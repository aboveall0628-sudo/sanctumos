/**
 * categoryRatingMap.js — 도트 평가 시 카테고리별 5축 인물 평가 + 점수 매핑
 *
 * 정책 (2026-05-12 v3):
 *   - 도트의 카테고리에 따라 그 도트에 등장한 인물에게 줄 수 있는 평가 항목이 달라진다
 *   - 각 평가 항목은 Big5(O/C/E/A/N)·능력 8축에 작은 가중치를 더함
 *   - 도트 저장 시 라벨 효과를 그 인물의 현재 점수에 누적(0~100 clamp)
 *
 * 예) 업무 도트 + "주도" 선택 → leadership +2, E +1 / Big5 N은 안정 ↔ 신경증 역방향
 */

/**
 * 평가 항목 사전. 키는 항목 id, 값은:
 *   label: 화면에 표시할 짧은 한글
 *   competencies: {key: weight}   능력 8축 (analysis/execution/creativity/communication/leadership/empathy/expertise/stamina)
 *   bigFive: {key: weight}        O/C/E/A/N. N은 "안정 ↔ 신경증" 축이라 보통 -값으로 안정 강조
 *
 * weight 단위: 도트 1개당 적용되는 작은 step. 일반적으로 1~3.
 */
export const RATING_DEFS = {
    // 업무·실행·창의
    initiative:  { label: '주도',   competencies: { leadership: 3 },                          bigFive: { E: 2, C: 1 } },
    execution:   { label: '실행',   competencies: { execution:  3 },                          bigFive: { C: 2 } },
    creativity:  { label: '창의',   competencies: { creativity: 3 },                          bigFive: { O: 3 } },
    analysis:    { label: '분석',   competencies: { analysis:   3 },                          bigFive: { O: 2, C: 1 } },
    cooperate:   { label: '협력',   competencies: { communication: 2, empathy: 2 },           bigFive: { A: 2 } },

    // 학습·집중
    focus:       { label: '집중',   competencies: { expertise:  2, execution: 1 },            bigFive: { C: 2 } },
    curiosity:   { label: '호기심', competencies: { analysis:   1, creativity: 1 },           bigFive: { O: 3 } },
    persistence: { label: '끈기',   competencies: { execution:  2, stamina: 1 },              bigFive: { C: 2 } },
    insight:     { label: '통찰',   competencies: { analysis:   3 },                          bigFive: { O: 2 } },
    organize:    { label: '정리',   competencies: { execution:  1 },                          bigFive: { C: 3 } },

    // 운동·에너지
    stamina:     { label: '체력',   competencies: { stamina:    4 },                          bigFive: {} },
    vigor:       { label: '활기',   competencies: { stamina:    2 },                          bigFive: { E: 2 } },
    willpower:   { label: '의지',   competencies: { execution:  2 },                          bigFive: { C: 2 } },
    pace:        { label: '페이스', competencies: { stamina:    1 },                          bigFive: { C: 1 } },

    // 가족·따뜻
    warm:        { label: '따뜻',   competencies: { empathy:    3 },                          bigFive: { A: 2 } },
    tender:      { label: '다정',   competencies: { empathy:    2, communication: 1 },        bigFive: { A: 2 } },
    stable:      { label: '안정',   competencies: {},                                         bigFive: { N: -3 } },
    empathic:    { label: '공감',   competencies: { empathy:    4 },                          bigFive: { A: 1 } },
    trusty:      { label: '신뢰',   competencies: {},                                         bigFive: { A: 2, C: 2 } },

    // 친구·관계
    candid:      { label: '솔직',   competencies: { communication: 2 },                       bigFive: { O: 1 } },
    humor:       { label: '유머',   competencies: { communication: 2 },                       bigFive: { E: 3 } },
    truthful:    { label: '진실',   competencies: {},                                         bigFive: { A: 2 } },
    cozy:        { label: '편안',   competencies: {},                                         bigFive: { N: -2, A: 1 } },
    sincere:     { label: '진심',   competencies: { empathy:    1 },                          bigFive: { A: 2 } },

    // 신앙·고요
    calm:        { label: '평온',   competencies: {},                                         bigFive: { N: -3 } },
    loving:      { label: '사랑',   competencies: { empathy:    3 },                          bigFive: { A: 3 } },
    patient:     { label: '인내',   competencies: { execution:  1 },                          bigFive: { A: 2, N: -1 } },
    humble:      { label: '겸손',   competencies: {},                                         bigFive: { A: 2 } },

    // 휴식·여유
    relax:       { label: '여유',   competencies: {},                                         bigFive: { N: -2, A: 1 } },
    together:    { label: '함께',   competencies: { empathy:    1 },                          bigFive: { E: 1, A: 1 } },
    quiet:       { label: '잔잔',   competencies: {},                                         bigFive: { N: -2 } },

    // 식사·즐거움
    joy:         { label: '즐거움', competencies: {},                                         bigFive: { E: 3 } },
    rich:        { label: '풍성',   competencies: { communication: 1 },                       bigFive: { E: 1 } },

    // 이동·동반
    composed:    { label: '침착',   competencies: {},                                         bigFive: { N: -3, C: 1 } },
    companion:   { label: '동반',   competencies: { empathy:    1 },                          bigFive: { A: 1 } },

    // 집안일·책임
    responsible: { label: '책임',   competencies: { execution:  2 },                          bigFive: { C: 3 } },
    diligent:    { label: '부지런', competencies: { execution:  2 },                          bigFive: { C: 2 } },
};

/**
 * 카테고리 id → 그 카테고리에서 보여줄 평가 항목 5개(±).
 * 사용자가 새 카테고리를 추가하면 fallback 5축으로 표시.
 */
export const CATEGORY_RATING_AXES = {
    work:    ['initiative', 'execution', 'creativity', 'analysis', 'cooperate'],
    study:   ['focus', 'curiosity', 'persistence', 'insight', 'organize'],
    workout: ['stamina', 'persistence', 'vigor', 'willpower', 'pace'],
    family:  ['warm', 'tender', 'stable', 'empathic', 'trusty'],
    friend:  ['candid', 'humor', 'truthful', 'cozy', 'sincere'],
    faith:   ['truthful', 'calm', 'loving', 'patient', 'humble'],
    rest:    ['cozy', 'relax', 'together', 'warm', 'quiet'],
    meal:    ['joy', 'rich', 'tender', 'vigor', 'cozy'],
    move:    ['vigor', 'pace', 'composed', 'companion', 'cozy'],
    chore:   ['responsible', 'diligent', 'cooperate', 'tender', 'stable'],
};

// 사용자 정의 카테고리에 노출할 fallback 5축
export const FALLBACK_RATING_AXES = ['warm', 'truthful', 'cooperate', 'execution', 'cozy'];

/**
 * 카테고리 id → 그 카테고리의 5축 RATING_DEFS 배열 반환.
 * 카테고리 미지정 또는 사용자 정의 → fallback.
 */
export function getRatingAxesForCategory(categoryId) {
    const ids = (categoryId && CATEGORY_RATING_AXES[categoryId]) || FALLBACK_RATING_AXES;
    return ids.map(id => ({ id, ...RATING_DEFS[id] })).filter(r => r.label);
}

/**
 * 선택된 라벨 id들의 가중치 합을 인물 카드 점수에 적용.
 * 정규화 step: weight × 0.7 (도트 1개 영향이 너무 크지 않게).
 * 0~100 clamp. relationship 1~5는 별도 함수에서 처리.
 *
 * @param person — 변경 대상 인물 (in-place 수정)
 * @param labelIds — 선택된 라벨 id 배열
 * @returns 변화가 있었는지
 */
export function applyRatingLabelsToPerson(person, labelIds) {
    if (!person || !Array.isArray(labelIds) || labelIds.length === 0) return false;
    let changed = false;
    person.bigFive = person.bigFive || { O: 50, C: 50, E: 50, A: 50, N: 50 };
    person.competencies = person.competencies || {};

    labelIds.forEach(id => {
        const def = RATING_DEFS[id];
        if (!def) return;
        const STEP = 0.7;

        Object.entries(def.competencies || {}).forEach(([k, w]) => {
            const cur = (person.competencies[k] == null) ? 50 : Number(person.competencies[k]);
            const next = clamp(cur + w * STEP, 0, 100);
            if (next !== cur) { person.competencies[k] = Math.round(next * 10) / 10; changed = true; }
        });

        Object.entries(def.bigFive || {}).forEach(([k, w]) => {
            const cur = (person.bigFive[k] == null) ? 50 : Number(person.bigFive[k]);
            const next = clamp(cur + w * STEP, 0, 100);
            if (next !== cur) { person.bigFive[k] = Math.round(next * 10) / 10; changed = true; }
        });
    });
    return changed;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
