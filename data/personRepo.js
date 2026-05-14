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
    const result = await saveRecord(dek, subPath(userId, SUB), data, data.id);

    // (본인 프로필 재기획 트랙 2026-05-14 S-B) 첫 인물 카드 미션 트리거.
    //   isSelf 카드(본인)는 제외 — 미션 의미는 "다른 사람 1명 박기".
    //   markMissionComplete 가 idempotent 라 dotsRepo 보조 트리거와 중복돼도 안전.
    if (data.isSelf !== true) {
        try {
            await markMissionComplete(dek, userId, 'person_first_dot', { signal: 'savePerson' });
        } catch (e) {
            console.warn('[savePerson] mission trigger failed:', e?.message || e);
        }
    }
    return result;
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
        // ─── (본인 프로필 재기획 트랙 2026-05-14 S-A) 신규 8 차원 빈 값 ───
        // (R12) 자동 정렬 메타 — 1차는 0, 의사결정·도트 트리거로 갱신 (후속 회로)
        displayOrder: 0,
        // (R17) 큐티 수준 — Day 0 큐티 수준 분기에서 박힘. 디폴트 null (사용자 첫 선택 기다림).
        devotionalLevel: null,
        // (R18) 미션 진행도 평문 요약 — 모듈별 클리어 표 (사이드바 잠금 가드용)
        //   각 모듈: { completed:boolean, unlockedAt?:ISO }
        missionStatus: {
            persons: { completed: false },
            organizations: { completed: false },
            economy: { completed: false },
            goals: { completed: false },
            decisions: { completed: false },
            reports: { completed: false },
            meditation: { completed: false },
            notifications: { completed: false },
            settings: { completed: false },
        },
        // (R19) GA4 가명화 토큰 — 사용자 동의 시 발급. 미동의면 null.
        gaAnonymousId: null,
        // (S-D 후속 2026-05-15) 사용자가 읽는 성경 번역본 id — 디폴트 'krv'(개역개정).
        bibleVersion: 'krv',
        // (R10) 간증 — 사용자 명시 글만, 자동 추출 X
        testimony: [],
        // (R15) 관계 추이 timeline — 본인 카드 안에서는 본인 스테이터스 변화 추이 (R12 연결)
        relationshipHistory: [],
        // (R17) 묵상 진도 사적 — 큐티 수준 따라 사용자별 어디까지 묵상했는지
        devotionalProgress: {},
        // (R18) 튜토리얼 상태 사적 — { [missionId]: { completedAt, signal, contextDotId? } }
        tutorialState: {},
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
 *
 *   반환: **저장된 카드 객체 전체** (id·lastSelfUpdatedAt 등 박힘 후 상태).
 *   ⚠️ 2026-05-14 버그 수정: 이전엔 savePerson(→saveRecord) 의 id 문자열을 그대로
 *   반환했음. 호출 측이 `_draft = saved` 패턴을 쓰면 _draft 가 string 으로 덮여
 *   다음 저장부터 spread/property 박기가 silent fail 됐음.
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
    await savePerson(dek, userId, payload);
    return payload;
}

// ─── (본인 프로필 재기획 트랙 2026-05-14 S-A) 미션 진행 헬퍼 3개 ───

/**
 * 모듈 ID → 미션 ID 추론 단순 매핑 (1차).
 *   미션 카탈로그(`config/missionCatalog.js`)가 S-B 에 박히면 그쪽에서 단일 출처로.
 */
const MODULE_FROM_MISSION_ID = {
    'person_first_dot':        'persons',
    'org_first_dot':           'organizations',
    'economy_first_transaction': 'economy',
    'goal_first_save':         'goals',
    'decision_first_record':   'decisions',
    'report_first_weekly':     'reports',
    'meditation_first_save':   'meditation'
};

/**
 * 미션 클리어 — selfCard 안 missionStatus 평문 갱신 + tutorialState 암호화 상세 박음.
 *   호출 측: dotsRepo.saveDot / economyRepo.saveTransaction / 등 각 repo 의 save 끝 (S-B).
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} missionId - 'person_first_dot' 등
 * @param {Object} opts - { signal?:string, contextDotId?:string }
 * @returns {Promise<boolean>} 이번 호출로 새로 클리어됐는지 (idempotent — 이미 클리어면 false)
 */
export async function markMissionComplete(dek, userId, missionId, opts = {}) {
    const moduleId = MODULE_FROM_MISSION_ID[missionId];
    if (!moduleId) return false;

    const self = await getSelfCard(dek, userId);
    if (!self) return false;

    const missionStatus = self.missionStatus || {};
    const moduleEntry = missionStatus[moduleId] || { completed: false };
    if (moduleEntry.completed) return false;  // idempotent

    const now = new Date().toISOString();
    const next = {
        ...self,
        missionStatus: {
            ...missionStatus,
            [moduleId]: { completed: true, unlockedAt: now }
        },
        tutorialState: {
            ...(self.tutorialState || {}),
            [missionId]: {
                completedAt: now,
                signal: opts.signal || null,
                contextDotId: opts.contextDotId || null
            }
        }
    };
    await saveSelfCard(dek, userId, next);

    // (S-C) 미션 클리어 즉시 UI 갱신 신호 — missionGate.js 가 listen.
    //   브라우저 환경에서만 발화 (테스트·SSR 환경 보호).
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('sanctum:mission-unlocked', {
                detail: { missionId, moduleId }
            }));
        } catch (_) { /* 이벤트 디스패치 실패는 무시 */ }
    }
    return true;
}

/**
 * 모듈 잠금 여부 — 사이드바 nav-* 진입 가드용 (R18c).
 *   도트·묵상은 처음부터 unlocked (Day 0 첫날부터 활성, Q6 B 결).
 *
 * @returns {Promise<boolean>} true 면 잠긴 상태
 */
export async function isModuleLocked(dek, userId, moduleId) {
    // 도트·묵상은 Day 0 첫날부터 활성 — 잠금 X
    // economy 는 B4 결정 (2026-05-14 S-B): 1.a 트랙 끝나기 전까지 처음부터 unlocked.
    if (moduleId === 'dots' || moduleId === 'meditation' || moduleId === 'today' || moduleId === 'self-profile' || moduleId === 'settings' || moduleId === 'economy') {
        return false;
    }
    const self = await getSelfCard(dek, userId);
    if (!self) return true;  // selfCard 없으면 잠긴 상태로 안전 fallback
    const entry = (self.missionStatus || {})[moduleId];
    return !entry || !entry.completed;
}

/**
 * 열린 미션 목록 — Day 1+ 메인 "오늘의 시작" 카드 미션 진행도 블록용 (S-D).
 *   missionCatalog 와 join 은 호출 측에서 (S-B 박힌 뒤).
 *
 * @returns {Promise<Array<{moduleId, completed, unlockedAt?}>>}
 */
export async function getOpenMissions(dek, userId) {
    const self = await getSelfCard(dek, userId);
    if (!self) return [];
    const ms = self.missionStatus || {};
    return Object.entries(ms).map(([moduleId, entry]) => ({
        moduleId,
        completed: !!entry.completed,
        unlockedAt: entry.unlockedAt || null
    }));
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
