/**
 * derivedScores.js — 도트 누적 만족도를 인물·조직 카드의 점수에 자동 반영
 *
 * 정책 (2026-05-12 합의, memory/project_person_card_policy.md):
 *   - 사용자가 직접 슬라이더를 움직인 축은 `xxxLocked = true` 로 잠김 → 자동 갱신 차단
 *   - 잠기지 않은 축만 만족도 평균에서 파생된 값으로 갱신
 *   - "함께한 시간의 만족도 누적이지 능력 그 자체가 아님" — UI에서 hint로 명시
 *
 * 매핑:
 *   - 0~100 점수축 (Big5, competencies): 기본 50, 만족도 평균(1~5)을 50 + (avg-3)*10 으로 매핑 (범위 30~70)
 *   - 1~5 점수축 (조직 관계 4지표):       만족도 평균을 round 후 1~5 clamp
 *   - 위험도 (1~4):                       만족도 평균과 역방향 (만족도 높음 → 위험도 낮음)
 *
 * 입출력:
 *   - applyDerivedToPerson(person, stats) → 변경된 person 객체 반환 (in-place 갱신)
 *   - applyDerivedToOrg(org, stats)       → 변경된 org 객체 반환 (in-place 갱신)
 *   - stats 인자는 cardStats.computeAllPersonStats / computeAllOrgStats 결과의 개별 항목
 */

const BIG5_KEYS = ['O', 'C', 'E', 'A', 'N'];
const COMPETENCY_KEYS = [
    'analysis', 'execution', 'creativity', 'communication',
    'leadership', 'empathy', 'expertise', 'stamina',
];
const REL_KEYS = ['closeness', 'trust', 'friendliness', 'importance'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * 만족도 평균(1~5) → 0~100 스케일 매핑. 표본이 없으면 기본 50.
 *
 * (B-4 데이터 인프라 트랙 2026-05-15) 만점 회피 곡선 추가:
 *   사용자 통찰: "도트에 좋은 점수 많이 주면 언젠가 만점되어서 객관성 없어진다"
 *   - 현재 점수가 70+ 면 변화율 절반 (둔화)
 *   - 90+ 면 변화율 1/5 (거의 안 움직임)
 *   - 0~70 구간은 정상 변화
 *   currentScore 인자 추가 — 호출 측에서 기존 점수 전달하면 곡선 적용. null 이면 기존 동작 유지.
 *
 *   slowFactor 인자 — 본인 카드(isSelf=true) 변화율 절반 적용용. 디폴트 1.
 */
function avgTo100(avg, currentScore = null, slowFactor = 1) {
    if (avg == null) return currentScore != null ? currentScore : 50;
    const target = clamp(Math.round(50 + (avg - 3) * 10), 0, 100);
    if (currentScore == null) return target;

    // 만점 회피 — 현재 점수 영역별 변화율 감쇠
    let zoneFactor = 1;
    if (currentScore >= 90) zoneFactor = 0.2;
    else if (currentScore >= 70) zoneFactor = 0.5;

    const totalFactor = zoneFactor * slowFactor;
    const delta = (target - currentScore) * totalFactor;
    return clamp(Math.round(currentScore + delta), 0, 100);
}

/**
 * 만족도 평균(1~5) → 1~5 정수. 표본 없으면 null.
 */
function avgTo5(avg) {
    if (avg == null) return null;
    return clamp(Math.round(avg), 1, 5);
}

/**
 * 만족도 평균(1~5) → 위험도 key. 역방향.
 *   avg ≥ 4.0 → 'safe'
 *   2.5~4.0   → 'caution'
 *   < 2.5     → 'risk'
 * 표본 없으면 null.
 */
function avgToRisk(avg) {
    if (avg == null) return null;
    if (avg >= 4.0) return 'safe';
    if (avg >= 2.5) return 'caution';
    return 'risk';
}

/**
 * locked 객체가 그 축을 lock 했는지 확인. 미설정/false면 자동 갱신 허용.
 */
function isLocked(lockMap, key) {
    if (!lockMap || typeof lockMap !== 'object') return false;
    return !!lockMap[key];
}

/**
 * 인물 카드의 unlocked 축에 derived 값을 적용한다.
 *
 * (B-4 데이터 인프라 트랙 2026-05-15) 3가지 보강:
 *   1) 만점 회피 곡선 — avgTo100 에 currentScore 전달
 *   2) 본인 카드(isSelf=true) 변화율 절반 (자기합리화 방지)
 *   3) 변화 감지 시 scoreSnapshots 시퀀스에 시점 자동 추가
 *      - 어떤 축이라도 ±5 이상 변화 + 마지막 스냅샷 7일+ 지남
 *
 * @returns {boolean} 실제로 한 칸이라도 갱신됐으면 true
 */
export function applyDerivedToPerson(person, stats) {
    if (!person) return false;
    // (B-4 데이터 인프라 트랙 2026-05-15) 가중 평균 우선 사용 — cardStats.weightedAvgRating
    //   최근 3개월 70% / 그 이전 30% 가중. 옛 도트 영향 자연 감쇠 → 사람 변화 반영.
    //   없으면 (옛 stats 호환) 기존 avgRating fallback.
    const avg = stats?.weightedAvgRating ?? stats?.avgRating ?? null;
    const slowFactor = person.isSelf === true ? 0.5 : 1;  // 본인 카드는 변화율 절반
    let changed = false;
    let deltaPeak = 0;  // 최대 단일 축 변화량 (스냅샷 트리거 판단용)

    // Big5 (0~100)
    if (!person.bigFive) person.bigFive = {};
    BIG5_KEYS.forEach(k => {
        if (isLocked(person.bigFiveLocked, k)) return;
        const cur = person.bigFive[k];
        const next = avgTo100(avg, cur, slowFactor);
        const d = Math.abs(next - (cur ?? 50));
        if (d > deltaPeak) deltaPeak = d;
        if (cur !== next) { person.bigFive[k] = next; changed = true; }
    });

    // 능력 8축 (0~100)
    if (!person.competencies) person.competencies = {};
    COMPETENCY_KEYS.forEach(k => {
        if (isLocked(person.competenciesLocked, k)) return;
        const cur = person.competencies[k];
        const next = avgTo100(avg, cur, slowFactor);
        const d = Math.abs(next - (cur ?? 50));
        if (d > deltaPeak) deltaPeak = d;
        if (cur !== next) { person.competencies[k] = next; changed = true; }
    });

    // 관계 4지표 (1~5)
    if (!person.relationship) person.relationship = {};
    REL_KEYS.forEach(k => {
        if (isLocked(person.relationshipLocked, k)) return;
        const next = avgTo5(avg);
        if (person.relationship[k] !== next) { person.relationship[k] = next; changed = true; }
    });

    // (B-4 트랙) 변화 폭이 임계 이상이고 마지막 스냅샷 후 7일 이상 지났으면 시퀀스 추가
    if (changed && deltaPeak >= 5) {
        maybeAppendScoreSnapshot(person, deltaPeak);
    }

    return changed;
}

/**
 * (B-4 데이터 인프라 트랙 2026-05-15) 점수 시점 스냅샷 시퀀스 추가.
 *
 * 조건:
 *   - 마지막 스냅샷이 7일+ 지났거나 없음
 *   - deltaPeak >= 5 (호출 측에서 보장)
 *
 * 한 시퀀스에 너무 많이 쌓이지 않도록 최대 200개 유지 (오래된 것부터 자름).
 * 사용자 시야에선 가지 시각화로만 사용 (R15).
 */
function maybeAppendScoreSnapshot(person, deltaPeak) {
    const now = new Date();
    const snapshots = Array.isArray(person.scoreSnapshots) ? person.scoreSnapshots.slice() : [];

    // 마지막 스냅샷 7일 가드
    const last = snapshots[snapshots.length - 1];
    if (last && last.capturedAt) {
        const lastMs = Date.parse(last.capturedAt);
        if (!isNaN(lastMs) && (now.getTime() - lastMs) < 7 * 24 * 60 * 60 * 1000) {
            return; // 7일 안이면 스킵
        }
    }

    snapshots.push({
        capturedAt: now.toISOString(),
        bigFive: { ...(person.bigFive || {}) },
        competencies: { ...(person.competencies || {}) },
        relationship: { ...(person.relationship || {}) },
        trigger: 'auto_change',
        deltaPeak,
    });

    // 시퀀스 상한 200 — 5살 비유 "사진첩 두께 제한"
    if (snapshots.length > 200) snapshots.splice(0, snapshots.length - 200);

    person.scoreSnapshots = snapshots;
}

/**
 * 조직 카드의 unlocked 축에 derived 값을 적용한다.
 */
export function applyDerivedToOrg(org, stats) {
    if (!org) return false;
    const avg = stats?.avgRating ?? null;
    let changed = false;

    // 관계 4지표(friendliness, trust, importance)는 평탄 1~5
    if (!isLocked(org.locked, 'friendliness')) {
        const next = avgTo5(avg);
        if (org.friendliness !== next) { org.friendliness = next; changed = true; }
    }
    if (!isLocked(org.locked, 'trust')) {
        const next = avgTo5(avg);
        if (org.trust !== next) { org.trust = next; changed = true; }
    }
    if (!isLocked(org.locked, 'importance')) {
        const next = avgTo5(avg);
        if (org.importance !== next) { org.importance = next; changed = true; }
    }
    // 위험도는 역방향
    if (!isLocked(org.locked, 'riskLevel')) {
        const next = avgToRisk(avg);
        if (org.riskLevel !== next) { org.riskLevel = next; changed = true; }
    }

    return changed;
}

export { BIG5_KEYS, COMPETENCY_KEYS, REL_KEYS };
