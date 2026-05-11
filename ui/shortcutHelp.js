/**
 * shortcutHelp.js — Ctrl+/ 또는 ? 로 띄우는 단축키 치트시트 모달.
 *
 * registry 에서 카테고리별로 묶인 단축키 목록을 받아 키 배지 + 설명 표 렌더.
 * modalManager 위에서 동작 — ESC/백드롭/포커스 트랩 자동.
 */

import { openModal, isModalOpen, closeTopModal } from './modalManager.js';
import { getShortcutsByCategory } from '../shortcuts/registry.js';
import { comboToBadges } from '../shortcuts/keyParser.js';

const OVERLAY_ID = 'shortcut-help-overlay';
let _handle = null;

function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'modal-overlay shortcut-help-overlay hidden';
    overlay.innerHTML = `
        <div class="modal-card shortcut-help-card" role="document">
            <header class="shortcut-help-head">
                <h2>단축키</h2>
                <button type="button" class="shortcut-help-close" aria-label="닫기">×</button>
            </header>
            <div class="shortcut-help-search">
                <input type="text" id="shortcut-help-search-input" placeholder="검색 (예: 잠금, 저장, Alt)" autocomplete="off" />
            </div>
            <div class="shortcut-help-body" id="shortcut-help-body"></div>
            <footer class="shortcut-help-foot">
                <span>도움말 닫기 <kbd>Esc</kbd></span>
                <span>다시 열기 <kbd>Ctrl</kbd>+<kbd>/</kbd></span>
            </footer>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function renderBadge(comboStr) {
    const parts = comboToBadges(comboStr);
    return parts.map((p, i) => {
        const sep = i < parts.length - 1 ? '<span class="kbd-plus">+</span>' : '';
        return `<kbd class="kbd">${escapeHTML(p)}</kbd>${sep}`;
    }).join('');
}

function renderKeyOptions(keys) {
    const arr = Array.isArray(keys) ? keys : [keys];
    return arr.map(k => renderBadge(k)).join('<span class="kbd-or">또는</span>');
}

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function renderBody(filter = '') {
    const f = filter.trim().toLowerCase();
    const groups = getShortcutsByCategory();
    const html = groups.map(([cat, items]) => {
        const filtered = !f ? items : items.filter(s => {
            const keyStr = (Array.isArray(s.keys) ? s.keys.join(' ') : s.keys).toLowerCase();
            return s.label.toLowerCase().includes(f)
                || (s.description || '').toLowerCase().includes(f)
                || keyStr.includes(f)
                || cat.toLowerCase().includes(f);
        });
        if (filtered.length === 0) return '';
        const rows = filtered.map(s => `
            <li class="shortcut-row">
                <div class="shortcut-row-keys">${renderKeyOptions(s.keys)}</div>
                <div class="shortcut-row-text">
                    <div class="shortcut-row-label">${escapeHTML(s.label)}</div>
                    <div class="shortcut-row-desc">${escapeHTML(s.description || '')}</div>
                </div>
            </li>
        `).join('');
        return `
            <section class="shortcut-group">
                <h3 class="shortcut-group-title">${escapeHTML(cat)}</h3>
                <ul class="shortcut-list">${rows}</ul>
            </section>
        `;
    }).join('');
    const body = document.getElementById('shortcut-help-body');
    if (body) body.innerHTML = html || '<p class="shortcut-empty">찾으시는 단축키가 없어요.</p>';
}

export function openShortcutHelp() {
    if (_handle) return;
    const overlay = ensureOverlay();
    renderBody();

    // 닫기 버튼
    const closeBtn = overlay.querySelector('.shortcut-help-close');
    const closeOnce = () => { if (_handle) _handle.close(); };
    closeBtn?.addEventListener('click', closeOnce, { once: true });

    // 검색 입력 — 입력하면 즉시 필터
    const input = overlay.querySelector('#shortcut-help-search-input');
    if (input) {
        input.value = '';
        input.addEventListener('input', () => renderBody(input.value));
    }

    _handle = openModal({
        overlay,
        initialFocus: '#shortcut-help-search-input',
        closeOnBackdrop: true,
        label: 'shortcut-help',
        onClose: () => { _handle = null; },
    });
}

export function closeShortcutHelp() {
    if (_handle) _handle.close();
}

/**
 * Ctrl+/ 단축키가 호출하는 토글 함수. 열려 있으면 닫고, 닫혀 있으면 연다.
 */
export function toggleShortcutHelp() {
    if (_handle) {
        _handle.close();
        return;
    }
    openShortcutHelp();
}
