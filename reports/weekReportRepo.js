/**
 * weekReportRepo.js — 주간 리포트 Firestore CRUD
 *
 * Reports 모듈 STEP 1.5 (Phase E-5-B/B-2) — 2026-05-11
 * docs/reports-spec.md §5 데이터 모델 기준.
 *
 * reportId 규약: `${userId}_${yearWeek}` (예: `uid_2026-W19`)
 *   yearWeek 는 weeklyAggregator.isoYearWeek() 와 동일 ISO 주차 포맷.
 *
 * 컬렉션: 'weekReports' (encryptionPolicy.js 에 이미 정책 등록됨)
 *   - plaintext: id, userId, period, startDate, endDate, stats, drillDownChildIds, createdAt
 *   - encrypted: aiSummary, hypotheses, decisionFlow, questionsForMeditation, userNotes
 *
 * 사용
 *   const stats = await aggregateWeeklyStats(dek, userId, weekStart, weekEnd);
 *   await saveWeekReport(dek, userId, weekStart, weekEnd, stats, {
 *       aiSummary, hypotheses, decisionFlow, questionsForMeditation
 *   });
 *   const report = await getWeekReport(dek, userId, yearWeek);
 */

import {
    db, collection, query, where, orderBy, limit, serverTimestamp,
} from '../data/firebase.js';
import { saveRecord, getRecord, queryRecords } from '../data/baseRepo.js';

const COLLECTION = 'weekReports';

/**
 * 주간 리포트 저장
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} weekStart - 'YYYY-MM-DD'
 * @param {string} weekEnd   - 'YYYY-MM-DD' (포함)
 * @param {Object} stats     - aggregateWeeklyStats() 출력 (yearWeek 포함)
 * @param {Object} [aiSections] - AI 호출 후 채워지는 부분
 *   @param {string|null}   aiSections.aiSummary               - ## 사실 산문
 *   @param {Array<Object>} aiSections.hypotheses              - [{text, repetitionCount}] (반복 횟수 표기 필수)
 *   @param {string|null}   aiSections.decisionFlow            - A3 추상화된 산문 (라벨·ID 없음)
 *   @param {string[]}      aiSections.questionsForMeditation  - 묵상 질문 3개
 * @returns {Promise<string>} reportId
 */
export async function saveWeekReport(dek, userId, weekStart, weekEnd, stats, aiSections = {}) {
    const yearWeek = stats?.yearWeek;
    if (!yearWeek) throw new Error('saveWeekReport: stats.yearWeek 누락 (aggregator 출력을 그대로 전달하세요)');

    const reportId = `${userId}_${yearWeek}`;

    const data = {
        id:                     reportId,
        userId,
        period:                 'week',
        startDate:              weekStart,
        endDate:                weekEnd,
        stats,                                                              // 평문 (수치·통계)
        aiSummary:              aiSections.aiSummary              ?? null,  // 암호화
        hypotheses:             aiSections.hypotheses             ?? [],    // 암호화
        decisionFlow:           aiSections.decisionFlow           ?? null,  // 암호화 (A3 산문)
        questionsForMeditation: aiSections.questionsForMeditation ?? [],    // 암호화
        userNotes:              '',
        drillDownChildIds:      [],                                         // 추후 dayReport ID 목록
        createdAt:              serverTimestamp(),
    };

    await saveRecord(dek, COLLECTION, data, reportId);
    return reportId;
}

/**
 * 주간 리포트 조회 (자동 복호화)
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} yearWeek - 'YYYY-Www' (예: '2026-W19')
 */
export async function getWeekReport(dek, userId, yearWeek) {
    const reportId = `${userId}_${yearWeek}`;
    return getRecord(dek, COLLECTION, reportId);
}

/**
 * 최근 N개 주간 리포트 (startDate desc, 자동 복호화)
 *
 * Firestore composite index 회피: userId 단일 where + 클라이언트 정렬.
 */
export async function listWeekReports(dek, userId, limitCount = 12) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(200),
    );
    const all = await queryRecords(dek, q);
    return all
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
        .slice(0, limitCount);
}

/**
 * 주간 리포트 존재 여부 (중복 생성 방지용)
 */
export async function weekReportExists(dek, userId, yearWeek) {
    return (await getWeekReport(dek, userId, yearWeek)) !== null;
}
