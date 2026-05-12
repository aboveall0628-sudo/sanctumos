/**
 * reportQna.js — 리포트 카드 하단 "리포트에 대해 질문하기" 입력창 (Phase E-9/R-QA)
 *
 * spec §4: A3 확장 — AI Q&A 패턴. 모든 리포트 공통.
 * 카드 하단(데이터 경계선 위)에 입력창 + 답변 누적 표시.
 *
 * 사용:
 *   mountReportQna(footEl, {
 *       reportId: '2026-05-12' | '2026-W19' | '2026-05',
 *       reportType: 'day' | 'week' | 'month' | 'quarter' | 'year',
 *       stats,                      // 그 리포트의 stats
 *       context: { persons, orgs },// 가명화 복원용 (선택)
 *       dek, userId,
 *   });
 */

import { callReportQuestion } from './aiClient.js';
import { saveReportQuestion, listQuestionsByReport, markQuestionSeen } from '../reports/reportQuestionsRepo.js';

/**
 * 카드의 "여기까지가 데이터예요…" 푸터 바로 위에 Q&A 영역을 끼움.
 * 같은 카드에 이미 박혀 있으면 무시 (idempotent).
 */
export async function mountReportQna(anchorEl, cfg) {
    if (!anchorEl) return;
    // 카드 내부에서 anchorEl 의 부모 = report-card 자체. 그 안에 q&a 노드를 push.
    const parent = anchorEl.parentElement || anchorEl;
    if (parent.querySelector('.qna-wrap')) return; // 중복 마운트 차단

    const wrap = document.createElement('div');
    wrap.className = 'qna-wrap';
    wrap.innerHTML = `
        <div class="qna-history" data-empty="true"></div>
        <form class="qna-form" autocomplete="off">
            <label class="qna-label" for="qna-input-${escapeId(cfg.reportId)}">리포트에 대해 질문하기</label>
            <div class="qna-input-row">
                <input id="qna-input-${escapeId(cfg.reportId)}" class="qna-input" type="text"
                       placeholder='예: "왜 화요일이 낮았어?" / "이 시기에 어떤 흐름이 있었어?"' maxlength="200" />
                <button type="submit" class="qna-submit">묻기</button>
            </div>
            <p class="qna-hint">AI는 데이터가 그린 흐름만 보여줘요. 답은 묵상에서.</p>
        </form>
    `;
    // 푸터(여기까지가 데이터예요…) 바로 앞에 끼움. 없으면 마지막에.
    anchorEl.insertAdjacentElement('beforebegin', wrap);

    // 기존 질문 로드 — listQuestionsByReport
    try {
        const history = await listQuestionsByReport(cfg.dek, cfg.userId, cfg.reportId, 10);
        if (history && history.length > 0) {
            renderHistory(wrap.querySelector('.qna-history'), history);
            // 본 즉시 seen 마킹 (다음 아침 게이트에서 안 보이도록)
            history.filter(h => !h.seenAt).forEach(h => {
                markQuestionSeen(cfg.userId, h.id).catch(() => {});
            });
        }
    } catch (e) {
        console.warn('qna history load failed:', e);
    }

    // submit 핸들러
    const form = wrap.querySelector('.qna-form');
    const input = wrap.querySelector('.qna-input');
    const submitBtn = wrap.querySelector('.qna-submit');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const question = (input.value || '').trim();
        if (!question) return;

        submitBtn.disabled = true;
        submitBtn.textContent = '듣는 중...';
        const tempCard = appendPendingCard(wrap.querySelector('.qna-history'), question);

        try {
            const res = await callReportQuestion({
                question,
                reportType: cfg.reportType,
                stats:      cfg.stats || {},
                context:    cfg.context || {},
            });

            // 저장 — Firestore
            await saveReportQuestion(cfg.dek, cfg.userId, {
                reportId:           cfg.reportId,
                reportType:         cfg.reportType,
                question,
                observationFlow:    res.observationFlow,
                returnToMeditation: res.returnToMeditation,
            });

            // 임시 카드 → 정식 답변으로 교체
            tempCard.classList.remove('qna-card-pending');
            tempCard.querySelector('.qna-answer').innerHTML = renderAnswerHtml(res);
            input.value = '';
        } catch (e) {
            console.error('reportQuestion failed:', e);
            tempCard.querySelector('.qna-answer').innerHTML =
                `<p class="qna-error">답을 부르지 못했어요. 잠시 후 다시 시도해 주세요.</p>`;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '묻기';
        }
    });
}

function renderHistory(historyEl, items) {
    historyEl.dataset.empty = 'false';
    historyEl.innerHTML = items.map(it => `
        <article class="qna-card" data-question-id="${escapeAttr(it.id)}">
            <p class="qna-question">${escapeHtml(it.question || '')}</p>
            <div class="qna-answer">${renderAnswerHtml(it)}</div>
        </article>
    `).join('');
}

function appendPendingCard(historyEl, question) {
    historyEl.dataset.empty = 'false';
    const card = document.createElement('article');
    card.className = 'qna-card qna-card-pending';
    card.innerHTML = `
        <p class="qna-question">${escapeHtml(question)}</p>
        <div class="qna-answer"><p class="qna-loading">관찰된 흐름을 짚고 있어요…</p></div>
    `;
    historyEl.prepend(card);
    return card;
}

/**
 * 답변 HTML — observationFlow 본문 + 종결 두 줄을 시각적으로 구분.
 */
function renderAnswerHtml(res) {
    const flow = res.observationFlow || res.full || '';
    const tail = res.returnToMeditation || '';
    return `
        <div class="qna-flow">${escapeHtml(flow).replace(/\n/g, '<br>')}</div>
        ${tail ? `<div class="qna-tail">${escapeHtml(tail).replace(/\n/g, '<br>')}</div>` : ''}
    `;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
function escapeAttr(s) { return escapeHtml(s); }
function escapeId(s) { return String(s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_'); }
