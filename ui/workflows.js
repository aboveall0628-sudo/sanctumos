/**
 * workflows.js — view-today 안 워크플로우(등산로) 카드
 *
 * 워크플로우 트랙 STEP 2 (2026-05-13):
 * - 활성 워크플로우 목록 + 각 스텝 행
 * - 데스크탑: 스텝 ⋮⋮ 핸들 드래그 → 시간표 슬롯 드롭 → 도트 즉시 생성
 * - 모바일: 스텝 옆 [+ 시간표에 박기] 버튼 → 현재 시각 슬롯에 박힘 + 시간표에서 조정
 *
 * 워크플로우 생성/편집 UI는 별도 트랙(다음 세션) — 여기선 읽기 + 드래그만.
 * 빈 상태도 친절하게 안내 (강제 차단 X).
 *
 * 도트 생성 시 자동 박힘:
 * - linkedGoalId      = workflow.parentGoalId
 * - linkedWorkflowStepId = step.id
 * - goalVersionId     = 활성 GoalVersion id (없으면 null)
 * - executor          = step.executor (self|helper|external)
 * - plannedTask       = step.title
 * - source            = 'self_report'
 *
 * 그리고 workflowsRepo.linkDotToStep 호출로 역참조 자동 완성.
 */

import { getDEK } from './lockScreen.js';
import { getActiveWorkflows, linkDotToStep } from '../data/workflowsRepo.js';
import { getActiveVersion } from '../data/goalVersionsRepo.js';
import { saveDot } from '../data/dotsRepo.js';
import { getAllGoals } from '../data/goalsRepo.js';
import { showToast } from './quickReview.js';
import { openWorkflowEdit } from './workflowEdit.js';

const STATUS_META = {
    pending:     { icon: '○', label: '대기',   cls: 'wf-step-pending' },
    in_progress: { icon: '▣', label: '진행 중', cls: 'wf-step-in-progress' },
    done:        { icon: '✓', label: '완료',   cls: 'wf-step-done' },
    abandoned:   { icon: '✕', label: '폐기',   cls: 'wf-step-abandoned' },
};

let _userId = null;
let _date = null;          // 현재 view-today 가 보고 있는 날짜
let _workflows = [];       // 활성 워크플로우 cache
let _goalTitles = {};      // parentGoalId → goal.title (드래그 박을 때 표시용)
let _onDotCreated = null;  // 도트 박힌 후 timeline 갱신 요청 콜백

/**
 * 마운트 — view-today 진입 시 1회 호출.
 */
export function initWorkflowsCard({ userId, date, onDotCreated }) {
    _userId = userId;
    _date = date;
    _onDotCreated = onDotCreated || null;
    bindEvents();
}

/**
 * 데이터 다시 로드 + 렌더 (잠금 해제, 날짜 변경, 워크플로우 변경 후 호출).
 */
export async function refreshWorkflows({ userId, date }) {
    _userId = userId;
    _date = date;
    const dek = getDEK();
    const container = document.getElementById('workflows-list');
    if (!container) return;
    if (!dek) {
        container.innerHTML = `<p class="wf-empty">잠시 잠겨 있어요.</p>`;
        return;
    }
    try {
        const [workflows, goals] = await Promise.all([
            getActiveWorkflows(dek, userId),
            getAllGoals(dek, userId)
        ]);
        _workflows = workflows;
        _goalTitles = {};
        goals.forEach(g => { _goalTitles[g.id] = g.title || g.id; });
        renderWorkflows();
    } catch (e) {
        console.error('[workflows] refresh failed:', e);
        container.innerHTML = `<p class="wf-empty wf-empty-error">못 가져왔어요. 새로고침해 주실래요?</p>`;
    }
}

function renderWorkflows() {
    const container = document.getElementById('workflows-list');
    if (!container) return;

    if (!_workflows.length) {
        container.innerHTML = `
            <div class="wf-empty-card">
                <p class="wf-empty-title">아직 등산로가 없어요.</p>
                <p class="wf-empty-body">
                    묵상을 통해 어떤 한 걸음을 박을지 분별이 모이면,<br>
                    그걸 등산로(워크플로우)로 정리해 보세요.
                </p>
                <button type="button" id="wf-new-empty-btn" class="primary-btn">+ 새 등산로 만들기</button>
            </div>
        `;
        return;
    }

    // (워크플로우 STEP 3 2026-05-14) 워크플로우 있을 때도 맨 위에 [+ 새 등산로] 진입 버튼
    container.innerHTML = `
        <div class="wf-header-actions">
            <button type="button" id="wf-new-btn" class="wf-new-btn">+ 새 등산로</button>
        </div>
        ${_workflows.map(wf => renderWorkflowCard(wf)).join('')}
    `;
}

function renderWorkflowCard(wf) {
    const steps = Array.isArray(wf.steps) ? wf.steps : [];
    const doneCount = steps.filter(s => s.status === 'done').length;
    const total = steps.length;
    const goalTitle = _goalTitles[wf.parentGoalId] || '(연결된 목표 없음)';

    const stepsHtml = steps.map((step, i) => renderStep(wf, step, i + 1)).join('');

    return `
        <div class="wf-card" data-workflow-id="${escapeAttr(wf.id)}">
            <div class="wf-card-head">
                <div class="wf-card-title-row">
                    <span class="wf-card-goal">${escapeHtml(goalTitle)}</span>
                    <h3 class="wf-card-title">${escapeHtml(wf.title || '(이름 없는 등산로)')}</h3>
                </div>
                <div class="wf-card-head-right">
                    <span class="wf-progress-chip">${doneCount}/${total}</span>
                    <button type="button" class="wf-card-edit-btn icon-btn"
                            data-workflow-id="${escapeAttr(wf.id)}" title="편집">✏️</button>
                </div>
            </div>
            <ul class="wf-steps">
                ${stepsHtml || '<li class="wf-empty-step">스텝이 비어 있어요.</li>'}
            </ul>
        </div>
    `;
}

function renderStep(wf, step, order) {
    const meta = STATUS_META[step.status] || STATUS_META.pending;
    const isActionable = step.status !== 'done' && step.status !== 'abandoned';
    const executorBadge = step.executor && step.executor !== 'self'
        ? `<span class="wf-step-executor">${escapeHtml(step.executor)}</span>` : '';
    const dotCount = Array.isArray(step.linkedDotIds) ? step.linkedDotIds.length : 0;
    const estimated = step.estimatedDots || 0;
    // (워크플로우 가벼운 손질 2026-05-15) 진척 시각 강화 — N/M 형식 + 진척 바
    let progressHtml = '';
    if (estimated > 0) {
        const pct = Math.min(100, Math.round((dotCount / estimated) * 100));
        progressHtml = `
            <div class="wf-step-progress" title="만들어진 도트 ${dotCount}개 / 예상 ${estimated}개">
                <span class="wf-step-progress-text">${dotCount}/${estimated}</span>
                <div class="wf-step-progress-bar"><div class="wf-step-progress-fill" style="width:${pct}%"></div></div>
            </div>`;
    } else if (dotCount > 0) {
        progressHtml = `<span class="wf-step-dot-count" title="이 스텝에서 만들어진 도트 수">×${dotCount}</span>`;
    }

    // (워크플로우 가벼운 손질 2026-05-15) 데스크탑·모바일 통일 — [+ 지금 시간표에 넣기] 버튼
    //   드래그가 안 보이거나 안 될 때 대안. 클릭 한 번에 현재 시각 슬롯으로 도트 생성.
    const addBtnHtml = isActionable
        ? `<button class="wf-step-add-now" type="button"
                   data-workflow-id="${escapeAttr(wf.id)}"
                   data-step-id="${escapeAttr(step.id)}"
                   data-parent-goal-id="${escapeAttr(wf.parentGoalId || '')}"
                   title="지금 시각에 한 걸음 만들기">+ 지금</button>`
        : '';
    // 데스크탑 ⋮⋮ 핸들 — actionable 한 스텝만 draggable (기존 유지)
    const handleHtml = isActionable
        ? `<span class="wf-step-handle desktop-only"
                 draggable="true"
                 data-workflow-id="${escapeAttr(wf.id)}"
                 data-step-id="${escapeAttr(step.id)}"
                 data-parent-goal-id="${escapeAttr(wf.parentGoalId || '')}"
                 title="잡고 시간표로 옮겨 보세요">⋮⋮</span>`
        : '';

    return `
        <li class="wf-step ${meta.cls}">
            <span class="wf-step-status" aria-label="${meta.label}">${meta.icon}</span>
            <span class="wf-step-order">${order}.</span>
            <span class="wf-step-title">${escapeHtml(step.title || '(제목 없음)')}</span>
            ${executorBadge}
            ${progressHtml}
            ${handleHtml}
            ${addBtnHtml}
        </li>
    `;
}

// ─── 이벤트 ───────────────────────────────────────────────

function bindEvents() {
    // 데스크탑 드래그 핸들
    document.addEventListener('dragstart', (e) => {
        const handle = e.target.closest('.wf-step-handle');
        if (!handle) return;
        const payload = JSON.stringify({
            workflowId: handle.dataset.workflowId,
            stepId: handle.dataset.stepId,
            parentGoalId: handle.dataset.parentGoalId || null
        });
        try { e.dataTransfer.setData('application/x-sanctum-workflow-step', payload); } catch {}
        try { e.dataTransfer.setData('text/plain', '워크플로우 스텝'); } catch {}
        e.dataTransfer.effectAllowed = 'move';
        handle.classList.add('dragging');
    });
    document.addEventListener('dragend', (e) => {
        const handle = e.target.closest('.wf-step-handle');
        if (handle) handle.classList.remove('dragging');
    });

    // 모바일 [+ 시간표에 박기] (기존, 호환성 유지) + 데스크탑·모바일 통일 [+ 지금]
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.wf-step-mobile-add, .wf-step-add-now');
        if (!btn) return;
        e.preventDefault();
        const workflowId = btn.dataset.workflowId;
        const stepId = btn.dataset.stepId;
        const parentGoalId = btn.dataset.parentGoalId || null;
        const slot = nowSlot();   // 현재 시각 기준 슬롯
        await createDotFromStep({ workflowId, stepId, parentGoalId, slot });
    });

    // (워크플로우 STEP 3 2026-05-14) [+ 새 등산로] / 카드 편집 진입점
    document.addEventListener('click', async (e) => {
        const newBtn = e.target.closest('#wf-new-btn, #wf-new-empty-btn');
        if (newBtn) {
            e.preventDefault();
            openWorkflowEdit({
                userId: _userId,
                onSaved: () => refreshWorkflows({ userId: _userId, date: _date })
            });
            return;
        }
        const editBtn = e.target.closest('.wf-card-edit-btn');
        if (editBtn) {
            e.preventDefault();
            const wfId = editBtn.dataset.workflowId;
            openWorkflowEdit({
                userId: _userId,
                workflowId: wfId,
                onSaved: () => refreshWorkflows({ userId: _userId, date: _date })
            });
            return;
        }
    });

    // 다른 곳에서 워크플로우 변경 시 자동 갱신
    window.addEventListener('sanctum:workflow-changed', () => {
        if (_userId) refreshWorkflows({ userId: _userId, date: _date });
    });
}

/**
 * 워크플로우 스텝 → 도트 1개 생성 (지정 슬롯에). 데스크탑 drop / 모바일 버튼 공용.
 * timeline.js 의 drop 핸들러에서도 import 해서 호출됨.
 */
export async function createDotFromStep({ workflowId, stepId, parentGoalId, slot, date }) {
    const dek = getDEK();
    if (!dek) { showToast('잠시 잠겨 있어요. 비밀번호로 열어 주실래요?'); return null; }

    const wf = _workflows.find(w => w.id === workflowId);
    if (!wf) {
        showToast('등산로를 찾지 못했어요. 새로고침해 주실래요?');
        return null;
    }
    const step = (wf.steps || []).find(s => s.id === stepId);
    if (!step) {
        showToast('스텝을 찾지 못했어요.');
        return null;
    }

    // 활성 GoalVersion 조회 — 없어도 진행 (goalVersionId=null)
    let goalVersionId = null;
    if (parentGoalId) {
        try {
            const v = await getActiveVersion(dek, _userId, parentGoalId);
            goalVersionId = v?.id || null;
        } catch (e) {
            console.warn('[workflows] getActiveVersion failed:', e?.message || e);
        }
    }

    const targetDate = date || _date;
    const targetSlot = (slot != null) ? slot : nowSlot();

    const dotData = {
        userId: _userId,
        date: targetDate,
        timeSlot: targetSlot,
        durationSlots: 4,  // 기본 1시간. 사용자가 시간표에서 리사이즈 가능.
        plannedTask: step.title || '',
        linkedGoalId: parentGoalId || null,
        linkedWorkflowStepId: step.id,
        goalVersionId,
        executor: step.executor || 'self',
        source: 'self_report'
    };
    // (워크플로우 STEP 3 2026-05-14) helper executor 일 때 인물 자동 전파.
    //   step에 helperPersonId 박혀 있으면 도트의 helperPersonId + linkedPersonIds에 자동 박힘.
    //   → 도트 평가 시 인물 카드와 자연 연결 + B-4 관계 신뢰도 회로 입력.
    if (step.executor === 'helper' && step.helperPersonId) {
        dotData.helperPersonId = step.helperPersonId;
        dotData.linkedPersonIds = [step.helperPersonId];
    }

    try {
        await saveDot(dek, dotData);
        // 역참조 — workflow.steps[].linkedDotIds 에 도트 ID 추가
        const dotId = `${_userId}_${targetDate}_${targetSlot}`;
        try {
            await linkDotToStep(dek, wf, step.id, dotId);
        } catch (e) {
            console.warn('[workflows] linkDotToStep failed:', e?.message || e);
        }
        showToast('✓ 시간표에 한 걸음 박혔어요');
        // 타임라인 갱신 요청
        if (_onDotCreated) await _onDotCreated({ dotId, slot: targetSlot });
        // 워크플로우 카드 자체도 진척이 바뀌었으니 다시
        await refreshWorkflows({ userId: _userId, date: _date });
        return dotId;
    } catch (e) {
        console.error('[workflows] createDotFromStep failed:', e);
        showToast('박는 중에 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
        return null;
    }
}

// ─── 헬퍼 ─────────────────────────────────────────────────

/**
 * 지금 시각을 15분 단위 슬롯 인덱스로. 모바일 [+ 박기] 기본값.
 */
function nowSlot() {
    const now = new Date();
    return Math.floor((now.getHours() * 60 + now.getMinutes()) / 15);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
function escapeAttr(s) { return escapeHtml(s); }
