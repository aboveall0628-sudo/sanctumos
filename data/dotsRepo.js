/**
 * dotsRepo.js — 도트 CRUD (자동 암복호화)
 *
 * 도트 = 타임박스 한 칸의 실행+평가 데이터.
 * 메타 필드(date, timeSlot, satisfaction 등)는 평문, 텍스트 필드는 암호화.
 */

import { db, doc, deleteDoc, collection, query, where, orderBy } from './firebase.js';
import { saveRecord, getRecord, queryRecords } from './baseRepo.js';

/**
 * 도트 저장 (신규/수정)
 * @param {CryptoKey} dek
 * @param {Object} dotData - 전체 도트 데이터
 */
export async function saveDot(dek, dotData) {
    const docId = `${dotData.userId}_${dotData.date}_${dotData.timeSlot}`;
    dotData.id = docId;
    return await saveRecord(dek, 'dots', dotData, docId);
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
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Object[]}
 */
export async function getDotsByDateRange(dek, userId, startDate, endDate) {
    const q = query(
        collection(db, 'dots'),
        where('userId', '==', userId),
        where('date', '>=', startDate),
        where('date', '<=', endDate),
        orderBy('date', 'asc'),
        orderBy('timeSlot', 'asc')
    );
    return await queryRecords(dek, q);
}

/**
 * 도트 삭제 (시계부에서 X 버튼)
 */
export async function deleteDot(id) {
    await deleteDoc(doc(db, 'dots', id));
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
