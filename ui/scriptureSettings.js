/**
 * scriptureSettings.js — 말씀 본문 표시 설정 (로컬 only)
 *
 * Phase E-8/A: 폰트 크기 + 표시할 파트 on/off.
 * (다음 단계에서 번역본/시작점/자유 선택까지 확장 예정 — 이 모듈이 그 진입점.)
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

const DEFAULTS = {
    fontSize: 'md',            // sm | md | lg | xl
    enabledParts: [1, 2, 3, 4], // 4파트 전체 켜짐
};

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
        _cache = {
            fontSize: FONT_SIZES[parsed.fontSize] ? parsed.fontSize : DEFAULTS.fontSize,
            enabledParts: Array.isArray(parsed.enabledParts) && parsed.enabledParts.length > 0
                ? parsed.enabledParts.filter(n => [1, 2, 3, 4].includes(n))
                : [...DEFAULTS.enabledParts],
        };
        if (_cache.enabledParts.length === 0) _cache.enabledParts = [...DEFAULTS.enabledParts];
        return _cache;
    } catch {
        _cache = { ...DEFAULTS };
        return _cache;
    }
}

function write(next) {
    _cache = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    // 변경 통지 — 같은 탭의 다른 모듈(scripture.js)이 즉시 다시 그릴 수 있도록
    window.dispatchEvent(new CustomEvent('sanctum:scripture-settings-changed', { detail: next }));
}

export function getScriptureSettings() {
    return { ...read() };
}

export function setFontSize(size) {
    if (!FONT_SIZES[size]) return;
    const next = { ...read(), fontSize: size };
    write(next);
    applyFontSizeToCSS(size);
}

export function setEnabledParts(parts) {
    const cleaned = [...new Set(parts)].filter(n => [1, 2, 3, 4].includes(n));
    if (cleaned.length === 0) return; // 0개 저장 방지 — 최소 1파트 강제
    const next = { ...read(), enabledParts: cleaned };
    write(next);
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
