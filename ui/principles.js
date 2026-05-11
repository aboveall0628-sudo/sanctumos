/**
 * principles.js — 나의 원칙 뷰 (카테고리 탭 + 인라인 편집 + 핀)
 *
 * 카테고리: 전체 / 영적 / 관계 / 일·소명 / 돈 / 건강 / 의사결정 / 기타
 * 핀(★) 누르면 오늘 화면 띠에 표시될 후보가 됨.
 */

import { getPrinciples, savePrinciple, deletePrinciple } from '../data/principlesRepo.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';

// icon 필드는 Lucide name (디자인 시스템 정합)
const CATEGORIES = [
    { id: 'all',       label: '전체',     icon: 'sparkles' },
    { id: 'spiritual', label: '영적',     icon: 'hand' },
    { id: 'relation',  label: '관계',     icon: 'heart' },
    { id: 'work',      label: '일·소명',   icon: 'briefcase' },
    { id: 'money',     label: '돈',      icon: 'wallet' },
    { id: 'health',    label: '건강',     icon: 'leaf' },
    { id: 'decision',  label: '의사결정',  icon: 'target' },
    { id: 'general',   label: '기타',     icon: 'pin' },
];

let _userId = null;
let _activeCategory = 'all';
let _principles = [];

export async function renderPrinciplesView(userId) {
    _userId = userId;
    const container = document.getElementById('principles-container');
    if (!container) return;

    const dek = getDEK();
    if (!dek) {
        container.innerHTML = '<div class="empty-state"><i class="empty-state-icon" data-lucide="lock"></i><h3>잠시 잠겨있어요</h3><p class="empty-state-desc">비밀번호로 열어주세요.</p></div>';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    container.innerHTML = '<div class="spinner" style="margin: 40px auto"></div>';

    try {
        _principles = await getPrinciples(dek, userId);
    } catch (e) {
        console.error('principles load failed:', e);
        _principles = [];
    }

    renderCategoryTabs(container);
    renderPrinciplePanel(container);
}

function renderCategoryTabs(container) {
    const html = `
        <div class="principle-tabs">
            ${CATEGORIES.map(c => {
                const count = c.id === 'all'
                    ? _principles.length
                    : _principles.filter(p => (p.category || 'general') === c.id).length;
                return `
                    <button class="principle-tab ${c.id === _activeCategory ? 'active' : ''}" data-cat="${c.id}">
                        <span><i class="principle-tab-icon" data-lucide="${c.icon}"></i> ${c.label}</span>
                        ${count > 0 ? `<span class="principle-tab-count">${count}</span>` : ''}
                    </button>
                `;
            }).join('')}
        </div>
        <div id="principle-panel"></div>
    `;
    container.innerHTML = html;

    container.querySelectorAll('.principle-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeCategory = btn.dataset.cat;
            renderCategoryTabs(container);
            renderPrinciplePanel(container);
        });
    });
}

function renderPrinciplePanel(container) {
    const panel = container.querySelector('#principle-panel') || document.getElementById('principle-panel');
    if (!panel) return;

    const filtered = _activeCategory === 'all'
        ? _principles
        : _principles.filter(p => (p.category || 'general') === _activeCategory);

    let html = `
        <div class="principles-toolbar">
            <button id="add-principle-btn" class="primary-btn">+ 새 원칙 적기</button>
        </div>
    `;

    if (filtered.length === 0) {
        html += `
            <div class="empty-state" style="padding: var(--sp-5)">
                <i class="empty-state-icon" data-lucide="book-open"></i>
                <h3>이 카테고리에 아직 원칙이 없어요</h3>
                <p class="empty-state-desc">
                    원칙은 흔들리지 않는 약속이에요.<br>
                    삶에서 발견한 한 문장을 적어 둬 봐요.
                </p>
            </div>
        `;
    } else {
        html += '<div class="principles-list">';
        filtered.forEach(p => { html += renderPrincipleCard(p); });
        html += '</div>';
    }

    panel.innerHTML = html;
    bindPanelEvents(panel);
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

function renderPrincipleCard(p) {
    const cat = p.category || 'general';
    return `
        <div class="principle-card" data-id="${p.id}">
            <div class="principle-header">
                <input type="text" class="principle-title-input" value="${escapeHtml(p.title || '')}"
                       placeholder="원칙 한 문장으로 적기" />
                <div class="principle-actions">
                    <button class="icon-btn pin-btn ${p.pinned ? 'active' : ''}" title="상단에 띄우기" aria-label="핀"><i data-lucide="pin"></i></button>
                    <button class="icon-btn delete-btn" title="지우기" aria-label="삭제"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
            <textarea class="principle-body-input" rows="3"
                      placeholder="이 원칙을 어떻게 삶에 적용할까요? 자유롭게 적어 보세요.">${escapeHtml(p.body || '')}</textarea>
            <div class="principle-card-footer">
                <select class="principle-cat-select">
                    ${CATEGORIES.filter(c => c.id !== 'all').map(c =>
                        `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${c.label}</option>`
                    ).join('')}
                </select>
            </div>
        </div>
    `;
}

function bindPanelEvents(panel) {
    panel.querySelector('#add-principle-btn')?.addEventListener('click', addNewPrinciple);

    panel.querySelectorAll('.principle-card').forEach(card => {
        const id = card.dataset.id;
        const titleInput = card.querySelector('.principle-title-input');
        const bodyInput = card.querySelector('.principle-body-input');
        const catSelect = card.querySelector('.principle-cat-select');
        const pinBtn = card.querySelector('.pin-btn');
        const deleteBtn = card.querySelector('.delete-btn');

        let saveTimer = null;
        const triggerSave = (immediate = false) => {
            clearTimeout(saveTimer);
            const fn = async () => {
                const dek = getDEK();
                if (!dek) return;
                const principle = _principles.find(p => p.id === id);
                if (!principle) return;
                principle.title = titleInput.value.trim();
                principle.body = bodyInput.value;
                principle.category = catSelect.value;
                principle.pinned = pinBtn.classList.contains('active');
                principle.active = true;
                try { await savePrinciple(dek, principle); }
                catch (e) { console.error('principle save failed:', e); }
            };
            if (immediate) fn();
            else saveTimer = setTimeout(fn, 1000);
        };

        titleInput?.addEventListener('input', () => triggerSave());
        bodyInput?.addEventListener('input', () => triggerSave());
        catSelect?.addEventListener('change', () => {
            triggerSave(true);
            // 카테고리 바뀌면 탭 카운트 갱신을 위해 재렌더
            setTimeout(() => renderPrinciplesView(_userId), 200);
        });

        pinBtn?.addEventListener('click', () => {
            pinBtn.classList.toggle('active');
            triggerSave(true);
            setTimeout(() => renderPrinciplesView(_userId), 200);
        });

        deleteBtn?.addEventListener('click', async () => {
            if (!confirm('이 원칙을 지워도 괜찮을까요?')) return;
            try {
                await deletePrinciple(id);
                _principles = _principles.filter(p => p.id !== id);
                renderCategoryTabs(document.getElementById('principles-container'));
                renderPrinciplePanel(document.getElementById('principles-container'));
                showToast('원칙을 지웠어요');
            } catch (e) {
                console.error('principle delete failed:', e);
                showToast('지우기가 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
            }
        });
    });
}

async function addNewPrinciple() {
    const dek = getDEK();
    if (!dek) { showToast('잠시 잠겨 있어요. 비밀번호로 열어 주실래요?'); return; }

    const newPrinciple = {
        userId: _userId,
        title: '',
        body: '',
        category: _activeCategory === 'all' ? 'general' : _activeCategory,
        pinned: false,
        active: true,
    };

    try {
        await savePrinciple(dek, newPrinciple);
        // saveRecord가 id를 자동 생성하므로 다시 로드
        await renderPrinciplesView(_userId);
        // 마지막 카드에 포커스
        setTimeout(() => {
            const cards = document.querySelectorAll('.principle-card');
            const last = cards[cards.length - 1];
            last?.querySelector('.principle-title-input')?.focus();
        }, 100);
    } catch (e) {
        console.error('principle create failed:', e);
        showToast('원칙 추가가 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
