/**
 * eventDot.js — 이벤트 도트(점 도트) 입력 모달 (경제 트랙 1.a 2026-05-14)
 *
 * 5살 비유: 일정 도트가 🎬 영화라면, 이벤트 도트는 📸 사진 — 한 순간의 찰칵.
 *   거래·말 한 마디·자동 결제 등 시점 단위 기록을 담는 그릇.
 *
 * 흐름:
 *   1. 시점(datetime-local) + 종류(거래/말/기타) 선택
 *   2. 거래(transaction) → 이벤트 도트 껍데기 생성 + openQuickAdd 호출
 *      (거래의 linkedDotId 에 이벤트 도트 id 박혀 자연 매칭)
 *   3. 말(speech)/기타(other) → 메모 + 시점만 저장
 *
 * 사용:
 *   openEventDotAdd({ userId, date?, onSaved?(eventDot) })
 */

import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
import { openModal } from './modalManager.js';
import { saveEventDot } from '../data/dotsRepo.js';
import { openQuickAdd } from './economyQuickAdd.js';

const OVERLAY_ID = 'event-dot-overlay';

const EVENT_TYPES = [
    { id: 'transaction', label: '💰 거래',  desc: '돈이 오갔어요' },
    { id: 'speech',      label: '💬 말',    desc: '누가 한 말이 마음에 남음' },
    { id: 'other',       label: '📝 기타',  desc: '시점 단위로 적고 싶은 것' },
];

export async function openEventDotAdd(opts = {}) {
    const { userId, date, onSaved } = opts;
    if (!userId) { showToast('사용자 정보가 없어요.'); return; }
    const dek = getDEK();
    if (!dek) { showToast('잠겨 있어요. 비밀번호로 먼저 열어 주실래요?'); return; }

    const now = new Date();
    // datetime-local 은 로컬 타임존, 'YYYY-MM-DDTHH:mm'
    const pad = (n) => String(n).padStart(2, '0');
    const initTs = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const initDate = date || `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

    const overlay = ensureOverlay();
    overlay.innerHTML = `
        <div class="modal-card event-dot-card">
            <header class="modal-head">
                <h3>📸 한 순간 적기</h3>
                <button class="modal-close" aria-label="닫기">×</button>
            </header>
            <div class="modal-body">
                <div class="evt-row">
                    <label>시점</label>
                    <input id="evt-ts" type="datetime-local" value="${initTs}" />
                </div>
                <div class="evt-row">
                    <label>종류</label>
                    <div class="evt-type-grid">
                        ${EVENT_TYPES.map((t, i) => `
                            <button type="button" class="evt-type-btn ${i === 0 ? 'active' : ''}" data-id="${t.id}">
                                <div class="evt-type-label">${t.label}</div>
                                <div class="evt-type-desc">${t.desc}</div>
                            </button>
                        `).join('')}
                    </div>
                </div>
                <div class="evt-row evt-note-row" id="evt-note-row" style="display:none">
                    <label>메모</label>
                    <textarea id="evt-note" placeholder="여기 적어주세요..." rows="4" maxlength="500"></textarea>
                </div>
            </div>
            <footer class="modal-foot">
                <span style="flex:1"></span>
                <button class="modal-cancel text-btn">취소</button>
                <button id="evt-save" class="primary-btn">거래 입력으로 →</button>
            </footer>
        </div>
    `;

    const handle = openModal({ overlay, initialFocus: '#evt-ts', label: 'event-dot' });
    overlay.querySelector('.modal-close')?.addEventListener('click', () => handle.close());
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => handle.close());

    let selectedType = 'transaction';
    const noteRow = overlay.querySelector('#evt-note-row');
    const saveBtn = overlay.querySelector('#evt-save');

    function updateForType() {
        if (noteRow) noteRow.style.display = (selectedType === 'transaction') ? 'none' : '';
        if (saveBtn) saveBtn.textContent = (selectedType === 'transaction') ? '거래 입력으로 →' : '저장';
    }
    updateForType();

    overlay.querySelectorAll('.evt-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedType = btn.dataset.id;
            overlay.querySelectorAll('.evt-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateForType();
        });
    });

    saveBtn?.addEventListener('click', async () => {
        const tsInput = overlay.querySelector('#evt-ts')?.value;
        // datetime-local 은 'YYYY-MM-DDTHH:mm' (로컬). ISO 비슷한 문자열로 보존 (초·tz 생략).
        const ts = tsInput || initTs;
        const ddate = ts.slice(0, 10);

        if (selectedType === 'transaction') {
            // 1) 이벤트 도트 껍데기 먼저 — id 받아둠
            let evtId;
            try {
                evtId = await saveEventDot(dek, {
                    userId,
                    eventTimestamp: ts,
                    date: ddate,
                    eventType: 'transaction',
                });
            } catch (e) {
                console.error('[eventDot] event-dot save failed:', e);
                showToast('저장이 잠깐 막혔어요.');
                return;
            }
            // 2) 거래 입력 모달 호출 — linkedDotId 에 evtId 박힘
            handle.close();
            openQuickAdd({
                userId,
                date: ddate,
                linkedDotId: evtId,
                onSaved: () => {
                    if (typeof onSaved === 'function') onSaved({ id: evtId, eventType: 'transaction' });
                },
            });
        } else {
            // 말/기타 — 메모 + 시점만 저장
            const note = (overlay.querySelector('#evt-note')?.value || '').trim();
            if (!note) { showToast('메모를 적어 주실래요?'); return; }
            try {
                const evtId = await saveEventDot(dek, {
                    userId,
                    eventTimestamp: ts,
                    date: ddate,
                    eventType: selectedType,
                    eventNote: note,
                });
                showToast('한 순간을 적었어요');
                handle.close();
                if (typeof onSaved === 'function') onSaved({ id: evtId, eventType: selectedType });
            } catch (e) {
                console.error('[eventDot] save failed:', e);
                showToast('저장이 잠깐 막혔어요.');
            }
        }
    });
}

function ensureOverlay() {
    let el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = 'modal-overlay hidden';
    document.body.appendChild(el);
    return el;
}
