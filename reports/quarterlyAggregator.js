/**
 * quarterlyAggregator.js — 분기 리포트 deterministic 집계
 *
 * Reports 모듈 STEP 3 (Phase E-9/R-3) — 2026-05-13
 * docs/reports-spec.md §3.4 분기 리포트 섹션을 코드가 계산.
 *
 * 입력: 3개월치 monthReport + 한 분기치 도트 + 결단·인물·원칙
 * 분석 기준: 3개월 모두에서 관찰된 패턴만 가설로 승격 (월간 = 2주+, 분기 = 3개월+).
 *
 * 코드(deterministic)가 채우는 섹션
 *   ① 월간 비교 매트릭스 (3개월 핵심 지표 추이)
 *   ② 시간 분배 변화 (카테고리 점유율 월별)
 *   ③ (보류) 자산·부채 추이 — assets 시스템 없음
 *   ④ 인물 그래프 변화 (innerCircle 변동 + 분기 누적 만남 빈도)
 *   ⑤ 원칙 효과성 누적 (분기 적용/미적용 만족도)
 *   ⑥ 결단 누적의 결 (A3 추상화 — 평균 거리·표본 수)
 *   ⑦ 라벨 상관 안정성 (3개월 일관 상관)
 *   ⑧ (보류) 7계층 목표 정렬도 — layer 메타 시스템 부재
 *
 * AI가 채우는 섹션
 *   ⑨ 가설 5~7개 (3개월 일관성)
 *   ⑩ (보류) 원칙 검증 결과 — 원칙 라이프사이클 시스템 별도 트랙
 *   ⑪ 묵상 질문 4~5개
 */

import { getDotsByDateRange } from '../data/dotsRepo.js';
import { getDailyGoals } from '../data/goalsRepo.js';
import { getPrinciples } from '../data/principlesRepo.js';
import { listMonthReports } from './monthReportRepo.js';
// STEP D-5 (2026-05-14): 5계층 공용 시간대(6구간)·요일·조직 매트릭스
import { computeTimeBandMatrix, computeDayOfWeekMatrix, computeOrgNetwork } from './timeBands.js';

const SLOTS_PER_HOUR = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_TOP_LABEL_PAIRS = 12;
const MAX_TOP_PERSONS = 10;

/**
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} quarterStart - 'YYYY-MM-DD' (분기 첫달 1일)
 * @param {string} quarterEnd   - 'YYYY-MM-DD' (분기 셋째달 마지막일, 포함)
 */
export async function aggregateQuarterlyStats(dek, userId, quarterStart, quarterEnd) {
    const yearQuarter = computeYearQuarter(quarterStart);

    const [dots, allDailyGoals, allPrinciples, recentMonthReports] = await Promise.all([
        getDotsByDateRange(dek, userId, quarterStart, quarterEnd),
        getDailyGoals(dek, userId).catch(() => []),
        getPrinciples(dek, userId).catch(() => []),
        listMonthReports(dek, userId, 12).catch(() => []),
    ]);

    const monthlyMatrix = buildMonthlyMatrix(recentMonthReports, quarterStart, quarterEnd);

    return {
        quarterStart,
        quarterEnd,
        yearQuarter,
        totalDots: dots.length,

        // ① 월간 비교 매트릭스 — 3개월 핵심 지표 추이
        monthlyMatrix,

        // ② 시간 분배 변화 (카테고리 점유율 월별)
        categoryShareByMonth: computeCategoryShareByMonth(dots, quarterStart, quarterEnd),

        // ③ 보류 — 거래/자산 시스템 부재
        transactions: null,
        assets: null,

        // ④ 인물 그래프 (분기 누적 만남 빈도 + 만족도)
        personNetwork: computePersonNetwork(dots),

        // ⑤ 원칙 효과성 누적
        pinnedPrincipleEffectiveness: computePinnedEffectiveness(allPrinciples, dots),

        // ⑥ 결단 누적의 결 (A3)
        decisionFlow: computeDecisionFlow(allDailyGoals, dots, quarterStart, quarterEnd),

        // ⑦ 라벨 상관 (3개월 누적)
        labelCorrelation: computeLabelCorrelation(dots),

        // ⑧ 보류
        goalAlignment: null,

        // STEP D (2026-05-14) — 5계층 다관점 통일: 시간대(6구간)·요일·조직 매트릭스 누적
        timeBandMatrix:   computeTimeBandMatrix(dots),
        dayOfWeekMatrix:  computeDayOfWeekMatrix(dots),
        orgNetwork:       computeOrgNetwork(dots),
    };
}

// ─── ① 월간 비교 매트릭스 ─────────────────────────────────
// 이 분기에 endDate가 속하는 monthReport들을 추출. 사용자가 월간을 만들지 않은 달은 자동 제외.
function buildMonthlyMatrix(monthReports, quarterStart, quarterEnd) {
    const inQuarter = (monthReports || []).filter(m =>
        m.endDate && m.endDate >= quarterStart && m.endDate <= quarterEnd
    );
    inQuarter.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    return {
        months: inQuarter.map(m => {
            const s = m.stats || {};
            const wm = s.weeklyMatrix || {};
            const cat = (s.categorySatisfactionMatrix?.items || [])[0] || null;
            const catHours = cat ? Math.round((cat.durationMinutes || 0) / 60 * 10) / 10 : null;
            return {
                yearMonth:       s.yearMonth || m.id,
                startDate:       m.startDate,
                endDate:         m.endDate,
                totalDots:       typeof s.totalDots === 'number' ? s.totalDots : null,
                weeksWithData:   wm.weeksWithData ?? null,
                topCategory:     cat?.category || null,
                topCategoryHours: catHours,
                decisionAvgDays: s.decisionFlow?.avgDistanceDays ?? null,
                decisionSamples: s.decisionFlow?.sampleSize ?? 0,
                personUnique:    s.personNetwork?.totalUniquePersons ?? 0,
            };
        }),
        monthsWithData: inQuarter.length,
    };
}

// ─── ② 카테고리 점유율 (분기 안 월별 share) ─────────────
function computeCategoryShareByMonth(dots, quarterStart, quarterEnd) {
    // 월별 카테고리 시간 합계
    const byMonth = new Map(); // 'YYYY-MM' → Map(category → minutes)
    for (const dot of dots) {
        if (!dot.date) continue;
        const ym = dot.date.slice(0, 7);
        if (ym < quarterStart.slice(0, 7) || ym > quarterEnd.slice(0, 7)) continue;
        const cat = dot.categoryId || dot.category || '(미분류)';
        const minutes = typeof dot.durationSlots === 'number'
            ? dot.durationSlots * (60 / SLOTS_PER_HOUR) : 0;
        if (!byMonth.has(ym)) byMonth.set(ym, new Map());
        const m = byMonth.get(ym);
        m.set(cat, (m.get(cat) || 0) + minutes);
    }

    const months = [...byMonth.keys()].sort();
    const items = months.map(ym => {
        const m = byMonth.get(ym);
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const cats = [...m.entries()]
            .map(([category, minutes]) => ({
                category,
                minutes: Math.round(minutes),
                share: total > 0 ? Math.round(minutes / total * 1000) / 10 : 0, // 0.1% 단위
            }))
            .sort((a, b) => b.minutes - a.minutes)
            .slice(0, 5);
        return { yearMonth: ym, totalMinutes: Math.round(total), top: cats };
    });
    return { items };
}

// ─── ④ 인물 네트워크 (분기 누적) ────────────────────────
function computePersonNetwork(dots) {
    const map = new Map();
    for (const dot of dots) {
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        for (const personId of (dot.linkedPersonIds || [])) {
            if (!map.has(personId)) map.set(personId, { count: 0, satSum: 0, satN: 0 });
            const v = map.get(personId);
            v.count += 1;
            if (sat != null) { v.satSum += sat; v.satN += 1; }
        }
    }
    const items = [...map.entries()]
        .map(([personId, v]) => ({
            personId,
            interactionCount: v.count,
            avgSatisfaction: v.satN > 0 ? round2(v.satSum / v.satN) : null,
        }))
        .sort((a, b) => b.interactionCount - a.interactionCount)
        .slice(0, MAX_TOP_PERSONS);
    return { items, totalUniquePersons: map.size };
}

// ─── ⑤ 핀 원칙 효과성 ──────────────────────────────────
function computePinnedEffectiveness(allPrinciples, dots) {
    const pinnedIds = new Set(allPrinciples.filter(p => p.pinned).map(p => p.id));
    if (pinnedIds.size === 0) return { applied: null, unapplied: null, hasPinned: false };
    const applied = { satSum: 0, satN: 0, count: 0 };
    const unapplied = { satSum: 0, satN: 0, count: 0 };
    for (const dot of dots) {
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        const linked = Array.isArray(dot.linkedPrincipleIds) ? dot.linkedPrincipleIds : [];
        const hasAny = linked.some(id => pinnedIds.has(id));
        const bucket = hasAny ? applied : unapplied;
        bucket.count += 1;
        if (sat != null) { bucket.satSum += sat; bucket.satN += 1; }
    }
    return {
        hasPinned: true,
        applied: {
            count: applied.count,
            avgSatisfaction: applied.satN > 0 ? round2(applied.satSum / applied.satN) : null,
        },
        unapplied: {
            count: unapplied.count,
            avgSatisfaction: unapplied.satN > 0 ? round2(unapplied.satSum / unapplied.satN) : null,
        },
    };
}

// ─── ⑥ 결단의 시간적 지연 (A3) ──────────────────────────
function computeDecisionFlow(allDailyGoals, dots, qStart, qEnd) {
    const goalById = new Map();
    for (const g of allDailyGoals) goalById.set(g.id, g);
    const distances = [];
    const seenGoalIds = new Set();
    for (const dot of dots) {
        const goalId = dot.linkedGoalId;
        if (!goalId || seenGoalIds.has(goalId)) continue;
        const goal = goalById.get(goalId);
        if (!goal) continue;
        const createdMs = toMillis(goal.createdAt);
        const dotMs = toMillis(dot.date);
        if (createdMs == null || dotMs == null) continue;
        const days = Math.max(0, Math.round((dotMs - createdMs) / MS_PER_DAY));
        distances.push(days);
        seenGoalIds.add(goalId);
    }
    if (distances.length === 0) return { avgDistanceDays: null, sampleSize: 0 };
    return {
        avgDistanceDays: round2(distances.reduce((a, b) => a + b, 0) / distances.length),
        sampleSize: distances.length,
    };
}

// ─── ⑦ 라벨 상관 (3개월 누적) ───────────────────────────
function computeLabelCorrelation(dots) {
    const pairCounts = new Map();
    for (const dot of dots) {
        const labels = Array.isArray(dot.labelIds) ? [...new Set(dot.labelIds)] : [];
        if (labels.length < 2) continue;
        labels.sort();
        for (let i = 0; i < labels.length - 1; i++) {
            for (let j = i + 1; j < labels.length; j++) {
                const key = `${labels[i]}|${labels[j]}`;
                pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
            }
        }
    }
    const topPairs = [...pairCounts.entries()]
        .map(([key, count]) => {
            const [a, b] = key.split('|');
            return { a, b, count };
        })
        .sort((x, y) => y.count - x.count)
        .slice(0, MAX_TOP_LABEL_PAIRS);
    return { topPairs };
}

// ─── 헬퍼 ──────────────────────────────────────────────
function round2(n) { return Math.round(n * 100) / 100; }

function toMillis(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v?.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') {
        const s = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00' : v;
        const ms = Date.parse(s);
        return isNaN(ms) ? null : ms;
    }
    return null;
}

/**
 * 'YYYY-MM-DD' → 'YYYY-Qn' (분기 시작일 기준)
 */
function computeYearQuarter(startDate) {
    const [y, m] = startDate.split('-').map(Number);
    const q = Math.ceil(m / 3);
    return `${y}-Q${q}`;
}

/**
 * 헬퍼: 'YYYY-Qn' → 분기 시작/끝 ISO 날짜
 */
export function getQuarterRange(yearQuarter) {
    const m = String(yearQuarter || '').match(/^(\d{4})-Q([1-4])$/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const q = parseInt(m[2], 10);
    const startMonth = (q - 1) * 3 + 1;     // 1, 4, 7, 10
    const endMonth = startMonth + 2;        // 3, 6, 9, 12
    const lastDay = new Date(y, endMonth, 0).getDate();
    return {
        start: `${y}-${String(startMonth).padStart(2, '0')}-01`,
        end:   `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
}

/**
 * 헬퍼: 'YYYY-MM-DD' → 'YYYY-Qn'
 */
export function dateToYearQuarter(dateStr) {
    if (!dateStr) return null;
    return computeYearQuarter(dateStr);
}
