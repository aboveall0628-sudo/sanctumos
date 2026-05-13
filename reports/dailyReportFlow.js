/**
 * dailyReportFlow.js — 일간 리포트 생성 공용 함수
 *
 * 사용자가 "리포트 받기" 버튼을 누른 시점에 트리거.
 * 저녁 회고('오늘 리포트' 단계)와 오늘 화면('오늘의 리포트' 카드) 양쪽에서 호출.
 *
 * 흐름
 *   1) 이미 AI 응답이 채워져 있으면 기존 리포트 반환 (재생성 X)
 *   2) 도트 0개면 'no-dots' 상태로 반환
 *   3) aggregateDailyStats → callDailyReport → saveDayReport
 */

import { getDotsByDate } from '../data/dotsRepo.js';
import { db, doc, getDoc } from '../data/firebase.js';
import { readDocument } from '../crypto/cryptoService.js';
import { aggregateDailyStats } from './dailyAggregator.js';
import { getDayReport, saveDayReport } from './dayReportRepo.js';
import { callDailyReport } from '../ui/aiClient.js';
// 인물·조직 이름 매핑 — LLM이 Firestore ID 대신 실제 이름 보고 응답하도록
import { getAllPersons } from '../data/personRepo.js';
import { getAllOrganizations } from '../data/orgRepo.js';
// 재작성(↻) 시 이전 Q&A archive — 사용자 정책 C (2026-05-14)
import { archiveQuestionsByReport } from './reportQuestionsRepo.js';

/**
 * stats의 connections에 들어있는 personId/orgId를 실제 이름으로 매핑.
 * LLM에 전달할 statsForLLM 버전을 별도로 만들어 ID는 빼고 이름만 둠.
 *
 * 왜 분리하는가:
 *   - LLM 시스템 프롬프트에 "이름은 P_001 마스킹 토큰 그대로" 지침이 있는데,
 *     stats에 Firestore ID(예: 1778492102156_dx040x)가 들어가면 LLM이 그것을
 *     가명화 토큰으로 착각하고 "P_1778492102156_dx040x" 형태로 응답.
 *   - 해결: LLM 입력에서 personId/orgId 자체 제거 + 진짜 이름은 context.persons로
 *     전달 → 가명화·역가명화 정상 동작.
 *
 * @returns {Promise<{
 *   statsForLLM: Object,           // ID 제거 + 이름 포함, LLM 호출용
 *   personNames: string[],         // 가명화 context.persons용
 *   orgNames: string[],            // 가명화 context.orgs용
 * }>}
 */
export async function enrichStatsForLLM(dek, userId, stats) {
    const personConns = stats.connections?.persons || [];
    const orgConns   = stats.connections?.organizations || [];
    const timeline   = stats.dotsTimeline || [];

    // timeline 안에도 personIds/orgIds 가 들어있으면 매핑 대상.
    const hasTimelineIds = timeline.some(t =>
        (t.personIds && t.personIds.length > 0) || (t.orgIds && t.orgIds.length > 0)
    );

    if (personConns.length === 0 && orgConns.length === 0 && !hasTimelineIds) {
        return { statsForLLM: stats, personNames: [], orgNames: [] };
    }

    // 한 번에 모든 인물·조직 fetch (이 도트들에 등장한 사람들 매핑용)
    const [allPersons, allOrgs] = await Promise.all([
        getAllPersons(dek, userId).catch(() => []),
        getAllOrganizations(dek, userId).catch(() => []),
    ]);

    const personNameById = new Map(allPersons.map(p => [p.id, p.name || '(이름 미지정)']));
    const orgNameById    = new Map(allOrgs.map(o => [o.id, o.name || '(이름 미지정)']));

    // LLM용 — personId/orgId 제거, name만 포함
    const personsForLLM = personConns.map(({ personId, ...rest }) => ({
        name: personNameById.get(personId) || '(알 수 없는 인물)',
        ...rest,
    }));
    const orgsForLLM = orgConns.map(({ orgId, ...rest }) => ({
        name: orgNameById.get(orgId) || '(알 수 없는 조직)',
        ...rest,
    }));

    // STEP A-2: timeline 안의 personIds/orgIds 도 이름으로 치환 (#4 회귀 차단)
    const timelineForLLM = timeline.map(t => ({
        ...t,
        personIds: undefined,
        orgIds:    undefined,
        persons:   (t.personIds || []).map(id => personNameById.get(id)).filter(Boolean),
        orgs:      (t.orgIds || []).map(id => orgNameById.get(id)).filter(Boolean),
    }));

    const statsForLLM = {
        ...stats,
        connections: {
            ...stats.connections,
            persons:       personsForLLM,
            organizations: orgsForLLM,
        },
        dotsTimeline: timelineForLLM,
    };

    // 가명화 context — 진짜 이름들 (P_001 등으로 자동 치환됨)
    const personNames = Array.from(new Set([
        ...personsForLLM.map(p => p.name).filter(n => n && !n.startsWith('(')),
        ...timelineForLLM.flatMap(t => t.persons || []),
    ]));
    const orgNames = Array.from(new Set([
        ...orgsForLLM.map(o => o.name).filter(n => n && !n.startsWith('(')),
        ...timelineForLLM.flatMap(t => t.orgs || []),
    ]));

    return { statsForLLM, personNames, orgNames };
}

/**
 * 그날의 묵상 노트(content/decisions/prayer) fetch.
 * 가드레일 아래 동기-행동 연결 관찰용 (docs/reports-spec.md §1.5).
 *
 * meditations 컬렉션 doc ID 규약: `meditation_${userId}_${date}` (todayView.js와 동일).
 */
async function getMeditationForDate(dek, userId, date) {
    const id = `meditation_${userId}_${date}`;
    try {
        const snap = await getDoc(doc(db, 'meditations', id));
        if (!snap.exists()) return null;
        const data = await readDocument(dek, snap.data());
        // 빈 본문이면 굳이 LLM에 보내지 않음 (token 절약 + AI 혼란 방지)
        const hasContent = (data.content && data.content.trim().length > 0)
                        || (Array.isArray(data.decisions) && data.decisions.length > 0)
                        || (data.prayer && data.prayer.trim && data.prayer.trim().length > 0);
        if (!hasContent) return null;
        return {
            content:   data.content   || null,
            decisions: data.decisions || null,
            prayer:    data.prayer    || null,
        };
    } catch (e) {
        console.warn('[dailyReportFlow] meditation load failed:', e);
        return null;
    }
}

/**
 * 일간 리포트 생성 (또는 기존 반환)
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} date - 'YYYY-MM-DD'
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] - true면 기존 리포트 무시하고 새로 생성, 캐시도 우회
 *                                        ("리포트 재작성하기" 버튼이 사용)
 * @returns {Promise<{
 *   status: 'created'|'existed'|'no-dots',
 *   report: Object|null,
 *   fallback: boolean
 * }>}
 */
export async function generateDailyReport(dek, userId, date, opts = {}) {
    // 1) 이미 차있으면 그대로 (단 force=true면 무시하고 재생성)
    const existing = await getDayReport(dek, userId, date);
    if (!opts.force && existing && existing.aiSummary) {
        return { status: 'existed', report: existing, fallback: false };
    }

    // 재작성 모드 — 같은 reportId 의 이전 Q&A 를 archive (정책 C)
    if (opts.force) {
        archiveQuestionsByReport(userId, date).catch(e => console.warn('[dailyReport] archive Q&A failed:', e));
    }

    // 2) 도트 0개면 의미 있는 리포트 못 만듦
    const dots = await getDotsByDate(dek, userId, date);
    if (dots.length === 0) {
        return { status: 'no-dots', report: null, fallback: false };
    }

    // 3) 집계 + 묵상 노트 fetch
    const [rawStats, meditation] = await Promise.all([
        aggregateDailyStats(dek, userId, date),
        getMeditationForDate(dek, userId, date),
    ]);

    // 4) 인물·조직 ID → 이름 매핑 (LLM이 ID 대신 이름 보고 응답하도록)
    const { statsForLLM, personNames, orgNames } = await enrichStatsForLLM(dek, userId, rawStats);

    // 5) AI 호출 — 가명화 context에 이름 채워서 P_001 자동 치환
    const aiResult = await callDailyReport(statsForLLM, {
        persons: personNames,
        orgs:    orgNames,
        places:  [],
        amounts: [],
    }, meditation, { force: !!opts.force });

    // 6) 저장 — 원본 stats(personId 유지)는 그대로 보존 (드릴다운용)
    await saveDayReport(dek, userId, date, rawStats, {
        aiSummary:              aiResult.aiSummary,
        observation:            aiResult.observation,
        questionsForMeditation: aiResult.questionsForMeditation,
    });

    const saved = await getDayReport(dek, userId, date);
    return { status: 'created', report: saved, fallback: aiResult.fallback };
}
