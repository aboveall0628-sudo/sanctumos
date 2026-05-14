/**
 * reportQuestionsRepo.js — Q&A 응답 누적 (Phase E-9/R-QA, spec §4 + §5)
 *
 * 컬렉션: 'reportQuestions'
 *   plaintext: id, userId, reportId, reportType, askedAt, createdAt
 *              + seenAt (다음 아침 게이트에서 노출 후 마킹)
 *              + archivedAt (2026-05-14, 리포트 재작성 시 사용자 정책 C — 옛 사고 흔적 보존 + 새 카드에선 숨김)
 *   encrypted: question, observationFlow, returnToMeditation
 *
 * 흐름:
 *   1) 사용자가 카드 하단 입력창에 질문 → callReportQuestion → 응답 받음
 *   2) saveReportQuestion → Firestore 에 저장
 *   3) 다음 아침 게이트 (대시보드 #today-start-content) 가 listUnseenQuestions 로 조회
 *   4) 사용자가 본 뒤 markSeen → 다음엔 안 보임
 *   5) 사용자가 리포트 재작성(↻) → archiveQuestionsByReport 호출
 *      → listQuestionsByReport 기본 호출은 active 만 반환 (새 카드 깨끗)
 *      → 사용자가 "이전 Q&A N건 보기" 토글 누르면 listArchivedQuestionsByReport
 *
 * seenAt / archivedAt 둘 다 plaintext 메타 (본문은 암호화 유지).
 */

import {
    db, collection, query, where, orderBy, limit, serverTimestamp,
    doc, setDoc, getDocs,
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
        archivedAt:         null,
        createdAt:          serverTimestamp(),
    };
    await saveRecord(dek, COLLECTION, data, id);
    return id;
}

/**
 * 특정 리포트에 대한 질문 목록 (최신순). 기본은 archived 제외 — 새 카드 깨끗.
 *
 * Firestore composite index 회피: userId 단일 where 로 가져온 뒤
 * 클라이언트에서 reportId 필터 + askedAt 정렬.
 * (메모리: feedback_firestore_index_pattern.md)
 *
 * @param {Object} [opts]
 *   @param {boolean} [opts.includeArchived=false] true면 archived 도 함께 반환
 */
export async function listQuestionsByReport(dek, userId, reportId, limitCount = 10, opts = {}) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(100),
    );
    const all = await queryRecords(dek, q);
    return all
        .filter(r => r.reportId === reportId)
        .filter(r => opts.includeArchived ? true : !r.archivedAt)
        .sort((a, b) => toMillis(b.askedAt) - toMillis(a.askedAt))
        .slice(0, limitCount);
}

/**
 * 리포트 재작성(↻) 시 호출 — 같은 reportId 의 active Q&A 를 archivedAt 으로 마킹.
 * 본문 암호화 필드는 그대로 보존. plaintext 메타만 갱신.
 * (사용자 명시 정책 C — 사고 흔적 보존, 새 카드에선 숨김, 토글로 펼침)
 *
 * baseRepo.queryRecords 는 readDocument(dek) 강제라 dek 없이 plaintext 만 보려면
 * raw getDocs 로 직접 docSnap.data() 의 평문 필드(userId/reportId/archivedAt) 만 읽음.
 */
export async function archiveQuestionsByReport(userId, reportId) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(100),
    );
    const snap = await getDocs(q);
    const targets = [];
    snap.forEach(docSnap => {
        const data = docSnap.data() || {};
        if (data.reportId === reportId && !data.archivedAt) {
            targets.push(docSnap.id);
        }
    });
    await Promise.all(targets.map(id => {
        const ref = doc(db, COLLECTION, id);
        return setDoc(ref, { archivedAt: serverTimestamp() }, { merge: true });
    }));
    return targets.length;
}

/**
 * archive 된 Q&A 목록 — 사용자가 "이전 Q&A N건 보기" 토글 누를 때.
 */
export async function listArchivedQuestionsByReport(dek, userId, reportId, limitCount = 20) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(100),
    );
    const all = await queryRecords(dek, q);
    return all
        .filter(r => r.reportId === reportId && !!r.archivedAt)
        .sort((a, b) => toMillis(b.archivedAt) - toMillis(a.archivedAt))
        .slice(0, limitCount);
}

/**
 * archive 카운트 — UI 토글 노출 여부 결정 시 가벼운 호출. 본문 디크립트 회피.
 * archiveQuestionsByReport 와 동일 — raw getDocs 로 평문 메타만 읽음.
 */
export async function countArchivedByReport(userId, reportId) {
    const q = query(
        collection(db, COLLECTION),
        where('userId', '==', userId),
        limit(100),
    );
    const snap = await getDocs(q);
    let count = 0;
    snap.forEach(docSnap => {
        const data = docSnap.data() || {};
        if (data.reportId === reportId && !!data.archivedAt) count++;
    });
    return count;
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
        // archived 도 게이트에서 제외 — 사용자가 재작성했다는 건 새 출발 의지
        .filter(r => !r.seenAt && !r.archivedAt)
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
