/**
 * router.js — 글로벌 keydown 라우터.
 *
 * registry.js 의 단축키를 한 keydown 리스너에서 컨텍스트 검사 후 dispatch.
 *
 * 정책:
 *  - 입력 필드(input/textarea/contenteditable)에 포커스가 있을 땐, 단축키 키가 수정자(Ctrl/Alt/Meta)
 *    하나라도 없으면 무시 (단일 문자 단축키 비활성). 단 Esc 는 예외.
 *  - 잠금 화면(#lock-screen-overlay 가 visible) 일 땐 모든 앱 단축키 비활성.
 *  - 설정에서 단축키 끄기 (localStorage 'sanctum-shortcuts-enabled' === 'false') 시 비활성.
 *  - 액션 결과가 Promise 면 await — 다중 발화 방지 위해 dispatch 중에는 무시.
 */

import { parseCombo, matchEvent } from './keyParser.js';
import { SHORTCUTS } from './registry.js';

let _initialized = false;
let _dispatching = false;
let _entries = []; // { combo, shortcut } — parseCombo 결과를 캐시

const SETTING_KEY = 'sanctum-shortcuts-enabled';
const SINGLE_CHAR_SETTING_KEY = 'sanctum-shortcuts-single-char-enabled';

export function isShortcutsEnabled() {
    return localStorage.getItem(SETTING_KEY) !== 'false';
}
export function setShortcutsEnabled(on) {
    localStorage.setItem(SETTING_KEY, on ? 'true' : 'false');
}
export function isSingleCharEnabled() {
    return localStorage.getItem(SINGLE_CHAR_SETTING_KEY) !== 'false';
}
export function setSingleCharEnabled(on) {
    localStorage.setItem(SINGLE_CHAR_SETTING_KEY, on ? 'true' : 'false');
}

/**
 * 현재 포커스가 입력 영역인가?
 * input/textarea/contenteditable — 단일 문자 단축키는 여기서 비활성.
 */
function isWritingContext() {
    const a = document.activeElement;
    if (!a) return false;
    if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
    if (a.getAttribute && a.getAttribute('contenteditable') === 'true') return true;
    return false;
}

/**
 * 잠금 화면이 활성인가? — 잠금 중엔 앱 단축키 모두 차단.
 */
function isLockedNow() {
    const lock = document.getElementById('lock-screen-overlay');
    if (!lock) return false;
    return !lock.classList.contains('hidden');
}

/**
 * combo 에 수정자가 하나라도 있는가? (Ctrl/Alt/Meta — Shift 는 단일 문자로 봄)
 */
function hasModifier(combo) {
    return combo.ctrl || combo.alt || combo.meta;
}

function build() {
    _entries = [];
    for (const s of SHORTCUTS) {
        const keys = Array.isArray(s.keys) ? s.keys : [s.keys];
        for (const k of keys) {
            const combo = parseCombo(k);
            if (combo) _entries.push({ combo, shortcut: s, keyStr: k });
        }
    }
}

async function onKeyDown(e) {
    if (!isShortcutsEnabled()) return;
    if (isLockedNow()) return;
    if (_dispatching) return;

    // IME 조합 중엔 무시 (한글 입력 중)
    if (e.isComposing || e.keyCode === 229) return;

    const writing = isWritingContext();

    for (const { combo, shortcut } of _entries) {
        if (!matchEvent(combo, e)) continue;

        // 컨텍스트 게이팅
        if (shortcut.context === 'writing' && !writing) continue;
        if (shortcut.context === 'list' && writing) continue;

        // 입력 컨텍스트 정책
        if (writing) {
            // Esc 와 수정자 콤보만 허용. 단, context === 'writing' 으로 명시된 건 통과.
            const isEsc = combo.key === 'Escape';
            const isWritingShortcut = shortcut.context === 'writing';
            if (!isEsc && !hasModifier(combo) && !isWritingShortcut) continue;
        } else {
            // 비입력 컨텍스트에서도, 단일 문자 단축키 글로벌 토글이 꺼져 있으면 차단
            if (!hasModifier(combo) && combo.key !== 'Escape' && !isSingleCharEnabled()) continue;
        }

        // when 가드
        if (typeof shortcut.when === 'function') {
            try { if (!shortcut.when()) continue; } catch (_) { continue; }
        }

        // preventDefault — 브라우저 기본 동작 가로채기 (Ctrl+S 등)
        if (shortcut.preventDefault !== false) {
            // Esc 는 일부 폼 reset 동작이 있을 수 있으니 명시적으로만 막음
            if (shortcut.preventDefault === true || hasModifier(combo) || combo.key === 'Escape') {
                e.preventDefault();
            }
        }

        _dispatching = true;
        try {
            await shortcut.action(e);
        } catch (err) {
            console.error('[shortcuts] action error:', shortcut.id, err);
        } finally {
            // 다음 프레임에 해제 — 같은 keydown 의 echo 방지
            requestAnimationFrame(() => { _dispatching = false; });
        }
        return; // 첫 매치만 처리
    }
}

/**
 * 단축키 시스템 초기화. ui/app.js 가 잠금 해제 직후 호출.
 * 잠금 화면에서는 lockScreen 자체의 keydown 리스너가 비밀번호 입력을 처리하고,
 * 라우터는 isLockedNow() 가드로 자동 차단된다.
 */
export function initShortcuts() {
    if (_initialized) return;
    build();
    window.addEventListener('keydown', onKeyDown, { capture: true });
    _initialized = true;
    console.log('[shortcuts] initialized,', _entries.length, 'bindings');
}

/**
 * 디버그 — 등록된 모든 단축키.
 */
export function listShortcuts() {
    return _entries.map(({ keyStr, shortcut }) => ({
        id: shortcut.id, keys: keyStr, label: shortcut.label, category: shortcut.category,
    }));
}
