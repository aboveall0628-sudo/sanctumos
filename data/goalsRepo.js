/**
 * goalsRepo.js — 7계층 목표 CRUD (자동 암복호화)
 * 
 * 계층: daily → weekly → monthly → quarterly → yearly → 5year → 10year
 */

import { db, doc, deleteDoc, collection, query, where } from './firebase.js';
import { saveRecord, getRecord, queryRecords } from './baseRepo.js';
import {
    createNextVersion as createNextGoalVersion,
    isSameVersion as isSameGoalVersion
} from './goalVersionsRepo.js';

const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', '5year', '10year'];

/**
 * 목표 저장.
 *
 * 자동 버전 감지 (워크플로우 트랙 2026-05-13):
 * - 신규 목표 → v1 GoalVersion 자동 생성
 * - 기존 목표의 핵심 필드(title/description/parentGoalId/period/startDate/endDate/status)
 *   변경 → currentVersion ++ + 새 GoalVersion 생성, 이전 활성 버전의 validTo 박힘.
 * - 배치 상태(timeSlot/placedAt/order/progress/...)만 바뀌면 버전 변경 없음.
 *
 * opts.skipVersioning=true 로 자동 버전 우회 가능 (마이그레이션·시드 등 특수 케이스).
 *
 * @param {CryptoKey} dek
 * @param {Object} goalData
 * @param {Object} [opts]
 *   - skipVersioning: 자동 버전 감지 끔
 *   - revisionReason: 의사결정 게이트가 채울 자리 (B1 트랙)
 *   - sourcePrecedentId: (B-1) 이 변경을 만든 판례 id. 게이트 통과 시 채움.
 *   - source: 'self_report' | 'ai_inferred' | 'system_auto'
 */
export async function saveGoal(dek, goalData, opts = {}) {
    const { skipVersioning = false, revisionReason = '', sourcePrecedentId = null, source } = opts;

    if (!skipVersioning && dek && goalData?.id && goalData?.userId) {
        try {
            const prev = await getRecord(dek, 'goals', goalData.id);
            if (!prev) {
                // 신규 — currentVersion=1 박고 v1 스냅샷 생성
                goalData.currentVersion = 1;
                await createNextGoalVersion(dek, goalData, {
                    revisionReason,
                    sourcePrecedentId,
                    source: source || 'self_report'
                });
            } else if (!isSameGoalVersion(prev, goalData)) {
                // 핵심 필드 변경 감지 — 새 버전
                const next = (prev.currentVersion ?? 1) + 1;
                goalData.currentVersion = next;
                await createNextGoalVersion(dek, goalData, {
                    revisionReason,
                    sourcePrecedentId,
                    source: source || (sourcePrecedentId ? 'self_report' : 'system_auto')
                });
            } else {
                // 배치 상태 변경 등 — 버전 그대로 유지
                if (goalData.currentVersion == null) {
                    goalData.currentVersion = prev.currentVersion ?? 1;
                }
            }
        } catch (e) {
            // 버전 감지 실패는 저장 자체를 막지 않음 — 잘못된 의존으로 사용자 흐름이
            // 끊기는 게 더 위험. 콘솔에만 흔적 남기고 진행.
            console.warn('[saveGoal] version detection failed:', e?.message || e);
        }
    }

    const result = await saveRecord(dek, 'goals', goalData, goalData.id);

    // (본인 프로필 재기획 트랙 2026-05-14 S-B) 첫 목표 박기 미션 트리거.
    //   신규 목표일 때만 (currentVersion === 1). 시드·마이그레이션 경로(skipVersioning)는
    //   currentVersion 이 undefined 일 수 있어 자연스럽게 제외됨.
    if (goalData.currentVersion === 1) {
        try {
            const { markMissionComplete } = await import('./personRepo.js');
            await markMissionComplete(dek, goalData.userId, 'goal_first_save', { signal: 'saveGoal' });
        } catch (e) {
            console.warn('[saveGoal] mission trigger failed:', e?.message || e);
        }
    }
    return result;
}

/**
 * 사용자의 모든 목표 조회.
 * orderBy 제거 + client-side sort — composite index 없이도 동작 (dots/decisions 와 같은 패턴).
 */
export async function getAllGoals(dek, userId) {
    const q = query(
        collection(db, 'goals'),
        where('userId', '==', userId)
    );
    const goals = await queryRecords(dek, q);
    // PERIODS 순서대로 정렬 (daily → 10year)
    const periodOrder = { daily: 0, weekly: 1, monthly: 2, quarterly: 3, yearly: 4, '5year': 5, '10year': 6 };
    return goals.sort((a, b) => {
        const ap = periodOrder[a.period] ?? 99;
        const bp = periodOrder[b.period] ?? 99;
        return ap - bp;
    });
}

/**
 * 오늘 화면용 daily 목표 조회 (period='daily'만).
 *
 * date(YYYY-MM-DD)가 주어지면 그 날짜에 속한 daily 목표만 반환한다.
 * 날짜 판정 우선순위: goal.startDate → goal.date → goal.createdAt(YYYY-MM-DD 변환).
 * 셋 다 없으면(레거시 데이터) 그 날짜에 포함시켜 사라지지 않게 함.
 * date를 생략하면(undefined) 과거 호환을 위해 모든 daily 목표를 반환.
 *
 * 정렬: timeSlot != null(박힌 것) 먼저, 그 다음 order, 그 다음 createdAt.
 */
export async function getDailyGoals(dek, userId, date) {
    const q = query(
        collection(db, 'goals'),
        where('userId', '==', userId),
        where('period', '==', 'daily')
    );
    const goals = await queryRecords(dek, q);
    const filtered = date ? goals.filter(g => goalBelongsToDate(g, date)) : goals;
    return filtered.sort((a, b) => {
        const aPlaced = a.timeSlot != null ? 1 : 0;
        const bPlaced = b.timeSlot != null ? 1 : 0;
        if (aPlaced !== bPlaced) return bPlaced - aPlaced;
        const ao = a.order ?? 0;
        const bo = b.order ?? 0;
        if (ao !== bo) return ao - bo;
        return 0;
    });
}

function toLocalISO(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function goalBelongsToDate(goal, date) {
    if (goal.startDate) return goal.startDate === date;
    if (goal.date) return goal.date === date;
    if (goal.createdAt) return toLocalISO(goal.createdAt) === date;
    // 레거시: 어느 날짜에도 속하지 않은 목표는 일단 오늘 화면에서 보이게 둠
    return true;
}

/**
 * 목표를 시간 슬롯에 박기 (daily 목표 → 시간표 plan 레인).
 * 기존 decisionsRepo.placeDecision 의 goal 버전.
 */
export async function placeGoal(dek, goal, timeSlot, durationSlots = 4) {
    goal.timeSlot = timeSlot;
    goal.durationSlots = durationSlots;
    goal.placedAt = Date.now();
    return await saveGoal(dek, goal);
}

/**
 * 시간 슬롯에서 빼서 다시 미배치 카드로 (시간표 plan 슬롯의 ✕).
 */
export async function unplaceGoal(dek, goal) {
    goal.timeSlot = null;
    goal.placedAt = null;
    return await saveGoal(dek, goal);
}

/**
 * 특정 기간의 활성 목표 조회 ("시간표에 넣기" 모달 자동 추천용)
 */
export async function getActiveGoalsByPeriod(dek, userId, period) {
    const q = query(
        collection(db, 'goals'),
        where('userId', '==', userId),
        where('period', '==', period),
        where('status', '==', 'active')
    );
    return await queryRecords(dek, q);
}

/**
 * 특정 목표의 하위 목표 조회
 */
export async function getChildGoals(dek, userId, parentGoalId) {
    const q = query(
        collection(db, 'goals'),
        where('userId', '==', userId),
        where('parentGoalId', '==', parentGoalId)
    );
    return await queryRecords(dek, q);
}

/**
 * 목표를 트리 구조로 변환
 */
export function buildGoalTree(goals) {
    const map = {};
    const roots = [];

    goals.forEach(g => { map[g.id] = { ...g, children: [] }; });
    goals.forEach(g => {
        if (g.parentGoalId && map[g.parentGoalId]) {
            map[g.parentGoalId].children.push(map[g.id]);
        } else {
            roots.push(map[g.id]);
        }
    });

    return roots;
}

/**
 * 목표 삭제
 */
export async function deleteGoal(goalId) {
    await deleteDoc(doc(db, 'goals', goalId));
}

/**
 * (워크플로우 트랙 2026-05-13) 목표 → 도트 역참조 + 워크플로우 묶음 조회.
 *
 * dotsRepo.getDotsByGoalId + workflowsRepo.getWorkflowsByGoal 를 한 번에 묶어
 * 일일 의식 화면이 "이 목표의 워크플로우 + 분배된 도트"를 한 번에 받게 함.
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} goalId
 * @returns {Promise<{ dots: Object[], workflows: Object[] }>}
 */
export async function getGoalContext(dek, userId, goalId) {
    const { getDotsByGoalId } = await import('./dotsRepo.js');
    const { getWorkflowsByGoal } = await import('./workflowsRepo.js');
    const [dots, workflows] = await Promise.all([
        getDotsByGoalId(dek, userId, goalId),
        getWorkflowsByGoal(dek, userId, goalId)
    ]);
    return { dots, workflows };
}

export { PERIODS };
