/**
 * referralRepo.js — 추천 링크 회로 (v75, 2026-05-18)
 *
 * 1차 베타 v6: 14명 시작 → 추천 링크 공유로 100명 도달.
 * 자세한 자리: project_referral_link_track.md
 *
 * 데이터 모델:
 *   - selfCard (persons/{uid}): referralCode · referredBy · referralCount (모두 평문)
 *   - referralCodes/{code}: { code, ownerUserId, count, createdAt } — 단일 컬렉션, 모두 평문
 *     · code → 본인 코드 (도큐먼트 id)
 *     · ownerUserId → 코드 주인 uid
 *     · count → 이 코드로 가입한 사람 수
 *
 * Firestore rules:
 *   - referralCodes/{code} read: 누구나 (가입 흐름 안 코드 유효성 확인)
 *   - create: 본인 uid 도큐먼트만 (ownerUserId == auth.uid)
 *   - update: count 1 증가만 허용 (다른 필드 변경 X)
 *
 * 핵심 함수:
 *   - generateUniqueReferralCode(nickname, ownerUserId) → 코드 자동 생성 + 충돌 시 5회 재시도 + Date.now 폴백
 *   - registerReferralCode(code, ownerUserId)          → referralCodes/{code} 도큐먼트 create
 *   - getReferralCode(code)                            → 코드로 도큐먼트 read (count 등 확인)
 *   - incrementReferralCount(code)                     → 새 사용자 가입 시 1 증가 (가입 흐름 안에서만)
 *   - getReferralCountByCode(code)                     → 자기 페이지에서 "N명 추천" 표시용
 */

import {
    db, doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from './firebase.js';
// increment 는 firebase.js export 안에 없어서 직접 import
import { increment } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

const REFERRAL_CODES_COLLECTION = 'referralCodes';
const MAX_RETRY = 5;
const SLUG_MAX_LEN = 12;

// ─── 코드 생성 헬퍼 ─────────────────────────────────────────

/**
 * 닉네임 → 영문 슬러그.
 *   한국어·이모지 등 비-알파벳은 제거. 빈 결과 시 'sanctum' 폴백.
 *   길이 12자 제한.
 */
function slugifyNickname(nickname) {
    const raw = String(nickname || '').toLowerCase();
    const slug = raw.replace(/[^a-z0-9]/g, '').slice(0, SLUG_MAX_LEN);
    return slug || 'sanctum';
}

/**
 * 영숫자 4자리 랜덤.
 */
function rand4() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 4; i++) {
        s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
}

/**
 * 한 자리 시도 — slug + '-' + rand4.
 */
function buildCandidate(slug) {
    return `${slug}-${rand4()}`;
}

// ─── 외부 API ────────────────────────────────────────────────

/**
 * 코드 존재 여부 확인.
 */
export async function checkCodeExists(code) {
    if (!code) return false;
    const snap = await getDoc(doc(db, REFERRAL_CODES_COLLECTION, code));
    return snap.exists();
}

/**
 * 충돌 회피 — 5회 재시도, 마지막 폴백은 Date.now 의 base36 접미사.
 *   동시 가입 흐름에서 race 가능성 낮지만 안전망.
 */
export async function generateUniqueReferralCode(nickname) {
    const slug = slugifyNickname(nickname);
    for (let i = 0; i < MAX_RETRY; i++) {
        const cand = buildCandidate(slug);
        try {
            const exists = await checkCodeExists(cand);
            if (!exists) return cand;
        } catch (e) {
            console.warn('[referralRepo] checkCodeExists failed (retry):', e);
        }
    }
    // 5회 실패 시 Date.now 폴백 — 충돌 가능성 거의 0
    return `${slug}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * 코드 도큐먼트 생성 — 본인 uid 와 1:1.
 *   ownerUserId 본인 auth.uid 와 일치해야 Firestore rules 통과.
 */
export async function registerReferralCode(code, ownerUserId) {
    if (!code || !ownerUserId) return;
    await setDoc(doc(db, REFERRAL_CODES_COLLECTION, code), {
        code,
        ownerUserId,
        count: 0,
        createdAt: serverTimestamp(),
    });
}

/**
 * 코드 도큐먼트 조회 — { code, ownerUserId, count, createdAt } 또는 null.
 */
export async function getReferralCode(code) {
    if (!code) return null;
    const snap = await getDoc(doc(db, REFERRAL_CODES_COLLECTION, code));
    return snap.exists() ? snap.data() : null;
}

/**
 * 카운터 1 증가 — 새 사용자 가입 시 referredBy 박힐 때 한 번만 호출.
 *   Firestore rules: count + 1 만 허용, 다른 필드 변경 X.
 */
export async function incrementReferralCount(code) {
    if (!code) return;
    try {
        await updateDoc(doc(db, REFERRAL_CODES_COLLECTION, code), {
            count: increment(1),
        });
    } catch (e) {
        console.warn('[referralRepo] incrementReferralCount failed:', e);
    }
}

/**
 * 코드별 카운트 조회 — 자기 페이지 "N명 추천" 표시용. 없으면 0.
 */
export async function getReferralCountByCode(code) {
    const data = await getReferralCode(code);
    return data?.count || 0;
}

// ─── 가입 흐름 통합 헬퍼 ──────────────────────────────────────

const REF_STORAGE_KEY = 'sanctum.ref.v1';

/**
 * URL 의 ?ref= 값을 sessionStorage 에 저장 — 부팅 시점 한 번 호출.
 *   가입 흐름 끝까지 살아남기 위해 sessionStorage 사용 (페이지 새로고침 OK, 탭 닫으면 사라짐).
 */
export function captureRefFromUrl() {
    if (typeof window === 'undefined') return;
    try {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref');
        if (ref && ref.trim()) {
            sessionStorage.setItem(REF_STORAGE_KEY, ref.trim());
        }
    } catch (e) {
        console.warn('[referralRepo] captureRefFromUrl failed:', e);
    }
}

/**
 * sessionStorage 에 저장된 ref 코드 읽기 — ensureSelfCard 안에서 사용.
 */
export function getCapturedRef() {
    if (typeof window === 'undefined') return null;
    try {
        return sessionStorage.getItem(REF_STORAGE_KEY);
    } catch (_) {
        return null;
    }
}

/**
 * 사용 완료 후 정리 — 한 번 박힌 사용자는 다시 처리 X.
 */
export function clearCapturedRef() {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.removeItem(REF_STORAGE_KEY);
    } catch (_) { /* ignore */ }
}
