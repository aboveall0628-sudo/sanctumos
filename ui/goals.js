/**
 * goals.js — 나의 목표 뷰 (7계층 탭 + CRUD + 인라인 편집)
 *
 * 7계층: daily → weekly → monthly → quarterly → yearly → 5year → 10year
 * 각 탭에서 + 버튼으로 새 목표 추가, 카드 인라인 편집(제목/설명 디바운스 1초 자동 저장)
 * 진행률은 하위 목표/도트로부터 추후 자동 계산 (B-D 단계)
 */

import { getAllGoals, saveGoal, deleteGoal } from '../data/goalsRepo.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
// B-1 의사결정 시스템 (2026-05-13): 분별의 자리 — 폐기 자동 게이트 + 명시 진입
import { openDecisionGate } from './decisionGate.js';

// icon 필드는 Lucide name (디자인 시스템 정합)
const PERIOD_LABELS = {
    'daily':     { label: '오늘',         icon: 'sun',            desc: '오늘 옮길 한 걸음' },
    'weekly':    { label: '이번 주',       icon: 'calendar',       desc: '이번 주 안에 자라야 할 것' },
    'monthly':   { label: '이번 달',       icon: 'calendar-days',  desc: '이번 달의 흐름' },
    'quarterly': { label: '이번 분기',      icon: 'bar-chart-3',    desc: '3개월 안에 도달할 곳' },
    'yearly':    { label: '올해',         icon: 'target',         desc: '올해 한 해의 방향' },
    '5year':     { label: '5년 안에',      icon: 'tree-pine',      desc: '5년 후의 모습' },
    '10year':    { label: '10년 후',       icon: 'sparkles',       desc: '먼 곳에서 부르시는 모습' },
};

// Phase D-1: 7계층 탭 시각 무게 절반으로. 디폴트는 daily/weekly 만 노출,
// 나머지는 [더 멀리 보기] 토글 안. _activeTab 디폴트도 daily 로.
const NEAR_TABS = ['daily', 'weekly'];        // 항상 노출
const FAR_TABS  = ['monthly', 'quarterly', 'yearly', '5year', '10year'];

let _userId = null;
let _activeTab = 'daily';
let _farTabsOpen = false;
let _goals = [];

export async function renderGoalsView(userId) {
    _userId = userId;
    const container = document.getElementById('goals-container');
    if (!container) return;

    const dek = getDEK();
    if (!dek) {
        container.innerHTML = '<div class="empty-state"><i class="empty-state-icon" data-lucide="lock"></i><h3>잠시 잠겨있어요</h3><p class="empty-state-desc">비밀번호로 열어주세요.</p></div>';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    container.innerHTML = '<div class="spinner" style="margin: 40px auto"></div>';

    try {
        _goals = await getAllGoals(dek, userId);
    } catch (e) {
        console.error('goals load failed:', e);
        _goals = [];
    }

    renderTabs(container);
    renderActivePanel(container);
}

function renderTabs(container) {
    // 디폴트는 daily + weekly 만. 나머지는 [더 멀리 보기] 토글 안.
    // 단 사용자가 멀리 있는 탭(_activeTab)을 활성화한 상태라면 자동으로 펼침.
    const farActive = FAR_TABS.includes(_activeTab);
    const showFar = _farTabsOpen || farActive;

    const renderTabBtn = (p) => {
        const meta = PERIOD_LABELS[p];
        const count = _goals.filter(g => g.period === p).length;
        return `
            <button class="goal-tab ${p === _activeTab ? 'active' : ''}" data-period="${p}">
                <i class="goal-tab-icon" data-lucide="${meta.icon}"></i>
                <span class="goal-tab-label">${meta.label}</span>
                ${count > 0 ? `<span class="goal-tab-count">${count}</span>` : ''}
            </button>
        `;
    };

    const farBtnHtml = `
        <button class="goal-tab goal-tab-far-toggle" id="goal-far-toggle" type="button">
            <i class="goal-tab-icon" data-lucide="${showFar ? 'chevron-left' : 'chevrons-right'}"></i>
            <span class="goal-tab-label">${showFar ? '가까이' : '더 멀리'}</span>
        </button>
    `;

    const tabsHtml = `
        <div class="goal-tabs">
            ${NEAR_TABS.map(renderTabBtn).join('')}
            ${showFar ? FAR_TABS.map(renderTabBtn).join('') : ''}
            ${farBtnHtml}
        </div>
        <div id="goal-panel"></div>
    `;
    container.innerHTML = tabsHtml;

    container.querySelectorAll('.goal-tab[data-period]').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeTab = btn.dataset.period;
            renderTabs(container);
            renderActivePanel(container);
        });
    });
    container.querySelector('#goal-far-toggle')?.addEventListener('click', () => {
        _farTabsOpen = !_farTabsOpen;
        renderTabs(container);
        renderActivePanel(container);
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    });
}

function renderActivePanel(container) {
    const panel = container.querySelector('#goal-panel') || document.getElementById('goal-panel');
    if (!panel) return;

    const meta = PERIOD_LABELS[_activeTab];
    // (2026-05-13 HC#1 추모비) archived 상태 목표는 active 목록에서 숨김.
    // 폐기된 목표는 "지나간 목표" 진입점으로만 노출.
    const periodGoals = _goals.filter(g => g.period === _activeTab && g.status !== 'archived');
    const archivedCount = _goals.filter(g => g.status === 'archived').length;

    let html = `
        <div class="goal-panel-header">
            <div>
                <h2 class="goal-panel-title"><i class="goal-panel-icon" data-lucide="${meta.icon}"></i> ${meta.label}</h2>
                <p class="goal-panel-desc">${meta.desc}</p>
            </div>
            <div class="goal-panel-actions">
                ${archivedCount > 0 ? `<button id="open-memorials-btn" class="text-btn" title="지나간 목표 추모비">🪦 지나간 목표 ${archivedCount}개</button>` : ''}
                <button id="add-goal-btn" class="primary-btn">+ 새 목표 적기</button>
            </div>
        </div>
    `;

    if (periodGoals.length === 0) {
        html += emptyStateForPeriod(_activeTab);
    } else {
        html += '<div class="goal-cards">';
        periodGoals.forEach(g => { html += renderGoalCard(g); });
        html += '</div>';
    }

    panel.innerHTML = html;
    bindPanelEvents(panel);
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

function emptyStateForPeriod(period) {
    const tips = {
        '10year':    '10년 뒤 어떤 모습이고 싶나요? 한 줄로 적어 보세요.',
        '5year':     '5년 안에 자라야 할 것을 한 줄로 적어 보세요.',
        'yearly':    '올해 한 해, 어디로 향하고 싶나요?',
        'quarterly': '이번 분기에 도달하고 싶은 곳을 적어 보세요.',
        'monthly':   '이번 달의 흐름을 한 줄로 정리해 봐요.',
        'weekly':    '이번 주 안에 자라야 할 것을 적어 보세요.',
        'daily':     '오늘 옮길 한 걸음을 적어 보세요.',
    };
    return `
        <div class="empty-state" style="padding: var(--sp-5)">
            <i class="empty-state-icon" data-lucide="${PERIOD_LABELS[period].icon}"></i>
            <h3>아직 ${PERIOD_LABELS[period].label} 목표가 없어요</h3>
            <p class="empty-state-desc">${tips[period] || ''}</p>
            <p style="margin-top:16px;font-size:12px;color:var(--ink-secondary)">
                위의 [+ 새 목표 적기]를 눌러 시작해 볼까요?
            </p>
        </div>
    `;
}

function renderGoalCard(g) {
    return `
        <div class="goal-card-v2" data-id="${g.id}">
            <input type="text" class="goal-title-input" value="${escapeHtml(g.title || '')}"
                   placeholder="목표 한 줄로 적기" />
            <textarea class="goal-desc-input" rows="2"
                      placeholder="(선택) 더 구체적으로 풀어 적어 보세요">${escapeHtml(g.description || '')}</textarea>
            <div class="goal-card-footer">
                <span class="goal-card-meta">${g.progress != null ? `진행 ${g.progress}%` : '진행률은 곧 자동으로 보여요'}</span>
                <div class="goal-card-actions">
                    <button class="goal-discernment-btn" title="분별의 자리 — 결정을 한 번 들여다보기" type="button">
                        📜 분별
                    </button>
                    <button class="icon-btn extinguish-btn" title="이 목표 그만두기 (분별 후 추모비로 보존)">🪦</button>
                    <button class="icon-btn delete-btn" title="완전 삭제 (흔적 없음)">🗑</button>
                </div>
            </div>
        </div>
    `;
}

function bindPanelEvents(panel) {
    const addBtn = panel.querySelector('#add-goal-btn');
    if (addBtn) {
        addBtn.addEventListener('click', addNewGoal);
    }

    // (2026-05-13 HC#1 추모비) "지나간 목표 N개" 진입점 — 추모비 목록 모달.
    const memorialsBtn = panel.querySelector('#open-memorials-btn');
    if (memorialsBtn) {
        memorialsBtn.addEventListener('click', async () => {
            try {
                const mod = await import('./memorials.js');
                mod.openMemorialsModal(_userId);
            } catch (e) {
                console.error('memorials open failed:', e);
                showToast('추모비를 펴는 게 잠깐 막혔어요.');
            }
        });
    }

    panel.querySelectorAll('.goal-card-v2').forEach(card => {
        const id = card.dataset.id;
        const titleInput = card.querySelector('.goal-title-input');
        const descInput = card.querySelector('.goal-desc-input');
        const deleteBtn = card.querySelector('.delete-btn');

        let saveTimer = null;
        const triggerSave = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => {
                const dek = getDEK();
                if (!dek) return;
                const goal = _goals.find(g => g.id === id);
                if (!goal) return;
                goal.title = titleInput.value.trim();
                goal.description = descInput.value.trim();
                try {
                    await saveGoal(dek, goal);
                } catch (e) {
                    console.error('goal save failed:', e);
                }
            }, 1000);
        };

        titleInput?.addEventListener('input', triggerSave);
        descInput?.addEventListener('input', triggerSave);

        deleteBtn?.addEventListener('click', async () => {
            if (!confirm('이 목표를 완전히 지워도 괜찮을까요?\n흔적이 남지 않아요. 보존하고 싶다면 옆 🪦 그만두기를 눌러 주세요.')) return;
            try {
                await deleteGoal(id);
                _goals = _goals.filter(g => g.id !== id);
                renderActivePanel(document.getElementById('goals-container'));
                showToast('목표를 지웠어요');
            } catch (e) {
                console.error('goal delete failed:', e);
                showToast('지우기가 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
            }
        });

        // (2026-05-13 HC#1 추모비 + B-1) 🪦 그만두기 — 분별의 자리 자동 호출 →
        // 게이트가 saveGoal(status:archived) + revisionReason + sourcePrecedentId 박음
        // → onDecided 콜백이 추모비 저장 (saveGoal 중복 방지로 skipGoalUpdate=true)
        const extinguishBtn = card.querySelector('.extinguish-btn');
        extinguishBtn?.addEventListener('click', () => {
            const goal = _goals.find(g => g.id === id);
            if (!goal) return;
            openDecisionGate({
                userId: _userId,
                mode: 'goal-edit',
                presetGoal: goal,
                pendingGoalChanges: { status: 'archived', archivedAt: new Date().toISOString() },
                onDecided: async ({ precedentId, applied, revisedGoal }) => {
                    if (!applied) return; // 사용자가 게이트 닫고 적용 안 했으면 무동작
                    const dek = getDEK();
                    if (!dek) { showToast('잠시 잠겨 있어요. 비밀번호로 열어 주실래요?'); return; }
                    try {
                        const { extinguishGoalToMemorial } = await import('../data/memorialsRepo.js');
                        await extinguishGoalToMemorial(dek, _userId, revisedGoal || goal, {
                            userNote: '', // 결정 본문은 판례에 박힘. 추모비 userNote 는 별도 자유 메모로 비워둠.
                            triggeredByPrecedentId: precedentId,
                            skipGoalUpdate: true  // 게이트가 이미 saveGoal 호출
                        });
                        // 화면 갱신 — 로컬 캐시도 archived 표시
                        const g2 = _goals.find(x => x.id === id);
                        if (g2) g2.status = 'archived';
                        renderActivePanel(document.getElementById('goals-container'));
                        showToast('🪦 분별의 자리에 결정을 박고, 추모비에 보관했어요.');
                    } catch (e) {
                        console.error('extinguish after gate failed:', e);
                        showToast('추모비 보관이 잠깐 막혔어요. 분별 기록은 안전해요.');
                    }
                }
            });
        });

        // (B-1) 📜 분별 버튼 — 자유 모드 게이트. 이 목표를 linkedGoal 로 박음.
        const discernBtn = card.querySelector('.goal-discernment-btn');
        discernBtn?.addEventListener('click', () => {
            const goal = _goals.find(g => g.id === id);
            if (!goal) return;
            openDecisionGate({
                userId: _userId,
                mode: 'free',
                presetGoal: goal,
                onDecided: () => {
                    showToast('📜 분별의 자리에 보관했어요.');
                }
            });
        });
    });
}

async function addNewGoal() {
    const dek = getDEK();
    if (!dek) { showToast('잠시 잠겨 있어요. 비밀번호로 열어 주실래요?'); return; }

    const newGoal = {
        id: `goal_${_userId.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: _userId,
        period: _activeTab,
        title: '',
        description: '',
        parentGoalId: null,
        startDate: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(),
        endDate: '',
        status: 'active',
        progress: 0,
    };

    try {
        await saveGoal(dek, newGoal);
        _goals.push(newGoal);
        renderActivePanel(document.getElementById('goals-container'));
        // 새로 추가된 카드의 제목 입력란에 포커스
        setTimeout(() => {
            const cards = document.querySelectorAll('.goal-card-v2');
            const last = cards[cards.length - 1];
            const input = last?.querySelector('.goal-title-input');
            input?.focus();
        }, 50);
    } catch (e) {
        console.error('goal create failed:', e);
        showToast('목표 추가가 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
