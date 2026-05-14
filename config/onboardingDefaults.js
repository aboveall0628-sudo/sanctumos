/**
 * onboardingDefaults.js — 온보딩 모달 디폴트·추천 데이터 단일 출처
 *
 * (본인 프로필 재기획 트랙 2026-05-15 S-D 후속)
 *
 * 합의 (2026-05-15):
 *   - 풀사이클은 R7 미션 시스템이 14일에 걸쳐 자연 분산
 *   - 온보딩 모달 본 흐름은 짧게 (설정 7단계 + 묵상 한 절 체험)
 *   - 성경 번역본은 "개역개정" 디폴트 + 다른 번역본 "준비 중"
 *   - 기본 원칙 추천 1개 디폴트, 사용자 수정 가능
 *   - 큐티 수준별 추천 본문 1절은 essentials100 트랙 안에서 고름
 *
 * 이 파일은 단일 출처 — onboarding.js / settings.js 가 함께 참조.
 */

/**
 * 성경 번역본 옵션.
 *   현재 코드에 본문 데이터가 들어 있는 건 "개역개정" 단일.
 *   다른 번역본은 자리만 마련 (preparing=true) — 사용자가 알아챌 수 있게.
 */
export const BIBLE_VERSIONS = [
    {
        id: 'krv',
        label: '개역개정',
        desc: '한국 교회에서 가장 널리 읽혀요. 디폴트.',
        preparing: false,
    },
    {
        id: 'new-korean',
        label: '새번역',
        desc: '현대어로 자연스럽게 풀어 옮긴 번역.',
        preparing: true,
    },
    {
        id: 'niv-korean',
        label: 'NIV 한글',
        desc: '국제 표준 영문 NIV의 한글 짝.',
        preparing: true,
    },
];

export const DEFAULT_BIBLE_VERSION = 'krv';

/**
 * 추천 기본 원칙 — 사용자가 직접 보내준 자리(2026-05-15) 그대로.
 *   첫 진입 사용자가 "어떻게 쓰는지" 한 눈에 보도록 디폴트 채워서 보여줌.
 *   사용자가 수정·교체 가능. 그대로 저장도 가능.
 */
export const RECOMMENDED_PRINCIPLE = {
    title: '의사결정 전에 말씀으로 방향 점검, 선택 전 하나님께 묻고 응답 기다리기',
    body: '모든 일정, 계획, 결정 전에 잠시 멈추고 하나님의 뜻을 구해요.\n급한 마음에 휩쓸리지 않고, 기도 후에 평안이 오는 방향으로 움직여요.',
    category: 'daily',
    strength: 'primary',
    source: 'user_value',
    createdBy: 'user',
    pinned: true,
    active: true,
};

/**
 * 큐티 수준별 첫 묵상 추천 본문 1절.
 *   essentials100 트랙 안에서 "처음 만나도 강한 한 절" 을 골라요.
 *   - 🌱 처음(basic):       창세기 1:1   ("태초에 하나님이…") — 가장 짧고 시작점
 *   - 🌿 가끔(intermediate): 시편 23:1   ("여호와는 나의 목자시니…") — 위로
 *   - 🌳 자주(advanced):    빌립보서 4:6~7 ("아무것도 염려하지 말고…") — 기도
 *
 *   각 항목은 ref(표기) + text(본문) + bookKey/chapter/verse(향후 진도 시드용).
 */
export const FIRST_MEDITATION_BY_LEVEL = {
    basic: {
        ref: '창세기 1:1',
        bookKey: '창',
        chapter: 1,
        verse: 1,
        text: '태초에 하나님이 천지를 창조하시니라',
    },
    intermediate: {
        ref: '시편 23:1',
        bookKey: '시',
        chapter: 23,
        verse: 1,
        text: '여호와는 나의 목자시니 내가 부족함이 없으리로다',
    },
    advanced: {
        ref: '빌립보서 4:6~7',
        bookKey: '빌',
        chapter: 4,
        verse: 6,
        text: '아무것도 염려하지 말고 다만 모든 일에 기도와 간구로, 너희 구할 것을 감사함으로 하나님께 아뢰라. 그리하면 모든 지각에 뛰어난 하나님의 평강이 그리스도 예수 안에서 너희 마음과 생각을 지키시리라',
    },
};

/**
 * 디폴트 본문 (큐티 수준 미선택 시).
 */
export const DEFAULT_FIRST_MEDITATION = FIRST_MEDITATION_BY_LEVEL.basic;

/**
 * 큐티 수준 id → 첫 묵상 본문 한 줄 헬퍼.
 */
export function firstMeditationForLevel(levelId) {
    return FIRST_MEDITATION_BY_LEVEL[levelId] || DEFAULT_FIRST_MEDITATION;
}
