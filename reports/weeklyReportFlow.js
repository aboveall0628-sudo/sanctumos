/**
 * weeklyReportFlow.js — 주간 리포트 생성 공용 함수
 *
 * Reports 모듈 STEP 1.5 (Phase E-5-B/B-3) — 2026-05-11
 * 사용자가 토요일 회고에서 "이번 주 리포트 만들기" 또는 리포트 메뉴의 재작성 버튼을 누른 시점에 트리거.
 *
 * 흐름
 *   1) 이미 AI 응답이 채워져 있으면 기존 리포트 반환 (force=true 면 무시하고 새로 호출)
 *   2) 도트 0개면 'no-dots' 상태로 반환
 *   3) aggregateWeeklyStats → enrichStatsForLLM (personId→name) → callWeeklyReport → saveWeekReport
 *
 * dailyReportFlow.js 와 같은 구조 — 인물 ID 노출 차단(0977193 패턴) 동일 적용.
 */

import { aggregateWeeklyStats } from './weeklyAggregator.js';
import { getWeekReport, saveWeekReport } from './weekReportRepo.js';
import { callWeeklyReport } from '../ui/aiClient.js';
import { getAllPersons } from '../data/personRepo.js';
// STEP D-7 (2026-05-14): orgNetwork 신규 (5계층 통일) — orgId → name 매핑
import { getAllOrganizations } from '../data/orgRepo.js';
// 재작성(↻) 시 이전 Q&A archive — 사용자 정책 C
import { archiveQuestionsByReport } from './reportQuestionsRepo.js';

/**
 * stats.personCounts.items 의 personId 를 실제 이름으로 매핑.
 * LLM 에 전달할 statsForLLM 은 personId 제거 + name 만 포함.
 *
 * 왜 분리하는가 (dailyReportFlow 와 동일 이유):
 *   - LLM 시스템 프롬프트가 "이름은 P_001 마스킹 토큰 그대로" 지침을 가짐
 *   - stats 에 Firestore ID(예: 1778492102156_dx040x)가 들어가면 LLM 이 그것을
 *     가명화 토큰으로 착각하고 "P_1778492102156_dx040x" 형태로 응답
 *   - 해결: LLM 입력에서 personId 제거 + 진짜 이름은 context.persons 로 전달
 *
 * @returns {Promise<{ statsForLLM: Object, personNames: string[], orgNames: string[] }>}
 */
async function enrichStatsForLLM(dek, userId, stats) {
    const personItems = stats.personCounts?.items || [];
    const orgItems    = stats.orgNetwork?.items || [];

    if (personItems.length === 0 && orgItems.length === 0) {
        return { statsForLLM: stats, personNames: [], orgNames: [] };
    }

    const [allPersons, allOrgs] = await Promise.all([
        getAllPersons(dek, userId).catch(() => []),
        getAllOrganizations(dek, userId).catch(() => []),
    ]);
    const personNameById = new Map(allPersons.map(p => [p.id, p.name || '(이름 미지정)']));
    const orgNameById    = new Map(allOrgs.map(o => [o.id, o.name || '(이름 미지정)']));

    const personsForLLM = personItems.map(({ personId, ...rest }) => ({
        name: personNameById.get(personId) || '(알 수 없는 인물)',
        ...rest,
    }));
    const orgsForLLM = orgItems.map(({ orgId, ...rest }) => ({
        name: orgNameById.get(orgId) || '(알 수 없는 조직)',
        ...rest,
    }));

    // 핀 원칙도 principleId 노출 안 하도록 LLM 용 버전에서 제거 (title 은 그대로 유지)
    const pinnedItems = stats.pinnedPrincipleApplication?.items || [];
    const pinnedForLLM = pinnedItems.map(({ principleId, ...rest }) => rest);

    const statsForLLM = {
        ...stats,
        personCounts: { items: personsForLLM },
        orgNetwork:   { ...stats.orgNetwork, items: orgsForLLM },
        pinnedPrincipleApplication: { items: pinnedForLLM },
    };

    const personNames = personsForLLM.map(p => p.name).filter(n => n && !n.startsWith('('));
    const orgNames    = orgsForLLM.map(o => o.name).filter(n => n && !n.startsWith('('));
    return { statsForLLM, personNames, orgNames };
}

/**
 * 주간 리포트 생성 (또는 기존 반환)
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} weekStart - 'YYYY-MM-DD'
 * @param {string} weekEnd   - 'YYYY-MM-DD' (포함)
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] - true면 기존 리포트 무시하고 새로 생성, 캐시도 우회
 * @returns {Promise<{
 *   status: 'created'|'existed'|'no-dots',
 *   report: Object|null,
 *   fallback: boolean
 * }>}
 */
export async function generateWeeklyReport(dek, userId, weekStart, weekEnd, opts = {}) {
    // 1) 집계 먼저 — yearWeek 가 필요해서 (reportId 결정)
    const rawStats = await aggregateWeeklyStats(dek, userId, weekStart, weekEnd);
    const yearWeek = rawStats.yearWeek;

    // 2) 이미 차있으면 그대로 (force=true 면 무시)
    const existing = await getWeekReport(dek, userId, yearWeek);
    if (!opts.force && existing && existing.aiSummary) {
        return { status: 'existed', report: existing, fallback: false };
    }

    // 재작성 모드 — 같은 reportId 의 이전 Q&A 를 archive (정책 C)
    if (opts.force) {
        archiveQuestionsByReport(userId, yearWeek).catch(e => console.warn('[weekReport] archive Q&A failed:', e));
    }

    // 3) 도트 0개면 의미 있는 리포트 못 만듦
    if (rawStats.totalDots === 0) {
        return { status: 'no-dots', report: null, fallback: false };
    }

    // 4) 인물·원칙·조직 ID → 이름 매핑 (LLM 응답이 ID 노출하지 않도록)
    const { statsForLLM, personNames, orgNames } = await enrichStatsForLLM(dek, userId, rawStats);

    // 5) AI 호출 — context.persons/orgs 로 진짜 이름들 넣어 P_001/O_001 자동 치환
    const aiResult = await callWeeklyReport(statsForLLM, {
        persons: personNames,
        orgs:    orgNames,
        places:  [],
        amounts: [],
    }, null, { force: !!opts.force });

    // 6) 저장 — 원본 stats(personId 유지)는 그대로 보존 (드릴다운용)
    await saveWeekReport(dek, userId, weekStart, weekEnd, rawStats, {
        aiSummary:              aiResult.aiSummary,
        hypotheses:             aiResult.hypotheses,
        decisionFlow:           aiResult.decisionFlow,
        questionsForMeditation: aiResult.questionsForMeditation,
    });

    const saved = await getWeekReport(dek, userId, yearWeek);
    return { status: 'created', report: saved, fallback: aiResult.fallback };
}
