/**
 * orgCard.js — v3-①-C: 조직 카드 UI
 *
 * 구성:
 *   1) 목록 그리드: stance 필터 칩 + 검색 + 카드 그리드 (type 아이콘, 4지표 미니바)
 *   2) 상세 모달: 4-층 프로파일 편집기
 *      Layer 1 정체성  - 이름, type
 *      Layer 2 관계    - friendliness/trust/importance 1~5 별점
 *      Layer 3 위험도  - riskLevel 3단계 칩 (안전/주의/위험 + 모름)
 *      Layer 4 멤버    - 인물 검색 자동완성 + 추가/제거
 *      + 의미 있는 말씀 / 메모
 *   3) 좌측 시각화: 큰 type 카드 + stance 큰 칩 + 멤버 미니리스트(아바타 5명)
 *
 * 영적 안전장치 (이 STEP 적용분):
 *   - friendliness/trust/importance/riskLevel 모두 null 허용 — "모르겠어요"는 정직한 답.
 *   - stance 변경은 비활성 (v3-①-F의 30초 기도 게이트 도입 후 활성).
 *   - meaningfulVerse 입력 칸 노출 (이 조직을 위한 말씀).
 *
 * 자동 암호화: orgRepo.saveOrganization → encryptionPolicy.organizations 정책에 따라 처리.
 *   plaintext: id, type, stance, friendliness, trust, importance, riskLevel
 *   encrypted: name, memberPersonIds, meaningfulVerse, notes
 */

import {
    saveOrganization,
    getAllOrganizations,
    deleteOrganization,
    changeOrgStance,
} from '../data/orgRepo.js';
import { getAllPersons } from '../data/personRepo.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
import { openStanceGate } from './stanceGate.js';

// ─── 상수 ───
const STANCE_META = {
    ally:      { label: '우호', color: 'var(--dot-green)',  icon: '🤝' },
    neutral:   { label: '중립', color: 'var(--dot-gray)',   icon: '➖' },
    caution:   { label: '주의', color: 'var(--dot-orange)', icon: '⚠️' },
    adversary: { label: '적대', color: 'var(--dot-red)',    icon: '⚡' },
};

const STANCE_FILTERS = [
    { key: 'all',       label: '전체' },
    { key: 'ally',      label: '🤝 우호' },
    { key: 'neutral',   label: '➖ 중립' },
    { key: 'caution',   label: '⚠️ 주의' },
    { key: 'adversary', label: '⚡ 적대' },
];

const TYPE_OPTIONS = [
    ['company',   '회사',     '🏢'],
    ['church',    '교회',     '⛪'],
    ['team',      '팀',       '👥'],
    ['community', '커뮤니티', '🌐'],
    ['family',    '가족',     '👨‍👩‍👧'],
    ['other',     '기타',     '📦'],
];

const RISK_OPTIONS = [
    { key: 'safe',    label: '안전', icon: '✅', color: 'var(--dot-green)' },
    { key: 'caution', label: '주의', icon: '⚠️', color: 'var(--dot-orange)' },
    { key: 'risk',    label: '위험', icon: '🚨', color: 'var(--dot-red)' },
];

// ─── 모듈 상태 ───
let _userId = null;
let _orgs = [];
let _personsCache = [];      // 멤버 자동완성용
let _activeFilter = 'all';
let _searchQuery = '';
let _editingId = null;
let _editingDraft = null;

// ═══════════════════════════════════════════════════════════════════════
//  진입점
// ═══════════════════════════════════════════════════════════════════════

export async function renderOrganizationsView(userId) {
    _userId = userId;
    const container = document.getElementById('view-organizations');
    if (!container) return;

    const dek = getDEK();
    if (!dek) {
        container.innerHTML = lockedTemplate();
        return;
    }

    container.innerHTML = `
        <header class="page-header">
            <h1><i class="page-icon" data-lucide="building-2"></i> 조직</h1>
            <p class="subtitle">조직도 사람의 모임이에요. 한 라벨로 가두지 않습니다.</p>
        </header>
        <div id="orgs-toolbar"></div>
        <div id="orgs-grid"></div>
        <div id="org-modal-root"></div>
    `;

    await loadAll();
    renderToolbar();
    renderGrid();
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

async function loadAll() {
    const dek = getDEK();
    if (!dek) { _orgs = []; _personsCache = []; return; }
    try {
        const [orgs, persons] = await Promise.all([
            getAllOrganizations(dek, _userId),
            getAllPersons(dek, _userId),
        ]);
        _orgs = orgs;
        _personsCache = persons.filter(p => !p.isFallback);
    } catch (e) {
        console.error('orgs load failed:', e);
        _orgs = [];
        _personsCache = [];
        showToast('조직 카드를 불러오는 중에 잠깐 막혔어요. 다시 한 번 들어와 주실래요?');
    }
}

function lockedTemplate() {
    return `
        <header class="page-header"><h1><i class="page-icon" data-lucide="building-2"></i> 조직</h1></header>
        <div class="empty-state">
            <i class="empty-state-icon" data-lucide="lock"></i>
            <h3>잠시 잠겨있어요</h3>
            <p class="empty-state-desc">비밀번호로 열어주세요.</p>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════════
//  툴바 (검색 + 필터 칩 + 새 조직)
// ═══════════════════════════════════════════════════════════════════════

function renderToolbar() {
    const root = document.getElementById('orgs-toolbar');
    if (!root) return;
    root.innerHTML = `
        <div class="orgs-toolbar">
            <div class="orgs-search">
                <input id="orgs-search-input" type="search"
                       placeholder="조직 이름으로 찾기"
                       value="${escapeAttr(_searchQuery)}" />
            </div>
            <div class="orgs-filter-chips">
                ${STANCE_FILTERS.map(f => `
                    <button class="orgs-chip ${f.key === _activeFilter ? 'active' : ''}" data-filter="${f.key}">
                        <span>${f.label}</span>
                        <span class="orgs-chip-count">${countBy(f.key)}</span>
                    </button>
                `).join('')}
            </div>
            <button class="primary-btn orgs-add-btn">+ 새 조직</button>
        </div>
    `;
    root.querySelector('.orgs-add-btn').addEventListener('click', () => openModal(null));
    root.querySelectorAll('.orgs-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeFilter = btn.dataset.filter;
            renderToolbar();
            renderGrid();
        });
    });
    const inp = root.querySelector('#orgs-search-input');
    inp?.addEventListener('input', () => {
        _searchQuery = inp.value || '';
        renderGrid();
    });
}

function countBy(key) {
    if (key === 'all') return _orgs.length;
    return _orgs.filter(o => (o.stance || 'neutral') === key).length;
}

function getFiltered() {
    let list = _orgs.slice();
    if (_activeFilter !== 'all') {
        list = list.filter(o => (o.stance || 'neutral') === _activeFilter);
    }
    if (_searchQuery.trim()) {
        const q = _searchQuery.toLowerCase().trim();
        list = list.filter(o => (o.name || '').toLowerCase().includes(q));
    }
    return list;
}

// ═══════════════════════════════════════════════════════════════════════
//  카드 그리드
// ═══════════════════════════════════════════════════════════════════════

function renderGrid() {
    const root = document.getElementById('orgs-grid');
    if (!root) return;
    const list = getFiltered();
    if (!list.length) {
        root.innerHTML = `
            <div class="empty-state">
                <i class="empty-state-icon" data-lucide="building-2"></i>
                <h3>${_orgs.length === 0 ? '아직 조직 카드가 없어요' : '맞는 조직이 없어요'}</h3>
                <p class="empty-state-desc">
                    ${_orgs.length === 0
                        ? '오른쪽 위 [+ 새 조직]을 눌러 첫 조직을 만들어 볼까요?'
                        : '다른 필터를 골라 보거나 검색어를 비워 보세요.'}
                </p>
            </div>`;
        return;
    }
    root.innerHTML = `<div class="orgs-grid">${list.map(orgCardHtml).join('')}</div>`;
    root.querySelectorAll('.org-card').forEach(card => {
        card.addEventListener('click', () => openModal(card.dataset.orgId));
    });
}

function orgCardHtml(o) {
    const stance = STANCE_META[o.stance || 'neutral'];
    const typeMeta = typeOf(o.type);
    const memberCount = (o.memberPersonIds || []).length;
    return `
        <div class="org-card" data-org-id="${o.id}">
            <div class="org-card-head">
                <div class="org-type-badge" title="${typeMeta.label}">${typeMeta.icon}</div>
                <div class="org-card-meta">
                    <div class="org-card-name">${escapeHtml(o.name || '이름 없음')}</div>
                    <div class="org-card-sub">
                        <span class="org-type-label">${typeMeta.label}</span>
                        <span class="org-member-count">👥 ${memberCount}</span>
                    </div>
                </div>
                <div class="org-stance-pill" style="background:${stance.color}1A;color:${stance.color}">
                    <span>${stance.icon}</span><span>${stance.label}</span>
                </div>
            </div>
            <div class="org-card-mini">
                ${miniIndicatorBars(o)}
            </div>
        </div>
    `;
}

function miniIndicatorBars(o) {
    const rows = [
        { label: '친밀', value: o.friendliness, max: 5 },
        { label: '신뢰', value: o.trust,        max: 5 },
        { label: '중요', value: o.importance,   max: 5 },
        { label: '위험', risk: o.riskLevel },
    ];
    return rows.map(r => {
        if (r.risk !== undefined) {
            return riskMiniBar(r.risk);
        }
        const v = r.value;
        const pct = (v == null) ? 0 : (v / r.max) * 100;
        const dim = (v == null) ? 'mini-bar-dim' : '';
        return `
            <div class="mini-bar-row" title="${r.label}: ${v == null ? '미입력' : v + '/5'}">
                <span class="mini-bar-label">${r.label}</span>
                <span class="mini-bar-track">
                    <span class="mini-bar-fill ${dim}" style="width:${pct}%"></span>
                </span>
            </div>
        `;
    }).join('');
}

function riskMiniBar(riskKey) {
    const meta = RISK_OPTIONS.find(r => r.key === riskKey);
    if (!meta) {
        return `
            <div class="mini-bar-row" title="위험도: 미입력">
                <span class="mini-bar-label">위험</span>
                <span class="mini-bar-track">
                    <span class="mini-bar-fill mini-bar-dim" style="width:0%"></span>
                </span>
            </div>`;
    }
    return `
        <div class="mini-bar-row" title="위험도: ${meta.label}">
            <span class="mini-bar-label">위험</span>
            <span class="risk-mini-pill" style="background:${meta.color}1A;color:${meta.color}">
                ${meta.icon} ${meta.label}
            </span>
        </div>`;
}

function typeOf(t) {
    const found = TYPE_OPTIONS.find(([v]) => v === t);
    if (found) return { value: found[0], label: found[1], icon: found[2] };
    return { value: 'other', label: '기타', icon: '📦' };
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

function openModal(orgId) {
    const original = orgId ? _orgs.find(o => o.id === orgId) : null;
    _editingId = orgId;
    _editingDraft = original ? deepClone(original) : newOrgDraft();
    renderModal();
}

function newOrgDraft() {
    return {
        name: '',
        type: 'company',
        stance: 'neutral',
        friendliness: null,
        trust: null,
        importance: null,
        riskLevel: null,
        memberPersonIds: [],
        meaningfulVerse: '',
        notes: '',
    };
}

function closeModal() {
    _editingId = null;
    _editingDraft = null;
    const root = document.getElementById('org-modal-root');
    if (root) root.innerHTML = '';
}

function renderModal() {
    const root = document.getElementById('org-modal-root');
    if (!root || !_editingDraft) return;
    const o = _editingDraft;
    const stance = STANCE_META[o.stance || 'neutral'];
    const typeMeta = typeOf(o.type);

    root.innerHTML = `
        <div class="modal-overlay org-modal-overlay">
            <div class="modal-content org-modal">
                <div class="org-modal-header">
                    <h3>${_editingId ? '조직 카드' : '새 조직'}</h3>
                    <button class="org-modal-close" aria-label="닫기">✕</button>
                </div>
                <div class="org-modal-body">
                    <aside class="org-detail-left">
                        <div class="org-type-display">
                            <div class="org-type-display-icon">${typeMeta.icon}</div>
                            <div class="org-type-display-label">${typeMeta.label}</div>
                        </div>
                        <div class="org-stance-display">
                            <div class="org-stance-pill big" style="background:${stance.color}1A;color:${stance.color}">
                                <span>${stance.icon}</span><span>${stance.label}</span>
                            </div>
                            ${_editingId ? stanceChangeChipsHtml(o.stance || 'neutral') : `
                            <div class="org-stance-locked-hint">
                                저장한 뒤에 stance를 바꿀 수 있어요.
                            </div>`}
                        </div>
                        <div class="org-member-mini">
                            <div class="org-member-mini-title">멤버 (${(o.memberPersonIds||[]).length})</div>
                            ${memberMiniListHtml(o.memberPersonIds || [])}
                        </div>
                    </aside>
                    <div class="org-detail-right">
                        ${layer1Html(o)}
                        ${layer2Html(o)}
                        ${layer3Html(o)}
                        ${layer4Html(o)}
                        ${layerVerseHtml(o)}
                    </div>
                </div>
                <div class="org-modal-footer">
                    ${_editingId
                        ? '<button class="text-btn org-delete-btn">삭제</button>'
                        : '<span></span>'}
                    <div class="org-modal-actions">
                        <button class="text-btn org-cancel-btn">취소</button>
                        <button class="primary-btn org-save-btn">저장</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    bindModalEvents();
}

function bindModalEvents() {
    const root = document.getElementById('org-modal-root');
    if (!root) return;

    root.querySelector('.org-modal-close')?.addEventListener('click', closeModal);
    root.querySelector('.org-cancel-btn')?.addEventListener('click', closeModal);
    root.querySelector('.org-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('org-modal-overlay')) closeModal();
    });

    root.querySelector('.org-save-btn')?.addEventListener('click', onSave);
    root.querySelector('.org-delete-btn')?.addEventListener('click', onDelete);

    bindLayer1Events(root);
    bindLayer2Events(root);
    bindLayer3Events(root);
    bindLayer4Events(root);

    root.querySelector('#org-meaningful-verse')?.addEventListener('input', (e) => {
        _editingDraft.meaningfulVerse = e.target.value;
    });
    root.querySelector('#org-notes')?.addEventListener('input', (e) => {
        _editingDraft.notes = e.target.value;
    });

    bindStanceChangeEvents(root);
}

// ─── stance 변경 (v3-①-F) ───
function stanceChangeChipsHtml(current) {
    const others = ['ally', 'neutral', 'caution', 'adversary'].filter(s => s !== current);
    return `
        <div class="org-stance-change-row">
            <div class="org-stance-change-label">다른 stance로 옮기기</div>
            <div class="org-stance-change-chips">
                ${others.map(s => {
                    const m = STANCE_META[s];
                    return `
                        <button class="org-stance-change-chip" data-to-stance="${s}"
                                style="border-color:${m.color}; color:${m.color}">
                            ${m.icon} ${m.label}
                        </button>
                    `;
                }).join('')}
            </div>
            <div class="org-stance-change-hint">
                긍정 방향은 바로 적용, 부정 방향은 30초 기도 게이트를 거쳐요.
            </div>
        </div>
    `;
}

function bindStanceChangeEvents(root) {
    root.querySelectorAll('.org-stance-change-chip').forEach(btn => {
        btn.addEventListener('click', async () => {
            const toStance = btn.dataset.toStance;
            if (!_editingId) return;
            const dek = getDEK();
            if (!dek) { showToast('잠겨 있어요. 비밀번호로 먼저 열어 주실래요?'); return; }
            const current = _orgs.find(o => o.id === _editingId);
            if (!current) return;
            const fromStance = current.stance || 'neutral';

            const result = await openStanceGate({
                subjectType: 'org',
                subjectName: current.name || '(이름 없음)',
                fromStance,
                toStance,
            });
            if (!result) return; // 취소
            try {
                await changeOrgStance(dek, _userId, current, toStance, result.reason, result.prayerDone);
                showToast('🙏 stance를 옮겼어요. 이 조직을 위해 기도해 주세요.');
                await loadAll();
                _editingDraft = deepClone(_orgs.find(o => o.id === _editingId));
                renderModal();
                renderToolbar();
                renderGrid();
            } catch (e) {
                console.error('changeOrgStance failed:', e);
                showToast('stance 변경이 잠깐 막혔어요. 다시 시도해 주실래요?');
            }
        });
    });
}

// ─── Layer 1 정체성 ───
function layer1Html(o) {
    return `
        <section class="org-layer">
            <h4 class="org-layer-title">Layer 1 · 정체성</h4>
            <div class="org-row">
                <label>이름</label>
                <input id="o-name" type="text" value="${escapeAttr(o.name || '')}" placeholder="조직 이름" />
            </div>
            <div class="org-row">
                <label>종류</label>
                <select id="o-type">
                    ${TYPE_OPTIONS.map(([v, l, icon]) => `
                        <option value="${v}" ${o.type === v ? 'selected' : ''}>${icon} ${l}</option>
                    `).join('')}
                </select>
            </div>
        </section>
    `;
}

function bindLayer1Events(root) {
    root.querySelector('#o-name')?.addEventListener('input', e => {
        _editingDraft.name = e.target.value;
    });
    root.querySelector('#o-type')?.addEventListener('change', e => {
        _editingDraft.type = e.target.value;
        // 좌측 type 카드 즉시 갱신
        const meta = typeOf(e.target.value);
        const iconEl = root.querySelector('.org-type-display-icon');
        const labelEl = root.querySelector('.org-type-display-label');
        if (iconEl) iconEl.textContent = meta.icon;
        if (labelEl) labelEl.textContent = meta.label;
    });
}

// ─── Layer 2 관계 (1~5 별점) ───
function layer2Html(o) {
    return `
        <section class="org-layer">
            <h4 class="org-layer-title">Layer 2 · 관계</h4>
            <p class="org-layer-hint">"지금 내 눈에 이렇게 보인다"의 거울일 뿐이에요.</p>
            ${rel5Row('friendliness', '우호도', o.friendliness)}
            ${rel5Row('trust',        '신뢰',   o.trust)}
            ${rel5Row('importance',   '중요도', o.importance)}
        </section>
    `;
}

function rel5Row(key, label, value) {
    const v = value == null ? null : Number(value);
    return `
        <div class="rel-row" data-rel-key="${key}">
            <span class="rel-label">${label}</span>
            <div class="rel-stars">
                ${[1,2,3,4,5].map(n => `
                    <button class="rel-star ${v != null && n <= v ? 'active' : ''}" data-rel-value="${n}">★</button>
                `).join('')}
                <button class="rel-clear" title="비우기">✕</button>
            </div>
        </div>
    `;
}

function bindLayer2Events(root) {
    root.querySelectorAll('.rel-row').forEach(row => {
        const key = row.dataset.relKey;
        row.querySelectorAll('.rel-star').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = Number(btn.dataset.relValue);
                _editingDraft[key] = v;
                row.querySelectorAll('.rel-star').forEach(s => {
                    const n = Number(s.dataset.relValue);
                    s.classList.toggle('active', n <= v);
                });
            });
        });
        row.querySelector('.rel-clear')?.addEventListener('click', () => {
            _editingDraft[key] = null;
            row.querySelectorAll('.rel-star').forEach(s => s.classList.remove('active'));
        });
    });
}

// ─── Layer 3 위험도 (3단계 칩) ───
function layer3Html(o) {
    const cur = o.riskLevel;
    return `
        <section class="org-layer">
            <h4 class="org-layer-title">Layer 3 · 위험도</h4>
            <p class="org-layer-hint">조직 자체가 "위험"한 게 아니라, 지금 나의 영적 상태에서 주의가 필요한 정도예요.</p>
            <div class="risk-chips">
                ${RISK_OPTIONS.map(r => `
                    <button class="risk-chip ${cur === r.key ? 'active' : ''}"
                            data-risk-value="${r.key}"
                            style="--risk-color:${r.color}">
                        <span>${r.icon}</span><span>${r.label}</span>
                    </button>
                `).join('')}
                <button class="risk-chip risk-chip-unknown ${cur == null ? 'active' : ''}"
                        data-risk-value="">
                    <span>□</span><span>모르겠어요</span>
                </button>
            </div>
        </section>
    `;
}

function bindLayer3Events(root) {
    root.querySelectorAll('.risk-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.dataset.riskValue || null;
            _editingDraft.riskLevel = v;
            root.querySelectorAll('.risk-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

// ─── Layer 4 멤버 관리 ───
function layer4Html(o) {
    const ids = o.memberPersonIds || [];
    return `
        <section class="org-layer" id="org-layer-4">
            <h4 class="org-layer-title">Layer 4 · 멤버</h4>
            <p class="org-layer-hint">이 조직에 속한 사람들을 인물 카드와 연결해 두면, 만남이 일어날 때 자연히 떠올라요.</p>
            <div class="member-add-row">
                <input id="member-add-input" type="text"
                       list="member-suggestions"
                       placeholder="인물 이름 검색 후 Enter 또는 [+ 추가]" />
                <datalist id="member-suggestions">
                    ${memberSuggestionOptions(ids)}
                </datalist>
                <button class="text-btn" id="member-add-btn">+ 추가</button>
            </div>
            <div class="member-list" id="member-list">
                ${memberChipsHtml(ids)}
            </div>
        </section>
    `;
}

function memberSuggestionOptions(currentIds) {
    return _personsCache
        .filter(p => !currentIds.includes(p.id))
        .map(p => `<option value="${escapeAttr(p.name || '')}" data-person-id="${p.id}"></option>`)
        .join('');
}

function memberChipsHtml(ids) {
    if (!ids.length) {
        return `<div class="member-empty">아직 멤버가 없어요.</div>`;
    }
    return ids.map(pid => {
        const p = _personsCache.find(x => x.id === pid);
        const name = p?.name || '(알 수 없는 인물)';
        const initial = (name || '?').slice(0, 1);
        return `
            <span class="member-chip" data-person-id="${pid}">
                <span class="member-avatar" style="background:${avatarColor(pid)}">${escapeHtml(initial)}</span>
                <span class="member-name">${escapeHtml(name)}</span>
                <button class="member-remove" title="제거" aria-label="제거">✕</button>
            </span>
        `;
    }).join('');
}

function memberMiniListHtml(ids) {
    if (!ids.length) {
        return `<div class="org-member-mini-empty">아직 멤버가 없어요</div>`;
    }
    const shown = ids.slice(0, 5);
    const extra = ids.length - shown.length;
    const items = shown.map(pid => {
        const p = _personsCache.find(x => x.id === pid);
        const name = p?.name || '(?)';
        const initial = (name || '?').slice(0, 1);
        return `
            <div class="org-member-mini-item" title="${escapeAttr(name)}">
                <span class="member-avatar" style="background:${avatarColor(pid)}">${escapeHtml(initial)}</span>
                <span class="org-member-mini-name">${escapeHtml(name)}</span>
            </div>`;
    }).join('');
    const more = extra > 0 ? `<div class="org-member-mini-more">+${extra}명 더</div>` : '';
    return items + more;
}

function bindLayer4Events(root) {
    const input = root.querySelector('#member-add-input');
    const addBtn = root.querySelector('#member-add-btn');
    const list = root.querySelector('#member-list');

    const tryAdd = () => {
        const name = (input?.value || '').trim();
        if (!name) return;
        const matched = _personsCache.find(p => (p.name || '') === name);
        if (!matched) {
            showToast('인물 카드에 없는 이름이에요. 인물 뷰에서 먼저 추가해 주실래요?');
            return;
        }
        const ids = _editingDraft.memberPersonIds || [];
        if (ids.includes(matched.id)) {
            showToast('이미 추가된 멤버예요');
            return;
        }
        ids.push(matched.id);
        _editingDraft.memberPersonIds = ids;
        input.value = '';
        refreshMemberSection(root);
    };

    addBtn?.addEventListener('click', tryAdd);
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            tryAdd();
        }
    });

    list?.querySelectorAll('.member-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const chip = btn.closest('.member-chip');
            const pid = chip?.dataset.personId;
            if (!pid) return;
            _editingDraft.memberPersonIds = (_editingDraft.memberPersonIds || []).filter(id => id !== pid);
            refreshMemberSection(root);
        });
    });
}

function refreshMemberSection(root) {
    const layer = root.querySelector('#org-layer-4');
    if (layer) {
        layer.outerHTML = layer4Html(_editingDraft);
        bindLayer4Events(root);
    }
    // 좌측 멤버 미니리스트 + 카운트도 갱신
    const ids = _editingDraft.memberPersonIds || [];
    const miniWrap = root.querySelector('.org-member-mini');
    if (miniWrap) {
        miniWrap.innerHTML = `
            <div class="org-member-mini-title">멤버 (${ids.length})</div>
            ${memberMiniListHtml(ids)}
        `;
    }
}

// ─── 의미 있는 말씀 + 메모 ───
function layerVerseHtml(o) {
    return `
        <section class="org-layer">
            <h4 class="org-layer-title">이 조직을 위한 말씀 / 메모</h4>
            <div class="org-row">
                <label>의미 있는 말씀</label>
                <input id="org-meaningful-verse" type="text"
                       value="${escapeAttr(o.meaningfulVerse || '')}"
                       placeholder="예: 마태복음 18:20" />
            </div>
            <div class="org-row">
                <label>메모</label>
                <textarea id="org-notes" rows="3"
                    placeholder="기억할 만한 사실, 약속, 기도 제목 등">${escapeHtml(o.notes || '')}</textarea>
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
    if (!(draft.name || '').trim()) {
        showToast('조직 이름을 적어 주실래요?');
        return;
    }

    try {
        await saveOrganization(dek, _userId, draft);
        showToast('🔐 안전하게 보관됐어요');
        await loadAll();
        renderToolbar();
        renderGrid();
        closeModal();
    } catch (e) {
        console.error('saveOrganization failed:', e);
        showToast('저장이 잠깐 막혔어요. 잠시 후 다시 시도해 주실래요?');
    }
}

async function onDelete() {
    if (!_editingId) return;
    const ok = confirm('이 조직 카드를 지워도 괜찮을까요? 한 번 지우면 되돌릴 수 없어요.');
    if (!ok) return;
    try {
        await deleteOrganization(_userId, _editingId);
        showToast('카드를 지웠어요');
        await loadAll();
        renderToolbar();
        renderGrid();
        closeModal();
    } catch (e) {
        console.error('deleteOrganization failed:', e);
        showToast('지우는 중에 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
    }
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
