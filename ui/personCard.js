/**
 * personCard.js — v3-①-B: 인물 카드 UI
 *
 * 구성:
 *   1) 목록 그리드: stance 필터 칩 + 검색 + 카드 그리드 (mini Big Five 막대)
 *   2) 상세 모달: 4-층 프로파일 편집기
 *      Layer 1 정체성  - 이름, 별명, 관계, 내사람
 *      Layer 2 Big Five - 5축 5단 슬라이더 + "모르겠어요"
 *      Layer 3 능력 스탯 - v3 표준 8개 + 사용자 정의
 *      Layer 4 관계     - 친밀/신뢰/우호/중요 1~5 별점 + stance(읽기 전용)
 *      + 의미 있는 말씀 / 메모
 *   3) SVG 레이더: 의존성 없이 직접 그리는 5각형 (200x200)
 *
 * 영적 안전장치 (이 STEP 적용분):
 *   - bigFive/competencies 모두 null 허용 — "모르겠어요"는 정직한 답.
 *   - stance 변경은 비활성 (v3-①-F의 30초 기도 게이트 도입 후 활성).
 *   - meaningfulVerse 입력 칸 노출 (이 사람을 위한 말씀).
 *
 * 자동 암호화: personRepo.savePerson → encryptionPolicy.persons 정책에 따라 처리.
 */

import { savePerson, getAllPersons, deletePerson, changeStance } from '../data/personRepo.js';
import { getAllOrganizations } from '../data/orgRepo.js';
import { getAllDots } from '../data/dotsRepo.js';
import { computeAllPersonStats, formatMinutes, formatTrend, slotToTimeStr, ratingDotsHtml } from '../data/cardStats.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
import { openStanceGate } from './stanceGate.js';
import { personDisplayHtml } from './personNameFormat.js';

// 조직 type 메타 (소속 조직 칩 표시용)
const ORG_TYPE_ICONS = {
    company: '🏢', church: '⛪', team: '👥',
    community: '🌐', family: '👨‍👩‍👧', other: '📦',
};

/**
 * 인물 표시 이름 — 새 정책(2026-05-12)으로 위임.
 * personNameFormat.personDisplayText: innerCircle이면 본명, 그 외에 별명이 있으면 "큰형 (별명)" 형식.
 * 외부 import 호환을 위해 함수 시그니처는 유지.
 */
export { personDisplayText as displayPersonName } from './personNameFormat.js';

// ─── 상수 ───
const STANCE_META = {
    ally:      { label: '우호', color: 'var(--dot-green)',  icon: '🤝' },
    neutral:   { label: '중립', color: 'var(--dot-gray)',   icon: '➖' },
    caution:   { label: '주의', color: 'var(--dot-orange)', icon: '⚠️' },
    adversary: { label: '적대', color: 'var(--dot-red)',    icon: '⚡' },
};

const STANCE_FILTERS = [
    { key: 'all',         label: '전체' },
    { key: 'innerCircle', label: '👨‍👩‍👧 내 사람' },
    { key: 'ally',        label: '🤝 우호' },
    { key: 'neutral',     label: '➖ 중립' },
    { key: 'caution',     label: '⚠️ 주의' },
    { key: 'adversary',   label: '⚡ 적대' },
];

const RELATION_OPTIONS = [
    ['family',       '가족'],
    ['spouse',       '배우자'],
    ['friend',       '친구'],
    ['colleague',    '동료'],
    ['mentor',       '멘토'],
    ['mentee',       '후배'],
    ['client',       '거래처'],
    ['acquaintance', '지인'],
    ['unknown',      '미정'],
];

const BIGFIVE_KEYS = [
    { k: 'O', name: '개방성', hint: '새로움 · 호기심' },
    { k: 'C', name: '성실성', hint: '책임 · 계획' },
    { k: 'E', name: '외향성', hint: '에너지 방향' },
    { k: 'A', name: '우호성', hint: '협력 · 신뢰' },
    { k: 'N', name: '신경증', hint: '정서 안정 ↔ 불안' },
];

const COMPETENCY_KEYS = [
    ['analysis',      '분석'],
    ['execution',     '실행'],
    ['creativity',    '창의'],
    ['communication', '소통'],
    ['leadership',    '리더십'],
    ['empathy',       '공감'],
    ['expertise',     '전문성'],
    ['stamina',       '체력'],
];

const SLIDER_LEVELS = [0, 25, 50, 75, 100];

// ─── 모듈 상태 ───
let _userId = null;
let _persons = [];
let _orgsCache = [];       // 소속 조직 표시용
let _statsMap = new Map(); // personId → 도트 누적 통계 ("함께한 흔적")
let _activeFilter = 'all';
let _searchQuery = '';
let _editingId = null;     // 모달에 열린 person.id (null이면 새 카드)
let _editingDraft = null;  // 편집 중 사본

// ═══════════════════════════════════════════════════════════════════════
//  진입점
// ═══════════════════════════════════════════════════════════════════════

export async function renderPersonsView(userId) {
    _userId = userId;
    const container = document.getElementById('view-persons');
    if (!container) return;

    const dek = getDEK();
    if (!dek) {
        container.innerHTML = lockedTemplate();
        return;
    }

    container.innerHTML = `
        <header class="page-header">
            <h1><i class="page-icon" data-lucide="users"></i> 인물</h1>
            <p class="subtitle">하나님 앞에서 사람을 정직하게 보되, 라벨로 정죄하지 않습니다.</p>
        </header>
        <div id="persons-toolbar"></div>
        <div id="persons-grid"></div>
        <div id="person-modal-root"></div>
    `;

    await loadPersons();
    renderToolbar();
    renderGrid();
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

async function loadPersons() {
    const dek = getDEK();
    if (!dek) { _persons = []; _orgsCache = []; _statsMap = new Map(); return; }
    try {
        // 카드 + 조직 + 도트 통계를 한 번에. 도트가 실패해도 카드는 살아남도록.
        const [persons, orgs, dots] = await Promise.all([
            getAllPersons(dek, _userId),
            getAllOrganizations(dek, _userId).catch(() => []),
            getAllDots(dek, _userId).catch(e => { console.warn('dots load for stats failed:', e); return []; }),
        ]);
        _persons = persons;
        _orgsCache = orgs;
        _statsMap = computeAllPersonStats(dots);
    } catch (e) {
        console.error('persons load failed:', e);
        _persons = [];
        _orgsCache = [];
        _statsMap = new Map();
        showToast('인물 카드를 불러오는 중에 잠깐 막혔어요. 다시 한 번 들어와 주실래요?');
    }
}

function lockedTemplate() {
    return `
        <header class="page-header"><h1><i class="page-icon" data-lucide="users"></i> 인물</h1></header>
        <div class="empty-state">
            <i class="empty-state-icon" data-lucide="lock"></i>
            <h3>잠시 잠겨있어요</h3>
            <p class="empty-state-desc">비밀번호로 열어주세요.</p>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  툴바 (검색 + 필터 칩 + 새 인물)
// ═══════════════════════════════════════════════════════════════════════

function renderToolbar() {
    const root = document.getElementById('persons-toolbar');
    if (!root) return;
    root.innerHTML = `
        <div class="persons-toolbar">
            <div class="persons-search">
                <input id="persons-search-input" type="search"
                       placeholder="이름 또는 별명으로 찾기"
                       value="${escapeAttr(_searchQuery)}" />
            </div>
            <div class="persons-filter-chips">
                ${STANCE_FILTERS.map(f => `
                    <button class="persons-chip ${f.key === _activeFilter ? 'active' : ''}" data-filter="${f.key}">
                        <span>${f.label}</span>
                        <span class="persons-chip-count">${countBy(f.key)}</span>
                    </button>
                `).join('')}
            </div>
            <button class="primary-btn persons-add-btn">+ 새 인물</button>
        </div>
    `;
    root.querySelector('.persons-add-btn').addEventListener('click', () => openModal(null));
    root.querySelectorAll('.persons-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeFilter = btn.dataset.filter;
            renderToolbar();
            renderGrid();
        });
    });
    const inp = root.querySelector('#persons-search-input');
    inp?.addEventListener('input', () => {
        _searchQuery = inp.value || '';
        renderGrid();
    });
}

function countBy(key) {
    if (key === 'all') return _persons.length;
    if (key === 'innerCircle') return _persons.filter(p => p.innerCircle).length;
    return _persons.filter(p => (p.stance || 'neutral') === key).length;
}

function getFiltered() {
    let list = _persons.slice();
    if (_activeFilter === 'innerCircle') {
        list = list.filter(p => p.innerCircle);
    } else if (_activeFilter !== 'all') {
        list = list.filter(p => (p.stance || 'neutral') === _activeFilter);
    }
    if (_searchQuery.trim()) {
        const q = _searchQuery.toLowerCase().trim();
        list = list.filter(p => {
            if ((p.name || '').toLowerCase().includes(q)) return true;
            if (Array.isArray(p.nicknames) && p.nicknames.some(n => (n || '').toLowerCase().includes(q))) return true;
            return false;
        });
    }
    return list;
}

// ═══════════════════════════════════════════════════════════════════════
//  카드 그리드
// ═══════════════════════════════════════════════════════════════════════

function renderGrid() {
    const root = document.getElementById('persons-grid');
    if (!root) return;
    const list = getFiltered();
    if (!list.length) {
        root.innerHTML = `
            <div class="empty-state">
                <i class="empty-state-icon" data-lucide="users"></i>
                <h3>${_persons.length === 0 ? '아직 카드가 없어요' : '맞는 카드가 없어요'}</h3>
                <p class="empty-state-desc">
                    ${_persons.length === 0
                        ? '오른쪽 위 [+ 새 인물]을 눌러 첫 카드를 만들어 볼까요?'
                        : '다른 필터를 골라 보거나 검색어를 비워 보세요.'}
                </p>
            </div>`;
        return;
    }
    root.innerHTML = `<div class="persons-grid">${list.map(personCardHtml).join('')}</div>`;
    root.querySelectorAll('.person-card').forEach(card => {
        card.addEventListener('click', () => openModal(card.dataset.personId));
    });
}

function personCardHtml(p) {
    const stance = STANCE_META[p.stance || 'neutral'];
    const relation = relationLabel(p.relation);
    const initial = (p.name || '?').slice(0, 1);
    const big5 = p.bigFive || {};
    const stats = _statsMap.get(p.id);
    return `
        <div class="person-card ${p.isFallback ? 'is-fallback' : ''}" data-person-id="${p.id}">
            <div class="person-card-head">
                <div class="person-avatar" style="background:${avatarColor(p.id)}">${escapeHtml(initial)}</div>
                <div class="person-card-meta">
                    <div class="person-card-name">${personDisplayHtml(p, escapeHtml)}</div>
                    <div class="person-card-sub">
                        ${p.innerCircle ? '<span class="person-inner">내 사람</span>' : ''}
                        ${relation ? `<span class="person-relation">${relation}</span>` : ''}
                    </div>
                </div>
                <div class="person-stance-pill" style="background:${stance.color}1A;color:${stance.color}">
                    <span>${stance.icon}</span><span>${stance.label}</span>
                </div>
            </div>
            <div class="person-card-mini">
                ${miniBigFiveBars(big5)}
            </div>
            ${miniStatsHtml(stats)}
            ${p.isFallback ? '<div class="person-fallback-tag">기본 카드</div>' : ''}
        </div>
    `;
}

/**
 * 그리드 카드 하단 미니 통계 한 줄.
 * 누적 도트가 없으면 (meetingCount===0) 표시 X — 초기 상태가 깔끔.
 */
function miniStatsHtml(stats) {
    if (!stats || stats.meetingCount === 0) return '';
    const dots = stats.avgRating != null ? ratingDotsHtml(stats.avgRating) : '<span class="rating-dots-empty">아직 평가 없음</span>';
    return `
        <div class="card-mini-stats">
            ${dots}
            <span class="card-mini-stat">${stats.meetingCount}번</span>
            <span class="card-mini-sep">·</span>
            <span class="card-mini-stat">${formatMinutes(stats.totalMinutes)}</span>
        </div>
    `;
}

function miniBigFiveBars(big5) {
    return BIGFIVE_KEYS.map(({ k, name }) => {
        const v = big5[k];
        const pct = (v == null) ? 0 : v;
        const dim = (v == null) ? 'mini-bar-dim' : '';
        return `
            <div class="mini-bar-row" title="${name}: ${v == null ? '미입력' : v}">
                <span class="mini-bar-label">${k}</span>
                <span class="mini-bar-track">
                    <span class="mini-bar-fill ${dim}" style="width:${pct}%"></span>
                </span>
            </div>
        `;
    }).join('');
}

function relationLabel(r) {
    const found = RELATION_OPTIONS.find(([v]) => v === r);
    return found ? found[1] : '';
}

function avatarColor(id) {
    let h = 0;
    const s = id || 'x';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h}, 50%, 80%)`;
}

// ═══════════════════════════════════════════════════════════════════════
//  모달
// ═══════════════════════════════════════════════════════════════════════

function openModal(personId) {
    const original = personId ? _persons.find(p => p.id === personId) : null;
    _editingId = personId;
    _editingDraft = original ? deepClone(original) : newPersonDraft();
    renderModal();
}

function newPersonDraft() {
    return {
        name: '',
        nicknames: [],
        relation: 'acquaintance',
        innerCircle: false,
        stance: 'neutral',
        bigFive: { O: null, C: null, E: null, A: null, N: null },
        competencies: {},
        relationship: { closeness: null, trust: null, friendliness: null, importance: null },
        meaningfulVerse: '',
        notes: '',
        stanceHistory: [],
        // 친한 사람(innerCircle)에만 노출. 비어 있어도 모델 호환.
        birthday: '',          // 'YYYY-MM-DD' 또는 '--MM-DD' (연도 모르면 앞 두 자리 비움)
        anniversaries: [],     // [{ date: 'YYYY-MM-DD' | '--MM-DD', label: '결혼기념일' }]
    };
}

function closeModal() {
    _editingId = null;
    _editingDraft = null;
    const root = document.getElementById('person-modal-root');
    if (root) root.innerHTML = '';
}

function renderModal() {
    const root = document.getElementById('person-modal-root');
    if (!root || !_editingDraft) return;
    const p = _editingDraft;
    const isFallback = !!p.isFallback;
    const stance = STANCE_META[p.stance || 'neutral'];

    root.innerHTML = `
        <div class="modal-overlay person-modal-overlay">
            <div class="modal-content person-modal">
                <div class="person-modal-header">
                    <h3>${_editingId ? '인물 카드' : '새 인물'}</h3>
                    <button class="person-modal-close" aria-label="닫기">✕</button>
                </div>
                ${isFallback ? `
                <div class="person-fallback-banner">
                    이 카드는 미등록 인물용 기본 카드예요. 이름은 바꿀 수 없어요.
                </div>` : ''}
                <div class="person-modal-body">
                    <aside class="person-detail-left">
                        <div class="person-radar-wrap">${bigFiveRadarSvg(p.bigFive)}</div>
                        <div class="person-radar-caption">Big Five 레이더</div>
                        <div class="person-stance-display">
                            <div class="person-stance-pill big" style="background:${stance.color}1A;color:${stance.color}">
                                <span>${stance.icon}</span><span>${stance.label}</span>
                            </div>
                            ${_editingId ? stanceChangeChipsHtml(p.stance || 'neutral') : `
                            <div class="person-stance-locked-hint">
                                저장한 뒤에 stance를 바꿀 수 있어요.
                            </div>`}
                        </div>
                    </aside>
                    <div class="person-detail-right">
                        ${layer1Html(p, isFallback)}
                        ${footprintHtml(p)}
                        ${layer2Html(p)}
                        ${layer3Html(p)}
                        ${layer4Html(p)}
                        ${belongsHtml(p)}
                        ${anniversariesHtml(p)}
                        ${layerVerseHtml(p)}
                    </div>
                </div>
                <div class="person-modal-footer">
                    ${_editingId && !isFallback
                        ? '<button class="text-btn person-delete-btn">삭제</button>'
                        : '<span></span>'}
                    <div class="person-modal-actions">
                        <button class="text-btn person-cancel-btn">취소</button>
                        <button class="primary-btn person-save-btn">저장</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    bindModalEvents();
    // footprint 의 trending-down/up 등 새 아이콘이 들어왔으니 한 번 더 렌더
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

function bindModalEvents() {
    const root = document.getElementById('person-modal-root');
    if (!root) return;

    root.querySelector('.person-modal-close')?.addEventListener('click', closeModal);
    root.querySelector('.person-cancel-btn')?.addEventListener('click', closeModal);
    root.querySelector('.person-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('person-modal-overlay')) closeModal();
    });

    root.querySelector('.person-save-btn')?.addEventListener('click', onSave);
    root.querySelector('.person-delete-btn')?.addEventListener('click', onDelete);

    bindLayer1Events(root);
    bindLayer2Events(root);
    bindLayer3Events(root);
    bindLayer4Events(root);

    root.querySelector('#person-notes')?.addEventListener('input', (e) => {
        _editingDraft.notes = e.target.value;
    });

    bindBelongsEvents(root);
    bindStanceChangeEvents(root);
    bindAxisUnlockEvents(root);
}

/**
 * 🔒 lock 해제 (↻) 버튼 — 그 축의 lock 플래그를 false로 돌리고,
 * 도트 누적에서 다시 derived 값으로 갱신해 즉시 화면 반영.
 * 어디든 .axis-unlock-btn 클릭만으로 동작하도록 이벤트 위임.
 */
function bindAxisUnlockEvents(root) {
    root.addEventListener('click', async (e) => {
        const btn = e.target.closest('.axis-unlock-btn');
        if (!btn) return;
        const rowEl = btn.closest('[data-axis]');
        if (!rowEl) return;
        const axis = rowEl.dataset.axis;
        const kind = rowEl.dataset.axisKind;
        if (!axis || !kind) return;

        // lock 해제
        const lockKey = `${kind}Locked`;
        if (_editingDraft[lockKey]) {
            delete _editingDraft[lockKey][axis];
            if (Object.keys(_editingDraft[lockKey]).length === 0) {
                _editingDraft[lockKey] = {};
            }
        }

        // 모달 열 때 이미 계산된 _statsMap에서 이 인물 통계를 가져와 derived 재계산
        try {
            const stats = _editingId ? _statsMap.get(_editingId) : null;
            const { applyDerivedToPerson } = await import('../data/derivedScores.js');
            applyDerivedToPerson(_editingDraft, stats);
        } catch (err) { console.warn('axis re-derive failed:', err); }

        // 해당 레이어 다시 그리기 (lock 인디케이터 + 값 동시 갱신)
        rerenderAffectedLayer(root, kind);
        if (kind === 'bigFive') updateRadar();
    });
}

function rerenderAffectedLayer(root, kind) {
    if (kind === 'bigFive') {
        const sec = root.querySelector('.person-layer:has([data-bf-steps])');
        if (sec) {
            sec.outerHTML = layer2Html(_editingDraft);
            bindLayer2Events(root);
        }
        return;
    }
    if (kind === 'competencies') {
        const sec = root.querySelector('#layer-3-section');
        if (sec) {
            sec.outerHTML = layer3Html(_editingDraft);
            bindLayer3Events(root);
        }
        return;
    }
    if (kind === 'relationship') {
        const sec = root.querySelector('.person-layer:has(.rel-row)');
        if (sec) {
            sec.outerHTML = layer4Html(_editingDraft);
            bindLayer4Events(root);
        }
        return;
    }
}

// ─── stance 변경 (v3-①-F) ───
function stanceChangeChipsHtml(current) {
    const others = ['ally', 'neutral', 'caution', 'adversary'].filter(s => s !== current);
    return `
        <div class="person-stance-change-row">
            <div class="person-stance-change-label">다른 stance로 옮기기</div>
            <div class="person-stance-change-chips">
                ${others.map(s => {
                    const m = STANCE_META[s];
                    return `
                        <button class="person-stance-change-chip" data-to-stance="${s}"
                                style="border-color:${m.color}; color:${m.color}">
                            ${m.icon} ${m.label}
                        </button>
                    `;
                }).join('')}
            </div>
            <div class="person-stance-change-hint">
                긍정 방향은 바로 적용, 부정 방향은 30초 기도 게이트를 거쳐요.
            </div>
        </div>
    `;
}

function bindStanceChangeEvents(root) {
    root.querySelectorAll('.person-stance-change-chip').forEach(btn => {
        btn.addEventListener('click', async () => {
            const toStance = btn.dataset.toStance;
            if (!_editingId) return;
            const dek = getDEK();
            if (!dek) { showToast('잠겨 있어요. 비밀번호로 먼저 열어 주실래요?'); return; }
            const current = _persons.find(p => p.id === _editingId);
            if (!current) return;
            const fromStance = current.stance || 'neutral';

            const result = await openStanceGate({
                subjectType: 'person',
                subjectName: current.name || '(이름 없음)',
                fromStance,
                toStance,
            });
            if (!result) return; // 취소
            try {
                await changeStance(dek, _userId, current, toStance, result.reason, result.prayerDone);
                showToast('🙏 stance를 옮겼어요. 그 사람을 위해 기도해 주세요.');
                await loadPersons();
                // 모달 갱신 (draft도 새 stance로 반영)
                _editingDraft = deepClone(_persons.find(p => p.id === _editingId));
                renderModal();
                renderToolbar();
                renderGrid();
            } catch (e) {
                console.error('changeStance failed:', e);
                showToast('stance 변경이 잠깐 막혔어요. 다시 시도해 주실래요?');
            }
        });
    });
}

// ─── Layer 1 정체성 ───
function layer1Html(p, isFallback) {
    return `
        <section class="person-layer">
            <h4 class="person-layer-title">정체성</h4>
            <div class="person-row">
                <label>이름</label>
                <input id="p-name" type="text" value="${escapeAttr(p.name || '')}"
                       ${isFallback ? 'disabled' : ''} />
            </div>
            <div class="person-row">
                <label>별명</label>
                <input id="p-nicknames" type="text" value="${escapeAttr((p.nicknames || []).join(', '))}"
                       placeholder="쉼표로 구분 (예: 김쌤, 김선생)" />
            </div>
            <div class="person-row">
                <label>관계</label>
                <select id="p-relation">
                    ${RELATION_OPTIONS.map(([v, l]) => `
                        <option value="${v}" ${p.relation === v ? 'selected' : ''}>${l}</option>
                    `).join('')}
                </select>
            </div>
            <div class="person-row">
                <label>내 사람</label>
                <label class="person-toggle">
                    <input id="p-inner" type="checkbox" ${p.innerCircle ? 'checked' : ''} />
                    <span>가족 · 배우자 · 친밀권</span>
                </label>
            </div>
        </section>
    `;
}

function bindLayer1Events(root) {
    root.querySelector('#p-name')?.addEventListener('input', e => { _editingDraft.name = e.target.value; });
    root.querySelector('#p-nicknames')?.addEventListener('input', e => {
        _editingDraft.nicknames = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    });
    root.querySelector('#p-relation')?.addEventListener('change', e => { _editingDraft.relation = e.target.value; });
    root.querySelector('#p-inner')?.addEventListener('change', e => {
        _editingDraft.innerCircle = e.target.checked;
        // innerCircle 토글 시 생일·기념일 섹션 동적 노출/숨김
        const layer = root.querySelector('#person-anniv-layer');
        const newHtml = anniversariesHtml(_editingDraft);
        if (layer) {
            if (newHtml) layer.outerHTML = newHtml;
            else layer.remove();
        } else if (newHtml) {
            // 섹션이 없었으면 메모 섹션 앞에 삽입
            const memoLayer = root.querySelector('#person-notes')?.closest('.person-layer');
            if (memoLayer) memoLayer.insertAdjacentHTML('beforebegin', newHtml);
        }
        bindAnnivEvents(root);
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    });
    bindAnnivEvents(root);
}

function bindAnnivEvents(root) {
    root.querySelector('#person-birthday')?.addEventListener('change', e => {
        _editingDraft.birthday = e.target.value;
    });
    root.querySelector('#person-anniv-add')?.addEventListener('click', () => {
        const list = Array.isArray(_editingDraft.anniversaries) ? _editingDraft.anniversaries : [];
        list.push({ date: '', label: '' });
        _editingDraft.anniversaries = list;
        const layer = root.querySelector('#person-anniv-layer');
        if (layer) {
            layer.outerHTML = anniversariesHtml(_editingDraft);
            bindAnnivEvents(root);
        }
    });
    root.querySelectorAll('#person-anniv-list .anniv-row').forEach(row => {
        const idx = parseInt(row.dataset.idx, 10);
        row.querySelector('.anniv-date')?.addEventListener('change', e => {
            _editingDraft.anniversaries[idx].date = e.target.value;
        });
        row.querySelector('.anniv-label')?.addEventListener('input', e => {
            _editingDraft.anniversaries[idx].label = e.target.value;
        });
        row.querySelector('.anniv-remove')?.addEventListener('click', () => {
            _editingDraft.anniversaries.splice(idx, 1);
            const layer = root.querySelector('#person-anniv-layer');
            if (layer) {
                layer.outerHTML = anniversariesHtml(_editingDraft);
                bindAnnivEvents(root);
            }
        });
    });
}

// ─── 함께한 흔적 (도트 통계) — "내가 본 사람" 옆에 두 면 나란히 ───
// 정책: 자동 조정 금지. 통계는 표시만, 슬라이더 조정은 사용자가 직접.
// memory/project_person_card_policy.md 참조.
function footprintHtml(p) {
    const stats = _editingId ? _statsMap.get(_editingId) : null;
    if (!stats || stats.meetingCount === 0) {
        return `
            <section class="person-layer">
                <h4 class="person-layer-title">함께한 흔적</h4>
                <p class="person-layer-hint">
                    아직 함께한 도트가 없어요. 시간표에서 이 사람과의 시간을 기록하면 여기에 누적돼요.
                </p>
            </section>
        `;
    }
    const avg = stats.avgRating;
    const trendArrow = formatTrend(stats.trend);
    const trendNote = (stats.recent4wAvg != null && stats.prev4wAvg != null)
        ? `최근 4주 ${stats.recent4wAvg.toFixed(1)} / 이전 4주 ${stats.prev4wAvg.toFixed(1)} ${trendArrow}`
        : (stats.recent4wAvg != null
            ? `최근 4주 평균 ${stats.recent4wAvg.toFixed(1)}`
            : '아직 추세 비교에 충분한 만남이 누적되지 않았어요');

    const recentList = stats.recentDots.map(d => {
        const dots = d.rating > 0 ? ratingDotsHtml(d.rating) : '<span class="rating-dots-empty">미평가</span>';
        const task = d.actualTask ? escapeHtml(d.actualTask) : '<span class="footprint-empty">(이름 없는 시간)</span>';
        return `
            <li class="footprint-recent-item">
                <span class="footprint-recent-when">${escapeHtml(d.date || '')} ${slotToTimeStr(d.timeSlot)}</span>
                <span class="footprint-recent-task">${task}</span>
                <span class="footprint-recent-rating">${dots}</span>
            </li>
        `;
    }).join('');

    // Phase E-3: 만족도 추세가 명확히 변했을 때만 stance 재검토 안내.
    // 자동 변경 금지(영적 안전장치 30초 기도 게이트가 stance 변경 경로). 안내만.
    // 임계값: recent vs prev 차이 |delta| >= 1.0 + 표본 충분 (각 면 2회 이상)
    const stanceHint = buildStanceHint(p, stats);

    return `
        <section class="person-layer footprint-section">
            <h4 class="person-layer-title">함께한 흔적</h4>
            <p class="person-layer-hint">
                도트가 만들어낸 누적이에요. 내가 본 점수와 함께한 흔적이 다르다면, 그 차이가 묵상의 재료예요.
            </p>
            ${stanceHint}
            <div class="footprint-grid">
                <div class="footprint-cell">
                    <div class="footprint-cell-label">만남</div>
                    <div class="footprint-cell-value">${stats.meetingCount}<small>번</small></div>
                </div>
                <div class="footprint-cell">
                    <div class="footprint-cell-label">평균 만족도</div>
                    <div class="footprint-cell-value">
                        ${avg != null ? ratingDotsHtml(avg) : '<span class="footprint-empty">미평가</span>'}
                        ${avg != null ? `<small>${avg.toFixed(1)}</small>` : ''}
                    </div>
                </div>
                <div class="footprint-cell">
                    <div class="footprint-cell-label">함께한 시간</div>
                    <div class="footprint-cell-value">${formatMinutes(stats.totalMinutes)}</div>
                </div>
                <div class="footprint-cell footprint-trend">
                    <div class="footprint-cell-label">추세</div>
                    <div class="footprint-cell-value footprint-trend-note">${escapeHtml(trendNote)}</div>
                </div>
            </div>
            ${stats.recentDots.length > 0 ? `
                <div class="footprint-recent">
                    <div class="footprint-recent-title">최근 만남</div>
                    <ul class="footprint-recent-list">${recentList}</ul>
                </div>
            ` : ''}
        </section>
    `;
}

/**
 * Phase E-3: 만족도 추세가 명확히 변할 때 stance 재검토 안내.
 *
 * 정책:
 *   - stance 자동 변경 절대 X. 안내만.
 *   - "주의" 톤 X. "관찰" 톤만 ("결이 바뀌는 흐름이 보입니다").
 *   - 임계값: |recent4w - prev4w| >= 1.0 + 각 4주에 표본 2회 이상.
 *   - 방향: down 이면 "ally→neutral/caution" 재검토, up 이면 "caution/adversary→ally" 재검토.
 */
function buildStanceHint(p, stats) {
    if (stats.recent4wAvg == null || stats.prev4wAvg == null) return '';
    // cardStats 의 trend 는 차이 >=0.5 에서 방향만 보지만, stance 알림은 더 엄격한 1.0 임계.
    const delta = stats.recent4wAvg - stats.prev4wAvg;
    if (Math.abs(delta) < 1.0) return '';

    // 표본 부족이면 알림 생략
    const r = stats.recentDots || [];
    const recentSamples = r.filter(d => d.rating > 0).length;
    if (recentSamples < 2) return '';

    const direction = delta < 0 ? 'down' : 'up';
    const current = p.stance || 'neutral';
    let suggestion = '';
    if (direction === 'down') {
        if (current === 'ally') suggestion = 'stance 를 다시 살펴볼 시점일지도 모릅니다.';
        else if (current === 'neutral') suggestion = 'caution 으로 옮길지 묵상 안에서 살펴봐 주세요.';
        else suggestion = '이미 caution/adversary 인 사람과의 결이 더 어두워지고 있어요.';
    } else {
        if (current === 'caution' || current === 'adversary') {
            suggestion = '회복의 결이 관찰됩니다. stance 를 다시 살펴봐 주세요.';
        } else {
            suggestion = '결이 밝아지는 흐름이에요.';
        }
    }

    const directionLabel = direction === 'down' ? '낮아지는' : '높아지는';
    return `
        <div class="footprint-stance-hint ${direction === 'down' ? 'hint-down' : 'hint-up'}">
            <i class="footprint-stance-icon" data-lucide="${direction === 'down' ? 'trending-down' : 'trending-up'}"></i>
            <div class="footprint-stance-body">
                <div class="footprint-stance-line">
                    최근 4주 만족도가 이전 4주 대비 ${Math.abs(delta).toFixed(1)}점 ${directionLabel} 흐름이 관찰됩니다.
                </div>
                <div class="footprint-stance-quiet">${escapeHtml(suggestion)}</div>
            </div>
        </div>
    `;
}

// ─── Layer 2 Big Five ───
function layer2Html(p) {
    const big = p.bigFive || {};
    const locks = p.bigFiveLocked || {};
    return `
        <section class="person-layer">
            <h4 class="person-layer-title">성격 (Big Five)</h4>
            <p class="person-layer-hint">
                ❗ 라벨이 사람을 가두지 않습니다. "지금 내 눈에 이렇게 보인다"의 거울일 뿐.
                <br>🔒 내가 정한 값 · 📊 도트가 만든 값 — 표시 옆 작은 마크로 알 수 있어요.
            </p>
            ${BIGFIVE_KEYS.map(({ k, name, hint }) => fiveStepRow({
                id: `bf-${k}`,
                axis: k,
                axisKind: 'bigFive',
                label: `${name} (${k})`,
                hint,
                value: big[k],
                locked: !!locks[k],
            })).join('')}
        </section>
    `;
}

function fiveStepRow({ id, axis, axisKind, label, hint, value, locked }) {
    const isNull = (value == null);
    // 정책(2026-05-12): 첫 평가(isNull)거나 내가 직접 정한 값(locked)일 때만 클릭 버튼 노출.
    // 도트가 만든 값(derived)일 땐 버튼 숨기고 숫자만 보여줘 화면을 조용히.
    // 다시 수동으로 바꾸고 싶으면 '모르겠어요'를 켰다 끄면 isNull로 돌아와 클릭 가능.
    const showSteps = isNull || locked;
    return `
        <div class="bf-row" data-axis="${escapeAttr(axis || '')}" data-axis-kind="${escapeAttr(axisKind || '')}">
            <div class="bf-row-head">
                <span class="bf-row-label">${label}</span>
                <span class="bf-row-hint">${hint || ''}</span>
                ${!showSteps ? `<span class="bf-derived-value">${value}</span>` : ''}
                ${lockBadgeHtml(locked, isNull)}
                <label class="bf-row-unknown">
                    <input type="checkbox" data-bf-unknown="${id}" ${isNull ? 'checked' : ''} />
                    모르겠어요
                </label>
            </div>
            ${showSteps ? `
                <div class="bf-row-steps ${isNull ? 'disabled' : ''}" data-bf-steps="${id}">
                    ${SLIDER_LEVELS.map(lv => `
                        <button class="bf-step ${value === lv ? 'active' : ''}" data-bf-value="${lv}">${lv}</button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * lock 인디케이터 + (locked일 때) 되돌리기 버튼.
 * - locked=true: 🔒 내가 정한 값. 옆에 '↻' 버튼 노출 (도트가 만든 값으로 되돌리기)
 * - locked=false: 📊 도트가 만든 값
 * - 모르겠어요(isNull)는 아무 표시 안 함 (값 자체가 없으니 lock 의미 없음)
 */
function lockBadgeHtml(locked, isNull) {
    if (isNull) return '';
    if (locked) {
        return `
            <span class="axis-lock-badge axis-locked" title="내가 직접 정한 값. 도트가 자동으로 바꾸지 않아요.">🔒 내가 정함</span>
            <button type="button" class="axis-unlock-btn" data-action="unlock" title="도트가 만든 값으로 되돌리기">↻</button>
        `;
    }
    return `<span class="axis-lock-badge axis-derived" title="이 값은 도트 만족도 누적에서 자동으로 만들어진 값이에요. 능력 그 자체가 아닌 '나에게 남은 인상'에 가깝습니다.">📊 도트가 만듦</span>`;
}

function bindLayer2Events(root) {
    BIGFIVE_KEYS.forEach(({ k }) => {
        const id = `bf-${k}`;
        const stepsEl = root.querySelector(`[data-bf-steps="${id}"]`);
        const unknownEl = root.querySelector(`[data-bf-unknown="${id}"]`);
        if (stepsEl) {
            stepsEl.querySelectorAll('.bf-step').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (stepsEl.classList.contains('disabled')) return;
                    const v = Number(btn.dataset.bfValue);
                    _editingDraft.bigFive[k] = v;
                    // 새 정책: 사용자가 직접 정한 축은 lock → 도트 자동 갱신 차단
                    _editingDraft.bigFiveLocked = _editingDraft.bigFiveLocked || {};
                    _editingDraft.bigFiveLocked[k] = true;
                    stepsEl.querySelectorAll('.bf-step').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    if (unknownEl) unknownEl.checked = false;
                    updateRadar();
                });
            });
        }
        if (unknownEl) {
            unknownEl.addEventListener('change', () => {
                if (unknownEl.checked) {
                    _editingDraft.bigFive[k] = null;
                    // lock도 풀어줌 — 다시 도트 derived가 들어올 자리 마련
                    if (_editingDraft.bigFiveLocked) delete _editingDraft.bigFiveLocked[k];
                }
                // isNull 변화로 step row 자체의 표시 여부가 바뀜 → 레이어 다시 그림
                rerenderAffectedLayer(root, 'bigFive');
                updateRadar();
            });
        }
    });
}

function updateRadar() {
    const wrap = document.querySelector('.person-radar-wrap');
    if (!wrap) return;
    wrap.innerHTML = bigFiveRadarSvg(_editingDraft.bigFive);
}

// ─── Layer 3 능력 스탯 ───
function layer3Html(p) {
    const comp = p.competencies || {};
    const customKeys = Object.keys(comp).filter(k => !COMPETENCY_KEYS.some(([std]) => std === k));
    return `
        <section class="person-layer" id="layer-3-section">
            <h4 class="person-layer-title">능력 스탯</h4>
            <p class="person-layer-hint">0~100. 모르는 항목은 ✕로 비우면 회색 막대로 표시돼요.</p>
            <div class="comp-list" id="comp-list">
                ${COMPETENCY_KEYS.map(([k, l]) => compRowHtml(k, l, comp[k], false)).join('')}
                ${customKeys.map(k => compRowHtml(k, k, comp[k], true)).join('')}
            </div>
            <div class="comp-add-row">
                <input id="comp-add-input" type="text" placeholder="사용자 정의 (예: 협상력)" />
                <button class="text-btn" id="comp-add-btn">+ 추가</button>
            </div>
        </section>
    `;
}

function compRowHtml(key, label, value, isCustom) {
    const v = (value == null) ? null : Number(value);
    const locked = !!((_editingDraft?.competenciesLocked || {})[key]);
    return `
        <div class="comp-row ${v == null ? 'is-null' : ''}" data-comp-key="${escapeAttr(key)}" data-axis="${escapeAttr(key)}" data-axis-kind="competencies">
            <span class="comp-label">${escapeHtml(label)}</span>
            <input class="comp-slider" type="range" min="0" max="100" step="10"
                   value="${v == null ? 0 : v}" />
            <span class="comp-value">${v == null ? '–' : v}</span>
            ${lockBadgeHtml(locked, v == null)}
            <button class="comp-clear" title="모름으로 비우기">✕</button>
            ${isCustom ? '<button class="comp-remove" title="이 항목 제거">🗑</button>' : ''}
        </div>
    `;
}

function bindLayer3Events(root) {
    const list = root.querySelector('#comp-list');
    if (list) attachCompRowEvents(list);

    root.querySelector('#comp-add-btn')?.addEventListener('click', () => {
        const input = root.querySelector('#comp-add-input');
        const name = (input?.value || '').trim();
        if (!name) return;
        if (COMPETENCY_KEYS.some(([k, l]) => k === name || l === name)) {
            showToast('이미 표준 항목에 있어요');
            return;
        }
        if (_editingDraft.competencies[name] !== undefined) {
            showToast('이미 추가된 항목이에요');
            return;
        }
        _editingDraft.competencies[name] = 50;
        const layerEl = root.querySelector('#layer-3-section');
        if (layerEl) {
            layerEl.outerHTML = layer3Html(_editingDraft);
            bindLayer3Events(root);
        }
    });
}

function attachCompRowEvents(listEl) {
    listEl.querySelectorAll('.comp-row').forEach(row => {
        const key = row.dataset.compKey;
        const slider = row.querySelector('.comp-slider');
        const valueEl = row.querySelector('.comp-value');
        const clearBtn = row.querySelector('.comp-clear');
        const removeBtn = row.querySelector('.comp-remove');

        slider?.addEventListener('input', () => {
            const v = Number(slider.value);
            _editingDraft.competencies[key] = v;
            _editingDraft.competenciesLocked = _editingDraft.competenciesLocked || {};
            _editingDraft.competenciesLocked[key] = true;
            valueEl.textContent = String(v);
            row.classList.remove('is-null');
        });
        clearBtn?.addEventListener('click', () => {
            _editingDraft.competencies[key] = null;
            slider.value = 0;
            valueEl.textContent = '–';
            row.classList.add('is-null');
        });
        removeBtn?.addEventListener('click', () => {
            delete _editingDraft.competencies[key];
            row.remove();
        });
    });
}

// ─── Layer 4 관계 (1~5 별점) ───
function layer4Html(p) {
    const r = p.relationship || {};
    return `
        <section class="person-layer">
            <h4 class="person-layer-title">관계</h4>
            ${rel5Row('closeness',    '친밀도', r.closeness)}
            ${rel5Row('trust',        '신뢰',   r.trust)}
            ${rel5Row('friendliness', '우호도', r.friendliness)}
            ${rel5Row('importance',   '중요도', r.importance)}
        </section>
    `;
}

function rel5Row(key, label, value) {
    const v = value == null ? null : Number(value);
    const locked = !!((_editingDraft?.relationshipLocked || {})[key]);
    return `
        <div class="rel-row" data-rel-key="${key}" data-axis="${escapeAttr(key)}" data-axis-kind="relationship">
            <span class="rel-label">${label}</span>
            <div class="rel-stars">
                ${[1,2,3,4,5].map(n => `
                    <button class="rel-star ${v != null && n <= v ? 'active' : ''}" data-rel-value="${n}">★</button>
                `).join('')}
                <button class="rel-clear" title="비우기">✕</button>
                ${lockBadgeHtml(locked, v == null)}
            </div>
        </div>
    `;
}

function bindLayer4Events(root) {
    root.querySelectorAll('.rel-row').forEach(row => {
        const key = row.dataset.relKey;
        row.querySelectorAll('.rel-star').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = Number(btn.dataset.relValue);
                _editingDraft.relationship[key] = v;
                _editingDraft.relationshipLocked = _editingDraft.relationshipLocked || {};
                _editingDraft.relationshipLocked[key] = true;
                row.querySelectorAll('.rel-star').forEach(s => {
                    const n = Number(s.dataset.relValue);
                    s.classList.toggle('active', n <= v);
                });
            });
        });
        row.querySelector('.rel-clear')?.addEventListener('click', () => {
            _editingDraft.relationship[key] = null;
            row.querySelectorAll('.rel-star').forEach(s => s.classList.remove('active'));
        });
    });
}

// ─── 소속 조직 (v3-①-C: 표시 전용, 추가/제거는 조직 카드에서) ───
function belongsHtml(p) {
    const personId = p.id;
    const matched = personId
        ? _orgsCache.filter(o => Array.isArray(o.memberPersonIds) && o.memberPersonIds.includes(personId))
        : [];
    return `
        <section class="person-layer">
            <h4 class="person-layer-title">소속 조직</h4>
            ${matched.length === 0
                ? `<div class="person-belongs-empty">
                       ${personId
                           ? '아직 등록된 소속 조직이 없어요. 조직 카드에서 멤버로 추가해 주세요.'
                           : '저장 후 조직 카드에서 멤버로 추가하면 여기에 보여요.'}
                   </div>`
                : `<div class="person-belongs-list">
                       ${matched.map(belongsChipHtml).join('')}
                   </div>`}
        </section>
    `;
}

function belongsChipHtml(o) {
    const icon = ORG_TYPE_ICONS[o.type] || '📦';
    return `
        <button class="person-belongs-chip" data-org-id="${o.id}" type="button">
            <span>${icon}</span><span>${escapeHtml(o.name || '이름 없음')}</span>
        </button>
    `;
}

function bindBelongsEvents(root) {
    root.querySelectorAll('.person-belongs-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            // 인물 모달 닫고 조직 뷰로 이동
            closeModal();
            if (typeof window.__sanctumSwitchView === 'function') {
                window.__sanctumSwitchView('organizations');
            }
        });
    });
}

// ─── 생일 · 기념일 (친한 사람 한정) ───
function anniversariesHtml(p) {
    if (!p.innerCircle) return '';
    const annivs = Array.isArray(p.anniversaries) ? p.anniversaries : [];
    const rows = annivs.map((a, i) => `
        <div class="anniv-row" data-idx="${i}">
            <input class="anniv-date" type="date" value="${escapeAttr(a.date || '')}" />
            <input class="anniv-label" type="text" value="${escapeAttr(a.label || '')}" placeholder="예: 결혼기념일" />
            <button class="anniv-remove text-btn" type="button" aria-label="삭제">✕</button>
        </div>
    `).join('');
    return `
        <section class="person-layer" id="person-anniv-layer">
            <h4 class="person-layer-title">생일 · 기념일</h4>
            <p class="org-layer-hint">친한 사람에게만 보여요. 연도를 모르면 그냥 비워도 돼요.</p>
            <div class="person-row">
                <label>생일</label>
                <input id="person-birthday" type="date" value="${escapeAttr(p.birthday || '')}" />
            </div>
            <div class="anniv-list" id="person-anniv-list">${rows}</div>
            <button type="button" id="person-anniv-add" class="text-btn">+ 기념일 추가</button>
        </section>
    `;
}

// ─── 메모 ───
function layerVerseHtml(p) {
    return `
        <section class="person-layer">
            <h4 class="person-layer-title">메모</h4>
            <div class="person-row">
                <label>메모</label>
                <textarea id="person-notes" rows="3"
                    placeholder="기억할 만한 사실, 약속, 기도 제목 등">${escapeHtml(p.notes || '')}</textarea>
            </div>
        </section>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
//  저장 / 삭제
// ═══════════════════════════════════════════════════════════════════════

async function onSave() {
    const dek = getDEK();
    if (!dek) { showToast('잠겨 있어 저장할 수 없어요. 비밀번호로 먼저 열어 주실래요?'); return; }
    const draft = _editingDraft;
    if (!draft) return;
    if (!draft.isFallback && !(draft.name || '').trim()) {
        showToast('이름을 적어 주실래요?');
        return;
    }

    if (draft.competencies) {
        Object.keys(draft.competencies).forEach(k => {
            if (draft.competencies[k] === undefined) delete draft.competencies[k];
        });
    }

    try {
        await savePerson(dek, _userId, draft);
        showToast('🔐 안전하게 보관됐어요');
        await loadPersons();
        renderToolbar();
        renderGrid();
        closeModal();
    } catch (e) {
        console.error('savePerson failed:', e);
        showToast('저장이 잠깐 막혔어요. 잠시 후 다시 시도해 주실래요?');
    }
}

async function onDelete() {
    if (!_editingId) return;
    const ok = confirm('이 인물 카드를 지워도 괜찮을까요? 한 번 지우면 되돌릴 수 없어요.');
    if (!ok) return;
    try {
        await deletePerson(_userId, _editingId);
        showToast('카드를 지웠어요');
        await loadPersons();
        renderToolbar();
        renderGrid();
        closeModal();
    } catch (e) {
        console.error('deletePerson failed:', e);
        showToast('지우는 중에 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  SVG Big Five 레이더 (의존성 없음)
// ═══════════════════════════════════════════════════════════════════════

function bigFiveRadarSvg(big5 = {}) {
    const cx = 100, cy = 105, r = 75;
    const axes = [
        { k: 'O', angle: -90  },   // 위
        { k: 'C', angle: -18  },   // 우상
        { k: 'E', angle:  54  },   // 우하
        { k: 'A', angle: 126  },   // 좌하
        { k: 'N', angle: -162 },   // 좌상
    ];

    const pt = (angleDeg, radius) => {
        const a = (angleDeg * Math.PI) / 180;
        return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
    };

    const rings = [0.25, 0.5, 0.75, 1].map(scale => {
        const pts = axes.map(({ angle }) => pt(angle, r * scale).join(',')).join(' ');
        return `<polygon points="${pts}" fill="none" stroke="var(--border)" stroke-width="1" opacity="${(0.3 + scale * 0.4).toFixed(2)}" />`;
    }).join('');

    const axisLines = axes.map(({ angle }) => {
        const [x, y] = pt(angle, r);
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" />`;
    }).join('');

    const dataPts = axes.map(({ k, angle }) => {
        const v = big5[k];
        const scale = v == null ? 0 : v / 100;
        return pt(angle, r * scale);
    });
    const allNull = axes.every(({ k }) => big5[k] == null);
    const dataPolygon = allNull ? '' : `
        <polygon points="${dataPts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"
            fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"
            stroke-linejoin="round" />`;

    const dataDots = axes.map(({ k }, i) => {
        const v = big5[k];
        if (v == null) return '';
        const [x, y] = dataPts[i];
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--accent)" />`;
    }).join('');

    const labels = axes.map(({ k, angle }) => {
        const [x, y] = pt(angle, r + 14);
        return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                font-size="11" fill="var(--text-secondary)" font-weight="600">${k}</text>`;
    }).join('');

    const placeholder = allNull
        ? `<text x="100" y="110" text-anchor="middle" font-size="11" fill="var(--text-secondary)">아직 비어있어요</text>`
        : '';

    return `
        <svg class="person-radar" viewBox="0 0 200 210" width="200" height="210" xmlns="http://www.w3.org/2000/svg">
            ${rings}
            ${axisLines}
            ${dataPolygon}
            ${dataDots}
            ${labels}
            ${placeholder}
        </svg>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════════════════════════

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
function escapeAttr(s) { return escapeHtml(s); }
