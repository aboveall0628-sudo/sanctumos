/**
 * dailyAggregator.js — 일간 리포트 deterministic 집계
 *
 * Reports 모듈 STEP 1.1 — 2026-05-11
 * docs/reports-spec.md §3.1 일간 리포트 8섹션 중 1~6을 코드가 계산.
 * 7) 관찰 1개, 8) 묵상 질문 1~2개는 AI가 채움 (다음 단계).
 *
 * 원칙
 * - LLM에게 산수 시키지 않음. 모든 수치는 여기서 결정론적으로 계산.
 * - "수행 일수" 같은 영적 정량화 표현 출력 절대 X (A2 재설계).
 *   묵상 메타는 boolean(존재/부재)만, 시계부 시간 합계는 자연히 포함.
 * - 도트 ID는 내부 처리용. UI/AI 노출은 별도 단계에서 가명화·역가명화.
 */

import { getDotsByDate } from '../data/dotsRepo.js';
// Phase B-4: 결단 → daily 목표 흡수 후 정렬도(alignment)는 daily 목표 기준으로 계산.
import { getDailyGoals } from '../data/goalsRepo.js';
// Phase F: 거래 데이터를 일간 stats 에 합산 — LLM 이 도트 + 거래를 함께 보고 산문 작성.
import { getTransactionsByDate } from '../data/economyRepo.js';
import { isGivingCategory } from '../config/economyBuckets.js';
// STEP D (2026-05-14): 5계층 공용 시간대 매트릭스 + 요일·조직 헬퍼.
import { computeTimeBandMatrix } from './timeBands.js';

const MIN_PER_SLOT = 15;  // 15분 단위 슬롯

/**
 * 일간 리포트 deterministic 통계 집계
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {Promise<Object>} stats 객체 (8섹션 중 1~6 + 묵상 메타 boolean)
 */
export async function aggregateDailyStats(dek, userId, date) {
    const [dots, allDailyGoals, txs] = await Promise.all([
        getDotsByDate(dek, userId, date),
        getDailyGoals(dek, userId).catch(() => []),
        getTransactionsByDate(dek, userId, date).catch(() => []),
    ]);

    // Phase B-4: 결단의 alignment 계산을 daily 목표 기준으로. 시간표에 박힌 목표만 의미 있음.
    // 결단 시절 d.text 도 fallback 으로 받아 옛 문서가 섞여 있을 때 대비.
    const placedGoals = allDailyGoals.filter(g => g.timeSlot != null);

    return {
        date,
        dotStats:                 computeDotStats(dots),
        alignment:                computeAlignment(placedGoals, dots),
        timeAllocation:           computeTimeAllocation(dots),
        satisfactionDistribution: computeDistribution(dots, 'executionSatisfaction'),
        resultDistribution:       computeDistribution(dots, 'outcomeSatisfaction'),
        labelFrequency:           computeLabelFrequency(dots),
        connections:              computeConnections(dots),
        meditationMeta:           computeMeditationMeta(dots),
        // STEP A — 17·1 흡수: 다관점 매트릭스 + 시간순 도트 배열 (산문 자연 인용 + UI 펼침)
        dotsTimeline:             computeDotsTimeline(dots),
        timeBandMatrix:           computeTimeBandMatrix(dots),
        categorySatisfactionMatrix: computeCategorySatisfactionMatrix(dots),
        // Phase F: 거래 통계 — bucket 평문/category 평문만 LLM 에 노출. exactAmount 는 자물쇠 안.
        transactionStats:         computeTransactionStats(txs),
    };
}

// ─── STEP A-1: 시간순 도트 배열 (17·1 — 다관점 + reason 인용) ───
// LLM 산문 자연 인용 + UI "시간순 도트 펼치기" 토글이 함께 사용.
// linkedPersonIds·linkedOrgIds 는 enrichStatsForLLM 에서 이름으로 치환됨.
function computeDotsTimeline(dots) {
    return [...dots]
        .filter(d => typeof d.timeSlot === 'number')
        .sort((a, b) => a.timeSlot - b.timeSlot)
        .map(d => {
            const startMin = d.timeSlot * MIN_PER_SLOT;
            const durMin   = (d.durationSlots || 1) * MIN_PER_SLOT;
            const endMin   = startMin + durMin;
            return {
                time:                 fmtSlotRange(startMin, endMin),
                // (2026-05-14 fix) 도트 제목 필드는 quickReview 가 저장하는 actualTask.
                //   STEP A 1차 작성 시 d.title 만 봐서 '(제목 없음)' 으로 LLM 에 전달 →
                //   산문이 "이름 없는 활동" 으로 풀어쓴 회귀. plannedTask 도 fallback.
                title:                d.actualTask || d.plannedTask || d.title || d.label || '(제목 없음)',
                reason:               d.reason || null,
                labels:               d.labelIds || [],
                executionSatisfaction: d.executionSatisfaction ?? null,
                outcomeSatisfaction:   d.outcomeSatisfaction ?? null,
                executed:              d.executed ?? null,
                personIds:             d.linkedPersonIds || [],
                orgIds:                d.linkedOrgIds || [],
                durationMinutes:       durMin,
            };
        });
}

function fmtSlotRange(startMin, endMin) {
    const fmt = (m) => {
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    return `${fmt(startMin)}~${fmt(endMin)}`;
}

// STEP A-1 의 computeTimeBandMatrix 는 STEP D-1 에서 reports/timeBands.js 로 이전됨
// (5계층 공용). 일간 stats 의 timeBandMatrix 호출은 동일하게 작동.

// ─── STEP A-1: 라벨×만족도 매트릭스 (17 — 카테고리 다관점) ───
// timeAllocation.byLabel 은 시간 합계만 있어 만족도 분리 안 됨.
// 산문이 "카테고리 X 에서 만족도가 낮게 관찰" 같은 흐름을 자연스럽게 쓸 수 있게 별도 매트릭스.
function computeCategorySatisfactionMatrix(dots) {
    const byLabel = {};
    for (const dot of dots) {
        const minutes = (dot.durationSlots || 1) * MIN_PER_SLOT;
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        for (const labelId of (dot.labelIds || [])) {
            if (!byLabel[labelId]) {
                byLabel[labelId] = { labelId, dotCount: 0, satSum: 0, satN: 0, totalMinutes: 0 };
            }
            byLabel[labelId].dotCount++;
            byLabel[labelId].totalMinutes += minutes;
            if (sat !== null) {
                byLabel[labelId].satSum += sat;
                byLabel[labelId].satN++;
            }
        }
    }
    return Object.values(byLabel)
        .map(b => ({
            labelId:         b.labelId,
            dotCount:        b.dotCount,
            totalMinutes:    b.totalMinutes,
            avgSatisfaction: b.satN > 0 ? round2(b.satSum / b.satN) : null,
        }))
        .sort((a, b) => b.dotCount - a.dotCount);
}

// ─── 1) 도트 카운트 (완료/부분/건너뜀/대체) ───
function computeDotStats(dots) {
    let doneCount = 0, partialCount = 0, skippedCount = 0, replacedCount = 0;
    for (const d of dots) {
        if (d.executed === true || d.executed === 'done') doneCount++;
        else if (d.executed === 'partial') partialCount++;
        else if (d.executed === 'replaced') replacedCount++;
        else skippedCount++;
    }
    return {
        totalDots: dots.length,
        doneCount, partialCount, skippedCount, replacedCount,
    };
}

// ─── 2) 계획 vs 실제 정렬도 ───
function computeAlignment(decisions, dots) {
    const plannedDecisions = decisions.filter(d =>
        d.timeSlot !== null && d.timeSlot !== undefined
    );

    let executedDecisions = 0;
    for (const dec of plannedDecisions) {
        const matchingDot = dots.find(dot =>
            dot.timeSlot !== undefined && slotsOverlap(dec, dot)
        );
        if (matchingDot) executedDecisions++;
    }

    const dotsWithSlots = dots.filter(d => d.timeSlot !== undefined);
    let overlappingDots = 0;
    for (const dot of dotsWithSlots) {
        if (plannedDecisions.some(dec => slotsOverlap(dec, dot))) {
            overlappingDots++;
        }
    }

    return {
        plannedDecisionsCount: plannedDecisions.length,
        executedDecisionsCount: executedDecisions,
        decisionExecutionRate: plannedDecisions.length > 0
            ? round2(executedDecisions / plannedDecisions.length)
            : null,
        plannedActualOverlap: dotsWithSlots.length > 0
            ? round2(overlappingDots / dotsWithSlots.length)
            : null,
    };
}

function slotsOverlap(a, b) {
    const aStart = a.timeSlot;
    const aEnd   = a.timeSlot + (a.durationSlots || 1);
    const bStart = b.timeSlot;
    const bEnd   = b.timeSlot + (b.durationSlots || 1);
    return aStart < bEnd && bStart < aEnd;
}

// ─── 3) 시간 분배 (라벨 카테고리별 합계, 분 단위) ───
function computeTimeAllocation(dots) {
    const byLabel = {};
    let totalMinutes = 0;

    for (const dot of dots) {
        const minutes = (dot.durationSlots || 1) * MIN_PER_SLOT;
        totalMinutes += minutes;
        for (const labelId of (dot.labelIds || [])) {
            byLabel[labelId] = (byLabel[labelId] || 0) + minutes;
        }
    }

    return { byLabel, totalMinutes };
}

// ─── 4) 만족도·결과 분포 ───
function computeDistribution(dots, fieldName) {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const values = [];

    for (const dot of dots) {
        const v = dot[fieldName];
        if (typeof v === 'number' && v >= 1 && v <= 5) {
            counts[v]++;
            values.push(v);
        }
    }

    const n = values.length;
    const avg = n > 0 ? values.reduce((a, b) => a + b, 0) / n : null;
    const std = n > 1
        ? Math.sqrt(values.reduce((s, x) => s + (x - avg) ** 2, 0) / (n - 1))
        : null;

    return {
        counts,
        avg: avg !== null ? round2(avg) : null,
        std: std !== null ? round2(std) : null,
        sampleSize: n,
    };
}

// ─── 5) 라벨 빈도 ───
function computeLabelFrequency(dots) {
    const counts = {};
    for (const dot of dots) {
        for (const labelId of (dot.labelIds || [])) {
            counts[labelId] = (counts[labelId] || 0) + 1;
        }
    }
    const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([labelId, count]) => ({ labelId, count }));

    return { top: sorted.slice(0, 10), all: counts };
}

// ─── 6) 인물·거래 연결 ───
function computeConnections(dots) {
    const personMap = {};   // personId → { count, satSum, satN }
    const orgMap = {};
    let linkedTransactionsCount = 0;

    for (const dot of dots) {
        const sat = typeof dot.executionSatisfaction === 'number'
            ? dot.executionSatisfaction
            : null;

        for (const personId of (dot.linkedPersonIds || [])) {
            if (!personMap[personId]) personMap[personId] = { count: 0, satSum: 0, satN: 0 };
            personMap[personId].count++;
            if (sat !== null) {
                personMap[personId].satSum += sat;
                personMap[personId].satN++;
            }
        }
        for (const orgId of (dot.linkedOrgIds || [])) {
            if (!orgMap[orgId]) orgMap[orgId] = { count: 0, satSum: 0, satN: 0 };
            orgMap[orgId].count++;
            if (sat !== null) {
                orgMap[orgId].satSum += sat;
                orgMap[orgId].satN++;
            }
        }
        if ((dot.linkedTransactionIds || []).length > 0) {
            linkedTransactionsCount += dot.linkedTransactionIds.length;
        }
    }

    return {
        persons: Object.entries(personMap).map(([personId, v]) => ({
            personId,
            interactionCount: v.count,
            avgSatisfaction: v.satN > 0 ? round2(v.satSum / v.satN) : null,
        })).sort((a, b) => b.interactionCount - a.interactionCount),

        organizations: Object.entries(orgMap).map(([orgId, v]) => ({
            orgId,
            interactionCount: v.count,
            avgSatisfaction: v.satN > 0 ? round2(v.satSum / v.satN) : null,
        })).sort((a, b) => b.interactionCount - a.interactionCount),

        linkedTransactionsCount,
    };
}

// ─── 묵상 메타 (A2 재설계 — boolean만, 카운팅 절대 X) ───
// 시계부 카테고리 합계(timeAllocation.byLabel)에 묵상 라벨이 있으면 시간이 자연히 노출됨.
// 별도 "수행 일수" 같은 점수화 섹션은 만들지 않음.
function computeMeditationMeta(dots) {
    const MEDITATION_LABEL_PATTERNS = [
        /묵상/, /기도/, /성경/, /말씀/, /통독/,
        /meditation/i, /prayer/i, /bible/i, /scripture/i,
    ];

    let morningGatePresent = false;
    let eveningReviewPresent = false;

    for (const dot of dots) {
        const matched = (dot.labelIds || []).some(labelId =>
            MEDITATION_LABEL_PATTERNS.some(p => p.test(labelId))
        );
        if (!matched) continue;

        const slot = dot.timeSlot;
        if (typeof slot !== 'number') continue;
        if (slot < 36) morningGatePresent = true;        // 0시~9시 = morning
        if (slot >= 72) eveningReviewPresent = true;      // 18시~24시 = evening
    }

    return { morningGatePresent, eveningReviewPresent };
}

// ─── 9) Phase F — 거래 통계 ────────────────────────
// 영적 안전장치: bucket(평문), category, direction, expenseType 만 노출.
// exactAmount(절대값) 합산은 자물쇠 안 stats 에 머무름 — LLM 에 절대 금액 전달 X.
function computeTransactionStats(txs) {
    if (!Array.isArray(txs) || txs.length === 0) {
        return {
            totalCount: 0,
            incomeCount: 0,
            expenseCount: 0,
            bucketCount: {},
            categoryCount: {},
            expenseTypeCount: { variable: 0, fixed: 0 },
            givingCount: 0,
        };
    }
    let incomeCount = 0, expenseCount = 0, givingCount = 0;
    const bucketCount = {};
    const categoryCount = {};
    const expenseTypeCount = { variable: 0, fixed: 0 };
    for (const t of txs) {
        if (t.direction === 'income') incomeCount++;
        else expenseCount++;
        const b = t.amountBucket || 'small';
        bucketCount[b] = (bucketCount[b] || 0) + 1;
        const c = t.category || 'other-expense';
        categoryCount[c] = (categoryCount[c] || 0) + 1;
        if (t.direction === 'expense') {
            const et = t.expenseType === 'fixed' ? 'fixed' : 'variable';
            expenseTypeCount[et]++;
        }
        if (isGivingCategory(t.category)) givingCount++;
    }
    return {
        totalCount: txs.length,
        incomeCount,
        expenseCount,
        bucketCount,
        categoryCount,
        expenseTypeCount,
        givingCount,
    };
}

// ─── 헬퍼 ───
function round2(n) { return Math.round(n * 100) / 100; }
