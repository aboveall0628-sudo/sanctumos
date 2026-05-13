/**
 * goalVersionsRepo.js — 목표 시점 스냅샷 (방법 A)
 *
 * 워크플로우 트랙(2026-05-13)에서 박은 모델.
 * 도트는 자신이 분배될 때의 currentVersion 을 goalVersionId 로 박고,
 * 컨텍스트 복원 시 여기서 그 시점 목표를 그대로 꺼낸다.
 *
 * 자동 버전 트리거: goalsRepo.saveGoal 이 핵심 필드 변경을 감지하면
 * createNextVersion() 을 호출해 새 스냅샷 생성 + 이전 활성 버전의 validTo 박기.
 * 명시적 revisionReason 은 의사결정 게이트(B1 트랙)가 채울 자리로 비워둔다.
 *
 * 평가보다 인과: 스냅샷은 그 시점의 컨텍스트 보존만 담당. 어떤 버전이
 * "더 좋다/나쁘다" 라벨을 박지 않는다.
 */

import { db, collection, query, where } from './firebase.js';
import { saveRecord, getRecord, queryRecords } from './baseRepo.js';

const PATH = 'goalVersions';

/**
 * docId 규약: `${goalId}_v${versionNumber}`
 */
export function goalVersionId(goalId, versionNumber) {
    return `${goalId}_v${versionNumber}`;
}

/**
 * 핵심 필드만 추출 — 이 셋이 바뀌면 "버전 차이"로 본다.
 * 단순 표현 수정(공백/오타)도 v↑ 시키지만, 도피 행동화 방지를 위해
 * R2(목표 수정은 의사결정 게이트 통과 의무) 적용 시점에 막힐 자리.
 *
 * timeSlot/placedAt 같은 일일 배치 상태는 제외 — 시점 스냅샷이 매일
 * 폭증하면 R1(데이터 부피)이 깨진다.
 */
const CORE_FIELDS = ['title', 'description', 'parentGoalId', 'period', 'startDate', 'endDate', 'status'];

export function corePayload(goal) {
    const out = {};
    CORE_FIELDS.forEach(k => { out[k] = goal[k] ?? null; });
    return out;
}

/**
 * 두 목표가 의미상 동일한지 — 핵심 필드 비교
 */
export function isSameVersion(a, b) {
    if (!a || !b) return false;
    for (const k of CORE_FIELDS) {
        if ((a[k] ?? null) !== (b[k] ?? null)) return false;
    }
    return true;
}

/**
 * 특정 버전 1건 조회
 */
export async function getGoalVersion(dek, goalId, versionNumber) {
    return await getRecord(dek, PATH, goalVersionId(goalId, versionNumber));
}

/**
 * 특정 목표의 모든 버전 (versionNumber asc).
 * composite index 회피 — userId 단일 쿼리 후 클라이언트 필터.
 */
export async function getVersionsByGoal(dek, userId, goalId) {
    const q = query(
        collection(db, PATH),
        where('userId', '==', userId)
    );
    const all = await queryRecords(dek, q);
    return all
        .filter(v => v.goalId === goalId)
        .sort((a, b) => (a.versionNumber ?? 0) - (b.versionNumber ?? 0));
}

/**
 * 현재 활성 버전 (validTo == null).
 * 항상 하나여야 하지만, 데이터 깨짐 대비 versionNumber max 로 fallback.
 */
export async function getActiveVersion(dek, userId, goalId) {
    const all = await getVersionsByGoal(dek, userId, goalId);
    const active = all.find(v => v.validTo == null);
    if (active) return active;
    return all.length ? all[all.length - 1] : null;
}

/**
 * 새 버전 생성.
 * goalsRepo.saveGoal 이 핵심 필드 변경을 감지했을 때 호출.
 * 이전 활성 버전이 있으면 validTo 박고 닫는다.
 *
 * @param {CryptoKey} dek
 * @param {Object} goal — 새 시점의 목표 객체 (currentVersion 은 호출측이 ++)
 * @param {Object} opts
 *   - revisionReason: 의사결정 게이트가 채울 자리. 자동 감지면 빈 문자열.
 *   - source: 'self_report' | 'ai_inferred' | 'system_auto' (자동 감지 시 'system_auto')
 *   - sourcePrecedentId: (B-1) 이 버전을 만든 판례 id. 게이트 통과 시 채움.
 *   - now: Date.now() override (테스트용)
 * @returns {Promise<{ id, versionNumber }>}
 */
export async function createNextVersion(dek, goal, opts = {}) {
    const {
        revisionReason = '',
        source = 'system_auto',
        sourcePrecedentId = null,
        now = Date.now()
    } = opts;
    if (!goal?.id || !goal?.userId) {
        throw new Error('createNextVersion: goal.id / goal.userId required');
    }

    // 이전 활성 버전 닫기
    const prev = await getActiveVersion(dek, goal.userId, goal.id);
    if (prev && prev.validTo == null) {
        const closed = { ...prev, validTo: now };
        await saveRecord(dek, PATH, closed, prev.id);
    }

    const versionNumber = (prev?.versionNumber ?? 0) + 1;
    const id = goalVersionId(goal.id, versionNumber);
    const record = {
        id,
        userId: goal.userId,
        goalId: goal.id,
        versionNumber,
        validFrom: now,
        validTo: null,
        source,
        snapshotData: corePayload(goal),
        revisionReason,
        sourcePrecedentId
    };
    await saveRecord(dek, PATH, record, id);
    return { id, versionNumber };
}
