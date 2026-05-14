/**
 * dotsRepo.js — 도트 CRUD (자동 암복호화)
 *
 * 도트 = 타임박스 한 칸의 실행+평가 데이터.
 * 메타 필드(date, timeSlot, satisfaction 등)는 평문, 텍스트 필드는 암호화.
 */

import { db, doc, deleteDoc, collection, query, where } from './firebase.js';
import { saveRecord, getRecord, queryRecords } from './baseRepo.js';

/**
 * 도트 저장 (신규/수정).
 *
 * 워크플로우 트랙 보강 (2026-05-13):
 * - 신규 도트의 executor 기본값 'self'. 옛 도트는 그대로(null 허용).
 * - source 가 명시되지 않으면 'self_report' 기본 (정직성 인프라).
 * - linkedWorkflowStepId/goalVersionId/helperPersonId 는 호출측이 박지 않으면 null.
 *
 * 옛 도트 마이그레이션은 하지 않음 (사용자 결정 2026-05-13 옵션 A).
 * 읽기 측에서 null 가드만 추가.
 */
export async function saveDot(dek, dotData) {
    // (경제 트랙 1.a 2026-05-14) kind 분기 — schedule(기존 일정 도트, 디폴트) | event(이벤트 도트).
    //   schedule: docId = `${userId}_${date}_${timeSlot}` (시간 슬롯 기반, 기존 패턴).
    //   event:    docId = `${userId}_evt_${eventTimestamp}_${rand}` (한 시점, 무한 가능).
    //   기존 도트는 kind 없이 저장됐어도 schedule 로 해석 (읽기 측 디폴트).
    if (dotData.kind == null) dotData.kind = 'schedule';

    let docId;
    if (dotData.kind === 'event') {
        // 이벤트 도트는 timeSlot 없음 → 별도 ID 패턴.
        const ts = dotData.eventTimestamp || new Date().toISOString();
        const rand = Math.random().toString(36).slice(2, 8);
        // 같은 사용자가 같은 ms에 두 번 박을 가능성 거의 없지만 random 으로 안전.
        docId = dotData.id || `${dotData.userId}_evt_${ts.replace(/[:.]/g, '-')}_${rand}`;
        // 이벤트 도트는 timeSlot/durationSlots null 명시 (정책 평문 필드라 명시적으로 비워야 함).
        if (dotData.timeSlot == null) dotData.timeSlot = null;
        if (dotData.durationSlots == null) dotData.durationSlots = null;
        // date 는 eventTimestamp 의 날짜 부분으로 자동 채움 (호출측이 안 줬을 때).
        if (!dotData.date) dotData.date = ts.slice(0, 10);
    } else {
        docId = `${dotData.userId}_${dotData.date}_${dotData.timeSlot}`;
    }
    dotData.id = docId;

    // 신규 저장 케이스에만 기본값 박기 — 기존 도큐먼트는 baseRepo.saveRecord 가
    // 정책에 없는 필드를 자동으로 떨어뜨리지 않으니 명시적으로 박혀야 함.
    if (dotData.executor == null) dotData.executor = 'self';
    if (dotData.source == null) dotData.source = 'self_report';
    const result = await saveRecord(dek, 'dots', dotData, docId);

    // (본인 프로필 재기획 트랙 2026-05-14 S-B) 자연 발화 보조 트리거.
    //   R18d 결: "도트 평가하다가 자연스럽게 그 차원을 발화하면 미션 자동 클리어".
    //   linkedPersonIds·linkedOrgIds 가 있으면 인물·조직 카드 직접 만들지 않아도 클리어.
    //   markMissionComplete 가 idempotent 라 인물·조직 카드 직접 박는 자리와 중복돼도 안전.
    try {
        const { markMissionComplete } = await import('./personRepo.js');
        if (Array.isArray(dotData.linkedPersonIds) && dotData.linkedPersonIds.length > 0) {
            await markMissionComplete(dek, dotData.userId, 'person_first_dot', {
                signal: 'saveDot', contextDotId: dotData.id
            });
        }
        if (Array.isArray(dotData.linkedOrgIds) && dotData.linkedOrgIds.length > 0) {
            await markMissionComplete(dek, dotData.userId, 'org_first_dot', {
                signal: 'saveDot', contextDotId: dotData.id
            });
        }
        // (S-D 후속 2026-05-15) 경제 거래 이벤트 도트 — "첫 거래 적기" 자연 발화.
        //   eventType='transaction' 또는 linkedTransactionIds 가 비어있지 않으면 클리어.
        const isTxEvent = dotData.kind === 'event' && dotData.eventType === 'transaction';
        const hasTxLink = Array.isArray(dotData.linkedTransactionIds) && dotData.linkedTransactionIds.length > 0;
        if (isTxEvent || hasTxLink) {
            await markMissionComplete(dek, dotData.userId, 'economy_first_transaction', {
                signal: 'saveDot:transaction', contextDotId: dotData.id
            });
        }
    } catch (e) {
        console.warn('[saveDot] mission trigger failed:', e?.message || e);
    }
    return result;
}

/**
 * (경제 트랙 1.a 2026-05-14) 이벤트 도트 전용 헬퍼 — 거래·말 한 마디 등 점 단위 기록.
 *
 * @param {CryptoKey} dek
 * @param {Object} data { userId, eventTimestamp, eventType, eventNote?, linkedTransactionIds?, linkedPersonIds?, linkedOrgIds?, ... }
 *   - eventType: 'transaction' | 'speech' | 'other'
 *   - eventTimestamp: ISO string (기본: 지금)
 *   - date 는 자동 채움 (eventTimestamp 의 날짜 부분)
 * @returns {Promise<string>} docId
 */
export async function saveEventDot(dek, data) {
    return saveDot(dek, { ...data, kind: 'event' });
}

/**
 * (경제 트랙 1.a) 특정 날짜의 이벤트 도트만 조회 (미매칭 박스 / 시간순 사진첩).
 * getDotsByDate 결과에서 kind='event' 필터 + eventTimestamp 정렬.
 */
export async function getEventDotsByDate(dek, userId, date) {
    const all = await getDotsByDate(dek, userId, date);
    return all
        .filter(d => d.kind === 'event')
        .sort((a, b) => (a.eventTimestamp || '').localeCompare(b.eventTimestamp || ''));
}

/**
 * (경제 트랙 1.a) 특정 날짜의 일정 도트만 조회 (기존 화면 호환).
 * kind 가 없거나 'schedule' 인 도트만.
 */
export async function getScheduleDotsByDate(dek, userId, date) {
    const all = await getDotsByDate(dek, userId, date);
    return all.filter(d => !d.kind || d.kind === 'schedule');
}

/**
 * (워크플로우 트랙 2026-05-13) 특정 목표에 분배된 도트 모두 조회 — 역참조.
 *
 * linkedGoalId 가 encrypted 라 Firestore 직접 쿼리 불가.
 * getAllDots 패턴 그대로 — userId 단일 쿼리 후 클라이언트 필터 (composite index 회피).
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} goalId
 * @returns {Object[]} date asc, timeSlot asc
 */
export async function getDotsByGoalId(dek, userId, goalId) {
    const q = query(
        collection(db, 'dots'),
        where('userId', '==', userId)
    );
    const all = await queryRecords(dek, q);
    return all
        .filter(d => d.linkedGoalId === goalId)
        .sort((a, b) => {
            const dc = (a.date || '').localeCompare(b.date || '');
            if (dc) return dc;
            return (a.timeSlot ?? 0) - (b.timeSlot ?? 0);
        });
}

/**
 * (워크플로우 트랙 2026-05-13) 특정 워크플로우 스텝에 분배된 도트 조회.
 * linkedWorkflowStepId 도 encrypted — 동일 패턴.
 */
export async function getDotsByWorkflowStepId(dek, userId, stepId) {
    const q = query(
        collection(db, 'dots'),
        where('userId', '==', userId)
    );
    const all = await queryRecords(dek, q);
    return all
        .filter(d => d.linkedWorkflowStepId === stepId)
        .sort((a, b) => {
            const dc = (a.date || '').localeCompare(b.date || '');
            if (dc) return dc;
            return (a.timeSlot ?? 0) - (b.timeSlot ?? 0);
        });
}

/**
 * 특정 날짜의 모든 도트 조회.
 * orderBy를 빼고 client-side sort — composite index 없이도 동작하도록.
 * (Firestore는 equality 2개만으론 자동 단일필드 인덱스로 처리 가능)
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} date - "2026-05-10"
 * @returns {Object[]}
 */
export async function getDotsByDate(dek, userId, date) {
    const q = query(
        collection(db, 'dots'),
        where('userId', '==', userId),
        where('date', '==', date)
    );
    const dots = await queryRecords(dek, q);
    return dots.sort((a, b) => (a.timeSlot ?? 0) - (b.timeSlot ?? 0));
}

/**
 * 특정 도트 1개 조회
 */
export async function getDot(dek, docId) {
    return await getRecord(dek, 'dots', docId);
}

/**
 * 날짜 범위의 도트 조회 (리포트 집계용)
 *
 * Firestore 규칙: where(userId==) + where(date 범위) 조합도 composite index
 * (userId, date) 필요. 인덱스 미배포 환경에서 throw 발생.
 *
 * 89bd651 의 countMeditations 와 동일 패턴 — userId 만으로 fetch 후 클라이언트
 * 에서 date 필터링 + 정렬. 단일 사용자라 도트 총량이 폭증할 가능성 작음.
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} startDate - inclusive
 * @param {string} endDate   - inclusive
 * @returns {Object[]} (date asc, timeSlot asc)
 */
export async function getDotsByDateRange(dek, userId, startDate, endDate) {
    const q = query(
        collection(db, 'dots'),
        where('userId', '==', userId)
    );
    const all = await queryRecords(dek, q);
    return all
        .filter(d => d.date && d.date >= startDate && d.date <= endDate)
        .sort((a, b) => {
            const dc = (a.date || '').localeCompare(b.date || '');
            if (dc) return dc;
            return (a.timeSlot ?? 0) - (b.timeSlot ?? 0);
        });
}

/**
 * 도트 삭제 (시계부에서 X 버튼)
 */
export async function deleteDot(id) {
    await deleteDoc(doc(db, 'dots', id));
}

/**
 * 사용자의 모든 도트 조회 (인물/조직 카드 통계 집계용).
 *
 * linkedPersonIds / linkedOrgIds 가 encrypted 필드라 Firestore 쿼리로 직접
 * 필터링할 수 없다 → 클라이언트가 전체를 받아 복호화 후 메모리 집계.
 * 도트 수가 매우 많아지면 페이지네이션 보강이 필요할 수 있다.
 */
export async function getAllDots(dek, userId) {
    const q = query(
        collection(db, 'dots'),
        where('userId', '==', userId)
    );
    const dots = await queryRecords(dek, q);
    return dots.sort((a, b) => {
        const dc = (a.date || '').localeCompare(b.date || '');
        if (dc) return dc;
        return (a.timeSlot ?? 0) - (b.timeSlot ?? 0);
    });
}

/**
 * 도트 통계 계산 (리포트용, 복호화 불필요 — 메타 필드만)
 */
export function computeDotStats(dots) {
    const total = dots.length;
    if (total === 0) return {
        totalSlots: 0, doneCount: 0, partialCount: 0,
        replacedCount: 0, skippedCount: 0,
        avgSatisfaction: 0, topLabelIds: [], matchRate: 0,
    };

    const counts = { done: 0, partial: 0, replaced: 0, skipped: 0 };
    let satSum = 0;
    const labelCount = {};

    dots.forEach(d => {
        counts[d.executed] = (counts[d.executed] || 0) + 1;
        satSum += d.executionSatisfaction || 0;
        (d.labelIds || []).forEach(lid => {
            labelCount[lid] = (labelCount[lid] || 0) + 1;
        });
    });

    const topLabels = Object.entries(labelCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([labelId, count]) => ({ labelId, count }));

    return {
        totalSlots: total,
        doneCount: counts.done,
        partialCount: counts.partial,
        replacedCount: counts.replaced,
        skippedCount: counts.skipped,
        avgSatisfaction: +(satSum / total).toFixed(1),
        topLabelIds: topLabels,
        matchRate: total > 0 ? Math.round((counts.done / total) * 100) : 0,
    };
}
