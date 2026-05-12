/**
 * yearlyReportFlow.js — 연간 리포트 생성 (Phase E-9/R-4)
 */

import { aggregateYearlyStats } from './yearlyAggregator.js';
import { getYearReport, saveYearReport } from './yearReportRepo.js';
import { callYearlyReport } from '../ui/aiClient.js';
import { getAllPersons } from '../data/personRepo.js';

async function enrichStatsForLLM(dek, userId, stats) {
    const personItems = stats.personNetwork?.items || [];
    if (personItems.length === 0) {
        return { statsForLLM: stats, personNames: [] };
    }
    const allPersons = await getAllPersons(dek, userId).catch(() => []);
    const personNameById = new Map(allPersons.map(p => [p.id, p.name || '(이름 미지정)']));
    const personsForLLM = personItems.map(({ personId, ...rest }) => ({
        name: personNameById.get(personId) || '(알 수 없는 인물)',
        ...rest,
    }));
    const statsForLLM = {
        ...stats,
        personNetwork: { ...stats.personNetwork, items: personsForLLM },
    };
    const personNames = personsForLLM.map(p => p.name).filter(n => n && !n.startsWith('('));
    return { statsForLLM, personNames };
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

    if (rawStats.totalDots === 0) {
        return { status: 'no-dots', report: null, fallback: false };
    }

    const { statsForLLM, personNames } = await enrichStatsForLLM(dek, userId, rawStats);

    const aiResult = await callYearlyReport(statsForLLM, {
        persons: personNames,
        orgs:    [],
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
