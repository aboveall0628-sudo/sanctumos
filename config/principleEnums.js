/**
 * principleEnums.js — B-1 의사결정 시스템 enum 상수 (2026-05-13)
 *
 * 사용자와 합의한 라벨 톤(feedback_collaboration.md — 정중·신앙 어우러진 톤).
 * 강도 라벨 "핵심/주요/참고" 는 기획서 §3 의 "절대/강한/약한" 을 한국어 자연 톤으로 옮긴 것.
 */

// 원칙 강도 — 충돌 해결 시 4단계 폴백의 1단계로 쓰임.
export const PRINCIPLE_STRENGTHS = [
    { id: 'core',      label: '핵심', description: '거의 안 넘는 선' },
    { id: 'primary',   label: '주요', description: '거의 지키되 상황 따라' },
    { id: 'reference', label: '참고', description: '가능하면 지키자' },
];

// 원칙 카테고리 — 기획서 §3
export const PRINCIPLE_CATEGORIES = [
    { id: 'daily',    label: '일상' },
    { id: 'relation', label: '관계' },
    { id: 'faith',    label: '신앙' },
    { id: 'life',     label: '인생' },
    // meta — 다른 원칙들의 우선순위 판단용 (B-3, 1차 보류이지만 스키마는 열어둠)
    { id: 'meta',     label: '메타' },
];

// 원칙 의미축 출처
export const PRINCIPLE_SOURCES = [
    { id: 'user_value',                  label: '내 가치관' },
    { id: 'scripture',                   label: '성경' },
    { id: 'book',                        label: '책' },
    { id: 'ai_drafted_user_confirmed',   label: 'AI 제안(승인)' },
];

export const STRENGTH_LABEL_MAP = Object.fromEntries(
    PRINCIPLE_STRENGTHS.map(s => [s.id, s.label])
);
export const CATEGORY_LABEL_MAP = Object.fromEntries(
    PRINCIPLE_CATEGORIES.map(c => [c.id, c.label])
);
export const SOURCE_LABEL_MAP = Object.fromEntries(
    PRINCIPLE_SOURCES.map(s => [s.id, s.label])
);

export function strengthLabel(id) { return STRENGTH_LABEL_MAP[id] || ''; }
export function categoryLabel(id) { return CATEGORY_LABEL_MAP[id] || ''; }
export function sourceLabel(id) { return SOURCE_LABEL_MAP[id] || ''; }
