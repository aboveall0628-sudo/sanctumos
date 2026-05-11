/**
 * goalsRepo.js — 7계층 목표 CRUD (자동 암복호화)
 * 
 * 계층: daily → weekly → monthly → quarterly → yearly → 5year → 10year
 */

import { db, doc, deleteDoc, collection, query, where } from './firebase.js';
import { saveRecord, queryRecords } from './baseRepo.js';

const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', '5year', '10year'];

/**
 * 목표 저장
 */
export async function saveGoal(dek, goalData) {
    return await saveRecord(dek, 'goals', goalData, goalData.id);
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
 * 모델:
 *   - 시작일/만료일과 무관하게 그 사용자의 모든 daily 목표 가져옴.
 *     이건 결단 흐름을 그대로 흡수한 것이라 단일 날짜에 종속되지 않음.
 *     (필요 시 startDate==today 필터를 추가하기 좋은 자리)
 *   - 정렬: timeSlot != null(박힌 것) 먼저, 그 다음 order, 그 다음 createdAt.
 */
export async function getDailyGoals(dek, userId) {
    const q = query(
        collection(db, 'goals'),
        where('userId', '==', userId),
        where('period', '==', 'daily')
    );
    const goals = await queryRecords(dek, q);
    return goals.sort((a, b) => {
        // 박힌 목표를 먼저
        const aPlaced = a.timeSlot != null ? 1 : 0;
        const bPlaced = b.timeSlot != null ? 1 : 0;
        if (aPlaced !== bPlaced) return bPlaced - aPlaced;
        // 그 다음 order, 마지막으로 createdAt
        const ao = a.order ?? 0;
        const bo = b.order ?? 0;
        if (ao !== bo) return ao - bo;
        return 0;
    });
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
 * 특정 기간의 활성 목표 조회 (타임박싱 모달 자동 추천용)
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

export { PERIODS };
