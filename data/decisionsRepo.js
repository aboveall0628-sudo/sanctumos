/**
 * decisionsRepo.js — 오늘의 결단 CRUD (자동 암복호화)
 *
 * 결단은 두 상태:
 *   - 미배치: timeSlot=null, 결단 패널 카드로만 존재
 *   - 박힌 결단: timeSlot=0~95(15분 슬롯), durationSlots=N
 *     → 통합 타임라인의 계획 레인에 표시되고 평가 시 dot으로 흡수됨
 */

import { db, doc, deleteDoc, collection, query, where } from './firebase.js';
import { saveRecord, queryRecords } from './baseRepo.js';

/**
 * 결단 저장(신규/수정).
 * @param {CryptoKey} dek
 * @param {Object} data { id?, userId, date, text, timeSlot=null, durationSlots=4, order=0 }
 */
export async function saveDecision(dek, data) {
    if (!data.id) {
        data.id = `decision_${data.userId}_${data.date}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }
    if (data.timeSlot != null && !data.placedAt) {
        data.placedAt = Date.now();
    }
    return await saveRecord(dek, 'decisions', data, data.id);
}

/**
 * 특정 날짜의 모든 결단 조회 (미배치 + 박힌 것 모두).
 * orderBy 제거 + client-side sort — composite index 없이도 동작.
 */
export async function getDecisionsByDate(dek, userId, date) {
    const q = query(
        collection(db, 'decisions'),
        where('userId', '==', userId),
        where('date', '==', date)
    );
    const decisions = await queryRecords(dek, q);
    return decisions.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * 결단을 시간 슬롯에 박기 / 옮기기
 */
export async function placeDecision(dek, decision, timeSlot, durationSlots = 4) {
    decision.timeSlot = timeSlot;
    decision.durationSlots = durationSlots;
    decision.placedAt = Date.now();
    return await saveDecision(dek, decision);
}

/**
 * 결단을 시간 슬롯에서 빼기 (다시 미배치 카드로)
 */
export async function unplaceDecision(dek, decision) {
    decision.timeSlot = null;
    decision.placedAt = null;
    return await saveDecision(dek, decision);
}

export async function deleteDecision(id) {
    await deleteDoc(doc(db, 'decisions', id));
}
