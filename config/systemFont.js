/**
 * systemFont.js — 시스템 폰트 4단계 (디자인 토큰 변수 override)
 *
 * (본인 프로필 재기획 트랙 2026-05-15 S-D 후속)
 *
 * 합의:
 *   - 성경 본문 폰트는 sanctum.scriptureSettings.v1 (기존)
 *   - 시스템 폰트는 따로 — 헤더·카드·라벨 모든 자리. 사용자가 직접 조정.
 *   - 4단계: 작게(sm) / 보통(md, 디폴트) / 크게(lg) / 매우 크게(xl)
 *   - 구현: <html> 데이터 속성 + style.css 의 :root 변수 override.
 *
 * 사용처:
 *   - 부팅 시 (app.js 초기) — applySystemFontFromStorage()
 *   - 온보딩 모달 6단계 — setSystemFontScale(size) 호출
 *   - 설정 화면 카드 — 동일.
 *
 * 디자인 토큰 (style.css :root) 와 일관:
 *   - 디폴트 (md) 그대로
 *   - sm: 약 0.92x, lg: 약 1.12x, xl: 약 1.25x
 */

const KEY = 'sanctum.systemFontScale.v1';

export const SYSTEM_FONT_SIZES = {
    sm: { label: '작게',     desc: '한 번에 더 많이 보기' },
    md: { label: '보통',     desc: '기본값' },
    lg: { label: '크게',     desc: '편하게 읽기' },
    xl: { label: '매우 크게', desc: '시력이 편치 않으실 때' },
};

const DEFAULT = 'md';

/**
 * 저장된 시스템 폰트 값 (없으면 'md').
 */
export function getSystemFontScale() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw && SYSTEM_FONT_SIZES[raw]) return raw;
    } catch (_) {}
    return DEFAULT;
}

/**
 * 시스템 폰트 값 저장 + <html data-system-font> 즉시 반영.
 */
export function setSystemFontScale(size) {
    if (!SYSTEM_FONT_SIZES[size]) return;
    try { localStorage.setItem(KEY, size); } catch (_) {}
    applySystemFontScale(size);
    try {
        window.dispatchEvent(new CustomEvent('sanctum:system-font-changed', { detail: { size } }));
    } catch (_) {}
}

/**
 * <html data-system-font="sm|md|lg|xl"> 박기 — CSS 변수 override 가 따라옴.
 */
export function applySystemFontScale(size) {
    const s = SYSTEM_FONT_SIZES[size] ? size : DEFAULT;
    const root = document.documentElement;
    if (root) root.setAttribute('data-system-font', s);
}

/**
 * 앱 부팅 시 1회 호출. localStorage 값 → <html> 적용.
 */
export function applySystemFontFromStorage() {
    applySystemFontScale(getSystemFontScale());
}
