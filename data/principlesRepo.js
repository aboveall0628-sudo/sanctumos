/**
 * principlesRepo.js — 원칙(법조항) CRUD (자동 암복호화)
 *
 * (B-1 트랙 2026-05-13) 의사결정 시스템 1차 작업으로 필드 보강.
 * 새 필드: strength / source / createdBy / conditions / scriptureRef / bookRef /
 *         linkedPrecedentIds / linkedDotIds / revisionLog
 *
 * "평가보다 인과" — 원칙은 시간이 흐르며 강도/본문이 바뀐다. 그 변화 자체가
 * 진단의 본질이라 revisionLog 자동 박힘이 핵심.
 */

import { db, doc, deleteDoc, collection, query, where } from './firebase.js';
import { saveRecord, getRecord, queryRecords } from './baseRepo.js';

const PATH = 'principles';

/**
 * 원칙 저장(신규/수정).
 *
 * 자동 revisionLog 박힘:
 *   - 기존 원칙이 있고 body 또는 strength 가 바뀌면 revisionLog 에 한 줄 추가.
 *   - 신규 원칙은 revisionLog 빈 배열로 시작.
 *
 * @param {CryptoKey} dek
 * @param {Object} principleData
 * @param {Object} [opts]
 *   - revisionReason: 수정 이유 (게이트 또는 사용자 직접 입력)
 *   - triggeredBy: { type: 'precedent'|'external_input'|'reflection'|'advice', reference?: string }
 */
export async function savePrinciple(dek, principleData, opts = {}) {
    const { revisionReason = '', triggeredBy = null } = opts;

    if (!principleData.category) principleData.category = 'daily';
    if (!principleData.strength) principleData.strength = 'primary';
    if (!principleData.source) principleData.source = 'user_value';
    if (!principleData.createdBy) principleData.createdBy = 'user';

    // 양방향 인과 가지 기본값
    if (!Array.isArray(principleData.linkedPrecedentIds)) principleData.linkedPrecedentIds = [];
    if (!Array.isArray(principleData.linkedDotIds)) principleData.linkedDotIds = [];
    if (!Array.isArray(principleData.revisionLog)) principleData.revisionLog = [];

    // 신규/수정 분기 — 수정이면 자동 revisionLog 박힘
    if (principleData.id) {
        try {
            const prev = await getRecord(dek, PATH, principleData.id);
            if (prev) {
                const bodyChanged = (prev.body || '') !== (principleData.body || '');
                const strengthChanged = (prev.strength || '') !== (principleData.strength || '');
                if (bodyChanged || strengthChanged) {
                    principleData.revisionLog = [
                        ...(prev.revisionLog || []),
                        {
                            revisedAt: Date.now(),
                            previousBody: bodyChanged ? (prev.body || '') : undefined,
                            previousStrength: strengthChanged ? (prev.strength || '') : undefined,
                            reason: revisionReason,
                            triggeredBy: triggeredBy || { type: 'reflection', reference: null }
                        }
                    ];
                }
            }
        } catch (e) {
            // revisionLog 자동 박힘 실패는 저장 자체를 막지 않음
            console.warn('[savePrinciple] revisionLog detection failed:', e?.message || e);
        }
    }

    return await saveRecord(dek, PATH, principleData, principleData.id);
}

export async function getPrinciples(dek, userId) {
    const q = query(collection(db, PATH), where('userId', '==', userId));
    const principles = await queryRecords(dek, q);

    // pinned 먼저, 최신순
    return principles.sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
        const timeA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
        const timeB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
        return timeB - timeA;
    });
}

/**
 * 활성 원칙만 (의사결정 게이트 선택지 후보).
 */
export async function getActivePrinciples(dek, userId) {
    const all = await getPrinciples(dek, userId);
    return all.filter(p => p.active !== false);
}

/**
 * 원칙 1건 조회 — 게이트가 시점 스냅샷 박을 때 필요.
 */
export async function getPrinciple(dek, principleId) {
    return await getRecord(dek, PATH, principleId);
}

export async function deletePrinciple(id) {
    await deleteDoc(doc(db, PATH, id));
}

/**
 * 원칙에 판례 역참조 박기 (양방향 인과 가지 유지).
 * 1차에선 게이트가 판례 저장 직후 명시적으로 호출.
 */
export async function appendLinkedPrecedent(dek, principleId, precedentId) {
    const p = await getRecord(dek, PATH, principleId);
    if (!p) return;
    const list = Array.isArray(p.linkedPrecedentIds) ? p.linkedPrecedentIds : [];
    if (list.includes(precedentId)) return;
    p.linkedPrecedentIds = [...list, precedentId];
    await saveRecord(dek, PATH, p, p.id);
}
