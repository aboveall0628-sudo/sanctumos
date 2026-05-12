/**
 * yearReportRepo.js — 연간 리포트 Firestore CRUD (Phase E-9/R-4)
 *
 * reportId: `${userId}_${year}` (예: `uid_2026`)
 * 정책: config/encryptionPolicy.js의 yearReports
 */

import {
    db, collection, query, where, limit, serverTimestamp,
} from '../data/firebase.js';
import { saveRecord, getRecord, queryRecords } from '../data/baseRepo.js';

const COLLECTION = 'yearReports';

export async function saveYearReport(dek, userId, yearStart, yearEnd, stats, aiSections = {}) {
    const year = stats?.year;
    if (!year) throw new Error('saveYearReport: stats.year 누락');

    const reportId = `${userId}_${year}`;

    const data = {
        id:                     reportId,
        userId,
        period:                 'year',
        startDate:              yearStart,
        endDate:                yearEnd,
        stats,
        aiSummary:              aiSections.aiSummary              ?? null,
        hypotheses:             aiSections.hypotheses             ?? [],
        decisionFlow:           aiSections.decisionFlow           ?? null,
        principleValidation:    aiSections.principleValidation    ?? [],
        questionsForMeditation: aiSections.questionsForMeditation ?? [],
        userNotes:              '',
        drillDownChildIds:      [],
        createdAt:              serverTimestamp(),
    };

    await saveRecord(dek, COLLECTION, data, reportId);
    return reportId;
}

export async function getYearReport(dek, userId, year) {
    const reportId = `${userId}_${year}`;
    return getRecord(dek, COLLECTION, reportId);
}

export async function listYearReports(dek, userId, limitCount = 5) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(20),
    );
    const all = await queryRecords(dek, q);
    return all
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
        .slice(0, limitCount);
}

export async function yearReportExists(dek, userId, year) {
    return (await getYearReport(dek, userId, year)) !== null;
}
