/**
 * keyParser.js — 단축키 문자열 ↔ KeyboardEvent 매칭
 *
 * 지원 표기:
 *   "Ctrl+K", "Ctrl+Shift+L", "Alt+1", "Alt+ArrowLeft", "Ctrl+/", "Ctrl+,",
 *   "Esc", "Enter", "Ctrl+Enter", "Ctrl+Shift+Backspace", "Delete", "Space"
 *   "?" (Shift+/ — 도움말 모달 같은 단일 문자 단축키)
 *
 * 정책:
 *  - Windows/QWERTY 전제. Cmd(meta) 도 가로채되, 기본은 Ctrl.
 *  - 단일 영문자는 대소문자 무시 (대문자로 정규화).
 *  - "g d" 같은 시퀀스는 이 모듈에서 다루지 않음 (router 가 처리). 여기서는 단일 콤보만.
 */

// 키 별칭 — 표기 ↔ event.key 정규화
const KEY_ALIASES = {
    'esc': 'Escape',
    'escape': 'Escape',
    'space': ' ',
    'spacebar': ' ',
    'del': 'Delete',
    'delete': 'Delete',
    'return': 'Enter',
    'enter': 'Enter',
    'up': 'ArrowUp',
    'down': 'ArrowDown',
    'left': 'ArrowLeft',
    'right': 'ArrowRight',
    'arrowup': 'ArrowUp',
    'arrowdown': 'ArrowDown',
    'arrowleft': 'ArrowLeft',
    'arrowright': 'ArrowRight',
    'plus': '+',
    'tab': 'Tab',
    'backspace': 'Backspace',
};

function normalizeKeyToken(token) {
    const lower = token.toLowerCase();
    if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
    // 단일 영문자 → 대문자
    if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
    // 숫자, 기호 등은 그대로
    if (token.length === 1) return token;
    // F1~F12
    if (/^f\d{1,2}$/.test(lower)) return 'F' + lower.slice(1);
    return token;
}

/**
 * "Ctrl+Shift+L" → { ctrl, shift, alt, meta, key }
 */
export function parseCombo(str) {
    if (!str) return null;
    // "+" 를 키로 쓸 때(Ctrl++) 같은 케이스를 위해, 마지막 "+" 는 키로 간주
    const parts = str.split('+').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const combo = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
    const last = parts.pop();
    for (const p of parts) {
        const lower = p.toLowerCase();
        if (lower === 'ctrl' || lower === 'control') combo.ctrl = true;
        else if (lower === 'shift') combo.shift = true;
        else if (lower === 'alt' || lower === 'option') combo.alt = true;
        else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') combo.meta = true;
    }
    combo.key = normalizeKeyToken(last);
    return combo;
}

/**
 * KeyboardEvent 가 combo 와 일치하는가?
 *
 * 주의: event.key 가 대문자가 되는 건 Shift 가 눌렸을 때만. 우리는 대소문자 무시이므로
 * key 비교 전에 단일 영문자를 정규화한다.
 *
 * "Ctrl+/" 같은 케이스: 미국식 자판에선 Shift 없이 /, 그대로 매치. "?" 는 Shift+/.
 */
export function matchEvent(combo, e) {
    if (!combo) return false;
    // 수정자 정확히 일치 — 단축키에 명시 안 된 수정자가 눌려있으면 미스매치
    // (단, Mac 대응: Ctrl 표기를 meta 도 받아주는 옵션은 잠재 추가. 일단 Windows 우선)
    if (combo.ctrl !== e.ctrlKey) return false;
    if (combo.shift !== e.shiftKey) return false;
    if (combo.alt !== e.altKey) return false;
    if (combo.meta !== e.metaKey) return false;

    let evKey = e.key;
    // 단일 영문자 정규화
    if (/^[a-zA-Z]$/.test(evKey)) evKey = evKey.toUpperCase();
    return evKey === combo.key;
}

/**
 * UI 표기용 — "Ctrl+K" → ["Ctrl", "K"]. 도움말 모달의 키 배지에 사용.
 */
export function comboToBadges(comboStr) {
    if (!comboStr) return [];
    return comboStr.split('+').map(s => s.trim()).filter(Boolean).map(p => {
        const lower = p.toLowerCase();
        if (lower === 'ctrl' || lower === 'control') return 'Ctrl';
        if (lower === 'shift') return 'Shift';
        if (lower === 'alt' || lower === 'option') return 'Alt';
        if (lower === 'meta' || lower === 'cmd') return 'Cmd';
        if (lower === 'escape' || lower === 'esc') return 'Esc';
        if (lower === ' ' || lower === 'space') return 'Space';
        if (lower === 'arrowleft') return '←';
        if (lower === 'arrowright') return '→';
        if (lower === 'arrowup') return '↑';
        if (lower === 'arrowdown') return '↓';
        if (lower === 'backspace') return 'Backspace';
        if (lower === 'enter') return 'Enter';
        if (lower === 'tab') return 'Tab';
        if (lower === 'delete') return 'Del';
        if (/^[a-z]$/.test(lower)) return p.toUpperCase();
        return p;
    });
}
