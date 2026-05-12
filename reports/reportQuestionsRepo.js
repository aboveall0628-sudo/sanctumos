/**
 * reportQuestionsRepo.js — Q&A 응답 누적 (Phase E-9/R-QA, spec §4 + §5)
 *
 * 컬렉션: 'reportQuestions'
 *   plaintext: id, userId, reportId, reportType, askedAt, createdAt
 *              + (이 모듈에서 추가) seenAt (다음 아침 게이트에서 노출 후 마킹)
 *   encrypted: question, observationFlow, returnToMeditation
 *
 * 흐름:
 *   1) 사용자가 카드 하단 입력창에 질문 → callReportQuestion → 응답 받음
 *   2) saveReportQuestion → Firestore 에 저장
 *   3) 다음 아침 게이트 (대시보드 #today-start-content) 가 listUnseenQuestions 로 조회
 *   4) 사용자가 본 뒤 markSeen → 다음엔 안 보임
 *
 * seenAt 은 plaintext 추가 필드. 컬렉션 정책에 명시되어 있지 않지만 plaintext 메타에
 * 같이 둠 (질문/응답 본문은 암호화).
 */

import {
    db, collection, query, where, orderBy, limit, serverTimestamp,
    doc, setDoc,
} from '../data/firebase.js';
import { saveRecord, getRecord, queryRecords } from '../data/baseRepo.js';

const COLLECTION = 'reportQuestions';

/**
 * 질문 + AI 응답 저장.
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {Object} opts
 *   @param {string} opts.reportId   - 'YYYY-MM-DD' / 'YYYY-Www' / 'YYYY-MM' 등
 *   @param {string} opts.reportType - 'day'|'week'|'month'|'quarter'|'year'
 *   @param {string} opts.question
 *   @param {string} opts.observationFlow      - AI 응답 본문 (관찰된 흐름)
 *   @param {string} opts.returnToMeditation   - 마지막 두 줄 (묵상으로 종결)
 * @returns {Promise<string>} questionId
 */
export async function saveReportQuestion(dek, userId, opts) {
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const data = {
        id,
        userId,
        reportId:           opts.reportId,
        reportType:         opts.reportType,
        question:           opts.question,
        observationFlow:    opts.observationFlow,
        returnToMeditation: opts.returnToMeditation,
        askedAt:            serverTimestamp(),
        seenAt:             null,
        createdAt:          serverTimestamp(),
    };
    await saveRecord(dek, COLLECTION, data, id);
    return id;
}

/**
 * 특정 리포트에 대한 질문 목록 (최신순).
 */
export async function listQuestionsByReport(dek, userId, reportId, limitCount = 10) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        where('reportId', '==', reportId),
        orderBy('askedAt', 'desc'),
        limit(limitCount),
    );
    return queryRecords(dek, q);
}

/**
 * 다음 아침 게이트에 노출할 "아직 안 본" 질문들 (최근 N개).
 *
 * 정책: seenAt 이 null 인 것 중 최신 3개 정도.
 * Firestore composite index 회피를 위해 userId 단일 필터로 가져온 뒤
 * 클라이언트에서 seenAt null 필터 + askedAt 정렬 + slice.
 * (feedback_firestore_index_pattern.md 정책)
 */
export async function listUnseenReportQuestions(dek, userId, max = 3) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(50),
    );
    const records = await queryRecords(dek, q);
    return records
        .filter(r => !r.seenAt)
        .sort((a, b) => toMillis(b.askedAt) - toMillis(a.askedAt))
        .slice(0, max);
}

/**
 * 사용자가 봤다고 표시 — 다음 게이트엔 안 보이게.
 * 본문은 안 건드리고 plaintext seenAt 만 업데이트.
 */
export async function markQuestionSeen(userId, questionId) {
    if (!questionId) return;
    const ref = doc(db, COLLECTION, questionId);
    // 본문 암호화된 필드는 그대로 두고 메타만 업데이트
    await setDoc(ref, { seenAt: serverTimestamp() }, { merge: true });
}

function toMillis(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v?.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    return 0;
}
