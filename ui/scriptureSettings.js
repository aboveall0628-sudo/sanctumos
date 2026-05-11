/**
 * scriptureSettings.js — 말씀 본문 표시 설정 (로컬 only)
 *
 * Phase E-8/A: 폰트 크기 + 표시할 파트 on/off.
 * Phase E-8/B-1: "묵상 계획(PRESET)" 개념 도입. 4파트 통독은 그 중 하나의 프리셋.
 *
 * 저장소: localStorage. 사용자/기기별로 분리되어 있어야 자연스러움
 * (한 사람이 폰에서 크게 보고 PC에서 작게 보는 경우 흔함).
 */

const KEY = 'sanctum.scriptureSettings.v1';
const USER_PLANS_KEY = 'sanctum.userPlans.v1';

/** 폰트 크기 단계 — verse-text 폰트 크기(px)에 그대로 매핑 */
export const FONT_SIZES = {
    sm: { label: '작게', verse: 13, lineHeight: 1.65 },
    md: { label: '보통', verse: 15, lineHeight: 1.75 },
    lg: { label: '크게', verse: 18, lineHeight: 1.85 },
    xl: { label: '매우 크게', verse: 21, lineHeight: 1.95 },
};

/**
 * 묵상 계획 프리셋 — parts는 BIBLE_METADATA.parts의 id 부분 집합.
 * 자유 구성("내가 만든 계획")은 다음 단계(B-2)에서 추가.
 *
 * id 명명: preset-* 로 시작 → 나중에 user-* (사용자 정의)와 구분.
 */
export const PRESETS = [
    {
        id: 'preset-4parts',
        name: '매일성경 4파트 통독',
        desc: '시가서 / 모세·대선지서 / 역사·소선지서 / 신약 — 4갈래 동시 진행, 1년 1독',
        parts: [1, 2, 3, 4],
    },
    {
        id: 'preset-newtestament',
        name: '신약 중심',
        desc: '복음서·서신서·계시록만. 짧게 1년 1독.',
        parts: [4],
    },
    {
        id: 'preset-ot-three',
        name: '구약 3파트',
        desc: '시가서 + 모세·대선지서 + 역사·소선지서. 신약은 잠시 내려둘 때.',
        parts: [1, 2, 3],
    },
    {
        id: 'preset-poetry',
        name: '시가서 묵상',
        desc: '욥기 · 시편 · 잠언 · 전도서 · 아가. 노래와 지혜에 머무는 시기.',
        parts: [1],
    },
    {
        id: 'preset-mose-newtestament',
        name: '모세·대선지서 + 신약',
        desc: '뼈대(언약·예언) + 성취(예수·교회) — 두 축으로 흐름 잡기.',
        parts: [2, 4],
    },
    {
        id: 'preset-history-newtestament',
        name: '역사·소선지서 + 신약',
        desc: '하나님 백성의 이야기 + 복음. 서사 위주로 따라갈 때.',
        parts: [3, 4],
    },
];

const DEFAULT_PLAN_ID = 'preset-4parts';
const DEFAULTS = {
    fontSize: 'md',                   // sm | md | lg | xl
    activePlanId: DEFAULT_PLAN_ID,
    // Phase E-8/B-3: plan별로 파트의 시작점 override.
    // 모양: { [planId]: { [partId]: { abbr, chapter, anchorDate } } }
    partOverrides: {},
    // Phase E-8/C: 본문 카드 맨 아래 "매일성경 사이트 바로가기" 링크 행을 보일지.
    showDailyBibleLink: true,
    // Phase E-8/E: 본문 진행 방식
    //  - 'calendar' (기본): 매일 자동으로 한 장씩 진행 (달력 방식)
    //  - 'manual': 사용자가 "다 읽었어요" 누른 만큼만 진행 (책갈피 방식)
    progressMode: 'calendar',
    // manual 모드에서 각 파트의 "지금 보여줄 시퀀스 인덱스"
    // 모양: { [planId]: { [partId]: number } }   (partId는 number 또는 string)
    partPositions: {},
};

const PRESET_IDS = new Set(PRESETS.map(p => p.id));

let _cache = null;

function read() {
    if (_cache) return _cache;
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) {
            _cache = { ...DEFAULTS };
            return _cache;
        }
        const parsed = JSON.parse(raw);
        const fontSize = FONT_SIZES[parsed.fontSize] ? parsed.fontSize : DEFAULTS.fontSize;
        // PRESET id 또는 저장된 user plan id (user-*)면 모두 유효
        let activePlanId = null;
        if (PRESET_IDS.has(parsed.activePlanId)) {
            activePlanId = parsed.activePlanId;
        } else if (typeof parsed.activePlanId === 'string' && parsed.activePlanId.startsWith('user-')) {
            const exists = getUserPlans().some(p => p.id === parsed.activePlanId);
            if (exists) activePlanId = parsed.activePlanId;
        }
        // v1 호환: enabledParts만 있던 시점 → 매칭되는 프리셋으로 자동 변환
        if (!activePlanId) {
            activePlanId = matchPresetByParts(parsed.enabledParts) || DEFAULT_PLAN_ID;
        }
        const partOverrides = (parsed.partOverrides && typeof parsed.partOverrides === 'object')
            ? parsed.partOverrides : {};
        const showDailyBibleLink = typeof parsed.showDailyBibleLink === 'boolean'
            ? parsed.showDailyBibleLink : DEFAULTS.showDailyBibleLink;
        const progressMode = parsed.progressMode === 'manual' ? 'manual' : DEFAULTS.progressMode;
        const partPositions = (parsed.partPositions && typeof parsed.partPositions === 'object')
            ? parsed.partPositions : {};
        _cache = { fontSize, activePlanId, partOverrides, showDailyBibleLink, progressMode, partPositions };
        return _cache;
    } catch {
        _cache = { ...DEFAULTS };
        return _cache;
    }
}

function write(next) {
    _cache = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    window.dispatchEvent(new CustomEvent('sanctum:scripture-settings-changed', { detail: next }));
}

/** enabledParts 배열 ↔ 가장 잘 맞는 프리셋 id (없으면 null) */
function matchPresetByParts(parts) {
    if (!Array.isArray(parts) || parts.length === 0) return null;
    const sortedKey = [...new Set(parts)].sort().join(',');
    const found = PRESETS.find(p => [...p.parts].sort().join(',') === sortedKey);
    return found ? found.id : null;
}

export function getScriptureSettings() {
    return { ...read() };
}

/**
 * 현재 활성 묵상 계획 (원본 형태, 정규화 전).
 * - PRESET 형태: { id, name, desc, parts: number[] }   (parts = BIBLE_METADATA.parts.id 배열)
 * - user 형태:   { id, name, books: [[abbr,full,chapters], ...], createdAt }
 *
 * scripture.js가 둘을 같은 모양으로 정규화해 사용함.
 */
export function getActivePlan() {
    const { activePlanId } = read();
    if (PRESET_IDS.has(activePlanId)) {
        return PRESETS.find(p => p.id === activePlanId);
    }
    const userPlan = getUserPlans().find(p => p.id === activePlanId);
    return userPlan || PRESETS[0];
}

export function setActivePlanId(planId) {
    const isPreset = PRESET_IDS.has(planId);
    const isUser = typeof planId === 'string' && planId.startsWith('user-')
        && getUserPlans().some(p => p.id === planId);
    if (!isPreset && !isUser) return;
    write({ ...read(), activePlanId: planId });
}

/**
 * Phase E-8/B-2: 사용자가 직접 만든 묵상 계획 목록.
 * 저장 형식: [{ id: 'user-<ts>', name, books: [[abbr, full, chapters], ...], createdAt }]
 */
export function getUserPlans() {
    try {
        const raw = localStorage.getItem(USER_PLANS_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

/** 모든 활성 가능한 plan (preset + user). 정규화 전, 원본 형태. */
export function listAllPlans() {
    return [...PRESETS, ...getUserPlans()];
}

/**
 * 새 user plan 저장 + 활성화 + 초기 시작점(첫 책 1장 / 오늘) 박기.
 * books가 비어 있거나 이름이 빈 문자열이면 null 반환.
 */
export function addUserPlan({ name, books }) {
    if (!name || !String(name).trim()) return null;
    if (!Array.isArray(books) || books.length === 0) return null;
    const id = 'user-' + Date.now();
    const plan = {
        id,
        name: String(name).trim(),
        books,
        createdAt: todayLocalISO(),
    };
    const userPlans = getUserPlans();
    userPlans.push(plan);
    try { localStorage.setItem(USER_PLANS_KEY, JSON.stringify(userPlans)); } catch {}
    // 초기 시작점 박기 — 첫 책 1장 / 오늘
    const cur = read();
    const today = todayLocalISO();
    const partId = id + '/p1';
    const nextOverrides = {
        ...cur.partOverrides,
        [id]: { [partId]: { abbr: books[0][0], chapter: 1, anchorDate: today } },
    };
    write({ ...cur, activePlanId: id, partOverrides: nextOverrides });
    return plan;
}

/** user plan 삭제. 활성이면 기본 plan으로 되돌림. partOverrides도 함께 청소. */
export function deleteUserPlan(planId) {
    if (typeof planId !== 'string' || !planId.startsWith('user-')) return;
    const userPlans = getUserPlans().filter(p => p.id !== planId);
    try { localStorage.setItem(USER_PLANS_KEY, JSON.stringify(userPlans)); } catch {}
    const cur = read();
    const nextOverrides = { ...cur.partOverrides };
    delete nextOverrides[planId];
    const nextActive = cur.activePlanId === planId ? DEFAULT_PLAN_ID : cur.activePlanId;
    write({ ...cur, activePlanId: nextActive, partOverrides: nextOverrides });
}

export function setFontSize(size) {
    if (!FONT_SIZES[size]) return;
    write({ ...read(), fontSize: size });
    applyFontSizeToCSS(size);
}

export function setShowDailyBibleLink(show) {
    write({ ...read(), showDailyBibleLink: !!show });
}

/** Phase E-8/E: 본문 진행 방식 */
export function getProgressMode() {
    return read().progressMode;
}

export function setProgressMode(mode) {
    const next = mode === 'manual' ? 'manual' : 'calendar';
    write({ ...read(), progressMode: next });
}

/** manual 모드에서 특정 (plan, part)의 현재 인덱스. 없으면 null. */
export function getPartPosition(planId, partId) {
    const { partPositions } = read();
    const v = partPositions?.[planId]?.[partId];
    return typeof v === 'number' ? v : null;
}

/** position을 절댓값으로 박는다 (시드용). */
export function setPartPosition(planId, partId, index) {
    if (!planId || partId === undefined || typeof index !== 'number') return;
    const cur = read();
    const next = {
        ...cur,
        partPositions: {
            ...cur.partPositions,
            [planId]: {
                ...(cur.partPositions?.[planId] || {}),
                [partId]: index,
            },
        },
    };
    write(next);
}

/** position을 1 늘림. 상한이 주어지면 그 직전까지만(한 바퀴 돌아도 멈춤). */
export function advancePartPosition(planId, partId, maxExclusive = Infinity) {
    const cur = read();
    const at = cur.partPositions?.[planId]?.[partId];
    const baseline = typeof at === 'number' ? at : 0;
    const nextIdx = Math.min(baseline + 1, Math.max(0, maxExclusive - 1));
    setPartPosition(planId, partId, nextIdx);
}

/**
 * <html>에 CSS 변수를 박아 verse-text가 즉시 따라가게 함.
 * 앱 부팅 시 한 번, 그리고 폰트 크기 바꿀 때마다 호출.
 */
export function applyFontSizeToCSS(size = null) {
    const s = size || read().fontSize;
    const cfg = FONT_SIZES[s] || FONT_SIZES.md;
    const root = document.documentElement;
    root.style.setProperty('--scripture-fs', cfg.verse + 'px');
    root.style.setProperty('--scripture-lh', String(cfg.lineHeight));
}

/**
 * Phase E-8/B-3: 활성 plan + 특정 파트의 시작점 override 조회.
 * 없으면 null (= 코드 기본 anchor 사용).
 */
export function getPartOverride(planId, partId) {
    const { partOverrides } = read();
    return partOverrides?.[planId]?.[partId] || null;
}

/**
 * 시작점 override 저장. anchorDate는 생략 시 오늘로 자동.
 *   ex) setPartOverride('preset-4parts', 1, { abbr: '시', chapter: 1 })
 */
export function setPartOverride(planId, partId, { abbr, chapter, anchorDate } = {}) {
    if (!planId || !partId || !abbr || !chapter) return;
    const cur = read();
    const next = {
        ...cur,
        partOverrides: {
            ...cur.partOverrides,
            [planId]: {
                ...(cur.partOverrides?.[planId] || {}),
                [partId]: {
                    abbr,
                    chapter: parseInt(chapter, 10),
                    anchorDate: anchorDate || todayLocalISO(),
                },
            },
        },
    };
    write(next);
}

/** 해당 plan·part의 override 제거 → 코드 기본 anchor로 복귀 */
export function clearPartOverride(planId, partId) {
    const cur = read();
    const planMap = cur.partOverrides?.[planId];
    if (!planMap || !planMap[partId]) return;
    const { [partId]: _drop, ...rest } = planMap;
    const nextOverrides = { ...cur.partOverrides };
    if (Object.keys(rest).length === 0) {
        delete nextOverrides[planId];
    } else {
        nextOverrides[planId] = rest;
    }
    write({ ...cur, partOverrides: nextOverrides });
}

function todayLocalISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
