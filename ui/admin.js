/**
 * admin.js — 운영자 페이지 (Swan 관리자 단독 진입점)
 *
 * (2026-05-18 후속) 사용자 명시:
 *   "사이드 메뉴로 운영자 하나 추가, 거기 들어가면 바로 피드백 관리, 슬림/메인 변환 모드 보이게"
 *
 * 구조:
 *   - 카드 1: 🌱 슬림 ↔ 메인 모드 토글 (즉시 적용)
 *   - 카드 2: 📋 피드백 관리 — 클릭 시 view-feedback-admin 진입
 *
 * isSwanAdmin 일 때만 nav-admin 노출됨. 본 함수는 sanity check 없이 동작.
 */

import { getTier, setTier, TIERS } from '../config/featureFlags.js';

export function renderAdminView(container) {
    if (!container) return;
    container.innerHTML = `
        <header class="page-header">
            <h1>🛠 운영자</h1>
        </header>

        <section class="card-section admin-card">
            <h3 class="section-title"><i class="section-icon" data-lucide="layers"></i> 모드 전환</h3>
            <p class="section-desc">슬림(베타 6 화면)과 메인(전체 모듈) 사이를 자유롭게 오갈 수 있어요. 사용자에게 어떤 모드로 보일지 직접 확인하실 수 있어요.</p>
            <div id="admin-tier-row" class="settings-tier-row"></div>
        </section>

        <section class="card-section admin-card">
            <h3 class="section-title"><i class="section-icon" data-lucide="inbox"></i> 피드백 관리</h3>
            <p class="section-desc">사용자가 우하단 풍선으로 보내준 피드백·사전 설문·사후 설문을 한 자리에서 관리해요.</p>
            <button type="button" id="admin-open-feedback-btn" class="primary-btn">
                <i data-lucide="arrow-right" class="btn-icon"></i> 피드백 관리 열기
            </button>
        </section>
    `;

    // 모드 전환 — settings 의 bindTierSettings 와 같은 패턴
    const row = container.querySelector('#admin-tier-row');
    if (row) {
        const current = getTier();
        row.innerHTML = Object.entries(TIERS).map(([id, cfg]) => `
            <button type="button"
                    class="settings-tier-chip"
                    role="radio"
                    aria-checked="${current === id ? 'true' : 'false'}"
                    data-tier="${id}">
                <span class="settings-tier-chip-label">${escapeText(cfg.label)}</span>
                <span class="settings-tier-chip-desc">${escapeText(cfg.desc)}</span>
            </button>
        `).join('');
        row.querySelectorAll('.settings-tier-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.tier;
                if (!TIERS[id]) return;
                setTier(id);
                row.querySelectorAll('.settings-tier-chip').forEach(b => {
                    b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
                });
            });
        });
    }

    // 피드백 관리 진입
    const openBtn = container.querySelector('#admin-open-feedback-btn');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            try {
                if (typeof window.__sanctumSwitchView === 'function') {
                    window.__sanctumSwitchView('feedback-admin');
                }
            } catch (e) { console.warn('[admin] open feedback-admin failed:', e); }
        });
    }

    // lucide 아이콘 재렌더 — switchView 직후 createIcons 호출 자리 정합
    try { if (window.lucide) window.lucide.createIcons(); } catch (_) {}
}

function escapeText(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
