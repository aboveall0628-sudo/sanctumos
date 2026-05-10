/**
 * goalsRepo.js — 7계층 목표 CRUD (자동 암복호화)
 * 
 * 계층: daily → weekly → monthly → quarterly → yearly → 5year → 10year
 */

import { db, doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, orderBy, serverTimestamp } from './firebase.js';
import { prepareDocument, readDocument } from '../crypto/cryptoService.js';

const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', '5year', '10year'];

/**
 * 목표 저장
 */
export async function saveGoal(dek, goalData) {
    const id = goalData.id || `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const meta = {
        id,
        userId: goalData.userId,
        period: goalData.period,
        parentGoalId: goalData.parentGoalId || null,
        startDate: goalData.startDate,
        endDate: goalData.endDate,
        status: goalData.status || 'active',
        progress: goalData.progress || 0,
        createdAt: serverTimestamp(),
    };

    const sensitive = {
        title: goalData.title || '',
        description: goalData.description || '',
        notes: goalData.notes || '',
        scriptureRef: goalData.scriptureRef || null,
    };

    const document = await prepareDocument(dek, meta, sensitive);
    await setDoc(doc(db, 'goals', id), document, { merge: true });
    return id;
}

/**
 * 사용자의 모든 목표 조회
 */
export async function getAllGoals(dek, userId) {
    const q = query(
        collection(db, 'goals'),
        where('userId', '==', userId),
        orderBy('period', 'asc')
    );
    const snapshot = await getDocs(q);
    const goals = [];
    for (const d of snapshot.docs) {
        try {
            goals.push(await readDocument(dek, d.data()));
        } catch (e) {
            goals.push(d.data());
        }
    }
    return goals;
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
    const snapshot = await getDocs(q);
    const goals = [];
    for (const d of snapshot.docs) {
        try {
            goals.push(await readDocument(dek, d.data()));
        } catch (e) {
            goals.push(d.data());
        }
    }
    return goals;
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
    const snapshot = await getDocs(q);
    const goals = [];
    for (const d of snapshot.docs) {
        try {
            goals.push(await readDocument(dek, d.data()));
        } catch (e) {
            goals.push(d.data());
        }
    }
    return goals;
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
