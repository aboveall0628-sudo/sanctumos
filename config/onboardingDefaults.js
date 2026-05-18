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
 * (베타 슬림 v1 / 본인 프로필 A 묶음 2026-05-18) 사는 지역 + 타임존.
 *   사업기획서 §1.3 디아스포라 시드 정합 — 서울·파리·도쿄·홍콩·LA + 기타.
 *   사용자가 '기타' 선택 시 타임존만 드롭다운에서 직접 고름.
 *   selfCard.city + selfCard.timezone 두 필드에 저장.
 */
export const CITY_PRESETS = [
    { id: 'seoul',    label: '서울',     timezone: 'Asia/Seoul',     offset: '+09:00', flag: '🇰🇷' },
    { id: 'tokyo',    label: '도쿄',     timezone: 'Asia/Tokyo',     offset: '+09:00', flag: '🇯🇵' },
    { id: 'hongkong', label: '홍콩',     timezone: 'Asia/Hong_Kong', offset: '+08:00', flag: '🇭🇰' },
    { id: 'paris',    label: '파리',     timezone: 'Europe/Paris',   offset: '+01:00', flag: '🇫🇷' },
    { id: 'la',       label: 'LA',       timezone: 'America/Los_Angeles', offset: '-08:00', flag: '🇺🇸' },
    { id: 'other',    label: '다른 곳',  timezone: null,             offset: null,      flag: '🌏' },
];

/**
 * 타임존 드롭다운 옵션 — '기타' 선택 시 노출.
 *   IANA timezone id + 한국어 라벨.
 */
export const TIMEZONE_OPTIONS = [
    { id: 'Asia/Seoul',          label: '서울 (UTC+9)' },
    { id: 'Asia/Tokyo',          label: '도쿄 (UTC+9)' },
    { id: 'Asia/Shanghai',       label: '베이징·상하이 (UTC+8)' },
    { id: 'Asia/Hong_Kong',      label: '홍콩 (UTC+8)' },
    { id: 'Asia/Singapore',      label: '싱가포르 (UTC+8)' },
    { id: 'Asia/Bangkok',        label: '방콕·자카르타 (UTC+7)' },
    { id: 'Asia/Kolkata',        label: '인도 (UTC+5:30)' },
    { id: 'Asia/Dubai',          label: '두바이 (UTC+4)' },
    { id: 'Europe/London',       label: '런던 (UTC+0)' },
    { id: 'Europe/Paris',        label: '파리·베를린 (UTC+1)' },
    { id: 'Europe/Athens',       label: '아테네·이스탄불 (UTC+2)' },
    { id: 'America/Sao_Paulo',   label: '상파울루 (UTC-3)' },
    { id: 'America/New_York',    label: '뉴욕·토론토 (UTC-5)' },
    { id: 'America/Chicago',     label: '시카고 (UTC-6)' },
    { id: 'America/Denver',      label: '덴버 (UTC-7)' },
    { id: 'America/Los_Angeles', label: 'LA·밴쿠버 (UTC-8)' },
    { id: 'Pacific/Auckland',    label: '오클랜드 (UTC+13)' },
];

/**
 * 브라우저 timezone 자동 감지 — Intl.DateTimeFormat resolvedOptions.
 *   '기타' 선택 시 드롭다운 디폴트 값으로 활용.
 */
export function detectBrowserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
    } catch (_) {
        return 'Asia/Seoul';
    }
}

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
 * (2026-05-18 후속) 성경 66권 전체 — 사용자 명시 "성경 커스텀 기능".
 *   onboarding step 8 [전체 보기] 또는 검색 자리에 노출. ONE_BOOK_QUICK_PICKS 는 그대로 상단 추천.
 *   구약 39 + 신약 27. abbr 는 BIBLE_DATA 안 키와 동일.
 */
export const BIBLE_BOOKS_66 = [
    // ─ 구약 모세오경 ─
    { abbr: '창', label: '창세기',     testament: 'old', chapters: 50 },
    { abbr: '출', label: '출애굽기',   testament: 'old', chapters: 40 },
    { abbr: '레', label: '레위기',     testament: 'old', chapters: 27 },
    { abbr: '민', label: '민수기',     testament: 'old', chapters: 36 },
    { abbr: '신', label: '신명기',     testament: 'old', chapters: 34 },
    // ─ 구약 역사서 ─
    { abbr: '수', label: '여호수아',   testament: 'old', chapters: 24 },
    { abbr: '삿', label: '사사기',     testament: 'old', chapters: 21 },
    { abbr: '룻', label: '룻기',       testament: 'old', chapters: 4 },
    { abbr: '삼상', label: '사무엘상', testament: 'old', chapters: 31 },
    { abbr: '삼하', label: '사무엘하', testament: 'old', chapters: 24 },
    { abbr: '왕상', label: '열왕기상', testament: 'old', chapters: 22 },
    { abbr: '왕하', label: '열왕기하', testament: 'old', chapters: 25 },
    { abbr: '대상', label: '역대상',   testament: 'old', chapters: 29 },
    { abbr: '대하', label: '역대하',   testament: 'old', chapters: 36 },
    { abbr: '스', label: '에스라',     testament: 'old', chapters: 10 },
    { abbr: '느', label: '느헤미야',   testament: 'old', chapters: 13 },
    { abbr: '에', label: '에스더',     testament: 'old', chapters: 10 },
    // ─ 구약 시가서 ─
    { abbr: '욥', label: '욥기',       testament: 'old', chapters: 42 },
    { abbr: '시', label: '시편',       testament: 'old', chapters: 150 },
    { abbr: '잠', label: '잠언',       testament: 'old', chapters: 31 },
    { abbr: '전', label: '전도서',     testament: 'old', chapters: 12 },
    { abbr: '아', label: '아가',       testament: 'old', chapters: 8 },
    // ─ 구약 대선지서 ─
    { abbr: '사', label: '이사야',     testament: 'old', chapters: 66 },
    { abbr: '렘', label: '예레미야',   testament: 'old', chapters: 52 },
    { abbr: '애', label: '예레미야애가', testament: 'old', chapters: 5 },
    { abbr: '겔', label: '에스겔',     testament: 'old', chapters: 48 },
    { abbr: '단', label: '다니엘',     testament: 'old', chapters: 12 },
    // ─ 구약 소선지서 ─
    { abbr: '호', label: '호세아',     testament: 'old', chapters: 14 },
    { abbr: '욜', label: '요엘',       testament: 'old', chapters: 3 },
    { abbr: '암', label: '아모스',     testament: 'old', chapters: 9 },
    { abbr: '옵', label: '오바댜',     testament: 'old', chapters: 1 },
    { abbr: '욘', label: '요나',       testament: 'old', chapters: 4 },
    { abbr: '미', label: '미가',       testament: 'old', chapters: 7 },
    { abbr: '나', label: '나훔',       testament: 'old', chapters: 3 },
    { abbr: '합', label: '하박국',     testament: 'old', chapters: 3 },
    { abbr: '습', label: '스바냐',     testament: 'old', chapters: 3 },
    { abbr: '학', label: '학개',       testament: 'old', chapters: 2 },
    { abbr: '슥', label: '스가랴',     testament: 'old', chapters: 14 },
    { abbr: '말', label: '말라기',     testament: 'old', chapters: 4 },
    // ─ 신약 복음서 ─
    { abbr: '마', label: '마태복음',   testament: 'new', chapters: 28 },
    { abbr: '막', label: '마가복음',   testament: 'new', chapters: 16 },
    { abbr: '눅', label: '누가복음',   testament: 'new', chapters: 24 },
    { abbr: '요', label: '요한복음',   testament: 'new', chapters: 21 },
    // ─ 신약 역사서 ─
    { abbr: '행', label: '사도행전',   testament: 'new', chapters: 28 },
    // ─ 신약 바울 서신 ─
    { abbr: '롬', label: '로마서',     testament: 'new', chapters: 16 },
    { abbr: '고전', label: '고린도전서', testament: 'new', chapters: 16 },
    { abbr: '고후', label: '고린도후서', testament: 'new', chapters: 13 },
    { abbr: '갈', label: '갈라디아서', testament: 'new', chapters: 6 },
    { abbr: '엡', label: '에베소서',   testament: 'new', chapters: 6 },
    { abbr: '빌', label: '빌립보서',   testament: 'new', chapters: 4 },
    { abbr: '골', label: '골로새서',   testament: 'new', chapters: 4 },
    { abbr: '살전', label: '데살로니가전서', testament: 'new', chapters: 5 },
    { abbr: '살후', label: '데살로니가후서', testament: 'new', chapters: 3 },
    { abbr: '딤전', label: '디모데전서', testament: 'new', chapters: 6 },
    { abbr: '딤후', label: '디모데후서', testament: 'new', chapters: 4 },
    { abbr: '딛', label: '디도서',     testament: 'new', chapters: 3 },
    { abbr: '몬', label: '빌레몬서',   testament: 'new', chapters: 1 },
    // ─ 신약 일반서신 ─
    { abbr: '히', label: '히브리서',   testament: 'new', chapters: 13 },
    { abbr: '약', label: '야고보서',   testament: 'new', chapters: 5 },
    { abbr: '벧전', label: '베드로전서', testament: 'new', chapters: 5 },
    { abbr: '벧후', label: '베드로후서', testament: 'new', chapters: 3 },
    { abbr: '요일', label: '요한1서',  testament: 'new', chapters: 5 },
    { abbr: '요이', label: '요한2서',  testament: 'new', chapters: 1 },
    { abbr: '요삼', label: '요한3서',  testament: 'new', chapters: 1 },
    { abbr: '유', label: '유다서',     testament: 'new', chapters: 1 },
    // ─ 신약 예언서 ─
    { abbr: '계', label: '요한계시록', testament: 'new', chapters: 22 },
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
