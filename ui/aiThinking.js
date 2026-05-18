/**
 * aiThinking.js — AI 응답 대기 시각 도우미 3종 (디자인 시스템 v1 Phase C)
 *
 * 2026-05-16 신규.
 *
 * 사용자 명시(산출물 §산출물 4 보강 3종): LLM 응답이 평균 4~8초 걸려서
 * "기다림"이 답답함 / 무한 도트 한 톤만 보면 막힌 인상 →
 *
 *   1. 단계 라벨 회전 — 자리별 카피 2.5초마다 교체 (지금 뭐 하고 있는지 보이기)
 *   2. 가짜 progress bar — 0→85% 자연 진행 (응답 도착 시 100% 점프 + 사라짐)
 *   3. typing breath — 응답 글자 25ms/자 노출 (ChatGPT 톤 자리잡힌 패턴)
 *
 * 자리별 카피:
 *   - SWAN: 메시지 살피는 중 → 분류하는 중 → 응답 정리하는 중
 *   - 소크라테스: 묵상 자리 살피는 중 → 원칙 비교하는 중 → 판례 모으는 중 → 질문 다듬는 중
 *   - 리포트 Q&A: 도트 모으는 중 → 흐름 따라가는 중 → 가설 정리하는 중
 *   - 본인 프로필: 질문 다듬는 중 → 답변 살피는 중 → 정리하는 중
 *
 * 사용:
 *   const handle = createThinking(targetEl, { labels: COPY.swan });
 *   const result = await callLLM(...);
 *   finishThinking(handle);                              // 진행 끝
 *   await typeText(responseEl, result.text);             // 응답 노출
 */

// ─── 자리별 단계 카피 카탈로그 ─────────────────────────────────────
export const THINKING_COPY = {
    swan: [
        '메시지 살피는 중...',
        '분류하는 중...',
        '응답 정리하는 중...',
    ],
    socratic: [
        '묵상 자리 살피는 중...',
        '원칙 비교하는 중...',
        '판례 모으는 중...',
        '질문 다듬는 중...',
    ],
    reportQna: [
        '도트 모으는 중...',
        '흐름 따라가는 중...',
        '가설 정리하는 중...',
    ],
    profileBootstrap: [
        '질문 다듬는 중...',
        '답변 살피는 중...',
        '정리하는 중...',
    ],
    reportGenerate: [
        '오늘의 도트 모으는 중...',
        '흐름 따라가는 중...',
        '산문 정리하는 중...',
        '묵상에 가져갈 질문 다듬는 중...',
    ],
    // 디폴트 (어디 자리든 안 잡힐 때)
    generic: [
        '잠깐만요...',
        '정리하는 중...',
    ],
};

// ─── 버튼 자리 inline thinking ─────────────────────────────────────

/**
 * 버튼이 있던 자리에 thinking 카드를 자연 자리잡-... (실은 자리잡-)...
 *   _아니_, 자리잡으-... 흠.
 *   ─ 한 줄로: 버튼을 hide 하고 같은 부모 안에 ai-thinking 카드를 만들어요.
 *   finish() 시 카드 사라지고 버튼 자연 노출 복원.
 *
 * @param {HTMLElement} buttonEl
 * @param {Object} opts
 *   @param {string[]} opts.labels
 * @returns {{ finish: () => void, dispose: () => void }}
 */
export function inlineThinkingForButton(buttonEl, opts = {}) {
    if (!buttonEl || !buttonEl.parentElement) {
        return { finish: () => {}, dispose: () => {} };
    }
    const prevDisplay = buttonEl.style.display;
    buttonEl.style.display = 'none';

    const handle = createThinking(buttonEl.parentElement, opts);
    return {
        finish() {
            handle.finish();
            // 카드 사라진 후 버튼 노출 복원 (필요한 자리만 — 호출 측이 새 UI 만들면 알아서)
            setTimeout(() => {
                if (buttonEl.isConnected) buttonEl.style.display = prevDisplay || '';
            }, 260);
        },
        dispose() {
            handle.dispose();
            if (buttonEl.isConnected) buttonEl.style.display = prevDisplay || '';
        },
    };
}

// ─── 단계 라벨 회전 + 가짜 progress bar ───────────────────────────

/**
 * thinking 카드 생성·시작. handle 을 반환하니까 finishThinking 에 그대로 전달.
 *
 * @param {HTMLElement} container - thinking 카드를 자식으로 넣을 자리
 * @param {Object} opts
 *   @param {string[]} opts.labels        — 단계 카피 배열 (THINKING_COPY 참고)
 *   @param {boolean}  opts.showProgress  — progress bar 표시 (디폴트 true)
 *   @param {number}   opts.intervalMs    — 라벨 회전 간격 (디폴트 2500)
 *   @param {string}   opts.size          — 'sm' | 'md' (디폴트 'md')
 * @returns {{ el: HTMLElement, dispose: () => void, finish: () => void }}
 */
export function createThinking(container, opts = {}) {
    const {
        labels = THINKING_COPY.generic,
        showProgress = true,
        intervalMs = 2500,
        size = 'md',
    } = opts;

    const el = document.createElement('div');
    el.className = `ai-thinking ai-thinking-${size}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    if (showProgress) {
        const bar = document.createElement('div');
        bar.className = 'ai-thinking-bar';
        el.appendChild(bar);
    }

    const labelEl = document.createElement('div');
    labelEl.className = 'ai-thinking-label';
    labelEl.textContent = labels[0] || '...';
    el.appendChild(labelEl);

    container.appendChild(el);

    let stage = 0;
    const timer = setInterval(() => {
        stage = (stage + 1) % labels.length;
        // 부드러운 페이드 — opacity 0 → 1
        labelEl.style.opacity = '0';
        setTimeout(() => {
            labelEl.textContent = labels[stage];
            labelEl.style.opacity = '1';
        }, 150);
    }, intervalMs);

    return {
        el,
        dispose() {
            clearInterval(timer);
            try { el.remove(); } catch (_) {}
        },
        finish() {
            clearInterval(timer);
            el.classList.add('is-done');
            // 가짜 게이지 100% 점프 후 200ms 뒤 제거
            setTimeout(() => {
                try { el.remove(); } catch (_) {}
            }, 240);
        },
    };
}

/**
 * thinking 카드 마무리 — 응답 도착 시 호출.
 */
export function finishThinking(handle) {
    if (handle && typeof handle.finish === 'function') handle.finish();
}

/**
 * thinking 카드 강제 종료 (에러·실패 시).
 */
export function disposeThinking(handle) {
    if (handle && typeof handle.dispose === 'function') handle.dispose();
}

// ─── Typing breath — 응답 글자 한 자씩 노출 ────────────────────────

/**
 * 글자 한 자씩 노출. 25ms/자 자연 자리잡힘.
 *
 * @param {HTMLElement} el         — 텍스트 들어갈 자리 (기존 내용 비우고 시작)
 * @param {string}      fullText
 * @param {Object} [opts]
 *   @param {number}  opts.delay   — 자당 ms (디폴트 25)
 *   @param {boolean} opts.cursor  — 진행 중 커서 표시 (디폴트 true, 끝나면 자동 제거)
 *   @param {AbortSignal} opts.signal — 도중 취소
 * @returns {Promise<void>}
 */
export async function typeText(el, fullText, opts = {}) {
    if (!el) return;
    const { delay = 25, cursor = true, signal } = opts;
    const text = String(fullText || '');

    el.textContent = '';
    if (cursor) el.classList.add('ai-typing');

    for (let i = 0; i < text.length; i++) {
        if (signal?.aborted) {
            el.textContent = text;
            break;
        }
        el.textContent = text.slice(0, i + 1);
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }

    el.classList.remove('ai-typing');
}

/**
 * 동기 모드 — 애니메이션 없이 한 번에. prefers-reduced-motion 또는 긴 응답 시 폴백.
 */
export function setTextInstant(el, fullText) {
    if (!el) return;
    el.classList.remove('ai-typing');
    el.textContent = String(fullText || '');
}

/**
 * prefers-reduced-motion 체크 — true 면 typing 안 함.
 */
export function shouldReduceMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
