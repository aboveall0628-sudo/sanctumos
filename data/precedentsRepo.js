/**
 * precedentsRepo.js — 판례(의사결정 사례) CRUD (자동 암복호화)
 *
 * (B-1 트랙 2026-05-13) 의사결정 시스템 신규 컬렉션.
 *
 * 법체계 비유: 판례는 "잘함/잘못함" 라벨을 박지 않는다. 그때 상황·결정·
 * 그 시점 원칙 강도 스냅샷만 박고, 후속 도트·판례·원칙 변경이 인과 가지로
 * 자라난다. ("평가보다 인과" — feedback_evaluation_vs_causation.md)
 *
 * 회로:
 *   원칙 선택 → savePrecedent → linkedGoalId 있으면 saveGoal 호출 →
 *   GoalVersion 자동 새 스냅샷(revisionReason + sourcePrecedentId 박힘) →
 *   대시보드 칠판·리포트 자동 반영.
 */

import { db, doc, deleteDoc, collection, query, where } from './firebase.js';
import { saveRecord, getRecord, queryRecords } from './baseRepo.js';
import { getPrinciple, appendLinkedPrecedent } from './principlesRepo.js';

const PATH = 'precedents';

/**
 * 판례 저장(신규/수정).
 *
 * 자동 처리:
 *   - id 없으면 자동 생성
 *   - principlesAtTime 시점 스냅샷 자동 박힘 (linkedPrincipleIds 가 있을 때)
 *   - 신규 저장 시 각 원칙에 linkedPrecedentIds 역참조 박힘 (양방향)
 *   - 평가 필드는 받지 않음 (스키마 자체에 없음)
 *
 * @param {CryptoKey} dek
 * @param {Object} data
 *   필수: userId, situation, decision, linkedPrincipleIds[]
 *   선택: contextNote, linkedGoalId, linkedGoalVersionId, linkedScriptureId,
 *        prayerLogged, source, decidedAt
 */
export async function savePrecedent(dek, data) {
    if (!data.id) {
        data.id = `precedent_${data.userId.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }
    if (!data.decidedAt) data.decidedAt = Date.now();
    if (!data.source) data.source = 'user';
    if (typeof data.prayerLogged !== 'boolean') data.prayerLogged = false;

    if (!Array.isArray(data.linkedPrincipleIds)) data.linkedPrincipleIds = [];
    if (!Array.isArray(data.linkedDotIds)) data.linkedDotIds = [];
    if (!Array.isArray(data.linkedPrecedentIds)) data.linkedPrecedentIds = [];
    if (!Array.isArray(data.revisionLog)) data.revisionLog = [];

    // 신규 저장이면 그 시점 원칙 스냅샷 박기
    const isNew = !(await getRecord(dek, PATH, data.id));
    if (isNew && data.linkedPrincipleIds.length > 0) {
        const snapshots = [];
        for (const pid of data.linkedPrincipleIds) {
            try {
                const p = await getPrinciple(dek, pid);
                if (p) {
                    snapshots.push({
                        principleId: pid,
                        strengthAtTime: p.strength || 'primary',
                        bodyAtTime: p.body || ''
                    });
                }
            } catch (e) {
                console.warn('[savePrecedent] principle snapshot failed:', pid, e?.message || e);
            }
        }
        data.principlesAtTime = snapshots;
    }

    const saved = await saveRecord(dek, PATH, data, data.id);

    // 신규일 때만 양방향 역참조 박기 (수정 시엔 사용자가 원칙 목록을 바꿔도
    // 옛 원칙의 linkedPrecedentIds 는 그대로 두는 게 인과 가지 정직성에 부합)
    if (isNew) {
        for (const pid of data.linkedPrincipleIds) {
            try { await appendLinkedPrecedent(dek, pid, data.id); }
            catch (e) { console.warn('[savePrecedent] reverse link failed:', pid, e?.message || e); }
        }
    }

    return saved;
}

/**
 * 사용자의 모든 판례 (최신순).
 * composite index 회피 — userId 단일 쿼리 후 클라이언트 정렬.
 */
export async function getAllPrecedents(dek, userId) {
    const q = query(collection(db, PATH), where('userId', '==', userId));
    const list = await queryRecords(dek, q);
    return list.sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0));
}

/**
 * 특정 원칙에 연결된 판례들 (게이트에서 "지난 비슷한 결정" 표시용).
 */
export async function getPrecedentsByPrinciple(dek, userId, principleId) {
    const all = await getAllPrecedents(dek, userId);
    return all.filter(p => Array.isArray(p.linkedPrincipleIds) && p.linkedPrincipleIds.includes(principleId));
}

/**
 * 특정 목표에 연결된 판례들 (목표 카드에서 "이 목표를 만든 결정" 보기용).
 */
export async function getPrecedentsByGoal(dek, userId, goalId) {
    const all = await getAllPrecedents(dek, userId);
    return all.filter(p => p.linkedGoalId === goalId);
}

export async function getPrecedent(dek, precedentId) {
    return await getRecord(dek, PATH, precedentId);
}

export async function deletePrecedent(id) {
    await deleteDoc(doc(db, PATH, id));
}
