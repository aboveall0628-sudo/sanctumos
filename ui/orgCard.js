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
import { getAllDots } from '../data/dotsRepo.js';
import { computeAllOrgStats, formatMinutes, formatTrend, slotToTimeStr, ratingDotsHtml } from '../data/cardStats.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
import { openStanceGate } from './stanceGate.js';
import { personDisplayHtml } from './personNameFormat.js';

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
    ['company',   '회사',          '🏢'],
    ['church',    '교회',          '⛪'],
    ['team',      '팀',            '👥'],
    ['community', '커뮤니티/모임', '🌐'],
    ['school',    '학교/학원',     '🏫'],
    ['place',     '동네 시설',     '🏪'],
    ['family',    '가족',          '👨‍👩‍👧'],
    ['other',     '기타',          '📦'],
];

// 종류 선택 시 어떤 조직이 이쪽인지 한 줄로 안내. select 옆 hint로 노출.
const TYPE_GUIDE = {
    company:   '직장·아르바이트처럼 일로 엮인 곳',
    church:    '예배·신앙 공동체',
    team:      '프로젝트팀·동아리·스터디처럼 함께 일하는 사람들',
    community: '교제 중심 모임·동호회·소그룹',
    school:    '학교·학원·교습 기관',
    place:     '수영장·헬스장·카페·병원처럼 자주 다니는 동네 장소',
    family:    '가족·친척 단위',
    other:     '어디에도 안 맞으면 여기로',
};

const RISK_OPTIONS = [
    { key: 'safe',    label: '안전', icon: '✅', color: 'var(--dot-green)' },
    { key: 'caution', label: '주의', icon: '⚠️', color: 'var(--dot-orange)' },
    { key: 'risk',    label: '위험', icon: '🚨', color: 'var(--dot-red)' },
];

// ─── 모듈 상태 ───
let _userId = null;
let _orgs = [];
let _personsCache = [];      // 멤버 자동완성용
let _statsMap = new Map();   // orgId → 도트 누적 통계 ("함께한 흔적")
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
    if (!dek) { _orgs = []; _personsCache = []; _statsMap = new Map(); return; }
    try {
        const [orgs, persons, dots] = await Promise.all([
            getAllOrganizations(dek, _userId),
            getAllPersons(dek, _userId),
            getAllDots(dek, _userId).catch(e => { console.warn('dots load for stats failed:', e); return []; }),
        ]);
        _orgs = orgs;
        _personsCache = persons.filter(p => !p.isFallback);
        _statsMap = computeAllOrgStats(dots);
    } catch (e) {
        console.error('orgs load failed:', e);
        _orgs = [];
        _personsCache = [];
        _statsMap = new Map();
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
    const stats = _statsMap.get(o.id);
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
            ${miniStatsHtml(stats)}
        </div>
    `;
}

/** 그리드 카드 하단 미니 통계 한 줄. 누적 0이면 표시 X. */
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

// ─── 함께한 흔적 (도트 통계) — 인물 카드와 같은 정책 ───
// 자동 조정 금지. 통계는 표시만, 슬라이더 조정은 사용자가 직접.
function footprintHtml(o) {
    const stats = _editingId ? _statsMap.get(_editingId) : null;
    if (!stats || stats.meetingCount === 0) {
        return `
            <section class="org-layer">
                <h4 class="org-layer-title">함께한 흔적</h4>
                <p class="org-layer-hint">
                    아직 함께한 도트가 없어요. 시간표에서 이 조직과의 시간을 기록하면 여기에 누적돼요.
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

    // 간결한 한 줄 요약 + 토글로 펼쳐 보는 최근 만남 리스트. 큰 칸을 4개 깔던
    // 기존 그리드는 정보 밀도에 비해 자리만 크게 차지해서 정리.
    const avgText = avg != null ? `${avg.toFixed(1)}` : '미평가';
    return `
        <section class="org-layer footprint-section footprint-quiet">
            <div class="footprint-summary">
                <h4 class="org-layer-title">함께한 흔적</h4>
                <div class="footprint-summary-stats">
                    <span class="footprint-stat"><span class="footprint-stat-num">${stats.meetingCount}</span><span class="footprint-stat-unit">번</span></span>
                    <span class="footprint-stat-divider">·</span>
                    <span class="footprint-stat">${avg != null ? ratingDotsHtml(avg) : ''}<span class="footprint-stat-unit">${avgText}</span></span>
                    <span class="footprint-stat-divider">·</span>
                    <span class="footprint-stat"><span class="footprint-stat-num">${formatMinutes(stats.totalMinutes)}</span></span>
                </div>
            </div>
            <p class="footprint-trend-line">${escapeHtml(trendNote)}</p>
            ${stats.recentDots.length > 0 ? `
                <details class="footprint-recent-details">
                    <summary>최근 만남 ${stats.recentDots.length}건 보기</summary>
                    <ul class="footprint-recent-list">${recentList}</ul>
                </details>
            ` : ''}
        </section>
    `;
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
        foundedDate: '',     // 설립일/시작일 (선택)
        anniversaries: [],   // [{ date, label }]
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
                        ${footprintHtml(o)}
                        ${layer2Html(o)}
                        ${layer3Html(o)}
                        ${layer4Html(o)}
                        ${anniversariesHtml(o)}
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

    root.querySelector('#org-notes')?.addEventListener('input', (e) => {
        _editingDraft.notes = e.target.value;
    });

    bindOrgAnnivEvents(root);
    bindStanceChangeEvents(root);
    bindAxisUnlockEvents(root);
}

/**
 * 🔒 lock 해제 (↻) 버튼 — 조직 카드의 unlocked 축을 도트 derived 값으로 즉시 되돌림.
 */
function bindAxisUnlockEvents(root) {
    root.addEventListener('click', async (e) => {
        const btn = e.target.closest('.axis-unlock-btn');
        if (!btn) return;
        const rowEl = btn.closest('[data-axis]');
        if (!rowEl) return;
        const axis = rowEl.dataset.axis;
        if (!axis) return;

        if (_editingDraft.locked) {
            delete _editingDraft.locked[axis];
        }
        try {
            const stats = _editingId ? _statsMap.get(_editingId) : null;
            const { applyDerivedToOrg } = await import('../data/derivedScores.js');
            applyDerivedToOrg(_editingDraft, stats);
        } catch (err) { console.warn('org axis re-derive failed:', err); }

        // 영향받은 레이어 다시 그리기
        if (axis === 'riskLevel') {
            const sec = root.querySelector('#org-layer-3');
            if (sec) {
                sec.outerHTML = layer3Html(_editingDraft);
                bindLayer3Events(root);
            }
        } else {
            const sec = root.querySelector('#org-layer-2');
            if (sec) {
                sec.outerHTML = layer2Html(_editingDraft);
                bindLayer2Events(root);
            }
        }
    });
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
    const guide = TYPE_GUIDE[o.type] || TYPE_GUIDE.other;
    return `
        <section class="org-layer">
            <h4 class="org-layer-title">Layer 1 · 정체성</h4>
            <p class="org-layer-hint">조직이라기보단 "함께 시간을 보내는 단위"예요. 동네 수영장처럼 사람 단위가 아닌 장소도 여기 넣어두면 도트가 흔적을 모아줘요.</p>
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
            <p class="org-type-guide" id="o-type-guide">${escapeHtml(guide)}</p>
        </section>
    `;
}

function bindLayer1Events(root) {
    root.querySelector('#o-name')?.addEventListener('input', e => {
        _editingDraft.name = e.target.value;
    });
    root.querySelector('#o-type')?.addEventListener('change', e => {
        _editingDraft.type = e.target.value;
        const meta = typeOf(e.target.value);
        const iconEl = root.querySelector('.org-type-display-icon');
        const labelEl = root.querySelector('.org-type-display-label');
        if (iconEl) iconEl.textContent = meta.icon;
        if (labelEl) labelEl.textContent = meta.label;
        const guideEl = root.querySelector('#o-type-guide');
        if (guideEl) guideEl.textContent = TYPE_GUIDE[e.target.value] || TYPE_GUIDE.other;
    });
}

// ─── Layer 2 관계 (1~5 별점) ───
function layer2Html(o) {
    return `
        <section class="org-layer" id="org-layer-2">
            <h4 class="org-layer-title">Layer 2 · 관계</h4>
            <p class="org-layer-hint">
                "지금 내 눈에 이렇게 보인다"의 거울일 뿐이에요.<br>
                🔒 내가 정한 값 · 📊 도트가 만든 값 — 표시 옆 작은 마크로 알 수 있어요.
            </p>
            ${rel5Row('friendliness', '우호도', o.friendliness, !!((o.locked||{}).friendliness))}
            ${rel5Row('trust',        '신뢰',   o.trust,        !!((o.locked||{}).trust))}
            ${rel5Row('importance',   '중요도', o.importance,   !!((o.locked||{}).importance))}
        </section>
    `;
}

function rel5Row(key, label, value, locked) {
    const v = value == null ? null : Number(value);
    return `
        <div class="rel-row" data-rel-key="${key}" data-axis="${escapeAttr(key)}" data-axis-kind="orgRel">
            <span class="rel-label">${label}</span>
            <div class="rel-stars">
                ${[1,2,3,4,5].map(n => `
                    <button class="rel-star ${v != null && n <= v ? 'active' : ''}" data-rel-value="${n}">★</button>
                `).join('')}
                <button class="rel-clear" title="비우기">✕</button>
                ${orgLockBadgeHtml(locked, v == null)}
            </div>
        </div>
    `;
}

function orgLockBadgeHtml(locked, isNull) {
    if (isNull) return '';
    if (locked) {
        return `
            <span class="axis-lock-badge axis-locked" title="내가 직접 정한 값. 도트가 자동으로 바꾸지 않아요.">🔒 내가 정함</span>
            <button type="button" class="axis-unlock-btn" data-action="unlock" title="도트가 만든 값으로 되돌리기">↻</button>
        `;
    }
    return `<span class="axis-lock-badge axis-derived" title="도트 만족도 누적에서 자동으로 만들어진 값이에요.">📊 도트가 만듦</span>`;
}

function bindLayer2Events(root) {
    root.querySelectorAll('.rel-row').forEach(row => {
        const key = row.dataset.relKey;
        row.querySelectorAll('.rel-star').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = Number(btn.dataset.relValue);
                _editingDraft[key] = v;
                // 사용자가 직접 조정한 축 lock → 도트 자동 갱신 차단
                _editingDraft.locked = _editingDraft.locked || {};
                _editingDraft.locked[key] = true;
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
    const locked = !!((o.locked || {}).riskLevel);
    return `
        <section class="org-layer" id="org-layer-3" data-axis="riskLevel" data-axis-kind="orgRel">
            <h4 class="org-layer-title">
                Layer 3 · 위험도
                <span class="risk-lock-slot">${orgLockBadgeHtml(locked, cur == null)}</span>
            </h4>
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
            _editingDraft.locked = _editingDraft.locked || {};
            _editingDraft.locked.riskLevel = true;
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
            <div class="member-add-row qr-ac-wrap">
                <input id="member-add-input" type="text" autocomplete="off"
                       placeholder="인물 이름이나 별명을 입력해요" />
                <button class="primary-btn member-add-btn" id="member-add-btn" type="button" aria-label="멤버 추가">
                    <i data-lucide="user-plus" class="btn-icon"></i> 추가
                </button>
                <div id="member-ac" class="qr-ac-panel hidden" role="listbox" aria-label="인물 후보"></div>
            </div>
            <div class="member-list" id="member-list">
                ${memberChipsHtml(ids)}
            </div>
        </section>
    `;
}

function memberAutocompleteCandidates(query, currentIds) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return _personsCache
        .filter(p => !currentIds.includes(p.id))
        .filter(p => {
            const name = (p.name || '').toLowerCase();
            if (name.includes(q)) return true;
            return Array.isArray(p.nicknames) && p.nicknames.some(n => (n || '').toLowerCase().includes(q));
        })
        .slice(0, 8);
}

function memberChipsHtml(ids) {
    if (!ids.length) {
        return `<div class="member-empty">아직 멤버가 없어요.</div>`;
    }
    return ids.map(pid => {
        const p = _personsCache.find(x => x.id === pid);
        const name = p?.name || '(알 수 없는 인물)';
        const initial = (name || '?').slice(0, 1);
        const displayHtml = p ? personDisplayHtml(p, escapeHtml) : escapeHtml(name);
        return `
            <span class="member-chip" data-person-id="${pid}">
                <span class="member-avatar" style="background:${avatarColor(pid)}">${escapeHtml(initial)}</span>
                <span class="member-name">${displayHtml}</span>
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
        const displayHtml = p ? personDisplayHtml(p, escapeHtml) : escapeHtml(name);
        return `
            <div class="org-member-mini-item" title="${escapeAttr(name)}">
                <span class="member-avatar" style="background:${avatarColor(pid)}">${escapeHtml(initial)}</span>
                <span class="org-member-mini-name">${displayHtml}</span>
            </div>`;
    }).join('');
    const more = extra > 0 ? `<div class="org-member-mini-more">+${extra}명 더</div>` : '';
    return items + more;
}

function bindLayer4Events(root) {
    const input = root.querySelector('#member-add-input');
    const addBtn = root.querySelector('#member-add-btn');
    const list = root.querySelector('#member-list');
    const acPanel = root.querySelector('#member-ac');

    const addMemberById = (pid) => {
        if (!pid) return false;
        const ids = _editingDraft.memberPersonIds || [];
        if (ids.includes(pid)) { showToast('이미 추가된 멤버예요'); return false; }
        ids.push(pid);
        _editingDraft.memberPersonIds = ids;
        input.value = '';
        if (acPanel) { acPanel.classList.add('hidden'); acPanel.innerHTML = ''; }
        refreshMemberSection(root);
        return true;
    };

    const tryAddByText = () => {
        const name = (input?.value || '').trim();
        if (!name) return;
        const matched = _personsCache.find(p =>
            (p.name || '') === name ||
            (Array.isArray(p.nicknames) && p.nicknames.includes(name))
        );
        if (!matched) {
            showToast('인물 카드에 없는 이름이에요. 인물 뷰에서 먼저 추가해 주실래요?');
            return;
        }
        addMemberById(matched.id);
    };

    const refreshAc = () => {
        if (!acPanel) return;
        const q = input.value;
        const ids = _editingDraft.memberPersonIds || [];
        const cands = memberAutocompleteCandidates(q, ids);
        if (cands.length === 0) {
            acPanel.classList.add('hidden');
            acPanel.innerHTML = '';
            return;
        }
        acPanel.innerHTML = cands.map(p => {
            const nicks = Array.isArray(p.nicknames) ? p.nicknames.filter(Boolean) : [];
            const sub = nicks.length
                ? ` <span class="qr-ac-sub">(${escapeHtml(nicks.join(', '))})</span>`
                : '';
            return `<button type="button" class="qr-ac-item" data-person-id="${escapeAttr(p.id)}" role="option">${escapeHtml(p.name || '')}${sub}</button>`;
        }).join('');
        acPanel.classList.remove('hidden');
    };

    addBtn?.addEventListener('click', tryAddByText);
    input?.addEventListener('input', refreshAc);
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); tryAddByText(); }
        if (e.key === 'Escape' && acPanel) { acPanel.classList.add('hidden'); }
    });
    acPanel?.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.qr-ac-item');
        if (!item) return;
        e.preventDefault(); // input blur 방지
        addMemberById(item.dataset.personId);
    });
    document.addEventListener('click', (e) => {
        if (!acPanel) return;
        if (!e.target.closest('.qr-ac-wrap')) acPanel.classList.add('hidden');
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

// ─── 설립일·기념일 ───
function anniversariesHtml(o) {
    const annivs = Array.isArray(o.anniversaries) ? o.anniversaries : [];
    const rows = annivs.map((a, i) => `
        <div class="anniv-row" data-idx="${i}">
            <input class="anniv-date" type="date" value="${escapeAttr(a.date || '')}" />
            <input class="anniv-label" type="text" value="${escapeAttr(a.label || '')}" placeholder="예: 창립일·시즌오픈" />
            <button class="anniv-remove text-btn" type="button" aria-label="삭제">✕</button>
        </div>
    `).join('');
    return `
        <section class="org-layer" id="org-anniv-layer">
            <h4 class="org-layer-title">설립일 · 기념일</h4>
            <p class="org-layer-hint">조직의 시작일과 챙기고 싶은 날을 두세요. 비워둬도 괜찮아요.</p>
            <div class="org-row">
                <label>설립일</label>
                <input id="o-founded" type="date" value="${escapeAttr(o.foundedDate || '')}" />
            </div>
            <div class="anniv-list" id="org-anniv-list">${rows}</div>
            <button type="button" id="org-anniv-add" class="text-btn">+ 기념일 추가</button>
        </section>
    `;
}

function bindOrgAnnivEvents(root) {
    root.querySelector('#o-founded')?.addEventListener('change', e => {
        _editingDraft.foundedDate = e.target.value;
    });
    root.querySelector('#org-anniv-add')?.addEventListener('click', () => {
        const list = Array.isArray(_editingDraft.anniversaries) ? _editingDraft.anniversaries : [];
        list.push({ date: '', label: '' });
        _editingDraft.anniversaries = list;
        const layer = root.querySelector('#org-anniv-layer');
        if (layer) {
            layer.outerHTML = anniversariesHtml(_editingDraft);
            bindOrgAnnivEvents(root);
        }
    });
    root.querySelectorAll('#org-anniv-list .anniv-row').forEach(row => {
        const idx = parseInt(row.dataset.idx, 10);
        row.querySelector('.anniv-date')?.addEventListener('change', e => {
            _editingDraft.anniversaries[idx].date = e.target.value;
        });
        row.querySelector('.anniv-label')?.addEventListener('input', e => {
            _editingDraft.anniversaries[idx].label = e.target.value;
        });
        row.querySelector('.anniv-remove')?.addEventListener('click', () => {
            _editingDraft.anniversaries.splice(idx, 1);
            const layer = root.querySelector('#org-anniv-layer');
            if (layer) {
                layer.outerHTML = anniversariesHtml(_editingDraft);
                bindOrgAnnivEvents(root);
            }
        });
    });
}

// ─── 메모 ───
function layerVerseHtml(o) {
    return `
        <section class="org-layer">
            <h4 class="org-layer-title">메모</h4>
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
