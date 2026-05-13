/**
 * weeklyAggregator.js — 주간 리포트 deterministic 집계
 *
 * Reports 모듈 STEP 1.5 (Phase E-5-B) — 2026-05-11
 * docs/reports-spec.md §3.2 주간 리포트 섹션 1~7을 코드가 계산.
 *   8) 거래 합계 / 9) 시간 분배의 결 / 10) 가설 / 11) 묵상 질문은 AI가 채움.
 *
 * 원칙 (dailyAggregator 와 동일)
 * - LLM 에게 산수 시키지 않음. 모든 수치는 여기서 결정론적으로 계산.
 * - "결단의 흐름"은 A3 추상화 — 평균 거리(일)와 표본 수만. 라벨·ID 명시 X.
 * - 핀 원칙 적용은 dot.linkedPrincipleIds 에 핀 원칙 ID 포함 여부로만 판정 (사용자 의식적 연결).
 *
 * 인덱스 정책
 * - getDotsByDateRange (data/dotsRepo) 는 (userId+date) composite 사용. 기존 사용처 호환.
 * - goals/principles 는 client-side filter — 추가 composite index 의존 없음.
 */

import { getDotsByDateRange } from '../data/dotsRepo.js';
import { getDailyGoals } from '../data/goalsRepo.js';
import { getPrinciples } from '../data/principlesRepo.js';
// STEP D-3 (2026-05-14): 5계층 공용 시간대(6구간)·요일·조직 매트릭스. 주간도 일관 통일.
import { computeDayOfWeekMatrix, computeOrgNetwork } from './timeBands.js';

const MIN_PER_SLOT = 15;          // 15분 단위 슬롯
const SLOTS_PER_HOUR = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// STEP D-3: 시간대 6구간 — 일간 STEP A 와 동일. 4구간(새벽·아침·낮·저녁)에서 6구간으로 확장.
//   새벽 00:00-06:00 / 아침 06:00-09:00 / 오전 09:00-12:00 /
//   오후 12:00-18:00 / 저녁 18:00-22:00 / 밤 22:00-24:00
const TIME_BANDS = [
    { key: 'dawn',         label: '새벽 0-6시',   startHour: 0,  endHour: 6  },
    { key: 'morning',      label: '아침 6-9시',   startHour: 6,  endHour: 9  },
    { key: 'late-morning', label: '오전 9-12시',  startHour: 9,  endHour: 12 },
    { key: 'afternoon',    label: '오후 12-18시', startHour: 12, endHour: 18 },
    { key: 'evening',      label: '저녁 18-22시', startHour: 18, endHour: 22 },
    { key: 'night',        label: '밤 22-24시',   startHour: 22, endHour: 24 },
];

const MAX_TOP_LABEL_PAIRS = 10;

/**
 * 주간 리포트 deterministic 통계 집계
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} weekStart - 'YYYY-MM-DD' (월요일 또는 사용자 주 시작일)
 * @param {string} weekEnd   - 'YYYY-MM-DD' (포함)
 * @returns {Promise<Object>} stats 객체
 */
export async function aggregateWeeklyStats(dek, userId, weekStart, weekEnd) {
    const [dots, allDailyGoals, allPrinciples] = await Promise.all([
        getDotsByDateRange(dek, userId, weekStart, weekEnd),
        getDailyGoals(dek, userId).catch(() => []),
        getPrinciples(dek, userId).catch(() => []),
    ]);

    return {
        weekStart,
        weekEnd,
        yearWeek:                   isoYearWeek(weekEnd),
        totalDots:                  dots.length,
        heatmap:                    computeHeatmap(dots),
        weekdayPattern:             computeWeekdayPattern(dots),
        timeBandPattern:            computeTimeBandPattern(dots),
        decisionFlow:               computeDecisionFlow(allDailyGoals, dots, weekStart, weekEnd),
        labelCorrelation:           computeLabelCorrelation(dots),
        pinnedPrincipleApplication: computePinnedPrincipleApplication(allPrinciples, dots),
        personCounts:               computePersonCounts(dots),
        // STEP D-3: 5계층 통일 — 주간 요일 매트릭스(weekdayPattern 과 별개 표준 형식) + 조직 네트워크
        dayOfWeekMatrix:            computeDayOfWeekMatrix(dots),
        orgNetwork:                 computeOrgNetwork(dots),
    };
}

// ─── ① 주간 히트맵 (7요일 × 24시간 만족도 평균) ───
// grid[dow][hour] = { avg, count } | null  (dow: 0=일 ... 6=토 — JS Date.getDay() 기준)
// timeSlot/4 = 시작 시간. durationSlots 가 여러 시간에 걸치면 시작 시간 셀에만 카운트.
function computeHeatmap(dots) {
    const buckets = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }))
    );

    for (const dot of dots) {
        const dow  = getDayOfWeek(dot.date);
        const hour = typeof dot.timeSlot === 'number'
            ? Math.floor(dot.timeSlot / SLOTS_PER_HOUR)
            : null;
        const sat  = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        if (dow == null || hour == null || hour < 0 || hour >= 24 || sat == null) continue;

        buckets[dow][hour].sum += sat;
        buckets[dow][hour].n   += 1;
    }

    const grid = buckets.map(row =>
        row.map(cell => cell.n > 0
            ? { avg: round2(cell.sum / cell.n), count: cell.n }
            : null
        )
    );
    return { grid };
}

// ─── ② 요일별 패턴 (만족도 평균·표준편차·도트 수) ───
function computeWeekdayPattern(dots) {
    const byDow = {};
    for (let i = 0; i < 7; i++) byDow[i] = [];

    for (const dot of dots) {
        const dow = getDayOfWeek(dot.date);
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        if (dow == null || sat == null) continue;
        byDow[dow].push(sat);
    }

    const summary = {};
    for (let i = 0; i < 7; i++) {
        const values = byDow[i];
        summary[i] = values.length > 0
            ? { avg: round2(mean(values)), std: round2(std(values)), count: values.length }
            : { avg: null, std: null, count: 0 };
    }
    return { byDow: summary };
}

// ─── ③ 시간대별 패턴 (아침/낮/저녁/밤 4구간) ───
function computeTimeBandPattern(dots) {
    const buckets = {};
    for (const band of TIME_BANDS) buckets[band.key] = { sum: 0, n: 0 };

    for (const dot of dots) {
        const hour = typeof dot.timeSlot === 'number'
            ? Math.floor(dot.timeSlot / SLOTS_PER_HOUR)
            : null;
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        if (hour == null || sat == null) continue;

        const band = TIME_BANDS.find(b => hour >= b.startHour && hour < b.endHour);
        if (!band) continue;
        buckets[band.key].sum += sat;
        buckets[band.key].n   += 1;
    }

    const out = {};
    for (const band of TIME_BANDS) {
        const b = buckets[band.key];
        out[band.key] = {
            label: band.label,
            avg:   b.n > 0 ? round2(b.sum / b.n) : null,
            count: b.n,
        };
    }
    return out;
}

// ─── ④ 결단의 흐름 (A3 추상화 — 평균 거리·표본 수만) ───
// 거리 = goal.createdAt(결단 생성 시점) → 첫 매칭 dot.date(실행) 일수.
// 매칭 = dot.linkedGoalId === goal.id.
// 같은 주(weekStart~weekEnd) 안에서 실행된 결단만 대상. 실행 안 된 결단은 카운트 X (부재 명시 금지).
function computeDecisionFlow(allDailyGoals, dots, weekStart, weekEnd) {
    const goalById = new Map();
    for (const g of allDailyGoals) goalById.set(g.id, g);

    const distances = [];
    const seenGoalIds = new Set();   // 한 결단당 한 번만 카운트 (첫 실행 도트)

    // 도트는 dotsRepo 에서 date asc 정렬되어 들어옴. 같은 결단에 대한 첫 도트가 먼저 보임.
    for (const dot of dots) {
        const goalId = dot.linkedGoalId;
        if (!goalId || seenGoalIds.has(goalId)) continue;
        const goal = goalById.get(goalId);
        if (!goal) continue;

        const createdMs = toMillis(goal.createdAt);
        const dotMs     = toMillis(dot.date);   // 'YYYY-MM-DD' → 자정 ms
        if (createdMs == null || dotMs == null) continue;

        const days = Math.max(0, Math.round((dotMs - createdMs) / MS_PER_DAY));
        distances.push(days);
        seenGoalIds.add(goalId);
    }

    if (distances.length === 0) {
        return { avgDistanceDays: null, sampleSize: 0 };
    }
    return {
        avgDistanceDays: round2(mean(distances)),
        sampleSize:      distances.length,
    };
}

// ─── ⑤ 라벨 상관 (같은 도트에서 동시 출현한 라벨 쌍 빈도 상위 N) ───
function computeLabelCorrelation(dots) {
    const pairCounts = new Map();   // key: 'a|b' (a<b) → count
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

// ─── ⑥ 핀 원칙 적용 횟수 + 적용 도트 만족도 ───
// 적용 판정: dot.linkedPrincipleIds 에 핀 원칙 ID 포함 (B-1 합의 — 명시적 연결만).
function computePinnedPrincipleApplication(allPrinciples, dots) {
    const pinned = allPrinciples.filter(p => p.pinned === true);
    if (pinned.length === 0) return { items: [] };

    const stats = new Map();    // principleId → { count, satSum, satN }
    for (const p of pinned) stats.set(p.id, { count: 0, satSum: 0, satN: 0, title: p.title || '(제목 없음)' });

    for (const dot of dots) {
        const linked = Array.isArray(dot.linkedPrincipleIds) ? dot.linkedPrincipleIds : [];
        if (linked.length === 0) continue;
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;

        for (const pid of linked) {
            const s = stats.get(pid);
            if (!s) continue;
            s.count += 1;
            if (sat != null) {
                s.satSum += sat;
                s.satN   += 1;
            }
        }
    }

    const items = Array.from(stats.entries())
        .map(([principleId, s]) => ({
            principleId,
            title:           s.title,
            appliedCount:    s.count,
            avgSatisfaction: s.satN > 0 ? round2(s.satSum / s.satN) : null,
        }))
        .sort((a, b) => b.appliedCount - a.appliedCount);

    return { items };
}

// ─── ⑦ 인물 카운트 (이번 주 만난 사람 빈도와 평균 만족도) ───
function computePersonCounts(dots) {
    const personMap = {};
    for (const dot of dots) {
        const sat = typeof dot.executionSatisfaction === 'number' ? dot.executionSatisfaction : null;
        for (const personId of (dot.linkedPersonIds || [])) {
            if (!personMap[personId]) personMap[personId] = { count: 0, satSum: 0, satN: 0 };
            personMap[personId].count += 1;
            if (sat != null) {
                personMap[personId].satSum += sat;
                personMap[personId].satN   += 1;
            }
        }
    }
    const items = Object.entries(personMap)
        .map(([personId, v]) => ({
            personId,
            interactionCount: v.count,
            avgSatisfaction:  v.satN > 0 ? round2(v.satSum / v.satN) : null,
        }))
        .sort((a, b) => b.interactionCount - a.interactionCount);
    return { items };
}

// ─── 헬퍼 ───
function round2(n) { return Math.round(n * 100) / 100; }

function mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

// 'YYYY-MM-DD' → JS Date.getDay() (0=일 ... 6=토). 잘못된 입력이면 null.
function getDayOfWeek(dateStr) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return d.getDay();
}

// Firestore Timestamp / Date / number / 'YYYY-MM-DD' / ISO string → ms (UTC 기준).
// 'YYYY-MM-DD' 는 로컬 자정으로 해석 (도트의 date 와 결단의 createdAt 시간차를
// "일 단위"로만 비교하므로 약간의 타임존 오차는 round 로 흡수됨).
function toMillis(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v?.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') {
        // 'YYYY-MM-DD' 는 로컬 자정 (T00:00:00 명시)
        const s = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00' : v;
        const ms = Date.parse(s);
        return isNaN(ms) ? null : ms;
    }
    return null;
}

// ISO 주차 — '2026-W19' 형식 (reportPipeline.getYearWeek 와 동일 로직)
function isoYearWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
