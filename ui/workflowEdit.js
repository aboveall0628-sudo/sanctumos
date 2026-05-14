/**
 * workflowEdit.js — 워크플로우 생성·편집 통합 모달 (워크플로우 STEP 3, 2026-05-14)
 *
 * 5살 비유:
 *   🏔️ 목표(한라산 가기)  →  🛤️ 등산로(워크플로우)  →  큰 단계 줄줄이(스텝)
 *   각 스텝: 제목 + 누가(혼자/같이/맡김) + 같이면 인물 자동완성 + 예상 도트
 *
 * 사용:
 *   openWorkflowEdit({ userId, parentGoalId?, workflowId?, onSaved })
 *     - parentGoalId 주면 그 목표 미리 선택 (목표 카드 옆 [+ 등산로 만들기])
 *     - workflowId 주면 편집 모드 (기존 워크플로우 로드)
 *     - 둘 다 없으면 신규 모드 (active 첫 목표 자동 선택)
 *
 * Q1·Q2·Q3 합의 (2026-05-14):
 *   - 진입점: 목표 카드 옆 + 워크플로우 섹션 둘 다 (같은 모달)
 *   - 스텝 입력: 인라인 줄줄이 (한 모달 안)
 *   - executor: 3 라디오 + helper 일 때 인물 자동완성 박스
 */

import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
import { openModal } from './modalManager.js';
import {
    saveWorkflow, getWorkflow, buildStep
} from '../data/workflowsRepo.js';
import { getAllGoals } from '../data/goalsRepo.js';
import { getActiveVersion } from '../data/goalVersionsRepo.js';
import { getAllPersons } from '../data/personRepo.js';

const OVERLAY_ID = 'workflow-edit-overlay';

const EXECUTOR_OPTIONS = [
    { id: 'self',     label: '혼자',   desc: '본인 직접' },
    { id: 'helper',   label: '같이',   desc: '인물 카드 있는 누군가와' },
    { id: 'external', label: '맡김',   desc: '외부에 맡김 (외주·식당·렌탈)' },
];

let _persons = [];        // 자동완성 후보 캐시
let _goals = [];          // active 목표 캐시

export async function openWorkflowEdit(opts = {}) {
    const { userId, parentGoalId: initGoalId, workflowId, onSaved } = opts;
    if (!userId) { showToast('사용자 정보가 없어요.'); return; }
    const dek = getDEK();
    if (!dek) { showToast('잠겨 있어요. 비밀번호로 먼저 열어 주실래요?'); return; }

    // 1) 데이터 로드 — 목표·인물·기존 워크플로우(편집 모드만)
    let existing = null;
    try {
        const [goals, persons] = await Promise.all([
            getAllGoals(dek, userId),
            getAllPersons(dek, userId)
        ]);
        _goals = goals.filter(g => g.status !== 'archived');
        _persons = persons;
        if (workflowId) {
            existing = await getWorkflow(dek, workflowId);
        }
    } catch (e) {
        console.error('[workflowEdit] load failed:', e);
        showToast('불러오기에 잠깐 막혔어요.');
        return;
    }

    if (_goals.length === 0) {
        showToast('먼저 목표를 하나 만들어 주실래요?');
        return;
    }

    const isEdit = !!existing;
    const selectedGoalId = existing?.parentGoalId || initGoalId || _goals[0].id;

    // 2) 모달 state — 스텝 배열은 메모리에서 관리, 저장 시 한 번에 박힘
    const state = {
        parentGoalId: selectedGoalId,
        title: existing?.title || '',
        steps: existing && Array.isArray(existing.steps) && existing.steps.length
            ? existing.steps.map(s => ({ ...s }))
            : [buildStep({ order: 0 })],  // 빈 스텝 1개 디폴트
    };

    // 3) 렌더
    const overlay = ensureOverlay();
    overlay.innerHTML = renderShell({ isEdit });
    const handle = openModal({ overlay, initialFocus: '#wfe-title', label: 'workflow-edit' });
    overlay.querySelector('.modal-close')?.addEventListener('click', () => handle.close());
    overlay.querySelector('.modal-cancel')?.addEventListener('click', () => handle.close());

    function renderAll() {
        renderGoalSelect();
        renderTitleInput();
        renderStepsList();
    }
    function renderGoalSelect() {
        const sel = overlay.querySelector('#wfe-goal');
        if (!sel) return;
        sel.innerHTML = _goals.map(g => {
            const sel = g.id === state.parentGoalId ? 'selected' : '';
            return `<option value="${escapeAttr(g.id)}" ${sel}>${escapeHtml(g.title || '(제목 없음)')}</option>`;
        }).join('');
        sel.onchange = () => { state.parentGoalId = sel.value; };
    }
    function renderTitleInput() {
        const inp = overlay.querySelector('#wfe-title');
        if (!inp) return;
        inp.value = state.title;
        inp.oninput = () => { state.title = inp.value; };
    }
    function renderStepsList() {
        const wrap = overlay.querySelector('#wfe-steps');
        if (!wrap) return;
        wrap.innerHTML = state.steps.map((step, i) => renderStepRow(step, i)).join('');
        bindStepRowEvents();
    }
    function renderStepRow(step, i) {
        const personName = step.helperPersonId
            ? (_persons.find(p => p.id === step.helperPersonId)?.name || '(없는 인물)')
            : '';
        const helperBox = (step.executor === 'helper') ? `
            <div class="wfe-helper-row">
                <input type="text" class="wfe-helper-input"
                       placeholder="누구랑? (이름 치면 후보 떠요)"
                       value="${escapeAttr(personName)}"
                       data-step-idx="${i}" autocomplete="off" />
                <div class="wfe-helper-ac qr-ac-panel hidden" data-step-idx="${i}" role="listbox"></div>
            </div>` : '';

        return `
            <li class="wfe-step-row" data-idx="${i}">
                <span class="wfe-step-order">${i + 1}.</span>
                <div class="wfe-step-fields">
                    <input type="text" class="wfe-step-title" placeholder="이 단계의 한 줄"
                           value="${escapeAttr(step.title)}" data-step-idx="${i}" />
                    <div class="wfe-exec-row">
                        ${EXECUTOR_OPTIONS.map(opt => `
                            <button type="button" class="wfe-exec-btn ${step.executor === opt.id ? 'active' : ''}"
                                    data-step-idx="${i}" data-exec="${opt.id}" title="${escapeAttr(opt.desc)}">
                                ${opt.label}
                            </button>
                        `).join('')}
                        <input type="number" class="wfe-est-dots" min="1" max="48" value="${step.estimatedDots || 1}"
                               data-step-idx="${i}" title="예상 도트 수 (15분 = 1도트)" />
                        <button type="button" class="wfe-step-del icon-btn" data-step-idx="${i}" title="이 스텝 지우기">🗑</button>
                    </div>
                    ${helperBox}
                </div>
            </li>
        `;
    }

    function bindStepRowEvents() {
        overlay.querySelectorAll('.wfe-step-title').forEach(el => {
            el.oninput = () => {
                const i = +el.dataset.stepIdx;
                if (state.steps[i]) state.steps[i].title = el.value;
            };
        });
        overlay.querySelectorAll('.wfe-est-dots').forEach(el => {
            el.oninput = () => {
                const i = +el.dataset.stepIdx;
                const n = Math.max(1, Math.min(48, +el.value || 1));
                if (state.steps[i]) state.steps[i].estimatedDots = n;
            };
        });
        overlay.querySelectorAll('.wfe-exec-btn').forEach(btn => {
            btn.onclick = () => {
                const i = +btn.dataset.stepIdx;
                const exec = btn.dataset.exec;
                if (!state.steps[i]) return;
                state.steps[i].executor = exec;
                // helper 떠난 경우 helperPersonId 초기화
                if (exec !== 'helper') state.steps[i].helperPersonId = null;
                renderStepsList();
            };
        });
        overlay.querySelectorAll('.wfe-step-del').forEach(btn => {
            btn.onclick = () => {
                const i = +btn.dataset.stepIdx;
                if (state.steps.length === 1) {
                    showToast('스텝이 최소 1개는 있어야 해요.');
                    return;
                }
                state.steps.splice(i, 1);
                state.steps.forEach((s, idx) => { s.order = idx; });
                renderStepsList();
            };
        });
        // 인물 자동완성 — helper 일 때만
        overlay.querySelectorAll('.wfe-helper-input').forEach(inp => {
            const i = +inp.dataset.stepIdx;
            const panel = overlay.querySelector(`.wfe-helper-ac[data-step-idx="${i}"]`);
            inp.oninput = () => updateHelperAC(inp, panel, i);
            inp.onfocus = () => updateHelperAC(inp, panel, i);
            inp.onblur = () => { setTimeout(() => panel?.classList.add('hidden'), 150); };
        });
    }

    function updateHelperAC(inp, panel, stepIdx) {
        if (!panel) return;
        const q = (inp.value || '').trim().toLowerCase();
        const matches = _persons
            .filter(p => {
                const name = (p.name || '').toLowerCase();
                if (!q) return true;
                if (name.includes(q)) return true;
                // 닉네임 매칭 (있으면)
                return (p.nicknames || []).some(n => (n || '').toLowerCase().includes(q));
            })
            .slice(0, 8);
        if (!matches.length) {
            panel.innerHTML = `<div class="qr-ac-empty">맞는 인물이 없어요. (인물 카드 먼저 만들어주세요)</div>`;
            panel.classList.remove('hidden');
            return;
        }
        panel.innerHTML = matches.map((p, i) => {
            const cls = i === 0 ? 'qr-ac-item qr-ac-first' : 'qr-ac-item';
            const nicks = Array.isArray(p.nicknames) && p.nicknames.length
                ? `<span class="qr-ac-sub">(${escapeHtml(p.nicknames.join(', '))})</span>` : '';
            return `<div class="${cls}" data-person-id="${escapeAttr(p.id)}" data-person-name="${escapeAttr(p.name || '')}">
                ${escapeHtml(p.name || '(이름 없음)')} ${nicks}
            </div>`;
        }).join('');
        panel.classList.remove('hidden');
        panel.querySelectorAll('.qr-ac-item').forEach(item => {
            item.onmousedown = (e) => {
                e.preventDefault();
                const pid = item.dataset.personId;
                const pname = item.dataset.personName;
                if (state.steps[stepIdx]) {
                    state.steps[stepIdx].helperPersonId = pid;
                }
                inp.value = pname;
                panel.classList.add('hidden');
            };
        });
    }

    renderAll();

    // [+ 스텝 추가]
    overlay.querySelector('#wfe-add-step')?.addEventListener('click', () => {
        state.steps.push(buildStep({ order: state.steps.length }));
        renderStepsList();
    });

    // [저장]
    overlay.querySelector('#wfe-save')?.addEventListener('click', async () => {
        const title = (state.title || '').trim();
        if (!title) { showToast('등산로 이름을 적어 주실래요?'); return; }
        if (!state.parentGoalId) { showToast('어느 목표의 등산로인가요?'); return; }
        // 스텝 검증 — 비어 있는 제목 제거 후 1개 이상 보장
        const validSteps = state.steps
            .filter(s => (s.title || '').trim().length > 0)
            .map((s, i) => ({ ...s, order: i, title: s.title.trim() }));
        if (validSteps.length === 0) {
            showToast('스텝을 최소 1개 적어 주실래요?');
            return;
        }

        try {
            // goalVersionAtCreate — 신규일 때만 박음 (편집은 보존)
            let goalVersionAtCreate = existing?.goalVersionAtCreate || null;
            if (!isEdit) {
                try {
                    const v = await getActiveVersion(dek, userId, state.parentGoalId);
                    goalVersionAtCreate = v?.versionNumber || null;
                } catch (e) { /* 버전 없어도 진행 */ }
            }

            const workflow = {
                ...(existing || {}),
                userId,
                parentGoalId: state.parentGoalId,
                title,
                steps: validSteps,
                goalVersionAtCreate,
                status: existing?.status || 'active',
                source: existing?.source || 'self_report',
                updatedAt: new Date().toISOString(),
            };
            // 신규 createdAt
            if (!isEdit) workflow.createdAt = new Date().toISOString();
            // revisionLog 추가
            workflow.revisionLog = [
                ...(workflow.revisionLog || []),
                { at: Date.now(), summary: isEdit ? '편집' : '신규 생성' }
            ];

            const id = await saveWorkflow(dek, workflow);
            workflow.id = id;
            // (워크플로우 가벼운 손질 2026-05-15) 신규일 때 다음 행동 안내 토스트 — 사용자가 "도트랑 연계 안 됨" 통증 해소.
            //   토스트 안내 + localStorage 로 첫 워크플로우 만들기 시 한 번만 큰 안내 모달도 옵션.
            if (isEdit) {
                showToast('등산로를 다시 정리했어요');
            } else {
                showToast('✓ 새 등산로가 생겼어요. 스텝 옆 [+ 지금] 누르면 시간표에 한 걸음이 만들어져요');
                // 첫 워크플로우 만들기면 1회 큰 안내
                try {
                    const firstKey = 'sanctum-first-workflow-guide-shown';
                    if (!localStorage.getItem(firstKey)) {
                        localStorage.setItem(firstKey, '1');
                        setTimeout(() => showFirstTimeGuide(), 600);
                    }
                } catch {}
            }
            handle.close();
            if (typeof onSaved === 'function') onSaved(workflow);
            // 다른 화면들 자동 동기화
            window.dispatchEvent(new CustomEvent('sanctum:workflow-changed', {
                detail: { type: isEdit ? 'update' : 'create', workflow }
            }));
        } catch (e) {
            console.error('[workflowEdit] save failed:', e);
            showToast('저장이 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
        }
    });
}

function renderShell({ isEdit }) {
    return `
        <div class="modal-card wfe-card">
            <header class="modal-head">
                <h3>${isEdit ? '🛤️ 등산로 편집' : '🛤️ 새 등산로 만들기'}</h3>
                <button class="modal-close" aria-label="닫기">×</button>
            </header>
            <div class="modal-body">
                <div class="wfe-row">
                    <label>어떤 목표의 등산로?</label>
                    <select id="wfe-goal"></select>
                </div>
                <div class="wfe-row">
                    <label>등산로 이름</label>
                    <input id="wfe-title" type="text" placeholder="예: '체력 회복 1단계'" maxlength="80" />
                </div>
                <div class="wfe-row">
                    <label>큰 단계 (스텝) <span class="wfe-hint">— 한 줄씩, 위에서부터 순서대로</span></label>
                    <ul class="wfe-steps-list" id="wfe-steps"></ul>
                    <button type="button" id="wfe-add-step" class="wfe-add-step-btn">+ 스텝 추가</button>
                </div>
            </div>
            <footer class="modal-foot">
                <span style="flex:1"></span>
                <button class="modal-cancel text-btn">취소</button>
                <button id="wfe-save" class="primary-btn">${isEdit ? '저장' : '만들기'}</button>
            </footer>
        </div>
    `;
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

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
function escapeAttr(s) { return escapeHtml(s); }

/**
 * (워크플로우 가벼운 손질 2026-05-15) 첫 워크플로우 만들기 시 1회 큰 안내.
 *   localStorage 'sanctum-first-workflow-guide-shown' 으로 중복 차단.
 *   사용자가 "워크플로우 만들었는데 도트랑 연계 안 됨" 통증 해소가 목적.
 */
function showFirstTimeGuide() {
    const guideId = 'wfe-first-guide-overlay';
    let el = document.getElementById(guideId);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = guideId;
    el.className = 'modal-overlay';
    el.innerHTML = `
        <div class="modal-card wfe-guide-card">
            <header class="modal-head">
                <h3>🛤️ 첫 등산로가 생겼어요</h3>
                <button class="modal-close" aria-label="닫기">×</button>
            </header>
            <div class="modal-body">
                <p class="wfe-guide-intro">이제 시간표에 한 걸음씩 넣으면, 도트가 자동으로 만들어져요.</p>
                <ol class="wfe-guide-steps">
                    <li><b>오늘 화면</b>에서 "등산로 (워크플로우)" 섹션을 찾아주세요.</li>
                    <li>방금 만든 등산로의 스텝 옆에 <b>[+ 지금]</b> 버튼이 있어요.</li>
                    <li>누르면 지금 시각에 도트가 만들어져요. 시간표에서 옮기거나 늘릴 수도 있어요.</li>
                    <li>드래그를 좋아하면 ⋮⋮ 핸들을 잡아서 시간표 빈 칸에 끌어다 놓으세요.</li>
                </ol>
                <p class="wfe-guide-note">다음에 또 만들 때는 이 안내가 안 나와요. 잊었으면 다시 보고 싶을 때 [등산로] 헤더에 도움말이 있어요.</p>
            </div>
            <footer class="modal-foot">
                <span style="flex:1"></span>
                <button class="modal-close primary-btn">알겠어요</button>
            </footer>
        </div>
    `;
    document.body.appendChild(el);
    el.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => el.remove()));
    el.addEventListener('click', (e) => {
        if (e.target === el) el.remove();
    });
}
