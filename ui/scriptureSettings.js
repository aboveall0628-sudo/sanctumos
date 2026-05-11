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
};

const KNOWN_PLAN_IDS = new Set(PRESETS.map(p => p.id));

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
        let activePlanId = KNOWN_PLAN_IDS.has(parsed.activePlanId) ? parsed.activePlanId : null;
        // v1 호환: enabledParts만 있던 시점 → 매칭되는 프리셋으로 자동 변환
        if (!activePlanId) {
            activePlanId = matchPresetByParts(parsed.enabledParts) || DEFAULT_PLAN_ID;
        }
        _cache = { fontSize, activePlanId };
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

/** 현재 활성 묵상 계획 객체 (프리셋 본체) */
export function getActivePlan() {
    const { activePlanId } = read();
    return PRESETS.find(p => p.id === activePlanId) || PRESETS[0];
}

export function setActivePlanId(planId) {
    if (!KNOWN_PLAN_IDS.has(planId)) return;
    write({ ...read(), activePlanId: planId });
}

export function setFontSize(size) {
    if (!FONT_SIZES[size]) return;
    write({ ...read(), fontSize: size });
    applyFontSizeToCSS(size);
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
