/**
 * monthReportRepo.js — 월간 리포트 Firestore CRUD
 *
 * Reports 모듈 STEP 2 (Phase E-9/R-2) — 2026-05-12
 * docs/reports-spec.md §5 데이터 모델 + config/encryptionPolicy.js의 monthReports 정책 기준.
 *
 * reportId 규약: `${userId}_${yearMonth}` (예: `uid_2026-05`)
 *
 * 컬렉션: 'monthReports'
 *   - plaintext: id, userId, period, startDate, endDate, stats, drillDownChildIds, createdAt
 *   - encrypted: aiSummary, hypotheses, patternsObserved(A1), decisionFlow,
 *                questionsForMeditation, userNotes
 */

import {
    db, collection, query, where, orderBy, limit, serverTimestamp,
} from '../data/firebase.js';
import { saveRecord, getRecord, queryRecords } from '../data/baseRepo.js';

const COLLECTION = 'monthReports';

/**
 * 월간 리포트 저장
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} monthStart - 'YYYY-MM-DD'
 * @param {string} monthEnd   - 'YYYY-MM-DD' (포함)
 * @param {Object} stats      - aggregateMonthlyStats() 출력 (yearMonth 포함)
 * @param {Object} [aiSections]
 *   @param {string|null}     aiSections.aiSummary               - ## 사실 산문
 *   @param {Array<Object>}   aiSections.hypotheses              - [{text, repetitionCount}]
 *   @param {Array<Object>}   aiSections.patternsObserved        - A1 패턴 N개 (도트 ID 노출 X)
 *   @param {string|null}     aiSections.decisionFlow            - A3 추상화 산문
 *   @param {string[]}        aiSections.questionsForMeditation  - 묵상 질문 4~5개
 * @returns {Promise<string>} reportId
 */
export async function saveMonthReport(dek, userId, monthStart, monthEnd, stats, aiSections = {}) {
    const yearMonth = stats?.yearMonth;
    if (!yearMonth) throw new Error('saveMonthReport: stats.yearMonth 누락 (aggregator 출력을 그대로 전달하세요)');

    const reportId = `${userId}_${yearMonth}`;

    const data = {
        id:                     reportId,
        userId,
        period:                 'month',
        startDate:              monthStart,
        endDate:                monthEnd,
        stats,                                                              // 평문
        aiSummary:              aiSections.aiSummary              ?? null,  // 암호화
        hypotheses:             aiSections.hypotheses             ?? [],    // 암호화
        patternsObserved:       aiSections.patternsObserved       ?? [],    // 암호화 (A1)
        decisionFlow:           aiSections.decisionFlow           ?? null,  // 암호화
        questionsForMeditation: aiSections.questionsForMeditation ?? [],    // 암호화
        userNotes:              '',
        drillDownChildIds:      [],                                         // 추후 weekReport ID 목록
        createdAt:              serverTimestamp(),
    };

    await saveRecord(dek, COLLECTION, data, reportId);
    return reportId;
}

/**
 * 월간 리포트 조회 (자동 복호화)
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} yearMonth - 'YYYY-MM'
 */
export async function getMonthReport(dek, userId, yearMonth) {
    const reportId = `${userId}_${yearMonth}`;
    return getRecord(dek, COLLECTION, reportId);
}

/**
 * 최근 N개 월간 리포트 (startDate desc)
 *
 * Firestore composite index 회피: userId 단일 where + 클라이언트 정렬.
 */
export async function listMonthReports(dek, userId, limitCount = 6) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(100),
    );
    const all = await queryRecords(dek, q);
    return all
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
        .slice(0, limitCount);
}

/**
 * 월간 리포트 존재 여부
 */
export async function monthReportExists(dek, userId, yearMonth) {
    return (await getMonthReport(dek, userId, yearMonth)) !== null;
}
