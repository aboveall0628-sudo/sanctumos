/**
 * feedbacksRepo.js — 베타 사용자 피드백 CRUD (CS AI 트랙 §9 1단계)
 *
 * 2026-05-15 신규.
 *
 * 컬렉션: users/{userId}/feedbacks/{feedbackId}
 *
 * ⚠️ 평문 정책 — encryptionPolicy.js feedbacks 참고.
 *   사용자가 *의도적으로* 개발자(Swan)에게 보내는 메시지이므로 평문 저장.
 *   §2.2-C 동의 모달 4번 체크박스로 사용자에게 명시.
 *
 * 권한:
 *   - 본인: 자기 피드백 읽기·쓰기 (firestore.rules users/{uid} 매처)
 *   - Swan UID: 모든 사용자 피드백 읽기·상태 토글 (firestore.rules 별도 규칙)
 *
 * 종료 조건:
 *   - 사용자 [보내기] 버튼 → endReason: 'manual_send'
 *   - 5분 무응답 자동 → endReason: 'auto_timeout_5min'
 */

import {
    db, doc, getDoc, setDoc, deleteDoc, collection, collectionGroup,
    query, where, orderBy, getDocs, serverTimestamp, updateDoc, limit,
} from './firebase.js';

const SUB = 'feedbacks';

// ─── 헬퍼 ───────────────────────────────────────────────────

function feedbackId(userId) {
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `fb_${stamp}_${rand}`;
}

function feedbackDocRef(userId, id) {
    return doc(db, 'users', userId, SUB, id);
}

function feedbackCollRef(userId) {
    return collection(db, 'users', userId, SUB);
}

// ─── 생성 ──────────────────────────────────────────────────

/**
 * 새 피드백 대화 시작 — 첫 SWAN 인사 turn 만 든 빈 문서 생성.
 * 이후 addTurn 으로 turn 누적, finalize 로 종료·요약·분류 처리.
 *
 * @param {Object} params
 *   - userId: string
 *   - nickname: string
 *   - context: { screenPath, moduleName, viewport, userAgent }
 *   - openingTurn: { role: 'swan', text, at }
 *   - kind: 'feedback' | 'preSurvey' | 'postSurvey' (디폴트 'feedback')
 * @returns {Promise<string>} feedbackId
 */
export async function startFeedback({ userId, nickname, context, openingTurn, kind = 'feedback' }) {
    const id = feedbackId(userId);
    const record = {
        id,
        userId,
        nickname: nickname || '',
        createdAt: serverTimestamp(),

        // 대화 종류 (베타 검증 시나리오 v1 §1·§4 — 사전·사후 설문 합류)
        kind,

        // 자동 라벨 (열어주는 시점)
        screenPath:   context?.screenPath || '',
        moduleName:   context?.moduleName || '',
        viewport:     context?.viewport || '',
        userAgent:    context?.userAgent || '',
        consoleErrors: context?.consoleErrors || [],

        // 대화
        turns: openingTurn ? [openingTurn] : [],

        // 자동 처리 결과 (종료 시 채움)
        endedAt: null,
        endReason: null,
        summary: '',
        category: '',
        categoryConfidence: 0,

        // 사전·사후 설문 구조화 결과 (kind 가 preSurvey/postSurvey 일 때 채움)
        //   사전: { q1_focus, q2_frequency, q3_recent_failure, ... q10_personalGoal }
        //   스키마는 docs/backlog/1차_베타_검증_시나리오_v1.md §1 저장 스키마
        surveyExtract: null,

        // 관리자 상태
        status: 'unread',
        swanNote: '',
    };
    await setDoc(feedbackDocRef(userId, id), record);
    return id;
}

/**
 * 설문 구조화 결과 저장 (사전·사후 설문 finalize 시 추가 호출).
 *
 * @param {string} userId
 * @param {string} feedbackId
 * @param {Object} extract - { q1_focus: {...}, q2_frequency: {...}, ... }
 */
export async function saveSurveyExtract(userId, feedbackId, extract) {
    await updateDoc(feedbackDocRef(userId, feedbackId), {
        surveyExtract: extract || null,
    });
}

// ─── turn 누적 ───────────────────────────────────────────────

/**
 * 진행 중인 대화에 turn 한 줄 추가.
 *
 * @param {string} userId
 * @param {string} feedbackId
 * @param {Object} turn - { role: 'swan'|'user', text, at }
 * @param {number} maxTurns - 12턴 비용 가드 (기본 12)
 * @returns {Promise<{ turnCount: number, reachedMax: boolean }>}
 */
export async function addTurn(userId, feedbackId, turn, maxTurns = 12) {
    const ref = feedbackDocRef(userId, feedbackId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error(`feedback ${feedbackId} not found`);

    const turns = snap.data().turns || [];
    if (turns.length >= maxTurns) {
        return { turnCount: turns.length, reachedMax: true };
    }
    turns.push({
        role: turn.role,
        text: turn.text,
        at:   turn.at || new Date().toISOString(),
    });
    await updateDoc(ref, { turns });
    return { turnCount: turns.length, reachedMax: turns.length >= maxTurns };
}

// ─── 종료 + 요약·분류 ─────────────────────────────────────────

/**
 * 대화 종료 + 자동 요약·분류 결과 함께 저장.
 *
 * @param {string} userId
 * @param {string} feedbackId
 * @param {Object} params
 *   - endReason: 'manual_send' | 'auto_timeout_5min' | 'turn_limit_reached'
 *   - summary: string (Gemini 자동 요약 2~3줄)
 *   - category: 'error' | 'ux_ui' | 'feature_request' | 'other'
 *   - categoryConfidence: number 0~1
 */
export async function finalizeFeedback(userId, feedbackId, params) {
    const ref = feedbackDocRef(userId, feedbackId);
    await updateDoc(ref, {
        endedAt:            serverTimestamp(),
        endReason:          params.endReason,
        summary:            params.summary || '',
        category:           params.category || 'other',
        categoryConfidence: params.categoryConfidence ?? 0,
    });
}

// ─── 조회 (본인용) ───────────────────────────────────────────

export async function getFeedback(userId, feedbackId) {
    const snap = await getDoc(feedbackDocRef(userId, feedbackId));
    if (!snap.exists()) return null;
    return snap.data();
}

export async function getMyFeedbacks(userId, maxCount = 50) {
    const q = query(
        feedbackCollRef(userId),
        orderBy('createdAt', 'desc'),
        limit(maxCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
}

// ─── 조회 (Swan 관리자용) ────────────────────────────────────

/**
 * Swan 관리자 페이지 — 모든 사용자 feedbacks 시간순 묶음.
 *
 * collection group query 사용 — users/{userId}/feedbacks 전부 스캔.
 * 호출 측에서 SWAN_ADMIN_UID 권한 체크 후에만 호출.
 *
 * @param {Object} opts
 *   - status: 'unread' | 'read' | null (전체)
 *   - category: 'error' | 'ux_ui' | 'feature_request' | 'other' | null
 *   - limit: number (기본 100)
 *   - orderDir: 'desc' (최신) | 'asc' (오래된순)
 */
export async function getAllFeedbacksForAdmin(opts = {}) {
    const { status = null, category = null, limit: lim = 100, orderDir = 'desc' } = opts;

    // (2026-05-16 fix) collectionGroup 쿼리는 composite index 자동 안 잡힘.
    //   feedback_firestore_index_pattern.md 정책(index 의존 금지) 따라
    //   서버 필터·정렬 빼고 클라이언트에서 처리. 1차 베타 분량(< 1000건) 안전.
    const q = query(collectionGroup(db, SUB), limit(500));
    const snap = await getDocs(q);
    let rows = snap.docs.map(d => d.data());

    if (status)   rows = rows.filter(r => r.status === status);
    if (category) rows = rows.filter(r => (r.category || 'other') === category);

    rows.sort((a, b) => {
        const av = _tsToMs(a.createdAt);
        const bv = _tsToMs(b.createdAt);
        return orderDir === 'asc' ? av - bv : bv - av;
    });

    return rows.slice(0, lim);
}

function _tsToMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts.seconds) return ts.seconds * 1000;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ─── 상태 토글 (Swan용) ──────────────────────────────────────

export async function markAsRead(userId, feedbackId) {
    await updateDoc(feedbackDocRef(userId, feedbackId), { status: 'read' });
}

export async function markAsUnread(userId, feedbackId) {
    await updateDoc(feedbackDocRef(userId, feedbackId), { status: 'unread' });
}

export async function updateCategory(userId, feedbackId, category) {
    await updateDoc(feedbackDocRef(userId, feedbackId), { category });
}

export async function updateSwanNote(userId, feedbackId, note) {
    await updateDoc(feedbackDocRef(userId, feedbackId), { swanNote: note || '' });
}

// ─── 삭제 (soft) + 복구 + 영구 삭제 ──────────────────────────
// (2026-05-18) 사용자 명시 — 삭제 가능 + 복구 가능. 수정은 X.
//   soft delete = deletedAt 자리. getAllFeedbacksForAdmin 기본 결과에서 제외.
//   휴지통 탭에서 복구 또는 영구 삭제 선택.

export async function softDeleteFeedback(userId, feedbackId) {
    await updateDoc(feedbackDocRef(userId, feedbackId), {
        deletedAt: serverTimestamp(),
    });
}

export async function restoreFeedback(userId, feedbackId) {
    await updateDoc(feedbackDocRef(userId, feedbackId), {
        deletedAt: null,
    });
}

// 영구 삭제 — 휴지통 안 항목만 호출 (Firestore doc 완전 제거)
export async function deleteFeedback(userId, feedbackId) {
    await deleteDoc(feedbackDocRef(userId, feedbackId));
}
