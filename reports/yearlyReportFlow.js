/**
 * yearlyReportFlow.js — 연간 리포트 생성 (Phase E-9/R-4)
 */

import { aggregateYearlyStats } from './yearlyAggregator.js';
import { getYearReport, saveYearReport } from './yearReportRepo.js';
import { callYearlyReport } from '../ui/aiClient.js';
import { getAllPersons } from '../data/personRepo.js';
// STEP D-7 (2026-05-14): orgNetwork 신규 — orgId → name 매핑
import { getAllOrganizations } from '../data/orgRepo.js';
// 재작성(↻) 시 이전 Q&A archive — 사용자 정책 C
import { archiveQuestionsByReport } from './reportQuestionsRepo.js';

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
 * @param {string} yearStart - 'YYYY-01-01'
 * @param {string} yearEnd   - 'YYYY-12-31'
 */
export async function generateYearlyReport(dek, userId, yearStart, yearEnd, opts = {}) {
    const rawStats = await aggregateYearlyStats(dek, userId, yearStart, yearEnd);
    const year = rawStats.year;

    const existing = await getYearReport(dek, userId, year);
    if (!opts.force && existing && existing.aiSummary) {
        return { status: 'existed', report: existing, fallback: false };
    }

    // 재작성 모드 — 같은 reportId 의 이전 Q&A 를 archive (정책 C)
    if (opts.force) {
        archiveQuestionsByReport(userId, year).catch(e => console.warn('[yearReport] archive Q&A failed:', e));
    }

    if (rawStats.totalDots === 0) {
        return { status: 'no-dots', report: null, fallback: false };
    }

    const { statsForLLM, personNames, orgNames } = await enrichStatsForLLM(dek, userId, rawStats);

    const aiResult = await callYearlyReport(statsForLLM, {
        persons: personNames,
        orgs:    orgNames,
        places:  [],
        amounts: [],
    }, null, { force: !!opts.force });

    await saveYearReport(dek, userId, yearStart, yearEnd, rawStats, {
        aiSummary:              aiResult.aiSummary,
        hypotheses:             aiResult.hypotheses,
        decisionFlow:           aiResult.decisionFlow,
        principleValidation:    aiResult.principleValidation,
        questionsForMeditation: aiResult.questionsForMeditation,
    });

    const saved = await getYearReport(dek, userId, year);
    return { status: 'created', report: saved, fallback: aiResult.fallback };
}
