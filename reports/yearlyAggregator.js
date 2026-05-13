/**
 * yearlyAggregator.js — 연간 리포트 deterministic 집계
 *
 * Reports 모듈 STEP 3 (Phase E-9/R-4) — 2026-05-13
 * docs/reports-spec.md §3.5 연간 리포트.
 *
 * 입력: 4분기치 quarterReport + 1년치 도트
 * 분석 기준: 4분기 모두에서 관찰된 패턴만 원칙급 가설로 승격
 *
 * 코드(deterministic)가 채우는 섹션
 *   ① 4분기 비교 매트릭스 (지표 분기별 추이 + 연간 합계)
 *   ② 시간 배분 연간 곡선 (카테고리별 월별 점유율 12개월)
 *   ③ (보류) 자산·부채·순자산 1년 곡선 — assets 시스템 없음
 *   ④ 인물 그래프 1년 변화 (1년 누적 만남 + 상위 N명)
 *   ⑤ (보류) 원칙 라이브러리 변동사 — 라이프사이클 시스템 별도 트랙
 *   ⑥ 결단 누적 정렬도 (분기별 결단 실행률 추이)
 *   ⑦ 라벨 5축 1년 분포 (top N)
 *   ⑧ (보류) 7계층 목표 진척
 *   ⑨ 묵상의 흐름 (1년간 묵상 카테고리 시간 누적 — A2 재설계 유지)
 *   ⑩ (보류) 공동체 활동 누적 — 팀 시스템 없음
 *
 * AI가 채우는 섹션
 *   ⑪ 가설 7~10개 (4분기 일관성, 원칙급)
 *   ⑫ (보류) 원칙 라이브러리 정착 — 별도 트랙
 *   ⑬ 묵상에 가져갈 질문 5개
 */

import { getDotsByDateRange } from '../data/dotsRepo.js';
import { getDailyGoals } from '../data/goalsRepo.js';
import { getPrinciples } from '../data/principlesRepo.js';
import { listQuarterReports } from './quarterReportRepo.js';
// STEP D-6 (2026-05-14): 5계층 공용 시간대(6구간)·요일·조직 매트릭스
import { computeTimeBandMatrix, computeDayOfWeekMatrix, computeOrgNetwork } from './timeBands.js';

const SLOTS_PER_HOUR = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_TOP_LABELS = 15;
const MAX_TOP_PERSONS = 12;
const MEDITATION_CATEGORY_KEYS = ['묵상', 'meditation', 'spiritual'];

/**
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} yearStart - 'YYYY-01-01'
 * @param {string} yearEnd   - 'YYYY-12-31'
 */
export async function aggregateYearlyStats(dek, userId, yearStart, yearEnd) {
    const year = parseInt(yearStart.slice(0, 4), 10);

    const [dots, allDailyGoals, allPrinciples, recentQuarterReports] = await Promise.all([
        getDotsByDateRange(dek, userId, yearStart, yearEnd),
        getDailyGoals(dek, userId).catch(() => []),
        getPrinciples(dek, userId).catch(() => []),
        listQuarterReports(dek, userId, 16).catch(() => []),
    ]);

    const quarterlyMatrix = buildQuarterlyMatrix(recentQuarterReports, yearStart, yearEnd);

    return {
        yearStart,
        yearEnd,
        year,
        totalDots: dots.length,

        // ① 4분기 비교 매트릭스
        quarterlyMatrix,

        // ② 시간 배분 12개월 곡선
        categoryShareByMonth: computeCategoryShareByMonth(dots),

        // ③ 보류
        assets: null,

        // ④ 인물 1년 누적
        personNetwork: computePersonNetwork(dots),

        // ⑤ 보류 — 원칙 라이프사이클
        principleLibrary: null,

        // ⑥ 결단 누적 (1년)
        decisionFlow: computeDecisionFlow(allDailyGoals, dots),

        // ⑦ 라벨 5축 1년 분포 (top N)
        labelDistribution: computeLabelDistribution(dots),

        // ⑧ 보류
        goalAlignment: null,

        // ⑨ 묵상의 흐름 (A2 재설계 — 시간 합계, 영적 점수화 X)
        meditationFlow: computeMeditationFlow(dots),

        // ⑩ 보류
        teamSessions: null,

        // STEP D (2026-05-14) — 5계층 다관점 통일: 시간대(6구간)·요일·조직 매트릭스 누적
        timeBandMatrix:   computeTimeBandMatrix(dots),
        dayOfWeekMatrix:  computeDayOfWeekMatrix(dots),
        orgNetwork:       computeOrgNetwork(dots),
    };
}

// ─── ① 4분기 비교 매트릭스 ─────────────────────────────
function buildQuarterlyMatrix(quarterReports, yearStart, yearEnd) {
    const inYear = (quarterReports || []).filter(q =>
        q.endDate && q.endDate >= yearStart && q.endDate <= yearEnd
    );
    inYear.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    return {
        quarters: inYear.map(q => {
            const s = q.stats || {};
            const mm = s.monthlyMatrix || {};
            const persons = s.personNetwork?.totalUniquePersons ?? 0;
            return {
                yearQuarter:     s.yearQuarter || q.id,
                startDate:       q.startDate,
                endDate:         q.endDate,
                totalDots:       typeof s.totalDots === 'number' ? s.totalDots : null,
                monthsWithData:  mm.monthsWithData ?? null,
                decisionAvgDays: s.decisionFlow?.avgDistanceDays ?? null,
                decisionSamples: s.decisionFlow?.sampleSize ?? 0,
                personUnique:    persons,
            };
        }),
        quartersWithData: inYear.length,
        yearlyTotal: {
            totalDots: inYear.reduce((s, q) => s + (q.stats?.totalDots || 0), 0),
            decisionSamples: inYear.reduce((s, q) => s + (q.stats?.decisionFlow?.sampleSize || 0), 0),
        },
    };
}

// ─── ② 카테고리 12개월 곡선 ────────────────────────────
function computeCategoryShareByMonth(dots) {
    const byMonth = new Map(); // 'YYYY-MM' → Map(category → minutes)
    for (const dot of dots) {
        if (!dot.date) continue;
        const ym = dot.date.slice(0, 7);
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
                share: total > 0 ? Math.round(minutes / total * 1000) / 10 : 0,
            }))
            .sort((a, b) => b.minutes - a.minutes)
            .slice(0, 6);
        return { yearMonth: ym, totalMinutes: Math.round(total), top: cats };
    });
    return { items };
}

// ─── ④ 인물 1년 누적 ───────────────────────────────────
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

// ─── ⑥ 결단의 시간적 지연 (1년 누적, A3) ──────────────
function computeDecisionFlow(allDailyGoals, dots) {
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

// ─── ⑦ 라벨 1년 분포 ───────────────────────────────────
function computeLabelDistribution(dots) {
    const counts = new Map();
    for (const dot of dots) {
        for (const label of (dot.labelIds || [])) {
            counts.set(label, (counts.get(label) || 0) + 1);
        }
    }
    const top = [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_TOP_LABELS);
    return { top, totalUniqueLabels: counts.size };
}

// ─── ⑨ 묵상의 흐름 (A2 — 시간 합계만, 영적 점수화 X) ─
function computeMeditationFlow(dots) {
    const byMonth = new Map();
    let totalMinutes = 0;
    for (const dot of dots) {
        if (!dot.date) continue;
        const cat = String(dot.categoryId || dot.category || '');
        const isMeditation = MEDITATION_CATEGORY_KEYS.some(k => cat.includes(k));
        if (!isMeditation) continue;
        const minutes = typeof dot.durationSlots === 'number'
            ? dot.durationSlots * (60 / SLOTS_PER_HOUR) : 0;
        const ym = dot.date.slice(0, 7);
        byMonth.set(ym, (byMonth.get(ym) || 0) + minutes);
        totalMinutes += minutes;
    }
    const monthly = [...byMonth.entries()]
        .map(([yearMonth, minutes]) => ({ yearMonth, minutes: Math.round(minutes) }))
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    return {
        totalMinutes: Math.round(totalMinutes),
        monthly,
    };
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
 * 'YYYY' → 그 해의 1/1 ~ 12/31
 */
export function getYearRange(year) {
    const y = parseInt(year, 10);
    if (!y) return null;
    return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/**
 * 'YYYY-MM-DD' → 'YYYY' (연도 문자열)
 */
export function dateToYear(dateStr) {
    if (!dateStr) return null;
    return dateStr.slice(0, 4);
}
