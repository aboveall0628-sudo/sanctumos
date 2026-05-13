/**
 * personRepo.js — 인물 카드 CRUD (자동 암복호화)
 *
 * 저장 위치: users/{uid}/persons/{personId}
 *
 * 4-층 프로파일:
 *   Layer 1 정체성: name, nicknames, avatar, relation, innerCircle
 *   Layer 2 성격(Big Five): O/C/E/A/N (0-100)
 *   Layer 3 능력 스탯: 8 기본 + 사용자 정의 (0-100)
 *   Layer 4 관계: closeness/trust/friendliness/importance (1-5), stance
 *
 * 영적 안전장치:
 *   - stance 변경 시 (특히 ally→caution/adversary) 30초 기도 게이트 강제
 *   - 적대 카드 진입 시 meaningfulVerse 자동 노출
 *   - AI 호출 전 가명화 (P_001 토큰)
 */

import { db, doc, deleteDoc, query, where, orderBy } from './firebase.js';
import { saveRecord, getRecord, queryRecords, subPath, colRef } from './baseRepo.js';

const SUB = 'persons';

/**
 * 인물 카드 저장(생성/수정)
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {Object} data - 인물 카드 필드 일체
 */
export async function savePerson(dek, userId, data) {
    if (!data.id) {
        data.id = `person_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    return saveRecord(dek, subPath(userId, SUB), data, data.id);
}

/**
 * 단일 인물 카드 조회
 */
export async function getPerson(dek, userId, personId) {
    return getRecord(dek, subPath(userId, SUB), personId);
}

/**
 * 사용자의 모든 인물 카드 조회 (정렬: 최근 상호작용 → 이름)
 *
 * (B-4 본인 프로필 트랙 2026-05-13)
 *   본인 카드(isSelf=true)는 디폴트로 제외 — 인물 화면·자동완성·통계 모두 "다른 사람들"이 대상.
 *   본인 카드까지 포함하려면 opts.includeSelf=true 명시.
 *   본인 카드만 단독으로 가져오려면 getSelfCard 사용.
 */
export async function getAllPersons(dek, userId, opts = {}) {
    const includeSelf = !!opts.includeSelf;
    const persons = await queryRecords(dek, subPath(userId, SUB));
    const filtered = includeSelf ? persons : persons.filter(p => !p.isSelf);
    return filtered.sort((a, b) => {
        const ta = a.lastInteractionAt?.toMillis ? a.lastInteractionAt.toMillis() : 0;
        const tb = b.lastInteractionAt?.toMillis ? b.lastInteractionAt.toMillis() : 0;
        if (tb !== ta) return tb - ta;
        return (a.name || '').localeCompare(b.name || '');
    });
}

/**
 * stance 별 필터 조회 (ally/neutral/caution/adversary)
 */
export async function getPersonsByStance(dek, userId, stance) {
    const all = await getAllPersons(dek, userId);
    return all.filter(p => p.stance === stance);
}

/**
 * innerCircle (가족·배우자·소수의 친밀권)만 조회
 */
export async function getInnerCircle(dek, userId) {
    const all = await getAllPersons(dek, userId);
    return all.filter(p => p.innerCircle === true);
}

/**
 * 이름·별명으로 검색 (자동완성용)
 */
export async function searchPersons(dek, userId, keyword) {
    if (!keyword || keyword.length < 1) return [];
    const all = await getAllPersons(dek, userId);
    const k = keyword.toLowerCase();
    return all.filter(p => {
        if ((p.name || '').toLowerCase().includes(k)) return true;
        if (Array.isArray(p.nicknames) && p.nicknames.some(n => n.toLowerCase().includes(k))) return true;
        return false;
    });
}

/**
 * stance 변경 + 사유 기록 (영적 안전장치)
 *
 * ally → caution/adversary 같은 부정 변경 시:
 *   1) 30초 기도 게이트 통과 후에만 호출
 *   2) prayerDone=true 보장
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {Object} person - 기존 카드
 * @param {string} newStance
 * @param {string} reason - 변경 사유 (암호화 저장)
 * @param {boolean} prayerDone
 */
export async function changeStance(dek, userId, person, newStance, reason, prayerDone) {
    const history = Array.isArray(person.stanceHistory) ? person.stanceHistory.slice() : [];
    history.push({
        from: person.stance || 'neutral',
        to: newStance,
        changedAt: new Date().toISOString(),
        reason: reason || '',
        prayerDone: !!prayerDone,
    });
    person.stance = newStance;
    person.stanceHistory = history;
    return savePerson(dek, userId, person);
}

/**
 * 마지막 상호작용 시간 갱신 (interaction 저장 시 호출)
 */
export async function touchLastInteraction(dek, userId, personId) {
    const person = await getPerson(dek, userId, personId);
    if (!person) return;
    person.lastInteractionAt = new Date().toISOString();
    return savePerson(dek, userId, person);
}

/**
 * 인물 카드 삭제
 */
export async function deletePerson(userId, personId) {
    await deleteDoc(doc(db, 'users', userId, SUB, personId));
}

// ═══════════════════════════════════════════════════════════════════════
//  (B-4 본인 프로필 트랙 2026-05-13) 본인 카드 헬퍼
//  ─────────────────────────────────────────────────────────────────────
//  persons 컬렉션 안에 isSelf=true 카드를 단 1장 두고 본인 프로필을 표현.
//  - getSelfCard: 본인 카드 1장 조회 (없으면 null)
//  - ensureSelfCard: 본인 카드가 없으면 빈 카드 1장 생성 (첫 진입 자동)
//  - saveSelfCard: 본인 카드 저장 (isSelf=true 강제, lastSelfUpdatedAt 자동 갱신)
//  영적 은사 필드는 1차 제외 — project_gifts_talents_serving.md 별도 트랙.
// ═══════════════════════════════════════════════════════════════════════

const SELF_CARD_ID_PREFIX = 'person_self_';

/**
 * 본인 카드 1장 조회 — isSelf=true 인 카드 첫 매칭.
 * @returns {Object|null}
 */
export async function getSelfCard(dek, userId) {
    const all = await queryRecords(dek, subPath(userId, SUB));
    return all.find(p => p.isSelf === true) || null;
}

/**
 * 본인 카드 보장 — 없으면 빈 카드 1장 자동 생성.
 *   첫 진입 시 호출 → 사용자가 점진적으로 채워나감.
 *   "평가보다 인과" — 자동 점수화 X, 모든 본인 필드는 사용자가 직접 입력.
 */
export async function ensureSelfCard(dek, userId) {
    const existing = await getSelfCard(dek, userId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const data = {
        id: `${SELF_CARD_ID_PREFIX}${Date.now()}`,
        isSelf: true,
        // 정체성 1층 — 본인 기본값
        name: '',                   // 사용자가 채움
        nicknames: [],
        relation: 'self',           // 'self' 마커
        innerCircle: true,          // 본인은 항상 내 사람
        stance: 'ally',             // 본인 stance 의미 없음, ally 디폴트
        stanceHistory: [],
        // Big5·능력 — 모두 null 로 시작 ("모르겠어요" 디폴트, 사용자 직접 입력)
        bigFive: { O: null, C: null, E: null, A: null, N: null },
        competencies: {},
        relationship: { closeness: null, trust: null, friendliness: null, importance: null },
        // 본인 전용 — 빈 값으로 시작
        lifeStage: '',
        currentCity: '',
        homeChurch: '',
        faithStartDate: '',
        faithTone: '',
        valueKeywords: [],
        lifeMission: '',
        interests: [],
        identitySentence: '',
        currentChallenges: [],
        mbti: '',
        // visibility 는 디폴트가 UI 상수로 박혀있어 비워두면 디폴트 적용
        profileVisibility: {},
        profileVersionIds: [],
        // 메타
        lastSelfUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
    };
    await savePerson(dek, userId, data);
    return data;
}

/**
 * 본인 카드 저장 — isSelf=true 강제, lastSelfUpdatedAt 자동 갱신.
 *   사용자가 "내 프로필" 화면에서 저장 누르면 호출.
 */
export async function saveSelfCard(dek, userId, data) {
    const now = new Date().toISOString();
    const payload = {
        ...data,
        isSelf: true,                  // 강제
        lastSelfUpdatedAt: now,
        updatedAt: now,
    };
    if (!payload.id) {
        payload.id = `${SELF_CARD_ID_PREFIX}${Date.now()}`;
    }
    return savePerson(dek, userId, payload);
}

/**
 * fallback 카드(미등록 인물용 기본 프로필) 자동 생성
 *   - "지인 일반", "낯선 사람", "거래처 미상" 등
 */
export async function ensureFallbackCard(dek, userId, kind) {
    const fallbackId = `person_fallback_${kind}`;
    const existing = await getPerson(dek, userId, fallbackId);
    if (existing) return existing;

    const map = {
        'general':   { name: '지인 일반',   relation: 'acquaintance' },
        'stranger':  { name: '낯선 사람',   relation: 'unknown' },
        'vendor':    { name: '거래처 미상', relation: 'client' },
    };
    const meta = map[kind] || map.general;
    const data = {
        id: fallbackId,
        name: meta.name,
        relation: meta.relation,
        innerCircle: false,
        stance: 'neutral',
        isFallback: true,
        nicknames: [],
        bigFive: { O: null, C: null, E: null, A: null, N: null },
        competencies: {},
        relationship: { closeness: null, trust: null, friendliness: null, importance: null },
        stanceHistory: [],
        createdAt: new Date().toISOString(),
    };
    await savePerson(dek, userId, data);
    return data;
}
