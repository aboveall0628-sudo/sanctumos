/**
 * memorialsRepo.js — 추모비 (ExtinguishedGoalMemorial) CRUD + 폐기 트리거
 *
 * 사용자가 "이 목표 그만두기" 결정을 내릴 때 그 목표의 흔적을 추모비 한 장으로
 * 보존. 도트는 1차 단계에서 삭제하지 않고 목표만 status='archived' 변경.
 *
 * 1차 (HC#1) 단계 채움:
 *   - goalSnapshot, duration, dotStats, source, userNote — 즉시
 * 다음 트랙에 채움:
 *   - representativeDots (AI 선별 3개)
 *   - aiNarrativeSummary (AI 한 문단)
 *   - contributions (B-4 사람×능력×기여도)
 *   - triggeredByPrecedentId (B-1 의사결정 게이트 자동 트리거)
 *
 * 의미: "포기"가 아니라 "정직한 마무리". 같은 길 다시 가지 않도록 + 회상 자료.
 */

import { db, doc, collection, query, where } from './firebase.js';
import { saveRecord, getRecord, queryRecords } from './baseRepo.js';
import { saveGoal } from './goalsRepo.js';
import { getDotsByDateRange, computeDotStats } from './dotsRepo.js';

/**
 * 추모비 저장 (신규/수정).
 */
export async function saveMemorial(dek, memorial) {
    const docId = memorial.id
        || `mem_${memorial.userId}_${memorial.goalId}_${Date.now()}`;
    memorial.id = docId;
    return await saveRecord(dek, 'extinguishedGoalMemorials', memorial, docId);
}

/**
 * 특정 추모비 1개 조회.
 */
export async function getMemorial(dek, docId) {
    return await getRecord(dek, 'extinguishedGoalMemorials', docId);
}

/**
 * 사용자의 모든 추모비 조회 (최신순).
 * userId equality 단일 쿼리 + 클라이언트 정렬 — Firestore 인덱스 회피 패턴.
 */
export async function getMemorialsByUser(dek, userId) {
    const q = query(
        collection(db, 'extinguishedGoalMemorials'),
        where('userId', '==', userId)
    );
    const memorials = await queryRecords(dek, q);
    return memorials.sort((a, b) =>
        (b.extinguishedAt || '').localeCompare(a.extinguishedAt || '')
    );
}

/**
 * 목표 폐기 → 추모비 생성 + 목표 archived.
 *
 * 1차 흐름:
 *   1) 목표의 시작일 ~ 오늘 범위 도트들 수집해 통계 계산
 *   2) 추모비 객체 생성 (도트 삭제 X, contributions·AI 내러티브 빈 칸)
 *   3) 추모비 저장
 *   4) 목표 status='archived' 로 변경 (saveGoal — 새 GoalVersion 자동 생성)
 *
 * (B-1 트랙 2026-05-13) 의사결정 게이트가 이 함수를 호출할 때:
 *   - triggeredByPrecedentId: 게이트가 만든 판례 id
 *   - skipGoalUpdate: true 면 saveGoal 생략 (게이트가 이미 saveGoal 호출했음 — 중복 방지)
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {Object} goal — 폐기할 목표 객체 전체
 * @param {Object} opts — { userNote, source, triggeredByPrecedentId, skipGoalUpdate }
 * @returns {Promise<Object>} 생성된 추모비 객체
 */
export async function extinguishGoalToMemorial(dek, userId, goal, opts = {}) {
    const {
        userNote = '',
        source = 'self_report',
        triggeredByPrecedentId = null,
        skipGoalUpdate = false
    } = opts;
    const today = new Date().toISOString().slice(0, 10);

    // 1) 목표 시작일·기간 계산
    const startDate = goal.createdAt
        ? new Date(goal.createdAt).toISOString().slice(0, 10)
        : today;
    const startMs = new Date(startDate + 'T00:00:00').getTime();
    const todayMs = new Date(today + 'T00:00:00').getTime();
    const daysElapsed = Math.max(0, Math.floor(
        (todayMs - startMs) / (1000 * 60 * 60 * 24)
    ));
    const duration = { startDate, endDate: today, daysElapsed };

    // 2) 도트 통계 — linkedGoalId 가 암호화라 클라이언트 처리.
    // 시작일~오늘 범위에서 이 목표에 연결된 도트들만 필터링.
    let dotStats;
    try {
        const allDots = await getDotsByDateRange(dek, userId, startDate, today);
        const linkedDots = allDots.filter(d => d.linkedGoalId === goal.id);
        dotStats = computeDotStats(linkedDots);
    } catch (e) {
        console.warn('[memorials] dotStats compute failed, using empty:', e);
        dotStats = {
            totalSlots: 0, doneCount: 0, partialCount: 0,
            replacedCount: 0, skippedCount: 0,
            avgSatisfaction: 0, topLabelIds: [], matchRate: 0,
        };
    }

    // 3) 추모비 객체
    const memorial = {
        userId,
        goalId: goal.id,
        extinguishedAt: today,
        createdAt: new Date().toISOString(),
        duration,
        dotStats,
        source,
        goalSnapshot: { ...goal },
        representativeDots: [],          // 다음 트랙 (AI 선별)
        contributions: [],               // B-4 트랙 후 채움
        aiNarrativeSummary: '',          // 다음 트랙
        triggeredByPrecedentId,          // (B-1) 게이트 통과 시 채움
        userNote,
    };

    // 4) 추모비 먼저 저장
    await saveMemorial(dek, memorial);

    // 5) 목표 status='archived' — saveGoal 이 자동으로 새 GoalVersion 만듦.
    //    게이트가 이미 saveGoal 을 호출한 경우(skipGoalUpdate=true)는 생략 — 중복 방지.
    if (!skipGoalUpdate) {
        const archivedGoal = {
            ...goal,
            status: 'archived',
            archivedAt: new Date().toISOString(),
        };
        try {
            await saveGoal(dek, archivedGoal, {
                source,
                revisionReason: `extinguished: ${userNote || '사용자 결정'}`,
                sourcePrecedentId: triggeredByPrecedentId
            });
        } catch (e) {
            console.warn('[memorials] goal archive failed (memorial saved):', e);
        }
    }

    return memorial;
}
