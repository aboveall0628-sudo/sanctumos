/**
 * timeBands.js — 5계층 리포트 공용 시간대 매트릭스 (STEP D-1, 2026-05-14)
 *
 * 일간 STEP A 에서 만든 6구간 시간대 표준을 주/월/분기/연에 통일 적용.
 * dailyAggregator 내부 상수였던 TIME_BANDS 를 여기로 이전, 모든 aggregator 가 import.
 *
 * 6구간 (도트 timeSlot 15분 단위, 0~95):
 *   새벽 0~6시   (slot 0~24)
 *   아침 6~9시   (slot 24~36)
 *   오전 9~12시  (slot 36~48)
 *   오후 12~18시 (slot 48~72)
 *   저녁 18~22시 (slot 72~88)
 *   밤   22~24시 (slot 88~96)
 */

const MIN_PER_SLOT = 15;

export const TIME_BANDS = [
    { id: 'dawn',         label: '새벽 (0~6시)',  startSlot: 0,  endSlot: 24 },
    { id: 'morning',      label: '아침 (6~9시)',  startSlot: 24, endSlot: 36 },
    { id: 'late-morning', label: '오전 (9~12시)', startSlot: 36, endSlot: 48 },
    { id: 'afternoon',    label: '오후 (12~18시)', startSlot: 48, endSlot: 72 },
    { id: 'evening',      label: '저녁 (18~22시)', startSlot: 72, endSlot: 88 },
    { id: 'night',        label: '밤 (22~24시)',  startSlot: 88, endSlot: 96 },
];

/**
 * 도트 배열 → 시간대 6구간 매트릭스.
 * 각 구간: { id, label, dotCount, avgSatisfaction, totalMinutes }
 *
 * 누적 일수에 관계없이 단순 도트 합계 — 주/월/분기/연 모두 동일하게 호출.
 * (분기·연 등 긴 호흡에서도 시간대 자체 평균은 의미 있음.)
 */
export function computeTimeBandMatrix(dots) {
    return TIME_BANDS.map(b => {
        const inBand = (dots || []).filter(d =>
            typeof d.timeSlot === 'number' && d.timeSlot >= b.startSlot && d.timeSlot < b.endSlot
        );
        const sats = inBand
            .map(d => d.executionSatisfaction)
            .filter(v => typeof v === 'number');
        const avgSat = sats.length > 0 ? round2(sats.reduce((a, b) => a + b, 0) / sats.length) : null;
        const totalMinutes = inBand.reduce((sum, d) => sum + (d.durationSlots || 1) * MIN_PER_SLOT, 0);
        return {
            id:              b.id,
            label:           b.label,
            dotCount:        inBand.length,
            avgSatisfaction: avgSat,
            totalMinutes,
        };
    });
}

/**
 * 도트 배열 → 요일 7개 매트릭스. dot.date('YYYY-MM-DD') 기반.
 * 각 요일: { id(0~6), label, dotCount, avgSatisfaction, totalMinutes }
 *   id 0 = 일요일 (JavaScript getDay 표준).
 *
 * 주간(이미 weekly 요일별 매트릭스 있음)·월/분기/연(누적) 모두 동일 호출.
 */
const DAYS_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function computeDayOfWeekMatrix(dots) {
    const bucket = DAYS_OF_WEEK.map((label, id) => ({
        id,
        label: `${label}요일`,
        dotCount: 0,
        satSum:   0,
        satN:     0,
        totalMinutes: 0,
    }));
    for (const dot of (dots || [])) {
        if (!dot.date) continue;
        const d = new Date(dot.date + 'T00:00:00');
        const dow = d.getDay();
        if (Number.isNaN(dow)) continue;
        const minutes = (dot.durationSlots || 1) * MIN_PER_SLOT;
        bucket[dow].dotCount++;
        bucket[dow].totalMinutes += minutes;
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        if (sat !== null) {
            bucket[dow].satSum += sat;
            bucket[dow].satN++;
        }
    }
    return bucket.map(b => ({
        id:              b.id,
        label:           b.label,
        dotCount:        b.dotCount,
        avgSatisfaction: b.satN > 0 ? round2(b.satSum / b.satN) : null,
        totalMinutes:    b.totalMinutes,
    }));
}

/**
 * 도트 배열 → 조직 네트워크. dot.linkedOrgIds 기반.
 * personNetwork 와 같은 모양(items + totalUniqueOrgs). 이름 매핑은 ReportFlow.enrichStatsForLLM 에서.
 */
export function computeOrgNetwork(dots, limit = 8) {
    const map = new Map();
    for (const dot of (dots || [])) {
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        for (const orgId of (dot.linkedOrgIds || [])) {
            if (!map.has(orgId)) map.set(orgId, { orgId, count: 0, satSum: 0, satN: 0 });
            const c = map.get(orgId);
            c.count++;
            if (sat !== null) { c.satSum += sat; c.satN++; }
        }
    }
    const items = Array.from(map.values())
        .map(c => ({
            orgId:           c.orgId,
            interactionCount: c.count,
            avgSatisfaction:  c.satN > 0 ? round2(c.satSum / c.satN) : null,
        }))
        .sort((a, b) => b.interactionCount - a.interactionCount)
        .slice(0, limit);
    return { items, totalUniqueOrgs: map.size };
}

function round2(n) { return Math.round(n * 100) / 100; }
