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

import { saveDot, getAllDots } from '../data/dotsRepo.js';
import { getAllPersons, savePerson } from '../data/personRepo.js';
import { getAllOrganizations, saveOrganization } from '../data/orgRepo.js';
import { getDEK } from './lockScreen.js';
import { personDisplayHtml } from './personNameFormat.js';
import { computeAllPersonStats, computeAllOrgStats } from '../data/cardStats.js';
import { applyDerivedToPerson, applyDerivedToOrg } from '../data/derivedScores.js';
import { getAllCategories, getRecentCategories, pushRecentCategory, addUserCategory, findCategory } from '../data/dotCategories.js';
import { getRatingAxesForCategory, applyRatingLabelsToPerson } from '../data/categoryRatingMap.js';
// Phase F: 거래 라벨 한국어 표시
import { bucketLabel as economyBucketLabel, categoryLabel as economyCategoryLabel } from '../config/economyBuckets.js';

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
// 도트별 인물/조직 만족도 — { [id]: 1-5 } (0이면 미평가)
let _personRatings = {};
let _orgRatings = {};
// 이번 평가 세션 중 stub으로 새로 만든 인물·조직 id 추적 (26번 — 멤버 연결 묻기)
let _newlyCreatedPersonIds = new Set();
let _newlyCreatedOrgIds = new Set();
// 활동 카테고리 (2026-05-12) — 도트 1개당 1개. null 허용.
let _selectedCategoryId = null;
// 인물별 카테고리 평가 라벨 — { personId: [ratingDefId, ...] } (복수 선택)
let _personRatingLabels = {};
let _cachedLoadedFor = null;  // userId — 다른 사용자로 바뀌면 다시 로드

// Phase F: 이번 평가 세션에 이 도트와 함께 추가한 거래 (id + 표시용 메타).
// 도트 저장 시 linkedTransactionIds 에 박힘.
let _addedTransactions = [];

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
    _addedTransactions = []; // 이번 세션에 새로 추가한 거래만 보임 (기존 linked 는 양방향 회차에서)
    _personRatings = (existingDot?.personRatings && typeof existingDot.personRatings === 'object')
        ? { ...existingDot.personRatings } : {};
    _orgRatings    = (existingDot?.orgRatings    && typeof existingDot.orgRatings    === 'object')
        ? { ...existingDot.orgRatings }    : {};

    // 초기화 — existingDot 이 있으면 그 안의 모든 필드를 복원해 사용자가 처음부터 다시
    // 적을 필요 없게. (인라인에서 빠르게 적은 actualTask·만족도·상태도 그대로 보임)
    const modal = document.getElementById('qr-modal');
    modal.classList.remove('hidden');

    const ed = existingDot || null;
    const sat    = ed?.executionSatisfaction ?? 3;
    const outSat = ed?.outcomeSatisfaction   ?? 3;

    document.getElementById('qr-planned-task').textContent = plannedTask || '(따로 계획은 없었어요)';
    // 실제로 한 일 — 인라인에서 적은 게 있으면 그대로, 없으면 plannedTask 자동 채움.
    document.getElementById('qr-actual-input').value = ed?.actualTask || plannedTask || '';
    document.getElementById('qr-reason-input').value = ed?.reason || '';
    document.getElementById('qr-satisfaction').value = String(sat);
    document.getElementById('qr-sat-value').textContent = String(sat);
    document.getElementById('qr-outcome-sat').value = String(outSat);

    // 상태 버튼 — existingDot.executed 와 같은 버튼만 selected
    const restoredStatus = ed?.executed;
    document.querySelectorAll('.qr-status-btn').forEach(btn => {
        btn.classList.toggle('selected', restoredStatus != null && btn.dataset.status === restoredStatus);
    });

    // 라벨 칩 — existingDot.labelIds 에 들어 있는 라벨만 selected
    const restoredLabels = Array.isArray(ed?.labelIds) ? ed.labelIds : [];
    document.querySelectorAll('.qr-label-chip').forEach(chip => {
        chip.classList.toggle('selected', restoredLabels.includes(chip.dataset.label));
    });

    // 활동 카테고리 — existingDot.category 복원
    _selectedCategoryId = ed?.category || null;
    renderCategoryChips();

    // 인물별 5축 평가 라벨 — 매 평가마다 새로 시작 (누적은 그 도트의 영향, 영구 저장은 안 함)
    _personRatingLabels = {};

    // 상세 접기 — 단, 기존 도트에 reason/라벨/만족도≠3 같은 자세한 정보가 있으면 자동으로 펼침
    const hasDetail = !!(ed?.reason || restoredLabels.length > 0
        || (ed?.actualTask && ed.actualTask !== plannedTask)
        || (ed && (sat !== 3 || outSat !== 3))
        || (_selectedPersonIds.length > 0) || (_selectedOrgIds.length > 0));
    const detailSection = document.getElementById('qr-detail-section');
    const detailToggle  = document.getElementById('qr-detail-toggle');
    detailSection.classList.toggle('hidden', !hasDetail);
    detailToggle.textContent = hasDetail ? '접기 ▲' : '조금 더 자세히 ▼';

    // v3: 인물·조직 칩 즉시 한 번 그리고, 백그라운드로 카드 로드 후 datalist 갱신
    renderLinkChips();
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

            <div class="qr-category-row" id="qr-category-row">
                <div class="qr-category-label">이 시간, 어떤 일이었어요?</div>
                <div class="qr-category-chips" id="qr-category-chips"></div>
                <div class="qr-category-add-row qr-ac-wrap">
                    <input type="text" id="qr-category-new" class="qr-text-input"
                           placeholder="새 카테고리 (예: 부업)" autocomplete="off" />
                    <button id="qr-category-add-btn" type="button" class="text-btn">+ 추가</button>
                </div>
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

                <!-- v3: 인물 칩 — 이름/별명 즉석 추가 + 칩별 만족도(5도트) -->
                <div class="qr-link-field">
                    <label><i class="label-icon" data-lucide="users"></i> 함께한 사람</label>
                    <div class="qr-link-add-row qr-ac-wrap">
                        <input type="text" id="qr-person-input" class="qr-text-input"
                               autocomplete="off"
                               placeholder="이름 또는 별명 (예: 박서연, 큰형)" />
                        <button id="qr-person-add" class="text-btn">+ 추가</button>
                        <div id="qr-person-ac" class="qr-ac-panel hidden" role="listbox" aria-label="인물 후보"></div>
                    </div>
                    <div id="qr-person-chips" class="qr-chip-row"></div>
                    <div class="qr-link-hint">없는 이름이면 카드를 자동으로 만들어 드려요. 칩 안 도트를 눌러 1~5점 만족도 평가도 함께 적을 수 있어요.</div>
                </div>

                <!-- v3: 조직 칩 -->
                <div class="qr-link-field">
                    <label><i class="label-icon" data-lucide="building-2"></i> 관련된 조직</label>
                    <div class="qr-link-add-row qr-ac-wrap">
                        <input type="text" id="qr-org-input" class="qr-text-input"
                               autocomplete="off"
                               placeholder="조직 이름 (없으면 자동으로 카드 만들어요)" />
                        <button id="qr-org-add" class="text-btn">+ 추가</button>
                        <div id="qr-org-ac" class="qr-ac-panel hidden" role="listbox" aria-label="조직 후보"></div>
                    </div>
                    <div id="qr-org-chips" class="qr-chip-row"></div>
                </div>

                <!-- 💰 돈 움직임 — Phase F. 이 도트와 함께 거래 한 건도 적기 -->
                <div class="qr-link-section">
                    <label class="qr-link-label">💰 이 시간에 돈이 움직였나요?</label>
                    <button type="button" id="qr-add-tx-btn" class="text-btn">+ 거래 한 건 적기</button>
                    <ul id="qr-tx-list" class="qr-tx-list"></ul>
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

    // 활동 카테고리 칩 — 단일 선택. 같은 칩을 다시 누르면 해제.
    // 카테고리가 바뀌면 인물 칩 아래의 5축 평가 라벨도 그 카테고리에 맞게 다시 그려야 함.
    document.addEventListener('click', (e) => {
        const chip = e.target.closest('.qr-category-chip');
        if (!chip) return;
        const id = chip.dataset.categoryId;
        _selectedCategoryId = (_selectedCategoryId === id) ? null : id;
        renderCategoryChips();
        renderLinkChips();
    });

    // 새 카테고리 추가 (사용자 정의)
    document.addEventListener('click', (e) => {
        if (e.target.id !== 'qr-category-add-btn') return;
        const input = document.getElementById('qr-category-new');
        const label = (input?.value || '').trim();
        if (!label) return;
        const cat = addUserCategory(label);
        if (cat) {
            _selectedCategoryId = cat.id;
            input.value = '';
            renderCategoryChips();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.target.id !== 'qr-category-new') return;
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('qr-category-add-btn')?.click();
        }
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

    // 💰 거래 한 건 추가 (Phase F) — 평가 모달 안에서 economyQuickAdd 호출
    document.addEventListener('click', async (e) => {
        if (e.target.id !== 'qr-add-tx-btn') return;
        const m = await import('./economyQuickAdd.js');
        m.openQuickAdd({
            userId: _currentUserId,
            date: _currentDate || new Date().toISOString().slice(0, 10),
            linkedPersonIds: Array.isArray(_selectedPersonIds) ? _selectedPersonIds.slice() : [],
            linkedOrgIds: Array.isArray(_selectedOrgIds) ? _selectedOrgIds.slice() : [],
            onSaved: (tx) => {
                // 모달 안에 거래 추가 표시 + 도트 저장 시 linkedTransactionIds 에 박을 ID 누적
                _addedTransactions.push(tx);
                renderAddedTransactions();
            },
        });
    });

    // 모달 안의 거래 X 버튼 — 삭제 + 누적 배열에서 제거 + 다른 화면 동기화
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.qr-tx-del-btn');
        if (!btn) return;
        const txId = btn.dataset.id;
        if (!txId) return;
        if (!confirm('이 거래를 지울까요? 되돌릴 수 없어요.')) return;
        try {
            const repo = await import('../data/economyRepo.js');
            await repo.deleteTransaction(_currentUserId, txId);
            _addedTransactions = _addedTransactions.filter(t => t.id !== txId);
            renderAddedTransactions();
            showToast('거래를 지웠어요');
            window.dispatchEvent(new CustomEvent('sanctum:economy-changed', { detail: { type: 'delete', id: txId }}));
        } catch (err) {
            console.error('[quickReview] delete tx failed:', err);
            showToast('지우는 중에 잠깐 막혔어요.');
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
    });
    document.addEventListener('keydown', (e) => {
        if (e.target.id === 'qr-person-input' && e.key === 'Enter') { e.preventDefault(); addPersonFromInput(); }
        if (e.target.id === 'qr-org-input'    && e.key === 'Enter') { e.preventDefault(); addOrgFromInput(); }
        if ((e.target.id === 'qr-person-input' || e.target.id === 'qr-org-input') && e.key === 'Escape') {
            hideAutocompletePanels();
        }
    });

    // 자동완성 — 입력값이 변할 때만 패널 갱신/표시. 빈 값이면 자동 hide.
    document.addEventListener('input', (e) => {
        if (e.target.id === 'qr-person-input') refreshPersonAutocomplete();
        if (e.target.id === 'qr-org-input')    refreshOrgAutocomplete();
    });

    // 자동완성 항목 선택 — 즉시 칩으로 추가
    document.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.qr-ac-item');
        if (!item) return;
        e.preventDefault(); // input blur 방지 → addPerson/Org의 input.value 클리어가 그대로 동작
        const pid = item.dataset.personId;
        const oid = item.dataset.orgId;
        if (pid) {
            const p = _personsCache.find(x => x.id === pid);
            if (p) {
                _selectedPersonIds.push(p.id);
                const input = document.getElementById('qr-person-input');
                if (input) input.value = '';
                renderLinkChips();
                refreshLinkDatalists();
            }
        } else if (oid) {
            const o = _orgsCache.find(x => x.id === oid);
            if (o) {
                _selectedOrgIds.push(o.id);
                const input = document.getElementById('qr-org-input');
                if (input) input.value = '';
                renderLinkChips();
                refreshLinkDatalists();
            }
        }
    });

    // 패널 바깥 클릭 시 자동완성 닫기
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.qr-ac-wrap')) hideAutocompletePanels();
    });
    // 칩 ✕ 제거 (이벤트 위임) — 만족도 점수·라벨도 같이 비움
    document.addEventListener('click', (e) => {
        const x = e.target.closest('.qr-chip-remove');
        if (!x) return;
        // wrap 컨테이너에서 id 추출 (정책 v3 — 인물 칩이 wrap div로 묶여 있음)
        const wrap = x.closest('.qr-link-chip-wrap');
        if (!wrap) return;
        const pid = wrap.dataset.personId;
        const oid = wrap.dataset.orgId;
        if (pid) {
            _selectedPersonIds = _selectedPersonIds.filter(id => id !== pid);
            delete _personRatings[pid];
            delete _personRatingLabels[pid];
        }
        if (oid) {
            _selectedOrgIds = _selectedOrgIds.filter(id => id !== oid);
            delete _orgRatings[oid];
        }
        renderLinkChips();
        refreshLinkDatalists();
    });

    // 5축 평가 라벨 토글 (정책 v3) — 복수 선택 가능
    document.addEventListener('click', (e) => {
        const labelBtn = e.target.closest('.qr-rating-label-chip');
        if (!labelBtn) return;
        const labelsRow = labelBtn.closest('.qr-chip-rating-labels');
        if (!labelsRow) return;
        const pid = labelsRow.dataset.personId;
        const labelId = labelBtn.dataset.ratingId;
        if (!pid || !labelId) return;
        const current = _personRatingLabels[pid] || [];
        if (current.includes(labelId)) {
            _personRatingLabels[pid] = current.filter(x => x !== labelId);
            labelBtn.classList.remove('selected');
        } else {
            _personRatingLabels[pid] = [...current, labelId];
            labelBtn.classList.add('selected');
        }
    });

    // 칩 안 만족도 도트 클릭 — 1~5점 토글. 같은 점수 다시 누르면 0(미평가)로.
    document.addEventListener('click', (e) => {
        const dot = e.target.closest('.qr-chip-rating-dot');
        if (!dot) return;
        e.stopPropagation();
        const container = dot.closest('.qr-chip-rating');
        if (!container) return;
        const target = container.dataset.target;          // 'person' | 'org'
        const id = container.dataset.id;
        const newRating = parseInt(dot.dataset.rating);
        const bag = target === 'person' ? _personRatings : _orgRatings;
        bag[id] = (bag[id] === newRating) ? 0 : newRating;
        if (!bag[id]) delete bag[id];                     // 0이면 미평가 — 키 자체 제거
        renderLinkChips();
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
    // dataset 카멜케이스(dataset.personId) ↔ HTML data-* 속성 매핑은
    // dash-case(data-person-id)를 거쳐야만 한다. 'personId' 같은 카멜케이스를
    // 그대로 속성명에 쓰면 브라우저가 lowercase로 normalize해 dataset 접근이 실패함.
    renderChipRow('qr-person-chips', _selectedPersonIds, _personsCache, 'person-id', '👥', _personRatings, 'person');
    renderChipRow('qr-org-chips',    _selectedOrgIds,    _orgsCache,    'org-id',    '🏢', _orgRatings,    'org');
}

function renderChipRow(rootId, ids, cache, datasetKey, fallbackIcon, ratings, target) {
    const root = document.getElementById(rootId);
    if (!root) return;
    if (!ids.length) { root.innerHTML = ''; return; }
    // 인물일 때만 5축 평가 라벨도 칩 아래에 표시 (정책 v3).
    const axes = (target === 'person') ? getRatingAxesForCategory(_selectedCategoryId) : null;
    root.innerHTML = ids.map(id => {
        const card = cache.find(c => c.id === id);
        const rating = ratings[id] || 0;
        const ratingDots = [1, 2, 3, 4, 5].map(n => `
            <button class="qr-chip-rating-dot${n <= rating ? ' filled' : ''}"
                    type="button" data-rating="${n}"
                    aria-label="${n}점"></button>
        `).join('');
        // 인물: 별명 표기 정책 적용. 조직: 그대로 이름 사용.
        const displayHtml = target === 'person'
            ? personDisplayHtml(card, escapeHtml)
            : escapeHtml(card?.name || '(이름 미상)');

        const ratingLabels = (target === 'person' && axes && axes.length) ? `
            <div class="qr-chip-rating-labels" data-person-id="${escapeAttr(id)}">
                ${axes.map(a => {
                    const selected = (_personRatingLabels[id] || []).includes(a.id);
                    return `<button type="button" class="qr-rating-label-chip ${selected ? 'selected' : ''}" data-rating-id="${escapeAttr(a.id)}">${escapeHtml(a.label)}</button>`;
                }).join('')}
            </div>
        ` : '';

        return `
            <div class="qr-link-chip-wrap" data-${datasetKey}="${escapeAttr(id)}">
                <span class="qr-link-chip">
                    <span class="qr-link-chip-icon">${fallbackIcon}</span>
                    <span class="qr-link-chip-name">${displayHtml}</span>
                    <span class="qr-chip-rating" data-target="${target}" data-id="${escapeAttr(id)}" title="만족도 1~5 (같은 점수 다시 누르면 해제)">${ratingDots}</span>
                    <button class="qr-chip-remove" type="button" aria-label="제거">✕</button>
                </span>
                ${ratingLabels}
            </div>
        `;
    }).join('');
}

/**
 * 자동완성 패널 — 입력값이 비어 있으면 닫고, 있으면 인물·조직 캐시에서
 * 이름/별명 부분일치 후보를 최대 8개 표시. 표기는 "이름 (별명1, 별명2)".
 */
function refreshLinkDatalists() {
    refreshPersonAutocomplete();
    refreshOrgAutocomplete();
}

function refreshPersonAutocomplete() {
    const input = document.getElementById('qr-person-input');
    const panel = document.getElementById('qr-person-ac');
    if (!input || !panel) return;
    const q = (input.value || '').trim().toLowerCase();
    if (!q) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }

    const candidates = _personsCache
        .filter(p => !p.isFallback && !_selectedPersonIds.includes(p.id))
        .filter(p => {
            const name = (p.name || '').toLowerCase();
            if (name.includes(q)) return true;
            return Array.isArray(p.nicknames) && p.nicknames.some(n => (n || '').toLowerCase().includes(q));
        })
        .slice(0, 8);

    if (candidates.length === 0) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }

    panel.innerHTML = candidates.map(p => {
        // 자동완성은 검색용이라 본명·별명을 함께 보여줘야 매칭이 직관적. 본문 표시 규칙은
        // 칩에서만 적용 (innerCircle 아닌 사람은 별명 위주).
        const nicks = Array.isArray(p.nicknames) ? p.nicknames.filter(Boolean) : [];
        const label = nicks.length
            ? `${escapeHtml(p.name || '')} <span class="qr-ac-sub">(${escapeHtml(nicks.join(', '))})</span>`
            : `${escapeHtml(p.name || '')}`;
        return `<button type="button" class="qr-ac-item" data-person-id="${escapeAttr(p.id)}" role="option">${label}</button>`;
    }).join('');
    panel.classList.remove('hidden');
}

function refreshOrgAutocomplete() {
    const input = document.getElementById('qr-org-input');
    const panel = document.getElementById('qr-org-ac');
    if (!input || !panel) return;
    const q = (input.value || '').trim().toLowerCase();
    if (!q) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }

    const candidates = _orgsCache
        .filter(o => !_selectedOrgIds.includes(o.id))
        .filter(o => (o.name || '').toLowerCase().includes(q))
        .slice(0, 8);

    if (candidates.length === 0) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }

    panel.innerHTML = candidates.map(o =>
        `<button type="button" class="qr-ac-item" data-org-id="${escapeAttr(o.id)}" role="option">${escapeHtml(o.name || '')}</button>`
    ).join('');
    panel.classList.remove('hidden');
}

function hideAutocompletePanels() {
    document.getElementById('qr-person-ac')?.classList.add('hidden');
    document.getElementById('qr-org-ac')?.classList.add('hidden');
}

async function addPersonFromInput() {
    const input = document.getElementById('qr-person-input');
    const name = (input?.value || '').trim();
    if (!name) return;

    // 1) 기존 카드와 이름/별명 정확히 일치 → 그 카드 재사용
    let matched = _personsCache.find(p =>
        !p.isFallback && (
            (p.name || '') === name ||
            (Array.isArray(p.nicknames) && p.nicknames.includes(name))
        )
    );

    // 2) 없으면 즉석 stub 카드 생성 — 이름 필드에 입력값(이름 또는 별명) 그대로
    if (!matched) {
        const dek = getDEK();
        if (!dek) { showToast('잠시 잠겨 있어요'); return; }
        const stub = {
            name: name,
            relation: 'unknown',
            innerCircle: false,
            stance: 'neutral',
            isFallback: false,
            nicknames: [],
            bigFive: { O: null, C: null, E: null, A: null, N: null },
            competencies: {},
            relationship: { closeness: null, trust: null, friendliness: null, importance: null },
            stanceHistory: [],
            createdAt: new Date().toISOString(),
        };
        try {
            await savePerson(dek, _currentUserId, stub);
            _personsCache.push(stub);
            matched = stub;
            _newlyCreatedPersonIds.add(stub.id);
            showToast(`✓ "${name}" 카드를 만들었어요. [인물]에서 자세히 채워주세요.`);
        } catch (e) {
            console.error('inline person create failed:', e);
            showToast('카드 만들기가 잠깐 막혔어요.');
            return;
        }
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

async function addOrgFromInput() {
    const input = document.getElementById('qr-org-input');
    const name = (input?.value || '').trim();
    if (!name) return;

    let matched = _orgsCache.find(o => (o.name || '') === name);

    if (!matched) {
        const dek = getDEK();
        if (!dek) { showToast('잠시 잠겨 있어요'); return; }
        const stub = {
            name: name,
            // v5 — multi-select 모델. 인라인 stub은 '방문' 단일 역할로 시작.
            roles: ['visit'],
            type: 'visit', // 구 호환
            activityType: 'none',
            stance: 'neutral',
            friendliness: 3, trust: 3, importance: 3, riskLevel: 1,
            memberPersonIds: [],
            stanceHistory: [],
            createdAt: new Date().toISOString(),
        };
        try {
            await saveOrganization(dek, _currentUserId, stub);
            _orgsCache.push(stub);
            matched = stub;
            _newlyCreatedOrgIds.add(stub.id);
            showToast(`✓ "${name}" 조직 카드를 만들었어요. [조직]에서 자세히 채워주세요.`);
        } catch (e) {
            console.error('inline org create failed:', e);
            showToast('카드 만들기가 잠깐 막혔어요.');
            return;
        }
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

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
function escapeAttr(s) { return escapeHtml(s); }

/**
 * 도트 저장 직전, 이번 세션에서 새로 만든 인물+조직이 모두 있으면
 * 멤버 연결을 한 번 묻는 마이크로 모달. (26번)
 */
async function maybeAskLinkNewMembers() {
    if (_newlyCreatedPersonIds.size === 0 || _newlyCreatedOrgIds.size === 0) return;
    const newPersons = [..._newlyCreatedPersonIds]
        .map(id => _personsCache.find(p => p.id === id))
        .filter(Boolean);
    const newOrgs = [..._newlyCreatedOrgIds]
        .map(id => _orgsCache.find(o => o.id === id))
        .filter(Boolean);
    if (!newPersons.length || !newOrgs.length) return;

    const personList = newPersons.map(p => p.name).join(', ');
    const orgList = newOrgs.map(o => o.name).join(', ');
    const yes = await askYesNo(
        '새 사람을 새 조직 멤버로 연결할까요?',
        `「${personList}」을(를) 「${orgList}」 멤버로 추가해 두면 다음에 만남이 일어날 때 자연히 떠올라요.`
    );
    if (!yes) return;

    const dek = getDEK();
    if (!dek) return;
    for (const org of newOrgs) {
        const ids = Array.isArray(org.memberPersonIds) ? org.memberPersonIds : [];
        newPersons.forEach(p => { if (!ids.includes(p.id)) ids.push(p.id); });
        org.memberPersonIds = ids;
        try { await saveOrganization(dek, _currentUserId, org); }
        catch (e) { console.warn('link new members failed:', e); }
    }
}

/**
 * 디자인 시스템 톤의 예/아니오 모달. native confirm 대체.
 * @returns Promise<boolean>
 */
function askYesNo(title, body) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'qr-mini-confirm-overlay';
        overlay.innerHTML = `
            <div class="qr-mini-confirm-box" role="dialog" aria-modal="true">
                <h4 class="qr-mini-confirm-title">${escapeHtml(title)}</h4>
                <p class="qr-mini-confirm-body">${escapeHtml(body)}</p>
                <div class="qr-mini-confirm-actions">
                    <button type="button" class="text-btn" data-no>아니오</button>
                    <button type="button" class="primary-btn" data-yes>예, 연결할게요</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('[data-yes]')?.addEventListener('click', () => close(true));
        overlay.querySelector('[data-no]')?.addEventListener('click', () => close(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    });
}

/**
 * 도트 저장 직후 — 그 도트와 엮인 인물·조직의 unlocked 점수축을 derived 값으로 갱신.
 * 누적 만족도 평균을 다시 계산하기 위해 사용자의 전체 도트를 한 번 로드한다.
 * (도트는 일반적으로 그렇게 크지 않아 한 번의 풀 fetch는 허용 가능한 비용.)
 */
async function refreshDerivedScoresFor(dek, personIds, orgIds) {
    const pIds = (personIds || []).filter(Boolean);
    const oIds = (orgIds || []).filter(Boolean);
    if (pIds.length === 0 && oIds.length === 0) return;

    const dots = await getAllDots(dek, _currentUserId);
    const personStats = computeAllPersonStats(dots);
    const orgStats = computeAllOrgStats(dots);

    // 인물 갱신 — 5축 라벨 가중치만 사용 (정책 v3).
    // 만족도 평균 기반 거친 derived 갱신은 라벨 효과를 덮어버려 제거.
    for (const pid of pIds) {
        const p = _personsCache.find(x => x.id === pid);
        if (!p) continue;
        const labels = _personRatingLabels[pid] || [];
        const changed = applyRatingLabelsToPerson(p, labels);
        if (changed) {
            try { await savePerson(dek, _currentUserId, p); }
            catch (e) { console.warn('person derived save failed:', pid, e); }
        }
    }
    // 조직 갱신
    for (const oid of oIds) {
        const o = _orgsCache.find(x => x.id === oid);
        if (!o) continue;
        const changed = applyDerivedToOrg(o, orgStats.get(oid) || null);
        if (changed) {
            try { await saveOrganization(dek, _currentUserId, o); }
            catch (e) { console.warn('org derived save failed:', oid, e); }
        }
    }
}

/**
 * 카테고리 칩 행 렌더 — 최근 사용 우선, 그 다음 프리셋, 마지막 사용자 정의.
 * _selectedCategoryId 가 active.
 */
function renderCategoryChips() {
    const root = document.getElementById('qr-category-chips');
    if (!root) return;
    const all = getAllCategories();
    const recent = getRecentCategories(4).map(id => all.find(c => c.id === id)).filter(Boolean);
    const rest = all.filter(c => !recent.some(r => r.id === c.id));
    const ordered = [...recent, ...rest];
    root.innerHTML = ordered.map(c => `
        <button type="button" class="qr-category-chip ${c.id === _selectedCategoryId ? 'selected' : ''}"
                data-category-id="${escapeAttr(c.id)}">
            <span class="qr-cat-icon">${c.icon || '🏷️'}</span>
            <span class="qr-cat-label">${escapeHtml(c.label)}</span>
        </button>
    `).join('');
}

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

    // 새 인물·새 조직이 한 번에 추가됐다면 멤버 연결 묻기 (26번).
    // 저장 흐름을 막지 않도록 도트 저장 전에 한 번만 실행.
    try { await maybeAskLinkNewMembers(); } catch (e) { console.warn(e); }

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
            personRatings: { ..._personRatings },
            orgRatings: { ..._orgRatings },
            linkedTransactionIds: [
                ...(_currentExistingDot?.linkedTransactionIds || []),
                ..._addedTransactions.map(t => t.id),
            ],
            category: _selectedCategoryId || null,
            // 정직성 인프라: 모달에서 사용자가 직접 입력한 도트 — self_report 명시.
            // 기존 도트 수정 시엔 옛 source 보존 (있다면), 없으면 self_report 로 시작.
            source: _currentExistingDot?.source || 'self_report',
        };
        if (_selectedCategoryId) pushRecentCategory(_selectedCategoryId);
        // 기존 도트가 있으면 id 유지하여 덮어쓰기
        if (_currentExistingDot?.id) dotData.id = _currentExistingDot.id;

        await saveDot(dek, dotData);

        // Phase F: 이번 세션에 추가한 거래들에 linkedDotId reverse 박기.
        // saveDot 후 dotData.id 가 확정 (userId_date_timeSlot). 거래는 merge 저장이라
        // 기존 다른 필드는 그대로 두고 linkedDotId 만 patch.
        if (_addedTransactions.length > 0) {
            try {
                const econRepo = await import('../data/economyRepo.js');
                for (const tx of _addedTransactions) {
                    if (tx.linkedDotId === dotData.id) continue;
                    await econRepo.saveTransaction(dek, _currentUserId, {
                        ...tx,
                        linkedDotId: dotData.id,
                        linkedPersonIds: dotData.linkedPersonIds.slice(),
                        linkedOrgIds:    dotData.linkedOrgIds.slice(),
                    });
                }
            } catch (e) { console.warn('[quickReview] tx linkedDotId reverse failed:', e); }
        }

        // 새 정책(2026-05-12): 도트 저장 직후 그 도트와 엮인 인물·조직의 unlocked 점수축을
        // 도트 누적 만족도 기준으로 자동 갱신. 실패해도 도트 저장 자체는 성공이므로 try/catch.
        try {
            await refreshDerivedScoresFor(dek, dotData.linkedPersonIds, dotData.linkedOrgIds);
        } catch (e) { console.warn('derived score refresh failed:', e); }

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

function renderAddedTransactions() {
    const ul = document.getElementById('qr-tx-list');
    if (!ul) return;
    if (_addedTransactions.length === 0) {
        ul.innerHTML = '';
        return;
    }
    ul.innerHTML = _addedTransactions.map(t => {
        const sign = t.direction === 'income' ? '+' : '−';
        const exact = t.exactAmount != null
            ? `<span class="sensitive qr-tx-exact">${sign}${Number(t.exactAmount).toLocaleString('ko-KR')}원</span>`
            : '';
        return `
            <li class="qr-tx-item">
                <span class="qr-tx-bucket econ-bucket-${escapeAttr(t.amountBucket || 'small')}">${escapeHtml(economyBucketLabel(t.amountBucket) || '')}</span>
                <span class="qr-tx-cat">${escapeHtml(economyCategoryLabel(t.category) || '')}</span>
                <span class="qr-tx-desc">${escapeHtml(t.description || '')}</span>
                ${exact}
                <button type="button" class="qr-tx-del-btn text-btn" data-id="${escapeAttr(t.id)}" title="지우기" aria-label="거래 지우기">×</button>
            </li>
        `;
    }).join('');
}

function closeModal() {
    // 다음 평가 세션에서 묻기 새로 시작
    _newlyCreatedPersonIds.clear();
    _newlyCreatedOrgIds.clear();
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
