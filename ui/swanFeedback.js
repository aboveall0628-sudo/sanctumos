/**
 * swanFeedback.js — SWAN 풍선 피드백 UI (CS AI 트랙 §9 3~5단계)
 *
 * 2026-05-15 신규.
 *
 * 흐름:
 *   1. 화면 우하단 풍선 버튼 → 클릭 시 모달 열림
 *   2. 모달: SWAN 첫 인사 → 사용자 입력 → SWAN 응답 (최대 12턴)
 *   3. [보내기] 또는 5분 무응답 → 자동 요약·분류 1회 → Firestore 종료
 *   4. 베타 환경에서만 풍선 노출 — 시작 시 mountSwanFeedback({ userId, getNickname })
 *
 * 의존:
 *   - data/feedbacksRepo.js — startFeedback / addTurn / finalizeFeedback
 *   - infra/feedbackContext.js — 자동 라벨 9종
 *   - ui/aiClient.js — callSwanAgent / callSwanSummary
 *   - ui/modalManager.js — openModal
 *   - ui/quickReview.js — showToast
 */

import { openModal } from './modalManager.js';
import { showToast } from './quickReview.js';
import { collectFeedbackContext } from '../infra/feedbackContext.js';
import {
    callSwanAgent, callSwanSummary,
    callSwanPreSurvey, callSwanPreSurveyExtract,
} from './aiClient.js';
import {
    startFeedback,
    addTurn,
    finalizeFeedback,
    saveSurveyExtract,
} from '../data/feedbacksRepo.js';
import { THINKING_COPY, typeText, shouldReduceMotion } from './aiThinking.js';
import { FAQ_FALLBACK_HINT_CHAT, findFaqById, getVisibleFaqs } from '../config/faqCatalog.js';

// ─── 카피 (Rule 9 §10-1~4 디폴트, 2026-05-15) ─────────────────
const COPY = {
    // 일반 피드백 (kind='feedback')
    feedback: {
        openingTurn:    '안녕하세요. 오늘 어떤 부분을 알려주고 싶으세요?',
        closeFarewell:  '알려주셔서 고마워요. 잘 정리해 둘게요.',
        turnLimitNote:  '여기까지 알려주신 걸 정리해서 보낼게요.',
        title:          'SWAN',
        balloonAria:    '의견 보내기',
    },
    // 사전 설문 (kind='preSurvey')
    preSurvey: {
        openingTurn:    null,             // AI 첫 호출이 오프닝+Q1 생성
        closeFarewell:  '사전 설문 잘 받았어요. 고마워요.',
        turnLimitNote:  '여기까지 들려주신 걸 잘 정리해 둘게요.',
        title:          'SWAN · 사전 설문',
        balloonAria:    '사전 설문 시작',
    },
    inputPlaceholder: '편하게 알려주세요…',
    sendButton:       '보내기',
    closeAria:        '닫기',
    summaryFailToast: '전달은 잘 됐어요. 자동 정리만 잠깐 못 했어요.',
    sendFailToast:    '잠깐 문제가 있었어요. 다시 한 번 보내볼까요?',
};

const MAX_TURNS_BY_KIND = {
    feedback:   12,    // 일반 피드백
    preSurvey:  40,    // 10 질문 × 평균 3~4 턴 (Q+후속+사용자)
    postSurvey: 50,    // 사후 13 질문 (Phase 2)
};
const AUTO_CLOSE_MS = 5 * 60_000; // 5분 무응답

// ─── 모듈 상태 ───────────────────────────────────────────────
let _userId        = null;
let _getNickname   = () => '';
let _balloonEl     = null;
let _mounted       = false;

// 세션 상태 — 모달이 열려있는 동안만 유효
let _session = null;
/** _session = {
 *    feedbackId, context, nickname,
 *    turns: [{role:'swan'|'user', text, at}],
 *    waitingForSwan: bool,
 *    autoCloseTimer: number|null,
 *    finalized: bool,
 *    modalHandle: any,
 *    listEl: HTMLElement,
 *    inputEl: HTMLTextAreaElement,
 *    sendBtn: HTMLButtonElement,
 * } */

// ─── 진입점 ──────────────────────────────────────────────────

/**
 * 풍선 마운트. 잠금 해제 후 한 번만 호출.
 * 베타 코호트 아닐 때도 일단 노출 — 1차 베타에선 전체 사용자(=Swan 본인)에게 보임.
 */
export function mountSwanFeedback({ userId, getNickname }) {
    if (_mounted) return;
    _userId      = userId;
    _getNickname = typeof getNickname === 'function' ? getNickname : () => '';

    _balloonEl = renderBalloon();
    document.body.appendChild(_balloonEl);
    if (window.lucide?.createIcons) window.lucide.createIcons({ icons: window.lucide.icons });

    _mounted = true;
}

/**
 * 일반 피드백 풍선 오픈 — 단축키·메뉴에서 호출 가능.
 */
export function openSwanFeedback() {
    if (!_mounted || !_userId) {
        console.warn('[swanFeedback] not mounted yet');
        return;
    }
    if (_session) return;
    startSession({ kind: 'feedback' });
}

/**
 * SWAN 사전 설문 시작 — 베타 1차 검증 시나리오 §1.
 *   - 가입 직후 onboarding 완료 시 자동 호출(예정) 또는 수동 트리거.
 *   - feedbacks 컬렉션에 kind='preSurvey' 로 저장.
 *   - 시작 직후 SWAN 이 직접 오프닝+Q1 발화 생성.
 */
export function openSwanPreSurvey() {
    if (!_mounted || !_userId) {
        console.warn('[swanFeedback] not mounted yet');
        return;
    }
    if (_session) return;
    startSession({ kind: 'preSurvey' });
}

// ─── 풍선 렌더 ───────────────────────────────────────────────

function renderBalloon() {
    const btn = document.createElement('button');
    btn.id = 'swan-balloon-btn';
    btn.className = 'swan-balloon';
    btn.type = 'button';
    btn.setAttribute('aria-label', COPY.feedback.balloonAria);
    btn.innerHTML = `<i data-lucide="message-circle"></i>`;
    btn.addEventListener('click', openSwanFeedback);
    return btn;
}

// ─── 세션 시작 ───────────────────────────────────────────────

async function startSession({ kind = 'feedback' } = {}) {
    const context  = collectFeedbackContext();
    const nickname = (_getNickname() || '').toString();
    const copy     = COPY[kind] || COPY.feedback;
    const maxTurns = MAX_TURNS_BY_KIND[kind] || MAX_TURNS_BY_KIND.feedback;

    // 일반 피드백: 하드코드 첫 인사 / 사전 설문: AI 가 첫 발화 생성 (openingTurn null)
    const openingTurn = copy.openingTurn
        ? { role: 'swan', text: copy.openingTurn, at: new Date().toISOString() }
        : null;

    // 1) Firestore 새 문서 생성
    let feedbackId;
    try {
        feedbackId = await startFeedback({
            userId: _userId,
            nickname,
            context,
            openingTurn,
            kind,
        });
    } catch (e) {
        console.error('[swanFeedback] startFeedback failed:', e);
        showToast('대화창을 못 열었어요. 잠시 후 다시 해볼까요?');
        return;
    }

    // 2) 모달 DOM
    const { overlay, listEl, inputEl, sendBtn, closeBtn, titleEl } = renderModal(copy.title, kind);
    document.body.appendChild(overlay);
    if (window.lucide?.createIcons) window.lucide.createIcons({ icons: window.lucide.icons });

    if (openingTurn) appendTurnDOM(listEl, openingTurn);

    // (v73) feedback 모드 — FAQ chip row 클릭 핸들러 바인딩 (preSurvey 시 chip row 자체 X)
    if (kind === 'feedback') bindFaqChips(overlay, listEl);

    _session = {
        feedbackId,
        kind,
        copy,
        maxTurns,
        context,
        nickname,
        turns: openingTurn ? [openingTurn] : [],
        askedQuestionIds: [],            // 사전 설문 추적용 (Q1~Q10)
        preSurveyDone: false,            // SWAN 이 마무리 발화했는지
        waitingForSwan: false,
        autoCloseTimer: null,
        finalized: false,
        modalHandle: null,
        listEl,
        inputEl,
        sendBtn,
    };

    // 3) modalManager 로 열기
    _session.modalHandle = openModal({
        overlay,
        label: 'swanFeedback',
        initialFocus: inputEl,
        closeOnBackdrop: true,
        onClose: handleModalClose,
    });

    // 4) 이벤트 바인딩
    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });
    closeBtn.addEventListener('click', () => _session?.modalHandle?.close());

    // 5) 5분 무응답 타이머
    resetAutoCloseTimer();

    // 6) 사전 설문 — SWAN 이 직접 오프닝+Q1 발화 생성
    if (kind === 'preSurvey') {
        runPreSurveyTurn();   // background — 사용자는 thinking 도트 보고 기다림
    }
}

// ─── 모달 DOM 렌더 ───────────────────────────────────────────

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, ch => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[ch]));
}

function renderModal(title = 'SWAN', kind = 'feedback') {
    const overlay = document.createElement('div');
    overlay.id = 'swan-feedback-overlay';
    overlay.className = 'swan-overlay';
    // (v73) feedback 모드에서만 FAQ chip row 노출 — preSurvey 흐름 방해 X.
    const faqBarHtml = kind === 'feedback' ? renderFaqBarHtml() : '';
    overlay.innerHTML = `
        <div class="swan-modal" role="dialog" aria-labelledby="swan-title">
            <header class="swan-header">
                <div class="swan-title" id="swan-title">
                    <span class="swan-dot" aria-hidden="true"></span>
                    <span>${escapeHtml(title)}</span>
                </div>
                <button type="button" class="swan-close-btn" id="swan-close-btn" aria-label="${COPY.closeAria}">
                    <i data-lucide="x"></i>
                </button>
            </header>
            ${faqBarHtml}
            <ul class="swan-turns" id="swan-turns" aria-live="polite"></ul>
            <footer class="swan-footer">
                <textarea
                    class="swan-input"
                    id="swan-input"
                    rows="2"
                    placeholder="${escapeHtml(COPY.inputPlaceholder)}"
                ></textarea>
                <button type="button" class="swan-send-btn" id="swan-send-btn">${escapeHtml(COPY.sendButton)}</button>
            </footer>
        </div>
    `;
    return {
        overlay,
        listEl:   overlay.querySelector('#swan-turns'),
        inputEl:  overlay.querySelector('#swan-input'),
        sendBtn:  overlay.querySelector('#swan-send-btn'),
        closeBtn: overlay.querySelector('#swan-close-btn'),
        titleEl:  overlay.querySelector('#swan-title'),
        faqBarEl: overlay.querySelector('#swan-faq-bar'),
    };
}

/**
 * (2026-05-18 v73) SWAN 채팅 안 FAQ chip row — 정적 카탈로그 + 클릭 시 두 turn 자연 삽입.
 *   AI 호출 X. 답에 없는 자리는 자유 채팅으로 그대로 흘러가 운영자에게 전달.
 */
function renderFaqBarHtml() {
    // (v74) 슬림 모드에선 slimHidden:true 항목 자연 제외 (분별의 자리 등)
    const visible = getVisibleFaqs();
    if (visible.length === 0) return '';
    const chips = visible.map(f =>
        `<button type="button" class="swan-faq-chip" data-faq-id="${escapeHtml(f.id)}">${escapeHtml(f.question)}</button>`
    ).join('');
    return `
        <div class="swan-faq-bar" id="swan-faq-bar">
            <div class="swan-faq-label">자주 묻는 질문</div>
            <div class="swan-faq-chips">${chips}</div>
            <p class="swan-faq-hint">${escapeHtml(FAQ_FALLBACK_HINT_CHAT)}</p>
        </div>
    `;
}

/**
 * (v74) FAQ bar 자연 숨김 — 사용자가 첫 행동(칩 클릭 또는 텍스트 전송)을 하면 자리 빠짐.
 *   진입 시점엔 도움말 자리, 행동 후엔 채팅 흐름 우선.
 */
function hideFaqBar() {
    const bar = document.getElementById('swan-faq-bar');
    if (bar) bar.hidden = true;
}

function bindFaqChips(overlay, listEl) {
    overlay.querySelectorAll('.swan-faq-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const faqId = chip.dataset.faqId;
            const faq = findFaqById(faqId);
            if (!faq) return;
            // 사용자 turn + SWAN 답 turn (DOM 표시만, Firestore 저장 X — 단순 도움말 자리)
            const now = new Date().toISOString();
            appendTurnDOM(listEl, { role: 'user', text: faq.question, at: now });
            appendTurnDOM(listEl, { role: 'swan', text: faq.answer, at: now });
            // _session.turns 에도 push — AI 호출 시 컨텍스트로 자연 전달
            if (_session) {
                _session.turns.push({ role: 'user', text: faq.question, at: now });
                _session.turns.push({ role: 'swan', text: faq.answer, at: now });
            }
            // (v74) FAQ 칩 한 번 누르면 도움말 자리 자연 빠짐 — 채팅 흐름 우선
            hideFaqBar();
        });
    });
}

function appendTurnDOM(listEl, turn) {
    const li = document.createElement('li');
    li.className = `swan-turn swan-turn-${turn.role}`;
    li.textContent = turn.text;
    listEl.appendChild(li);
    listEl.scrollTop = listEl.scrollHeight;
}

// (디자인 시스템 v1 Phase C 2026-05-16) 단계 라벨 회전 + 도트 한 묶음.
// 채팅 거품 안 — progress bar 는 풍선 톤 어색해서 빼고 라벨만 + 기존 도트 유지.
const THINKING_ROTATE_MS = 2500;

function appendThinkingDOM(listEl, kind) {
    const labels = kind === 'preSurvey'
        ? ['질문 다듬는 중...', '답변 살피는 중...', '정리하는 중...']
        : THINKING_COPY.swan;

    const li = document.createElement('li');
    li.className = 'swan-turn swan-turn-swan swan-thinking';
    li.id = 'swan-thinking-bubble';
    li.innerHTML = `
        <span class="swan-thinking-label" data-stage="0">${labels[0]}</span>
        <span class="swan-dots"><span></span><span></span><span></span></span>
    `;
    listEl.appendChild(li);
    listEl.scrollTop = listEl.scrollHeight;

    // 단계 라벨 회전
    const labelEl = li.querySelector('.swan-thinking-label');
    let stage = 0;
    const timer = setInterval(() => {
        if (!labelEl.isConnected) { clearInterval(timer); return; }
        stage = (stage + 1) % labels.length;
        labelEl.style.opacity = '0';
        setTimeout(() => {
            labelEl.textContent = labels[stage];
            labelEl.style.opacity = '';
        }, 150);
    }, THINKING_ROTATE_MS);
    // li 사라질 때 자연 종료
    li._thinkingTimer = timer;
}

function removeThinkingDOM(listEl) {
    const el = listEl.querySelector('#swan-thinking-bubble');
    if (!el) return;
    if (el._thinkingTimer) clearInterval(el._thinkingTimer);
    el.remove();
}

// (Phase C 2026-05-16) SWAN 응답 한 자씩 노출 — typing breath.
async function appendSwanTurnTyping(listEl, turn) {
    const li = document.createElement('li');
    li.className = `swan-turn swan-turn-${turn.role}`;
    listEl.appendChild(li);
    listEl.scrollTop = listEl.scrollHeight;

    if (shouldReduceMotion()) {
        li.textContent = turn.text;
        return;
    }
    await typeText(li, turn.text, { delay: 22 });
    // 자동 스크롤 한 번 더 (긴 응답일 때 끝까지)
    listEl.scrollTop = listEl.scrollHeight;
}

// ─── 사용자 메시지 처리 ──────────────────────────────────────

async function handleSend() {
    if (!_session || _session.waitingForSwan || _session.finalized) return;
    const text = _session.inputEl.value.trim();
    if (!text) return;

    // (v74) 사용자가 텍스트로 대화 시작하면 FAQ 도움말 자리 자연 빠짐 — 채팅 흐름 우선
    hideFaqBar();

    _session.waitingForSwan = true;
    _session.sendBtn.disabled = true;
    _session.inputEl.disabled = true;

    const userTurn = {
        role: 'user',
        text,
        at:   new Date().toISOString(),
    };

    // 1) UI 먼저
    appendTurnDOM(_session.listEl, userTurn);
    _session.turns.push(userTurn);
    _session.inputEl.value = '';
    resetAutoCloseTimer();

    // 2) Firestore turn 저장
    let turnCountAfterUser = _session.turns.length;
    try {
        const res = await addTurn(_userId, _session.feedbackId, userTurn, _session.maxTurns);
        turnCountAfterUser = res.turnCount;
    } catch (e) {
        console.error('[swanFeedback] addTurn(user) failed:', e);
        showToast(COPY.sendFailToast);
        _session.waitingForSwan = false;
        _session.sendBtn.disabled = false;
        _session.inputEl.disabled = false;
        _session.inputEl.focus();
        return;
    }

    // 3) SWAN 다음 발화 (kind 분기)
    await runSwanTurn({ turnCountAfterUser });
}

/**
 * SWAN AI 호출 + 응답 UI/저장. kind 별 분기.
 * 사전 설문 첫 발화(history 비어있음)일 때도 같은 함수 재사용.
 */
async function runSwanTurn({ turnCountAfterUser = null } = {}) {
    if (!_session) return;
    const sess = _session;

    appendThinkingDOM(sess.listEl, sess.kind);

    let swanText = '';
    let preSurveyMeta = null;
    try {
        if (sess.kind === 'preSurvey') {
            const res = await callSwanPreSurvey({
                history:          sess.turns,
                askedQuestionIds: sess.askedQuestionIds,
                turnCount:        turnCountAfterUser || sess.turns.length,
            });
            swanText = (res.text || '').trim();
            preSurveyMeta = { askedNow: res.askedNow, nextQuestion: res.nextQuestion, done: res.done };
        } else {
            const res = await callSwanAgent({
                history:       sess.turns,
                screenPath:    sess.context.screenPath || '',
                consoleErrors: sess.context.consoleErrors || [],
                turnCount:     turnCountAfterUser || sess.turns.length,
            });
            swanText = (res.text || '').trim();
        }
    } catch (e) {
        console.warn('[swanFeedback] SWAN call failed:', e);
    }
    removeThinkingDOM(sess.listEl);

    if (!swanText) {
        swanText = sess.kind === 'preSurvey'
            ? '잠깐 끊겼어요. 한 줄 더 들려주시면 이어 갈게요.'
            : '잘 받았어요. 더 알려주고 싶은 게 있으면 한 줄 더 적어 주세요.';
    }

    const swanTurn = {
        role: 'swan',
        text: swanText,
        at:   new Date().toISOString(),
    };
    // (Phase C 2026-05-16) SWAN 응답 typing breath 노출 — 한 자씩 자연 자리.
    await appendSwanTurnTyping(sess.listEl, swanTurn);
    sess.turns.push(swanTurn);

    // 사전 설문 메타 반영
    if (preSurveyMeta?.askedNow && /^Q\d+$/i.test(preSurveyMeta.askedNow)
        && !sess.askedQuestionIds.includes(preSurveyMeta.askedNow)) {
        sess.askedQuestionIds.push(preSurveyMeta.askedNow);
    }
    if (preSurveyMeta?.done) sess.preSurveyDone = true;

    let reachedMax = false;
    try {
        const res = await addTurn(_userId, sess.feedbackId, swanTurn, sess.maxTurns);
        reachedMax = res.reachedMax;
    } catch (e) {
        console.warn('[swanFeedback] addTurn(swan) failed:', e);
    }

    // 사전 설문 자연 종결
    if (sess.preSurveyDone) {
        await finalizeAndClose('preSurvey_completed');
        return;
    }

    // 턴 한도 도달 — 안내 한 줄 + 자동 종료
    if (reachedMax) {
        const limitTurn = {
            role: 'swan',
            text: sess.copy.turnLimitNote,
            at:   new Date().toISOString(),
        };
        appendTurnDOM(sess.listEl, limitTurn);
        sess.turns.push(limitTurn);
        try { await addTurn(_userId, sess.feedbackId, limitTurn, sess.maxTurns + 1); } catch (_) {}
        await finalizeAndClose('turn_limit_reached');
        return;
    }

    sess.waitingForSwan = false;
    sess.sendBtn.disabled = false;
    sess.inputEl.disabled = false;
    sess.inputEl.focus();
}

/**
 * 사전 설문 첫 진입 — history 빈 상태에서 SWAN 이 오프닝+Q1 생성.
 */
async function runPreSurveyTurn() {
    if (!_session) return;
    _session.waitingForSwan = true;
    _session.sendBtn.disabled = true;
    _session.inputEl.disabled = true;
    await runSwanTurn({ turnCountAfterUser: 0 });
}

// ─── 5분 무응답 타이머 ───────────────────────────────────────

function resetAutoCloseTimer() {
    if (!_session) return;
    if (_session.autoCloseTimer) clearTimeout(_session.autoCloseTimer);
    _session.autoCloseTimer = setTimeout(() => {
        if (!_session || _session.finalized) return;
        finalizeAndClose('auto_timeout_5min');
    }, AUTO_CLOSE_MS);
}

// ─── 종료 + 자동 요약·분류 (kind 분기) ───────────────────────

async function finalizeAndClose(endReason) {
    if (!_session || _session.finalized) return;
    _session.finalized = true;
    if (_session.autoCloseTimer) {
        clearTimeout(_session.autoCloseTimer);
        _session.autoCloseTimer = null;
    }

    const { feedbackId, kind, turns, context, copy } = _session;

    // 1) kind 별 자동 처리 — 실패해도 finalize 는 진행 (turns 는 이미 저장)
    if (kind === 'preSurvey') {
        await runPreSurveyFinalize(_userId, feedbackId, turns, endReason);
    } else {
        await runFeedbackFinalize(_userId, feedbackId, turns, context, endReason);
    }

    // 2) 안내 토스트 + 모달 닫기
    showToast(copy.closeFarewell);
    try { _session.modalHandle?.close(); } catch (_) {}
}

async function runFeedbackFinalize(userId, feedbackId, turns, context, endReason) {
    let summary, category, confidence;
    try {
        const res = await callSwanSummary({
            turns,
            screenPath:    context.screenPath || '',
            consoleErrors: context.consoleErrors || [],
        });
        summary    = res.summary;
        category   = res.category;
        confidence = res.confidence;
    } catch (e) {
        console.warn('[swanFeedback] callSwanSummary failed:', e);
        summary    = '자동 요약을 만들지 못했어요. 대화 원본을 참고해 주세요.';
        category   = 'other';
        confidence = 0;
    }
    try {
        await finalizeFeedback(userId, feedbackId, {
            endReason,
            summary,
            category,
            categoryConfidence: confidence,
        });
    } catch (e) {
        console.error('[swanFeedback] finalizeFeedback failed:', e);
    }
}

async function runPreSurveyFinalize(userId, feedbackId, turns, endReason) {
    let extract = null;
    try {
        const res = await callSwanPreSurveyExtract({ turns });
        extract = res.extract;
    } catch (e) {
        console.warn('[swanFeedback] callSwanPreSurveyExtract failed:', e);
    }
    // finalize 본체 — 사전 설문은 category 고정 'other', summary 는 짧은 요약 한 줄
    const summary = extract?.q10_personalGoal?.testerPriority
        || extract?.q1_focus?.raw
        || '사전 설문이 마무리됐어요.';
    try {
        await finalizeFeedback(userId, feedbackId, {
            endReason,
            summary,
            category:           'other',
            categoryConfidence: 0,
        });
    } catch (e) {
        console.error('[swanFeedback] finalizeFeedback failed:', e);
    }
    // 구조화 결과 저장 (있을 때만)
    if (extract) {
        try { await saveSurveyExtract(userId, feedbackId, extract); }
        catch (e) { console.warn('[swanFeedback] saveSurveyExtract failed:', e); }
    }
}

function handleModalClose() {
    if (!_session) return;

    // 사용자가 백드롭/ESC/X 로 닫은 경우 — 아직 finalize 안 됐으면 manual_send 로 처리
    const wasFinalized = _session.finalized;
    const sess = _session;
    _session = null;

    // overlay DOM 정리
    try { sess.modalHandle?.overlay?.remove(); } catch (_) {}
    if (sess.autoCloseTimer) clearTimeout(sess.autoCloseTimer);

    if (!wasFinalized) {
        // 사용자 메시지가 하나라도 있으면 manual_send 로 마무리, 없으면 그냥 폐기
        const hasUserTurn = sess.turns.some(t => t.role === 'user');
        if (hasUserTurn) {
            finalizeAfterClose(sess, 'manual_send').catch(e =>
                console.warn('[swanFeedback] post-close finalize failed:', e)
            );
        }
        // hasUserTurn 이 false 면 빈 대화 — finalize 안 함. 다음 진입 때 새 doc 시작.
        // (빈 doc 은 남지만 §10-5 에 따라 1회 1 doc 정책으로 유지. 향후 청소 트랙에서 정리.)
    }
}

async function finalizeAfterClose(sess, endReason) {
    try {
        if (sess.kind === 'preSurvey') {
            await runPreSurveyFinalize(_userId, sess.feedbackId, sess.turns, endReason);
        } else {
            await runFeedbackFinalize(_userId, sess.feedbackId, sess.turns, sess.context, endReason);
        }
        showToast(sess.copy.closeFarewell);
    } catch (e) {
        console.error('[swanFeedback] post-close finalize failed:', e);
        showToast(COPY.summaryFailToast);
    }
}
