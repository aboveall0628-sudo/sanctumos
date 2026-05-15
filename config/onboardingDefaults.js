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

/* ─────────────────────────────────────────────────────────
   (S-E7 2026-05-15) 묵상 트랙 추천 — 온보딩 [6/9] step
   사용자 명시: "자기가 묵상하고 싶은 성경을 고를 수 있어야 해"
   ───────────────────────────────────────────────────────── */

/**
 * 큐티 수준별 추천 트랙.
 *   primary = 큰 카드 1장 (추천 강조)
 *   options = 작은 카드들 (대안)
 *
 *   id 매핑:
 *     - 'essentials100'        → DEVOTIONAL_TRACKS.essentials100
 *     - 'preset-4parts'        → scriptureSettings PRESETS 4파트 통독
 *     - 'preset-newtestament'  → scriptureSettings PRESETS 신약 중심
 *     - 'one-book'             → 책 1권 통독 (사용자 정의, addUserPlan)
 *     - 'custom'               → 자기 만들기 (advanced 강조)
 */
export const RECOMMENDED_TRACKS_BY_LEVEL = {
    basic: {
        primary: {
            id: 'essentials100',
            icon: '🌱',
            label: '100구절 입문',
            desc: '창조 → 죄 → 구원 → 종말까지 18주제 100절. 천천히 핵심부터.',
        },
        options: [
            { id: 'one-book',     icon: '📖', label: '성경 한 권 통독', desc: '책 한 권을 정해서 처음부터 끝까지.' },
            { id: 'preset-4parts', icon: '📜', label: '4파트 통독',     desc: '시가·역사·예언·신약 4파트.' },
        ],
    },
    intermediate: {
        primary: {
            id: 'one-book',
            icon: '📖',
            label: '성경 한 권 통독',
            desc: '책 한 권을 정해서 처음부터 끝까지 깊이 보기.',
        },
        options: [
            { id: 'essentials100',       icon: '🌱', label: '100구절 입문', desc: '핵심 100절 빠르게.' },
            { id: 'preset-4parts',       icon: '📜', label: '4파트 통독',   desc: '시가·역사·예언·신약.' },
            { id: 'preset-newtestament', icon: '✝', label: '신약 중심',    desc: '신약 27권.' },
        ],
    },
    advanced: {
        primary: {
            id: 'preset-4parts',
            icon: '📜',
            label: '매일성경 4파트 통독',
            desc: '하루 4장씩 1년 1독. 시가·역사·예언·신약.',
        },
        // (S-E7.1 2026-05-15) 사용자 명시: 100구절 입문은 어느 레벨에든 자리.
        options: [
            { id: 'essentials100',       icon: '🌱', label: '100구절 입문', desc: '핵심 100절. 곁들임 묵상에도 좋음.' },
            { id: 'preset-newtestament', icon: '✝', label: '신약 중심', desc: '신약 27권.' },
            { id: 'one-book',            icon: '📖', label: '한 권 통독', desc: '책 1권 깊이.' },
            { id: 'custom',              icon: '🛠', label: '직접 만들기', desc: '내가 원하는 책 조합으로.', highlight: true, preparing: true },
        ],
    },
};

/**
 * "한 권 통독" 선택 시 빠른 책 추천 5종.
 *   사용자가 책 1권 정해 통독하는 자리. 너무 길지 않거나 묵상하기 좋은 책 위주.
 *   abbr 는 scripture.js BIBLE_METADATA 안 약자와 동일.
 *
 *   각 항목은 addUserPlan({name, books:[{abbr, chapters:[...]}]}) 형태로 박힘.
 */
export const ONE_BOOK_QUICK_PICKS = [
    { abbr: '시', label: '시편',     desc: '150편', chapters: 150 },
    { abbr: '요', label: '요한복음', desc: '21장',  chapters: 21 },
    { abbr: '빌', label: '빌립보서', desc: '4장 (짧음)',  chapters: 4 },
    { abbr: '잠', label: '잠언',     desc: '31장',  chapters: 31 },
    { abbr: '창', label: '창세기',   desc: '50장',  chapters: 50 },
];

/**
 * 트랙 id 별 첫 묵상 본문.
 *   온보딩 [9/9] 에서 사용자가 고른 트랙·책에 맞춰 자동 추천.
 *
 * @param {string} trackId - 'essentials100' | 'preset-4parts' | 'preset-newtestament' | 'one-book:창' 등
 * @param {string} [levelId] - fallback 시 큐티 수준 기반 디폴트
 */
export function firstMeditationForTrack(trackId, levelId) {
    if (!trackId) return firstMeditationForLevel(levelId);

    if (trackId === 'essentials100') {
        return FIRST_MEDITATION_BY_LEVEL.basic; // 창세기 1:1
    }
    if (trackId === 'preset-4parts' || trackId === 'preset-newtestament') {
        // 신약 중심·4파트 통독 → 요한복음 1:1 (말씀의 첫 구절)
        return {
            ref: '요한복음 1:1',
            bookKey: '요',
            chapter: 1,
            verse: 1,
            text: '태초에 말씀이 계시니라 이 말씀이 하나님과 함께 계셨으니 이 말씀은 곧 하나님이시니라',
        };
    }
    if (trackId.startsWith('one-book:')) {
        // 'one-book:창' 같은 형태 — 그 책 1:1 자동
        const abbr = trackId.slice('one-book:'.length);
        const firstVerseByBook = {
            '시': { ref: '시편 1:1', bookKey: '시', chapter: 1, verse: 1, text: '복 있는 사람은 악인들의 꾀를 따르지 아니하며 죄인들의 길에 서지 아니하며 오만한 자들의 자리에 앉지 아니하고' },
            '요': { ref: '요한복음 1:1', bookKey: '요', chapter: 1, verse: 1, text: '태초에 말씀이 계시니라 이 말씀이 하나님과 함께 계셨으니 이 말씀은 곧 하나님이시니라' },
            '빌': { ref: '빌립보서 1:1', bookKey: '빌', chapter: 1, verse: 1, text: '그리스도 예수의 종 바울과 디모데는 그리스도 예수 안에서 빌립보에 사는 모든 성도와 또한 감독들과 집사들에게 편지하노니' },
            '잠': { ref: '잠언 1:1', bookKey: '잠', chapter: 1, verse: 1, text: '다윗의 아들 이스라엘 왕 솔로몬의 잠언이라' },
            '창': FIRST_MEDITATION_BY_LEVEL.basic,
        };
        return firstVerseByBook[abbr] || FIRST_MEDITATION_BY_LEVEL.basic;
    }
    // fallback
    return firstMeditationForLevel(levelId);
}
