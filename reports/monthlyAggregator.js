/**
 * monthlyAggregator.js — 월간 리포트 deterministic 집계
 *
 * Reports 모듈 STEP 2 (Phase E-9/R-2) — 2026-05-12
 * docs/reports-spec.md §3.3 월간 리포트 섹션을 코드가 계산.
 *
 * 입력: 4~5주치 weekReports + 한 달치 도트 (인물·핀 원칙 누적용) + 결단·인물·원칙
 * 출력: stats 객체
 *
 * 코드(deterministic)가 채우는 섹션
 *   ① 주간 비교 매트릭스 (4~5주 핵심 지표 추이)
 *   ② 시간 4분면 (카테고리 × 만족도 매트릭스)
 *   ③ (보류) 현금흐름 — transactions 시스템 없음. transactions: null
 *   ④ (보류) 자산·부채 변화 — assets 시스템 없음. assets: null
 *   ⑤ 인물 네트워크 (월간 누적 빈도 + 만족도)
 *   ⑥ 라벨 상관 매트릭스 (한 달치 도트의 라벨 동시 출현)
 *   ⑦ 핀 원칙 효과성 (적용 도트 vs 미적용 도트 만족도 차이)
 *   ⑧ 결단의 시간적 지연 (한 달치 결단·실행 평균 거리 — A3 추상화 유지)
 *   ⑨ (보류) 공동체 도트 합류 — 팀 시스템 없음
 *
 * AI가 채우는 섹션 (별도)
 *   ⑩ 가설 3~5개  ⑪ A1 패턴 N개  ⑫ 묵상 질문
 *
 * 원칙
 * - LLM에게 산수 시키지 않음. 모든 수치는 여기서 결정론.
 * - "결단 흐름"은 A3 추상화 — 평균 거리·표본 수만. 라벨/ID 명시 X.
 * - 핀 원칙 효과성은 같은 기간 적용 도트 vs 미적용 도트 비교.
 *   (사용자 의식적 연결만 — dot.linkedPrincipleIds 기반)
 */

import { getDotsByDateRange } from '../data/dotsRepo.js';
import { getDailyGoals } from '../data/goalsRepo.js';
import { getPrinciples } from '../data/principlesRepo.js';
import { listWeekReports } from './weekReportRepo.js';
// STEP D-4 (2026-05-14): 5계층 공용 시간대(6구간)·요일·조직 매트릭스
import { computeTimeBandMatrix, computeDayOfWeekMatrix, computeOrgNetwork } from './timeBands.js';

const SLOTS_PER_HOUR = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_TOP_LABEL_PAIRS = 12;
const MAX_TOP_PERSONS = 8;

/**
 * 월간 리포트 deterministic 통계 집계
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} monthStart - 'YYYY-MM-DD' (월의 첫날, 보통 1일)
 * @param {string} monthEnd   - 'YYYY-MM-DD' (월의 마지막날, 포함)
 * @returns {Promise<Object>} stats 객체
 */
export async function aggregateMonthlyStats(dek, userId, monthStart, monthEnd) {
    const yearMonth = monthStart.slice(0, 7); // 'YYYY-MM'

    const [dots, allDailyGoals, allPrinciples, recentWeekReports] = await Promise.all([
        getDotsByDateRange(dek, userId, monthStart, monthEnd),
        getDailyGoals(dek, userId).catch(() => []),
        getPrinciples(dek, userId).catch(() => []),
        listWeekReports(dek, userId, 12).catch(() => []),
    ]);

    // 이 달에 종료된 주간 리포트만 필터 (weekEnd가 monthStart~monthEnd 사이)
    const weeklyMatrix = buildWeeklyMatrix(recentWeekReports, monthStart, monthEnd);

    return {
        monthStart,
        monthEnd,
        yearMonth,
        totalDots:                  dots.length,

        // ① 주간 비교 매트릭스 — weekReport.stats에서 추출한 4~5주 핵심 지표
        weeklyMatrix,

        // ② 시간 4분면 (카테고리 × 만족도)
        categorySatisfactionMatrix: computeCategoryMatrix(dots),

        // ③·④ — 데이터 없음. 향후 transactions/assets 시스템 합류 시 채움.
        transactions:               null,
        assets:                     null,

        // ⑤ 인물 네트워크 (월간 누적)
        personNetwork:              computePersonNetwork(dots),

        // ⑥ 라벨 상관 매트릭스 (한 달치)
        labelCorrelation:           computeLabelCorrelation(dots),

        // ⑦ 핀 원칙 효과성 — 적용 vs 미적용 도트 만족도 비교
        pinnedPrincipleEffectiveness: computePinnedEffectiveness(allPrinciples, dots),

        // ⑧ 결단 시간적 지연 — A3 추상화 (평균 거리 + 표본 수)
        decisionFlow:               computeDecisionFlow(allDailyGoals, dots, monthStart, monthEnd),

        // ⑨ — 팀 시스템 없음
        teamSessions:               null,

        // STEP D (2026-05-14) — 5계층 다관점 통일: 시간대(6구간)·요일·조직 매트릭스 누적
        timeBandMatrix:             computeTimeBandMatrix(dots),
        dayOfWeekMatrix:            computeDayOfWeekMatrix(dots),
        orgNetwork:                 computeOrgNetwork(dots),
    };
}

// ─── ① 주간 비교 매트릭스 ─────────────────────────────────
// 이 달에 weekEnd가 속하는 weekReport들을 추출해 핵심 지표 4~5개를 표로 정리.
// 사용자가 weekly 리포트를 만들지 않은 주는 자동으로 빠짐 (totalDots: null).
function buildWeeklyMatrix(weekReports, monthStart, monthEnd) {
    const inMonth = (weekReports || []).filter(w =>
        w.endDate && w.endDate >= monthStart && w.endDate <= monthEnd
    );
    // 오래된 주부터 정렬 (시간 순서로 비교 보기 좋게)
    inMonth.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    return {
        weeks: inMonth.map(w => {
            const s = w.stats || {};
            // 시간대 4구간 평균 → 가장 높은 시간대만 추출 (요약 1줄)
            const tb = s.timeBandPattern || {};
            const topBand = Object.values(tb)
                .filter(b => b && typeof b.avg === 'number')
                .sort((a, b) => b.avg - a.avg)[0] || null;

            return {
                yearWeek:        s.yearWeek || w.id,
                startDate:       w.startDate,
                endDate:         w.endDate,
                totalDots:       typeof s.totalDots === 'number' ? s.totalDots : null,
                topBandLabel:    topBand?.label || null,
                topBandAvg:      topBand?.avg ?? null,
                decisionAvgDays: s.decisionFlow?.avgDistanceDays ?? null,
                decisionSamples: s.decisionFlow?.sampleSize ?? 0,
                pinnedApplied:   (s.pinnedPrincipleApplication?.items || [])
                                    .reduce((sum, x) => sum + (x.appliedCount || 0), 0),
            };
        }),
        weeksWithData: inMonth.length,
    };
}

// ─── ② 시간 4분면 (카테고리 × 만족도) ────────────────────
// 카테고리별 도트 수 + 평균 만족도. dotCategories 모듈이 categoryId를 정의.
function computeCategoryMatrix(dots) {
    const byCat = new Map(); // catId → { count, satSum, satN, durationMinutes }
    for (const dot of dots) {
        const cat = dot.categoryId || dot.category || '(미분류)';
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        const minutes = typeof dot.durationSlots === 'number'
            ? dot.durationSlots * (60 / SLOTS_PER_HOUR)
            : 0;
        if (!byCat.has(cat)) byCat.set(cat, { count: 0, satSum: 0, satN: 0, durationMinutes: 0 });
        const c = byCat.get(cat);
        c.count += 1;
        c.durationMinutes += minutes;
        if (sat != null) { c.satSum += sat; c.satN += 1; }
    }
    return {
        items: Array.from(byCat.entries())
            .map(([category, c]) => ({
                category,
                count:           c.count,
                durationMinutes: Math.round(c.durationMinutes),
                avgSatisfaction: c.satN > 0 ? round2(c.satSum / c.satN) : null,
            }))
            .sort((a, b) => b.count - a.count),
    };
}

// ─── ⑤ 인물 네트워크 (월간 누적) ─────────────────────────
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
    const items = Array.from(map.entries())
        .map(([personId, v]) => ({
            personId,
            interactionCount: v.count,
            avgSatisfaction:  v.satN > 0 ? round2(v.satSum / v.satN) : null,
        }))
        .sort((a, b) => b.interactionCount - a.interactionCount)
        .slice(0, MAX_TOP_PERSONS);
    return { items, totalUniquePersons: map.size };
}

// ─── ⑥ 라벨 상관 매트릭스 (월간) ─────────────────────────
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
    const topPairs = Array.from(pairCounts.entries())
        .map(([key, count]) => {
            const [a, b] = key.split('|');
            return { a, b, count };
        })
        .sort((x, y) => y.count - x.count)
        .slice(0, MAX_TOP_LABEL_PAIRS);
    return { topPairs };
}

// ─── ⑦ 핀 원칙 효과성 (적용 vs 미적용 만족도 차이) ─────
// 사용자가 dot.linkedPrincipleIds에 핀 원칙 ID를 명시한 도트 = "의식적으로 원칙을 적용한 도트"
// 미적용 도트 = 모든 핀 원칙 ID가 linked에 없는 도트
// 차이가 크면 "원칙을 의식한 시간이 더 만족스러웠다" 같은 가설 가능 (AI가 판단, 코드는 숫자만)
function computePinnedEffectiveness(allPrinciples, dots) {
    const pinnedIds = new Set(allPrinciples.filter(p => p.pinned).map(p => p.id));
    if (pinnedIds.size === 0) {
        return { applied: null, unapplied: null, hasPinned: false };
    }
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

// ─── ⑧ 결단의 시간적 지연 (A3 추상화) ─────────────────
// weeklyAggregator.computeDecisionFlow와 동일 정책: 평균 거리·표본 수만. 라벨/ID 명시 X.
function computeDecisionFlow(allDailyGoals, dots, monthStart, monthEnd) {
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

    if (distances.length === 0) {
        return { avgDistanceDays: null, sampleSize: 0 };
    }
    return {
        avgDistanceDays: round2(distances.reduce((a, b) => a + b, 0) / distances.length),
        sampleSize:      distances.length,
    };
}

// ─── 헬퍼 ─────────────────────────────────────────────
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
 * 헬퍼: 'YYYY-MM' → 그 달의 시작·끝 ISO 날짜 (월말 토요일 트리거에서 사용)
 */
export function getMonthRange(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate(); // m은 1-12 → Date에서 다음 달 0일 = 이번 달 마지막
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
}
