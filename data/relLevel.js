/**
 * relLevel.js — 함께한 흔적의 누적값을 게임식 XP·레벨로 환산
 *
 * 정책 (2026-05-12):
 *   - 인물·조직 공용
 *   - XP = (만남 × 10 + 함께한 분 / 3) × 만족도 가중치
 *     · 만족도 1 → ×0.5, 3 → ×1.0, 5 → ×1.5 (선형 보간)
 *     · 평균이 null이면 가중치 ×1.0 으로 처리
 *   - 레벨 곡선: Lv.N → Lv.N+1 까지 N × 100 XP 필요
 *     · 누적 임계값: cum(N) = (N-1) × N / 2 × 100
 *     · Lv.1=0, Lv.2=100, Lv.3=300, Lv.4=600, Lv.5=1000, ... 점점 천천히
 *   - 표시 형식: "Lv.3 (245/300 XP)" (순수 게임 톤)
 */

/**
 * stats(cardStats 결과) → { level, currentXp, totalXp, nextLevelXp, progressRatio, label }
 * stats가 비어있거나 표본이 없으면 Lv.1 0/100 으로 반환.
 */
export function computeRelLevel(stats) {
    const totalXp = computeTotalXp(stats);
    return xpToLevel(totalXp);
}

function computeTotalXp(stats) {
    if (!stats) return 0;
    const meetings = stats.meetingCount || 0;
    const minutes = stats.totalMinutes || 0;
    const avg = stats.avgRating;
    const mult = satisfactionMultiplier(avg);
    const raw = (meetings * 10) + (minutes / 3);
    return Math.round(raw * mult);
}

function satisfactionMultiplier(avg) {
    if (avg == null) return 1.0;
    // [1, 5] → [0.5, 1.5]
    const clamped = Math.max(1, Math.min(5, avg));
    return 0.5 + (clamped - 1) * (1.0 / 4);
}

/**
 * 누적 XP → 레벨 정보.
 * cum(N) = (N-1)*N/2 * 100  (Lv.N 시작에 필요한 누적 XP)
 * 역산: N = floor((1 + sqrt(1 + 8*xp/100)) / 2)
 */
function xpToLevel(totalXp) {
    if (totalXp < 0) totalXp = 0;
    const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * totalXp) / 100)) / 2));
    const cumStart = cumulativeXpForLevel(level);     // 이 레벨 시작 누적
    const cumNext  = cumulativeXpForLevel(level + 1); // 다음 레벨 시작 누적
    const inLevel  = totalXp - cumStart;
    const span     = cumNext - cumStart;              // = level * 100
    return {
        level,
        currentXp: inLevel,
        nextLevelXp: span,
        totalXp,
        progressRatio: span > 0 ? Math.min(1, inLevel / span) : 0,
        label: `Lv.${level} (${inLevel}/${span} XP)`,
    };
}

function cumulativeXpForLevel(n) {
    return ((n - 1) * n / 2) * 100;
}
