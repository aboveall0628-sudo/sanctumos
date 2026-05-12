/**
 * orgRepo.js — 조직 카드 CRUD
 *
 * 저장 위치: users/{uid}/organizations/{orgId}
 *
 * roles (v5 2026-05-12): string[] — 한 곳이 여러 역할을 동시에 가질 수 있음
 *   · people     : 사람 모임 (회사·팀·학교·교회·커뮤니티·가족·동창회 등 subType으로 세분)
 *   · membership : 등록·소속이 있는 곳 (헬스장·코스트코·학교 등록·교회 등록)
 *   · regular    : 자주 가서 안면 있는 곳 (단골 미용실·동네 카페)
 *   · visit      : 한 번씩 or 새로 가본 곳 (낯선 식당·미술관·관광지)
 *   예) 교회 → ['people', 'membership']   /   학교 → ['people', 'membership']
 *       단골 카페에 적립카드 있음 → ['regular', 'membership']
 *       헬스장 → ['membership']            /   가족 → ['people']
 * subType: people 역할의 세부 (company | team | school | church | community | friends | family | other)
 * activityType: 장소 역할(membership/regular/visit) 의 활동 영역 — restaurant | shop | bigStore | medical | beauty | culture | leisure | workout | none
 *
 * stance: ally | neutral | caution | adversary
 */

import { db, doc, deleteDoc } from './firebase.js';
import { saveRecord, getRecord, queryRecords, subPath } from './baseRepo.js';

const SUB = 'organizations';

// 이전 분류(v3 단일 type) → 새 v5 (roles 배열 + subType/activityType) 자동 매핑.
// 학교/회사/교회는 사람 모임 + 멤버십을 동시에 가진다 — v5의 multi-role 모델이 이 본질을 잡음.
const TYPE_MIGRATION = {
    // 사람 모임 + 멤버십 (등록·소속을 가진 사람 조직)
    company:    { roles: ['people', 'membership'], subType: 'company' },
    school:     { roles: ['people', 'membership'], subType: 'school' },
    church:     { roles: ['people', 'membership'], subType: 'church' },
    // 사람 모임만
    team:       { roles: ['people'],               subType: 'team' },
    community:  { roles: ['people'],               subType: 'community' },
    family:     { roles: ['people'],               subType: 'family' },
    // 장소들
    restaurant: { roles: ['visit'],      activityType: 'restaurant' },
    shop:       { roles: ['visit'],      activityType: 'shop' },
    bigStore:   { roles: ['visit'],      activityType: 'bigStore' },
    medical:    { roles: ['visit'],      activityType: 'medical' },
    beauty:     { roles: ['regular'],    activityType: 'beauty' },
    culture:    { roles: ['visit'],      activityType: 'culture' },
    leisure:    { roles: ['visit'],      activityType: 'leisure' },
    place:      { roles: ['membership'], activityType: 'workout' },
    visit:      { roles: ['visit'],      activityType: 'none' },
    // v4 단일 type (people/membership/regular/visit/other) → roles 배열로 감싸기
    people:     { roles: ['people'] },
    membership: { roles: ['membership'] },
    regular:    { roles: ['regular'] },
    other:      { roles: [] },
};

const VALID_ROLES = new Set(['people', 'membership', 'regular', 'visit']);

function migrateLegacyType(o) {
    if (!o) return o;
    // 이미 v5 (roles 배열이 있고 비어있지 않거나 명시적 빈 배열)
    if (Array.isArray(o.roles)) return o;

    const mapped = TYPE_MIGRATION[o.type];
    if (!mapped) return { ...o, roles: [] };
    return { ...o, ...mapped };
}

export { VALID_ROLES };

/**
 * 조직 카드 저장(생성/수정)
 */
export async function saveOrganization(dek, userId, data) {
    if (!data.id) {
        data.id = `org_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    return saveRecord(dek, subPath(userId, SUB), data, data.id);
}

/**
 * 단일 조직 조회. 옛 type 자동 매핑.
 */
export async function getOrganization(dek, userId, orgId) {
    const o = await getRecord(dek, subPath(userId, SUB), orgId);
    return migrateLegacyType(o);
}

/**
 * 사용자의 모든 조직 (이름 정렬). 로드 시 옛 type을 새 분류(v4)로 자동 매핑.
 */
export async function getAllOrganizations(dek, userId) {
    const orgs = await queryRecords(dek, subPath(userId, SUB));
    return orgs
        .map(migrateLegacyType)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * type 별 조회
 */
export async function getOrganizationsByType(dek, userId, type) {
    const all = await getAllOrganizations(dek, userId);
    return all.filter(o => o.type === type);
}

/**
 * 이름으로 검색 (자동완성)
 */
export async function searchOrganizations(dek, userId, keyword) {
    if (!keyword || keyword.length < 1) return [];
    const all = await getAllOrganizations(dek, userId);
    const k = keyword.toLowerCase();
    return all.filter(o => (o.name || '').toLowerCase().includes(k));
}

/**
 * 멤버 인물 추가/제거
 */
export async function addMemberToOrg(dek, userId, orgId, personId) {
    const org = await getOrganization(dek, userId, orgId);
    if (!org) return;
    const members = Array.isArray(org.memberPersonIds) ? org.memberPersonIds : [];
    if (!members.includes(personId)) members.push(personId);
    org.memberPersonIds = members;
    return saveOrganization(dek, userId, org);
}

export async function removeMemberFromOrg(dek, userId, orgId, personId) {
    const org = await getOrganization(dek, userId, orgId);
    if (!org) return;
    const members = Array.isArray(org.memberPersonIds) ? org.memberPersonIds : [];
    org.memberPersonIds = members.filter(id => id !== personId);
    return saveOrganization(dek, userId, org);
}

/**
 * 조직 삭제
 */
export async function deleteOrganization(userId, orgId) {
    await deleteDoc(doc(db, 'users', userId, SUB, orgId));
}

/**
 * stance 변경 + 사유 기록 (v3-①-F 영적 안전장치)
 *
 * personRepo.changeStance와 동일한 시맨틱:
 *   - ally → caution/adversary 같은 부정 변경 시 30초 게이트 통과 후 호출
 *   - stanceHistory에 from/to/reason/prayerDone 누적
 */
export async function changeOrgStance(dek, userId, org, newStance, reason, prayerDone) {
    const history = Array.isArray(org.stanceHistory) ? org.stanceHistory.slice() : [];
    history.push({
        from: org.stance || 'neutral',
        to: newStance,
        changedAt: new Date().toISOString(),
        reason: reason || '',
        prayerDone: !!prayerDone,
    });
    org.stance = newStance;
    org.stanceHistory = history;
    return saveOrganization(dek, userId, org);
}
