/**
 * modalManager.js — 모달 공통 헬퍼
 *
 * 기존 모달들이 제각각 ESC/백드롭/포커스를 처리하던 걸 한 곳에 모은다.
 * 단축키 시스템과 짝꿍 — 등록된 모달이 열려 있는 동안 단축키 라우터가
 * `isModalOpen()` 로 컨텍스트를 분기한다.
 *
 * 사용 예:
 *   const handle = openModal({
 *       overlay: document.getElementById('my-modal-overlay'),
 *       onClose: () => { ... },
 *       initialFocus: '#first-input',
 *       closeOnBackdrop: true,
 *   });
 *   handle.close();
 *
 * 정책:
 *  - ESC → 가장 위 모달 close
 *  - 백드롭 클릭 → close (옵션, 기본 true)
 *  - body { overflow: hidden } 으로 배경 스크롤 락 (모바일 대응)
 *  - 포커스 트랩 (Tab/Shift+Tab 이 모달 내부에서 순환)
 *  - 닫을 때 직전 포커스 복원
 *  - 스택 구조 — 모달 안 모달도 안전
 */

const _stack = []; // { handle, overlay, onClose, prevFocus, keydownHandler, backdropHandler }
let _bodyLocked = false;
let _bodyOverflowPrev = '';

function lockBody() {
    if (_bodyLocked) return;
    _bodyOverflowPrev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    _bodyLocked = true;
}
function unlockBody() {
    if (!_bodyLocked) return;
    document.body.style.overflow = _bodyOverflowPrev;
    _bodyLocked = false;
}

// 포커스 가능 요소 셀렉터 (focus trap 용)
const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE))
        .filter(el => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);
}

/**
 * 모달 열기.
 * @param {Object} opts
 * @param {HTMLElement} opts.overlay - 모달 오버레이 루트 요소 (이미 DOM에 있는)
 * @param {Function} [opts.onClose] - 닫힐 때 호출
 * @param {string|HTMLElement} [opts.initialFocus] - 열리자마자 포커스할 요소 (셀렉터 또는 요소)
 * @param {boolean} [opts.closeOnBackdrop=true] - 오버레이 자체 클릭으로 닫기 허용
 * @param {string} [opts.label] - 디버그용 이름
 * @returns {{close: Function, overlay: HTMLElement}}
 */
export function openModal(opts) {
    const { overlay, onClose, initialFocus, closeOnBackdrop = true, label } = opts || {};
    if (!overlay) throw new Error('[modalManager] overlay required');

    const prevFocus = document.activeElement;

    // 이미 hidden 클래스가 있으면 노출
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-modal', 'true');
    if (!overlay.getAttribute('role')) overlay.setAttribute('role', 'dialog');

    lockBody();

    // 백드롭 클릭 — overlay 자체를 클릭했을 때만 (자식 클릭은 통과)
    const backdropHandler = (e) => {
        if (!closeOnBackdrop) return;
        if (e.target === overlay) handle.close();
    };
    overlay.addEventListener('mousedown', backdropHandler);

    // 포커스 트랩 + ESC 라우팅 (전역 ESC 는 router가 처리, 여기선 Tab만)
    const keydownHandler = (e) => {
        if (e.key === 'Tab') {
            const focusable = getFocusable(overlay);
            if (focusable.length === 0) { e.preventDefault(); return; }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    };
    overlay.addEventListener('keydown', keydownHandler);

    const handle = {
        overlay,
        label: label || '',
        close() {
            // 중복 close 방지
            const idx = _stack.findIndex(s => s.handle === handle);
            if (idx === -1) return;
            _stack.splice(idx, 1);

            overlay.removeEventListener('mousedown', backdropHandler);
            overlay.removeEventListener('keydown', keydownHandler);
            overlay.classList.add('hidden');
            overlay.removeAttribute('aria-modal');

            // 스택이 비면 body 락 해제
            if (_stack.length === 0) unlockBody();

            // 포커스 복원
            if (prevFocus && typeof prevFocus.focus === 'function' && document.body.contains(prevFocus)) {
                try { prevFocus.focus(); } catch (_) {}
            }

            try { onClose && onClose(); } catch (e) { console.error('[modalManager] onClose error:', e); }
        },
    };

    _stack.push({ handle, overlay, onClose, prevFocus, keydownHandler, backdropHandler });

    // 초기 포커스 — 다음 프레임에 (DOM 렌더 완료 대기)
    requestAnimationFrame(() => {
        let target = null;
        if (typeof initialFocus === 'string') target = overlay.querySelector(initialFocus);
        else if (initialFocus instanceof HTMLElement) target = initialFocus;
        if (!target) target = getFocusable(overlay)[0];
        if (target) try { target.focus(); } catch (_) {}
    });

    return handle;
}

/**
 * 가장 위의 모달을 닫는다. ESC 키 핸들러에서 사용.
 * @returns {boolean} 닫은 모달이 있었으면 true
 */
export function closeTopModal() {
    const top = _stack[_stack.length - 1];
    if (!top) return false;
    top.handle.close();
    return true;
}

/**
 * 모달이 하나라도 열려 있는가? — 단축키 라우터의 컨텍스트 검사용.
 */
export function isModalOpen() {
    return _stack.length > 0;
}

/**
 * 현재 열린 모달 개수 — 디버깅용.
 */
export function modalDepth() {
    return _stack.length;
}

/**
 * 모든 모달 강제 종료 — 잠금 발동 시 등.
 */
export function closeAllModals() {
    while (_stack.length > 0) {
        const top = _stack[_stack.length - 1];
        try { top.handle.close(); } catch (_) { _stack.pop(); }
    }
}
