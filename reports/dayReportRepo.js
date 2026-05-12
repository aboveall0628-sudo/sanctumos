/**
 * dayReportRepo.js — 일간 리포트 Firestore CRUD
 *
 * Reports 모듈 STEP 1.1 — 2026-05-11
 * docs/reports-spec.md §5 데이터 모델 기준.
 *
 * 기존 data/reportPipeline.js의 'dayReports' 컬렉션을 그대로 사용 (호환성 유지).
 * 새 spec 필드들(observations, questionsForMeditation)은 encryptionPolicy.js에서
 * 암호화 대상으로 등록 완료. baseRepo가 자동으로 암복호화 처리.
 *
 * 사용
 *   const stats = await aggregateDailyStats(dek, userId, date);
 *   await saveDayReport(dek, userId, date, stats, {
 *       aiSummary, observation, questionsForMeditation
 *   });
 *   const report = await getDayReport(dek, userId, date);
 */

import {
    db, collection, query, where, orderBy, limit, serverTimestamp
} from '../data/firebase.js';
import { saveRecord, getRecord, queryRecords } from '../data/baseRepo.js';

const COLLECTION = 'dayReports';

/**
 * 일간 리포트 저장
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} date - 'YYYY-MM-DD'
 * @param {Object} stats - aggregateDailyStats() 출력
 * @param {Object} aiSections - AI 호출 후 채워지는 부분
 *   @param {string|null} aiSections.aiSummary - 리포트 산문 전체
 *   @param {string|null} aiSections.observation - 그날 가장 두드러진 관찰 1개
 *   @param {string[]}    aiSections.questionsForMeditation - 묵상 질문 1~2개
 * @returns {Promise<string>} reportId
 */
export async function saveDayReport(dek, userId, date, stats, aiSections = {}) {
    const reportId = `${userId}_${date}`;

    const data = {
        id: reportId,
        userId,
        period: 'day',
        startDate: date,
        endDate: date,
        stats,                                                  // 평문 (인덱싱·쿼리)
        aiSummary:               aiSections.aiSummary ?? null,
        observations:            aiSections.observation ? [aiSections.observation] : [],
        questionsForMeditation:  aiSections.questionsForMeditation ?? [],
        userNotes:               '',
        drillDownChildIds:       [],
        createdAt:               serverTimestamp(),
    };

    await saveRecord(dek, COLLECTION, data, reportId);
    return reportId;
}

/**
 * 일간 리포트 조회 (자동 복호화)
 */
export async function getDayReport(dek, userId, date) {
    const reportId = `${userId}_${date}`;
    return getRecord(dek, COLLECTION, reportId);
}

/**
 * 최근 N개 일간 리포트 (자동 복호화)
 *
 * Firestore composite index 회피: userId 단일 where + 클라이언트 정렬·limit.
 * (메모리: feedback_firestore_index_pattern.md)
 */
export async function listDayReports(dek, userId, limitCount = 30) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(500),
    );
    const all = await queryRecords(dek, q);
    return all
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
        .slice(0, limitCount);
}

/**
 * 기간(startDate ~ endDate)에 속한 일간 리포트 조회 (주간 합성용)
 * 동일 패턴 — userId 단일 where + 클라이언트 필터·정렬.
 */
export async function getDayReportsByDateRange(dek, userId, startDate, endDate) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(500),
    );
    const all = await queryRecords(dek, q);
    return all
        .filter(r => r.startDate >= startDate && r.startDate <= endDate)
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

/**
 * 일간 리포트 존재 여부 (저녁 회고 진입 시 중복 생성 방지용)
 */
export async function dayReportExists(dek, userId, date) {
    return (await getDayReport(dek, userId, date)) !== null;
}
