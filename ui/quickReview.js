/**
 * quickReview.js — 3초 평가 모달 v3 (v3-①-E QuickEvalV3)
 *
 * 기본 모드: 4큰버튼 + 만족도 슬라이더 1개 + 라벨 칩
 * "자세히" 토글: 실제 작업, 결과 만족도, 한 줄 이유, 👥 인물 / 🏢 조직 칩, 🌟 AI 브리핑
 * 키보드 단축키: 1~4 상태, 5~9 만족도, Enter 저장
 *
 * v3 확장:
 *  - 👥 인물 칩: 평가하는 시간 슬롯에 함께한 사람들을 인물 카드와 연결
 *    → 도트의 linkedPersonIds에 저장 → 인물 카드의 lastInteractionAt이 갱신됨
 *  - 🏢 조직 칩: 같은 흐름으로 linkedOrgIds 저장
 *  - 🌟 AI 브리핑 패널: 4섹션 (관련 원칙 / 지난 패턴 / 주의할 점 / 묵상 점검)
 *    → callLLM('briefing', ...) 호출 전 가명화 (P_001/O_001/L_001)
 */

import { saveDot } from '../data/dotsRepo.js';
import { getAllPersons } from '../data/personRepo.js';
import { getAllOrganizations } from '../data/orgRepo.js';
import { getDEK } from './lockScreen.js';

let _currentSlot = null;
let _currentCells = [];
let _currentUserId = null;
let _currentDate = null;
let _currentDecisionId = null;
let _currentExistingDot = null;
let _onSaved = null;

// v3 확장: 인물·조직 카드 캐시 + 현재 선택 상태
let _personsCache = [];   // [{id, name, ...}]
let _orgsCache = [];      // [{id, name, ...}]
let _selectedPersonIds = [];
let _selectedOrgIds = [];
let _cachedLoadedFor = null;  // userId — 다른 사용자로 바뀌면 다시 로드

const STATUS_OPTIONS = [
    { key: 'done', emoji: '😀', label: '잘 했어요', shortcut: '1' },
    { key: 'partial', emoji: '🙂', label: '조금 했어요', shortcut: '2' },
    { key: 'replaced', emoji: '🔄', label: '다른 걸 했어요', shortcut: '3' },
    { key: 'skipped', emoji: '😣', label: '못 했어요', shortcut: '4' },
];

/**
 * 모달 초기화 (앱 시작 시 1회)
 */
export function initQuickReview({ onSaved }) {
    _onSaved = onSaved;
    renderModal();
    bindEvents();
}

/**
 * 모달 열기
 */
export function openQuickReview({ timeSlot, cells, userId, date, plannedTask, decisionId, existingDot }) {
    _currentSlot = timeSlot;
    _currentCells = cells || [timeSlot];
    _currentUserId = userId;
    _currentDate = date;
    _currentDecisionId = decisionId || null;
    _currentExistingDot = existingDot || null;

    // 기존 도트가 있으면 그 안의 연결을 복원, 없으면 빈 배열
    _selectedPersonIds = Array.isArray(existingDot?.linkedPersonIds) ? existingDot.linkedPersonIds.slice() : [];
    _selectedOrgIds    = Array.isArray(existingDot?.linkedOrgIds)    ? existingDot.linkedOrgIds.slice()    : [];

    // 초기화
    const modal = document.getElementById('qr-modal');
    modal.classList.remove('hidden');

    document.getElementById('qr-planned-task').textContent = plannedTask || '(따로 계획은 없었어요)';
    document.getElementById('qr-actual-input').value = plannedTask || '';
    document.getElementById('qr-reason-input').value = '';
    document.getElementById('qr-satisfaction').value = '3';
    document.getElementById('qr-sat-value').textContent = '3';
    document.getElementById('qr-outcome-sat').value = '3';

    // 상태 버튼 초기화
    document.querySelectorAll('.qr-status-btn').forEach(btn => btn.classList.remove('selected'));

    // 라벨 칩 초기화
    document.querySelectorAll('.qr-label-chip').forEach(chip => chip.classList.remove('selected'));

    // 상세 접기
    document.getElementById('qr-detail-section').classList.add('hidden');
    document.getElementById('qr-detail-toggle').textContent = '조금 더 자세히 ▼';

    // v3: 인물·조직 칩 즉시 한 번 그리고, 백그라운드로 카드 로드 후 datalist 갱신
    renderLinkChips();
    resetBriefingPanel();
    ensurePersonsAndOrgsLoaded(userId).then(() => {
        renderLinkChips();
        refreshLinkDatalists();
    }).catch(e => console.warn('persons/orgs load failed:', e));

    // 포커스
    setTimeout(() => document.querySelector('.qr-status-btn')?.focus(), 100);
}

/**
 * 사용자별 인물·조직 카드 1회 로드 (모달 진입 시).
 * 이후 같은 사용자 세션이면 캐시 재사용.
 */
async function ensurePersonsAndOrgsLoaded(userId) {
    if (_cachedLoadedFor === userId && _personsCache.length + _orgsCache.length > 0) return;
    const dek = getDEK();
    if (!dek) return;
    const [persons, orgs] = await Promise.all([
        getAllPersons(dek, userId).catch(() => []),
        getAllOrganizations(dek, userId).catch(() => []),
    ]);
    _personsCache = persons || [];
    _orgsCache = orgs || [];
    _cachedLoadedFor = userId;
}

function renderModal() {
    if (document.getElementById('qr-modal')) return;

    const labelAxes = {
        spiritual: ['평안함', '감사함', '메마름', '갈등함'],
        energy: ['활력', '보통', '피로', '소진'],
        cognitive: ['집중', '산만', '창의적', '루틴적'],
    };

    const modal = document.createElement('div');
    modal.id = 'qr-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
        <div class="modal-content qr-modal-content">
            <div class="qr-header">
                <h3>이 시간, 어땠나요?</h3>
                <span id="qr-planned-task" class="qr-planned-label"></span>
            </div>

            <div class="qr-status-row">
                ${STATUS_OPTIONS.map(s => `
                    <button class="qr-status-btn" data-status="${s.key}" title="단축키 ${s.shortcut}">
                        <span class="qr-status-emoji">${s.emoji}</span>
                        <span class="qr-status-text">${s.label}</span>
                        <span class="qr-status-key">${s.shortcut}</span>
                    </button>
                `).join('')}
            </div>

            <div class="qr-slider-row">
                <label>얼마나 만족?</label>
                <input type="range" id="qr-satisfaction" min="1" max="5" value="3" class="neon-slider-light" />
                <span id="qr-sat-value" class="qr-sat-display">3</span>
            </div>

            <div class="qr-labels-row">
                ${Object.values(labelAxes).map(labels =>
                    labels.map(l => `<button class="qr-label-chip" data-label="${l}">${l}</button>`).join('')
                ).join('')}
            </div>

            <button id="qr-detail-toggle" class="qr-toggle-btn">조금 더 자세히 ▼</button>

            <div id="qr-detail-section" class="qr-detail hidden">
                <div class="qr-field">
                    <label>실제로 한 일</label>
                    <input type="text" id="qr-actual-input" class="qr-text-input" placeholder="이 시간에 진짜 뭘 했어요?" />
                </div>
                <div class="qr-slider-row">
                    <label>결과는?</label>
                    <input type="range" id="qr-outcome-sat" min="1" max="5" value="3" class="neon-slider-dark" />
                </div>
                <div class="qr-field">
                    <label>이유 한 줄</label>
                    <input type="text" id="qr-reason-input" class="qr-text-input" placeholder="왜 이렇게 됐을까요?" />
                </div>

                <!-- v3: 인물 칩 -->
                <div class="qr-link-field">
                    <label><i class="label-icon" data-lucide="users"></i> 함께한 사람</label>
                    <div class="qr-link-add-row">
                        <input type="text" id="qr-person-input" class="qr-text-input"
                               list="qr-person-datalist"
                               placeholder="이름 입력 후 Enter / [+ 추가]" />
                        <datalist id="qr-person-datalist"></datalist>
                        <button id="qr-person-add" class="text-btn">+ 추가</button>
                    </div>
                    <div id="qr-person-chips" class="qr-chip-row"></div>
                    <div class="qr-link-hint">아직 등록 안 된 사람이면 [인물] 메뉴에서 카드부터 만들어 주세요.</div>
                </div>

                <!-- v3: 조직 칩 -->
                <div class="qr-link-field">
                    <label><i class="label-icon" data-lucide="building-2"></i> 관련된 조직</label>
                    <div class="qr-link-add-row">
                        <input type="text" id="qr-org-input" class="qr-text-input"
                               list="qr-org-datalist"
                               placeholder="조직 이름 입력 후 Enter / [+ 추가]" />
                        <datalist id="qr-org-datalist"></datalist>
                        <button id="qr-org-add" class="text-btn">+ 추가</button>
                    </div>
                    <div id="qr-org-chips" class="qr-chip-row"></div>
                </div>

                <!-- v3: AI 브리핑 패널 -->
                <div class="qr-briefing-field">
                    <button id="qr-briefing-btn" class="text-btn qr-briefing-btn"><i data-lucide="sparkles" class="btn-icon"></i> AI 브리핑 보기</button>
                    <div id="qr-briefing-panel" class="qr-briefing-panel hidden"></div>
                </div>
            </div>

            <div class="qr-actions">
                <button id="qr-cancel-btn" class="text-btn">닫기</button>
                <button id="qr-save-btn" class="primary-btn">저장하기</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function bindEvents() {
    // 상태 버튼
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.qr-status-btn');
        if (btn) {
            document.querySelectorAll('.qr-status-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        }
    });

    // 라벨 칩 토글
    document.addEventListener('click', (e) => {
        const chip = e.target.closest('.qr-label-chip');
        if (chip) chip.classList.toggle('selected');
    });

    // 만족도 슬라이더
    document.addEventListener('input', (e) => {
        if (e.target.id === 'qr-satisfaction') {
            document.getElementById('qr-sat-value').textContent = e.target.value;
        }
    });

    // 자세히 토글
    document.addEventListener('click', (e) => {
        if (e.target.id === 'qr-detail-toggle') {
            const section = document.getElementById('qr-detail-section');
            const isHidden = section.classList.toggle('hidden');
            e.target.textContent = isHidden ? '조금 더 자세히 ▼' : '접기 ▲';
        }
    });

    // 저장
    document.addEventListener('click', (e) => {
        if (e.target.id === 'qr-save-btn') handleSave();
        if (e.target.id === 'qr-cancel-btn') closeModal();
    });

    // 모달 배경 클릭 닫기
    document.addEventListener('click', (e) => {
        if (e.target.id === 'qr-modal') closeModal();
    });

    // v3: 인물 칩 — 추가
    document.addEventListener('click', (e) => {
        if (e.target.id === 'qr-person-add') addPersonFromInput();
        if (e.target.id === 'qr-org-add') addOrgFromInput();
        if (e.target.id === 'qr-briefing-btn') toggleBriefing();
    });
    document.addEventListener('keydown', (e) => {
        if (e.target.id === 'qr-person-input' && e.key === 'Enter') { e.preventDefault(); addPersonFromInput(); }
        if (e.target.id === 'qr-org-input'    && e.key === 'Enter') { e.preventDefault(); addOrgFromInput(); }
    });
    // 칩 ✕ 제거 (이벤트 위임)
    document.addEventListener('click', (e) => {
        const x = e.target.closest('.qr-chip-remove');
        if (!x) return;
        const chip = x.closest('.qr-link-chip');
        if (!chip) return;
        const pid = chip.dataset.personId;
        const oid = chip.dataset.orgId;
        if (pid) _selectedPersonIds = _selectedPersonIds.filter(id => id !== pid);
        if (oid) _selectedOrgIds = _selectedOrgIds.filter(id => id !== oid);
        renderLinkChips();
        refreshLinkDatalists();
    });

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('qr-modal');
        if (!modal || modal.classList.contains('hidden')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key >= '1' && e.key <= '4') {
            const idx = parseInt(e.key) - 1;
            const btns = document.querySelectorAll('.qr-status-btn');
            btns.forEach(b => b.classList.remove('selected'));
            btns[idx]?.classList.add('selected');
            e.preventDefault();
        }
        if (e.key >= '5' && e.key <= '9') {
            const val = parseInt(e.key) - 4; // 5→1, 6→2, ..., 9→5
            document.getElementById('qr-satisfaction').value = val;
            document.getElementById('qr-sat-value').textContent = val;
            e.preventDefault();
        }
        if (e.key === 'Enter') {
            handleSave();
            e.preventDefault();
        }
        if (e.key === 'Escape') {
            closeModal();
            e.preventDefault();
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  v3: 인물·조직 칩 + AI 브리핑 헬퍼
// ═══════════════════════════════════════════════════════════════════════

function renderLinkChips() {
    renderChipRow('qr-person-chips', _selectedPersonIds, _personsCache, 'personId', '👥');
    renderChipRow('qr-org-chips',    _selectedOrgIds,    _orgsCache,    'orgId',    '🏢');
}

function renderChipRow(rootId, ids, cache, datasetKey, fallbackIcon) {
    const root = document.getElementById(rootId);
    if (!root) return;
    if (!ids.length) { root.innerHTML = ''; return; }
    root.innerHTML = ids.map(id => {
        const card = cache.find(c => c.id === id);
        const name = card?.name || '(미등록)';
        return `
            <span class="qr-link-chip" data-${datasetKey}="${escapeAttr(id)}">
                <span class="qr-link-chip-icon">${fallbackIcon}</span>
                <span class="qr-link-chip-name">${escapeHtml(name)}</span>
                <button class="qr-chip-remove" type="button" aria-label="제거">✕</button>
            </span>
        `;
    }).join('');
}

function refreshLinkDatalists() {
    const personDl = document.getElementById('qr-person-datalist');
    if (personDl) {
        personDl.innerHTML = _personsCache
            .filter(p => !p.isFallback && !_selectedPersonIds.includes(p.id))
            .map(p => `<option value="${escapeAttr(p.name || '')}"></option>`)
            .join('');
    }
    const orgDl = document.getElementById('qr-org-datalist');
    if (orgDl) {
        orgDl.innerHTML = _orgsCache
            .filter(o => !_selectedOrgIds.includes(o.id))
            .map(o => `<option value="${escapeAttr(o.name || '')}"></option>`)
            .join('');
    }
}

function addPersonFromInput() {
    const input = document.getElementById('qr-person-input');
    const name = (input?.value || '').trim();
    if (!name) return;
    const matched = _personsCache.find(p => (p.name || '') === name && !p.isFallback);
    if (!matched) {
        showToast('인물 카드에 없는 이름이에요. [👥 인물]에서 먼저 추가해 주실래요?');
        return;
    }
    if (_selectedPersonIds.includes(matched.id)) {
        showToast('이미 추가된 사람이에요');
        return;
    }
    _selectedPersonIds.push(matched.id);
    input.value = '';
    renderLinkChips();
    refreshLinkDatalists();
}

function addOrgFromInput() {
    const input = document.getElementById('qr-org-input');
    const name = (input?.value || '').trim();
    if (!name) return;
    const matched = _orgsCache.find(o => (o.name || '') === name);
    if (!matched) {
        showToast('조직 카드에 없는 이름이에요. [🏢 조직]에서 먼저 추가해 주실래요?');
        return;
    }
    if (_selectedOrgIds.includes(matched.id)) {
        showToast('이미 추가된 조직이에요');
        return;
    }
    _selectedOrgIds.push(matched.id);
    input.value = '';
    renderLinkChips();
    refreshLinkDatalists();
}

function resetBriefingPanel() {
    const panel = document.getElementById('qr-briefing-panel');
    if (panel) {
        panel.innerHTML = '';
        panel.classList.add('hidden');
    }
    const btn = document.getElementById('qr-briefing-btn');
    if (btn) btn.textContent = '🌟 AI 브리핑 보기';
}

let _briefingLoading = false;
async function toggleBriefing() {
    const panel = document.getElementById('qr-briefing-panel');
    const btn = document.getElementById('qr-briefing-btn');
    if (!panel || !btn) return;

    // 이미 펼쳐져 있으면 접기
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        btn.innerHTML = '<i data-lucide="sparkles" class="btn-icon"></i> AI 브리핑 보기';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    // 이미 내용이 있으면 다시 펼치기
    if (panel.dataset.loaded === '1') {
        panel.classList.remove('hidden');
        btn.innerHTML = '<i data-lucide="sparkles" class="btn-icon"></i> AI 브리핑 접기';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    if (_briefingLoading) return;
    _briefingLoading = true;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="sparkles" class="btn-icon"></i> 불러오는 중…';
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="qr-briefing-loading">잠깐만요, AI 브리핑을 준비하고 있어요…</div>';
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();

    try {
        const taskText = (document.getElementById('qr-actual-input')?.value
            || document.getElementById('qr-planned-task')?.textContent
            || '').trim();
        // 가명화에 쓸 context — 칩으로 선택된 카드의 이름들
        const personNames = _selectedPersonIds
            .map(id => _personsCache.find(p => p.id === id)?.name)
            .filter(Boolean);
        const orgNames = _selectedOrgIds
            .map(id => _orgsCache.find(o => o.id === id)?.name)
            .filter(Boolean);

        const { getBriefingForTask } = await import('./aiClient.js');
        const result = await getBriefingForTask(
            taskText,
            [],                                  // principles: 핀 원칙 연동은 다음 STEP
            {},                                  // pastStats
            { persons: personNames, orgs: orgNames }
        );
        panel.innerHTML = briefingHtml(result.sections, result.fallback);
        panel.dataset.loaded = '1';
        btn.innerHTML = '<i data-lucide="sparkles" class="btn-icon"></i> AI 브리핑 접기';
    } catch (e) {
        console.warn('briefing failed:', e);
        panel.innerHTML = '<div class="qr-briefing-loading">잠깐 막혔어요. 다시 한 번 눌러 주실래요?</div>';
        btn.innerHTML = '<i data-lucide="sparkles" class="btn-icon"></i> AI 브리핑 보기';
    } finally {
        _briefingLoading = false;
        btn.disabled = false;
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    }
}

function briefingHtml(sections, fallback) {
    // s.icon은 Lucide name (aiClient에서 book-open / bar-chart-3 / alert-triangle / hand / sparkles 등)
    const items = (sections || []).map(s => `
        <div class="qr-briefing-card">
            <div class="qr-briefing-card-head">
                <i class="qr-briefing-icon" data-lucide="${escapeAttr(s.icon || 'sparkles')}"></i>
                <span class="qr-briefing-title">${escapeHtml(s.title || '')}</span>
            </div>
            <div class="qr-briefing-body">${escapeHtml(s.body || '').replace(/\n/g, '<br>')}</div>
        </div>
    `).join('');
    const tag = fallback
        ? '<div class="qr-briefing-fallback-tag"><i data-lucide="alert-triangle" class="btn-icon"></i> 인터넷이 멀거나 AI가 잠시 쉬는 중이에요 — 로컬 안내로 대체했어요.</div>'
        : '';
    return `${tag}<div class="qr-briefing-grid">${items}</div>`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
function escapeAttr(s) { return escapeHtml(s); }

async function handleSave() {
    const dek = getDEK();
    if (!dek) return;

    const statusBtn = document.querySelector('.qr-status-btn.selected');
    const executed = statusBtn?.dataset.status || 'done';
    const satisfaction = parseInt(document.getElementById('qr-satisfaction').value);
    const outcomeSat = parseInt(document.getElementById('qr-outcome-sat').value);
    const actualTask = document.getElementById('qr-actual-input').value;
    const reason = document.getElementById('qr-reason-input').value;

    const labels = [];
    document.querySelectorAll('.qr-label-chip.selected').forEach(c => {
        labels.push(c.dataset.label);
    });

    const btn = document.getElementById('qr-save-btn');
    btn.textContent = '저장하는 중...';
    btn.disabled = true;

    try {
        const planned = document.getElementById('qr-planned-task').textContent;
        const dotData = {
            userId: _currentUserId,
            date: _currentDate,
            timeSlot: _currentSlot,
            executed,
            executionSatisfaction: satisfaction,
            outcomeSatisfaction: outcomeSat,
            plannedTask: planned,
            // 사용자 신고: ✅완료일 때 plannedTask가 actualTask로 자동 복사
            actualTask: actualTask || (executed === 'done' ? planned : ''),
            reason,
            labelIds: labels,
            // 미래 슬롯 예약(STEP 0/1 단계에선 빈 배열로 두기)
            linkedScriptureId: _currentExistingDot?.linkedScriptureId || null,
            linkedGoalId: _currentExistingDot?.linkedGoalId || null,
            linkedPersonIds: _selectedPersonIds.slice(),
            linkedOrgIds: _selectedOrgIds.slice(),
            linkedTransactionIds: _currentExistingDot?.linkedTransactionIds || [],
        };
        // 기존 도트가 있으면 id 유지하여 덮어쓰기
        if (_currentExistingDot?.id) dotData.id = _currentExistingDot.id;

        await saveDot(dek, dotData);

        // 토스트
        showToast('🔐 안전하게 보관됐어요');
        closeModal();
        if (_onSaved) _onSaved({ decisionId: _currentDecisionId });
    } catch (e) {
        console.error('Save dot error:', e);
        btn.textContent = '저장하기';
        btn.disabled = false;
        showToast('저장이 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
    }
}

function closeModal() {
    const modal = document.getElementById('qr-modal');
    if (modal) modal.classList.add('hidden');
    const btn = document.getElementById('qr-save-btn');
    if (btn) { btn.textContent = '저장하기'; btn.disabled = false; }
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'sanctum-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 1000);
}

export { showToast };
