/**
 * economyBuckets.js — 경제 모듈 bucket 임계값 + 카테고리 상수.
 *
 * "스타벅스 컵 사이즈" 비유:
 *   - 정확한 금액(exactAmount) 은 자물쇠 안에만 저장
 *   - 평문엔 bucket("소액"/"중액"/"고액"/"거액") 만 — 통계·검색용
 *
 * 디폴트 임계값 (한국 직장인 표준, 2026-05):
 *   - 소액 < 1만원 / 중액 1만~10만 / 고액 10만~100만 / 거액 > 100만
 *
 * 사용자가 [설정 → 경제 임계값] 에서 조정하면 setBucketThresholds 가 호출되어
 * AMOUNT_BUCKETS 라이브 바인딩이 갱신됨 (ES module live binding 활용).
 *
 * ⚠️ 임계값 변경 시 옛 거래의 amountBucket 라벨도 재계산 필요 →
 *    data/economyRepo.recalcAllTransactionBuckets() 를 같이 호출.
 */

// let 으로 export 해야 import 한 쪽에서 갱신값을 보게 됨 (ES module live binding).
export let AMOUNT_BUCKETS = buildBuckets(10000, 100000, 1000000);

/**
 * 사용자 임계값으로 AMOUNT_BUCKETS 갱신. settings 로드 시 + 저장 시 호출.
 *
 * @param {{smallMax:number, mediumMax:number, largeMax:number}} thresholds
 */
export function setBucketThresholds({ smallMax, mediumMax, largeMax }) {
    AMOUNT_BUCKETS = buildBuckets(smallMax, mediumMax, largeMax);
}

/**
 * 현재 임계값 읽기 (저장 시 prefill 등에 사용).
 */
export function getBucketThresholds() {
    return {
        smallMax:  AMOUNT_BUCKETS[0].max,
        mediumMax: AMOUNT_BUCKETS[1].max,
        largeMax:  AMOUNT_BUCKETS[2].max,
    };
}

function buildBuckets(smallMax, mediumMax, largeMax) {
    const fmt = (n) => Number(n).toLocaleString('ko-KR');
    return [
        { id: 'small',  label: '소액', max: smallMax,   icon: '🟢', desc: `${fmt(smallMax)}원 미만` },
        { id: 'medium', label: '중액', max: mediumMax,  icon: '🟡', desc: `${fmt(smallMax)} ~ ${fmt(mediumMax)}` },
        { id: 'large',  label: '고액', max: largeMax,   icon: '🟠', desc: `${fmt(mediumMax)} ~ ${fmt(largeMax)}` },
        { id: 'huge',   label: '거액', max: Infinity,   icon: '🔴', desc: `${fmt(largeMax)} 이상` },
    ];
}

/**
 * 금액 → bucket id.
 * 음수도 절대값 기준. 호출 시점의 AMOUNT_BUCKETS 사용.
 */
export function amountToBucket(amount) {
    const v = Math.abs(Number(amount) || 0);
    for (const b of AMOUNT_BUCKETS) {
        if (v < b.max) return b.id;
    }
    return 'huge';
}

/**
 * 추천 프리셋 — 설정 화면의 빠른 시작 버튼.
 */
export const BUCKET_PRESETS = [
    { id: 'student',   label: '학생·1인 자취', smallMax: 3000,  mediumMax: 30000,  largeMax: 300000 },
    { id: 'worker',    label: '직장인',         smallMax: 10000, mediumMax: 100000, largeMax: 1000000 },
    { id: 'household', label: '부양가족·자영업', smallMax: 50000, mediumMax: 500000, largeMax: 5000000 },
];

/**
 * bucket id → 한국어 라벨.
 */
export function bucketLabel(bucketId) {
    return AMOUNT_BUCKETS.find(b => b.id === bucketId)?.label || bucketId;
}

/**
 * bucket id → 아이콘 (UI 표시용).
 */
export function bucketIcon(bucketId) {
    return AMOUNT_BUCKETS.find(b => b.id === bucketId)?.icon || '⚪';
}

// ─── 카테고리 (수입 / 지출) ─────────────────────────
// 각 카테고리는 사용자가 직접 추가/수정 가능하지만, 시작 시드 16종.
// 영적 안전장치: 'giving' (헌금·기부) 은 별도 강조 — 일반 expense 와 차등 시각 표시.

export const INCOME_CATEGORIES = [
    { id: 'salary',         label: '근로 소득',  icon: 'briefcase' },
    { id: 'business',       label: '사업 소득',  icon: 'store' },
    { id: 'interest',       label: '이자·배당',  icon: 'trending-up' },
    { id: 'gift-received',  label: '받은 선물',  icon: 'gift' },
    { id: 'other-income',   label: '기타 수입',  icon: 'circle-plus' },
];

export const EXPENSE_CATEGORIES = [
    { id: 'food',           label: '음식',       icon: 'utensils' },
    // (2026-05-13 묶음 A 버그) 사교·모임 비용 — 1·2·3차(밥·카페·술·노래방) 한 묶음.
    // 혼자 카페·취미는 'leisure' 로. 누구와 함께 쓴 돈을 모아 보기 위한 축.
    { id: 'social',         label: '사교·모임',  icon: 'users' },
    // (2026-05-13 HC#1) 경조사 — 결혼식 축의·장례식 조의·돌잔치 등 의례적 지출.
    // social(자발적 사교)과 의미 분리: 의례성은 "안 가면 관계가 끊김" 무게의 지출.
    { id: 'ceremony',       label: '경조사',     icon: 'flower-2' },
    { id: 'transport',      label: '교통',       icon: 'car' },
    { id: 'housing',        label: '주거',       icon: 'home' },
    { id: 'utility',        label: '공과금',     icon: 'plug' },
    { id: 'telecom',        label: '통신',       icon: 'smartphone' },
    { id: 'subscription',   label: '구독',       icon: 'repeat' },
    { id: 'health',         label: '의료',       icon: 'heart-pulse' },
    { id: 'education',      label: '교육',       icon: 'book-open' },
    { id: 'clothing',       label: '의류',       icon: 'shirt' },
    { id: 'leisure',        label: '여가',       icon: 'sparkles' },
    { id: 'giving',         label: '헌금·기부',  icon: 'hand-heart',  isGiving: true },
    { id: 'tax',            label: '세금',       icon: 'receipt' },
    { id: 'insurance',      label: '보험',       icon: 'shield' },
    { id: 'fixed-cost',     label: '기타 고정비', icon: 'calendar-clock' },
    { id: 'other-expense',  label: '기타 지출',  icon: 'circle-minus' },
];

// expenseType — 지출의 성질 (고정 / 변동). 카테고리와는 별도 축.
// 같은 음식 거래도 매일의 식대(변동) vs 정기 구독(고정) 으로 구분 가능.
export const EXPENSE_TYPES = [
    { id: 'variable', label: '변동 지출' },
    { id: 'fixed',    label: '고정 지출' },
];

export function expenseTypeLabel(typeId) {
    return EXPENSE_TYPES.find(t => t.id === typeId)?.label || typeId;
}

// ─── (경제 트랙 1.a 2026-05-14) 거래 9종 분류 ────────────
// 가이드 별: "도트=거울+인과 진단" (사용자 명시).
// direction × incomeType/expenseType/transferKind 축으로 9종을 만든다.
//
// 수입 3종 (incomeType):
//   - active    "일해서 번 돈" (월급·프리랜서비)
//   - passive   "내 돈이 일해서 번 돈" (배당·이자·임대)
//   - trade     "사고 팔아서 남은/잃은 돈" (±매매차익, 손실 시 음수)
//
// 지출 4종: 일반(별도 incomeType 없음, category 일반) / 세금(category='tax')
//           / 헌금(category='giving') / 고정비(expenseType='fixed' 또는 category='subscription'·'fixed-cost')
//
// 이체 2종 (transferKind):
//   - internal  내 통장 사이 (transferFromAccountId, transferToAccountId 모두 본인 통장)
//               → 지출 합계 X (분식회계 방지)
//   - external  다른 사람에게 (transferToAccountId=null, recipient만 채움)
//               → 지출 합계 자동 합산
//
// 매매(trade) 거래만 의사결정 흔적 필드 노출: tradeReason/tradeLesson/linkedPrecedentId.

export const DIRECTIONS = [
    { id: 'income',   label: '수입',  shortLabel: '들어옴' },
    { id: 'expense',  label: '지출',  shortLabel: '나감' },
    { id: 'transfer', label: '이체',  shortLabel: '옮김' },
];

export const INCOME_TYPES = [
    { id: 'active',  label: '활성 (노동)',   desc: '일해서 번 돈',          icon: 'briefcase' },
    { id: 'passive', label: '비활성 (자산)', desc: '내 돈이 일해서 번 돈',  icon: 'trending-up' },
    { id: 'trade',   label: '매매 (±)',      desc: '사고 팔아서 남은/잃은 돈', icon: 'arrow-up-down' },
];

export const TRANSFER_KINDS = [
    { id: 'internal', label: '내 통장 사이',     desc: '잔액 이동, 지출 아님' },
    { id: 'external', label: '다른 사람에게',    desc: '메모 필수, 지출로 합산' },
];

export function incomeTypeLabel(typeId) {
    return INCOME_TYPES.find(t => t.id === typeId)?.label || typeId;
}

export function directionLabel(dirId) {
    return DIRECTIONS.find(d => d.id === dirId)?.label || dirId;
}

/**
 * direction 별 카테고리 리스트.
 */
export function categoriesFor(direction) {
    return direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

/**
 * category id → 라벨 (라벨 표시용).
 */
export function categoryLabel(catId) {
    return [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]
        .find(c => c.id === catId)?.label || catId;
}

/**
 * category id → 헌금/기부 여부 (영적 강조 표시용).
 */
export function isGivingCategory(catId) {
    return EXPENSE_CATEGORIES.find(c => c.id === catId)?.isGiving === true;
}
