/**
 * accentColor.js — 사용자 강조 색 3색 선택 (디자인 시스템 v1)
 *
 * (디자인 시스템 v1 2026-05-15)
 *
 * 합의:
 *   - 디자인 시스템 v1 — Brand Accent 변주 3색 (Muted Olive · Warm Beige · Dusty Lavender)
 *   - 사용자가 설정에서 자유 선택. 라이트·다크 둘 다 자연 적응.
 *   - 구현: <html data-accent="..."> + style.css 의 [data-accent] 변수 override.
 *   - 디폴트 = "olive" (디자인 시스템 추천).
 *
 * 사용처:
 *   - 부팅 시 (app.js 초기) — applyAccentFromStorage()
 *   - 설정 화면 카드 — setAccentColor(value) 호출.
 *
 * 시스템 폰트(systemFont.js) 패턴과 같은 결.
 */

const KEY = 'sanctum.accent.v1';

export const ACCENT_COLORS = {
    olive:    { label: '올리브',   desc: '살림·생명·정원의 톤. 차분하고 자연스러워요.' },
    beige:    { label: '베이지',   desc: '따뜻한 한지 톤. 가장 절제된 자리예요.' },
    lavender: { label: '라벤더',   desc: '회복·기도의 톤. 영적 색감이 살아남아요.' },
};

const DEFAULT = 'olive';

/**
 * 저장된 강조 색 (없으면 'olive').
 */
export function getAccentColor() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw && ACCENT_COLORS[raw]) return raw;
    } catch (_) {}
    return DEFAULT;
}

/**
 * 강조 색 자리잡기 + 즉시 <html data-accent> 적용.
 */
export function setAccentColor(value) {
    if (!ACCENT_COLORS[value]) return;
    try { localStorage.setItem(KEY, value); } catch (_) {}
    applyAccentToHtml(value);
}

/**
 * 부팅 시 호출 — localStorage 의 값으로 <html data-accent> 적용.
 */
export function applyAccentFromStorage() {
    const value = getAccentColor();
    applyAccentToHtml(value);
}

/**
 * 내부 — <html data-accent="..."> 토글.
 *   디폴트 'olive' 일 때는 속성 제거(자연 :root 사용).
 *   beige · lavender 만 data-accent 자리잡힘.
 */
function applyAccentToHtml(value) {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    if (value === 'olive' || !ACCENT_COLORS[value]) {
        html.removeAttribute('data-accent');
    } else {
        html.setAttribute('data-accent', value);
    }
}
