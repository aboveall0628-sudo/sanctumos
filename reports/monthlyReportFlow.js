/**
 * monthlyReportFlow.js — 월간 리포트 생성 공용 함수
 *
 * Reports 모듈 STEP 2 (Phase E-9/R-2) — 2026-05-12
 * 사용자가 월말 토요일 회고에서 "이번 달 리포트 만들기" / 리포트 메뉴의 재작성 버튼에서 트리거.
 *
 * 흐름
 *   1) aggregateMonthlyStats → yearMonth 결정 → 기존 리포트 조회
 *   2) 이미 AI 응답이 채워져 있고 force=false면 그대로 반환
 *   3) 도트 0개면 'no-dots' 반환
 *   4) enrichStatsForLLM (personId → name 매핑)
 *   5) callMonthlyReport (AI)
 *   6) saveMonthReport (원본 stats 유지 + AI 섹션 추가)
 *
 * weeklyReportFlow.js 와 같은 구조 — 인물 ID 노출 차단(0977193 패턴) 동일.
 */

import { aggregateMonthlyStats } from './monthlyAggregator.js';
import { getMonthReport, saveMonthReport } from './monthReportRepo.js';
import { callMonthlyReport } from '../ui/aiClient.js';
import { getAllPersons } from '../data/personRepo.js';
// STEP D-7 (2026-05-14): 신규 orgNetwork (5계층 통일) — orgId → name 매핑 추가
import { getAllOrganizations } from '../data/orgRepo.js';
// 재작성(↻) 시 이전 Q&A archive — 사용자 정책 C
import { archiveQuestionsByReport } from './reportQuestionsRepo.js';

/**
 * stats.personNetwork.items의 personId를 실제 이름으로 매핑.
 * LLM에 전달할 statsForLLM은 personId 제거 + name만 포함.
 *
 * 왜 분리하는가 (weeklyReportFlow와 동일):
 *   - LLM 시스템 프롬프트가 "이름은 P_001 마스킹 토큰 그대로" 지침
 *   - stats에 Firestore ID가 들어가면 LLM이 그것을 가명화 토큰으로 착각
 *   - 해결: LLM 입력에서 personId 제거 + 진짜 이름은 context.persons로 전달
 */
async function enrichStatsForLLM(dek, userId, stats) {
    const personItems = stats.personNetwork?.items || [];
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

    // 핀 원칙 효과성에는 ID가 없음 (집계 단계에서 hasPinned/avgSatisfaction만 산출) — 별도 처리 불필요
    const statsForLLM = {
        ...stats,
        personNetwork: { ...stats.personNetwork, items: personsForLLM },
        orgNetwork:    { ...stats.orgNetwork,    items: orgsForLLM },
    };

    const personNames = personsForLLM.map(p => p.name).filter(n => n && !n.startsWith('('));
    const orgNames    = orgsForLLM.map(o => o.name).filter(n => n && !n.startsWith('('));
    return { statsForLLM, personNames, orgNames };
}

/**
 * 월간 리포트 생성 (또는 기존 반환)
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} monthStart - 'YYYY-MM-DD'
 * @param {string} monthEnd   - 'YYYY-MM-DD' (포함)
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] - 기존 무시하고 새로 생성
 * @returns {Promise<{ status: 'created'|'existed'|'no-dots', report: Object|null, fallback: boolean }>}
 */
export async function generateMonthlyReport(dek, userId, monthStart, monthEnd, opts = {}) {
    // 1) 집계 먼저 — yearMonth가 필요 (reportId 결정)
    const rawStats = await aggregateMonthlyStats(dek, userId, monthStart, monthEnd);
    const yearMonth = rawStats.yearMonth;

    // 2) 이미 차있으면 그대로
    const existing = await getMonthReport(dek, userId, yearMonth);
    if (!opts.force && existing && existing.aiSummary) {
        return { status: 'existed', report: existing, fallback: false };
    }

    // 재작성 모드 — 같은 reportId 의 이전 Q&A 를 archive (정책 C)
    if (opts.force) {
        archiveQuestionsByReport(userId, yearMonth).catch(e => console.warn('[monthReport] archive Q&A failed:', e));
    }

    // 3) 도트 0개면 의미 있는 리포트 못 만듦
    if (rawStats.totalDots === 0) {
        return { status: 'no-dots', report: null, fallback: false };
    }

    // 4) personId·orgId → name 매핑 (STEP D-7: orgNetwork 추가)
    const { statsForLLM, personNames, orgNames } = await enrichStatsForLLM(dek, userId, rawStats);

    // 5) AI 호출
    const aiResult = await callMonthlyReport(statsForLLM, {
        persons: personNames,
        orgs:    orgNames,
        places:  [],
        amounts: [],
    }, null, { force: !!opts.force });

    // 6) 저장 — 원본 stats(personId 유지)는 그대로 보존 (드릴다운용)
    await saveMonthReport(dek, userId, monthStart, monthEnd, rawStats, {
        aiSummary:              aiResult.aiSummary,
        hypotheses:             aiResult.hypotheses,
        patternsObserved:       aiResult.patternsObserved,
        decisionFlow:           aiResult.decisionFlow,
        questionsForMeditation: aiResult.questionsForMeditation,
    });

    const saved = await getMonthReport(dek, userId, yearMonth);
    return { status: 'created', report: saved, fallback: aiResult.fallback };
}
