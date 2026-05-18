/**
 * feedbackAdmin.js — Swan 관리자 페이지 (CS AI 트랙 §9 6·7·8단계)
 *
 * 2026-05-15 신규.
 *
 * 기능:
 *   - 탭 3개 (피드백 / 사전 설문 / 사후 설문) — feedbacksRepo.kind 별 필터
 *   - 리스트: 시간순 · ●○ 읽음 · 검색 · 필터 · 다중 선택 + 묶음 markdown 복사
 *   - 상세: 메타 9 라벨 · 자동 분류 (수정 가능) · 자동 요약 · 대화 원본 · Swan 메모 · 단건 복사 · 자동 read 토글
 *   - 사전 설문 surveyExtract 표 보기
 *   - 1차 베타엔 삭제 X — archived 상태만 (CS AI Rule 9 §10 합의)
 *
 * 권한:
 *   - 시각 차단: isSwanAdmin(uid) — 호출 측이 가드 (app.js 뷰 진입 분기)
 *   - 데이터 차단: Firestore 보안 규칙 (firestore.rules feedbacks 매처)
 */

import {
    getAllFeedbacksForAdmin,
    getMyFeedbacks,
    markAsRead,
    markAsUnread,
    softDeleteFeedback,
    restoreFeedback,
    deleteFeedback,
} from '../data/feedbacksRepo.js';
import { isSwanAdmin } from '../config/adminConfig.js';
import { db, collectionGroup, onSnapshot } from '../data/firebase.js';
import { showToast } from './quickReview.js';

// ─── 모듈 상태 ───────────────────────────────────────────────
let _state = {
    userId:   null,
    mode:     'list',          // 'list' | 'detail'
    kindTab:  'feedback',      // 'feedback' | 'preSurvey' | 'postSurvey'
    rows:     [],              // 현재 탭의 모든 피드백 (서버 fetch 결과)
    filtered: [],              // 검색·필터 적용 후 표시 대상
    visible:  [],              // 페이지 크기 적용 후 실제 그려지는 자리
    selectedIds: new Set(),    // 묶음 복사용 체크박스
    detailId: null,            // 현재 상세 보고 있는 feedbackId
    // 필터 상태
    search:   '',
    statusF:  'all',           // 'all' | 'unread' | 'read'
    categoryF: 'all',          // 'all' | 'error' | 'ux_ui' | 'feature_request' | 'other'
    sortDir:  'desc',          // 'desc' (최신) | 'asc' (오래된)
    pageSize: 10,              // (2026-05-18) 페이지 크기 — 10·50·100 옵션
};

// ─── 진입점 ──────────────────────────────────────────────────

export async function renderFeedbackAdminView(userId) {
    _state.userId = userId;

    const container = document.getElementById('view-feedback-admin');
    if (!container) {
        console.warn('[feedbackAdmin] container not found');
        return;
    }

    // 권한 가드 (시각) — 호출 측에서 한 번 더 잠긴 상태로 둠
    if (!isSwanAdmin(userId)) {
        container.innerHTML = `
            <div class="fbadmin-empty">
                <p>이 페이지는 운영자 전용이에요.</p>
            </div>`;
        return;
    }

    // (2026-05-18 fix) 뒤로가기 자연 자리잡기 — history.state 의 detailId 보고 mode 결정.
    //   사용자가 detail 진입 후 브라우저 뒤로가기 → popstate → switchView('feedback-admin')
    //   → 이 함수 재호출 → 이 자리에서 detail/list 자연 분기.
    try {
        const histState = (typeof history !== 'undefined' && history.state) || {};
        if (histState.view === 'feedback-admin' && histState.detailId) {
            _state.mode = 'detail';
            _state.detailId = histState.detailId;
            _state.detailOwnerUserId = histState.ownerUserId || null;
        } else {
            _state.mode = 'list';
            _state.detailId = null;
        }
    } catch (_) { /* incognito 환경 안전 */ }

    await refreshAndRender();
}

async function refreshAndRender() {
    const container = document.getElementById('view-feedback-admin');
    if (!container) return;

    // 로딩 자리잡음
    container.innerHTML = `<div class="fbadmin-empty"><p>불러오는 중이에요…</p></div>`;

    try {
        _state.rows = await getAllFeedbacksForAdmin({
            limit:   200,
            orderDir: _state.sortDir,
        });
        console.log(`[feedbackAdmin] loaded ${_state.rows.length} feedback(s) total`,
            _state.rows.map(r => ({ id: r.id, kind: r.kind || 'feedback', userId: r.userId, status: r.status })));

        // (2026-05-16 fix) collectionGroup 쿼리가 권한·인덱스 문제로 비어 돌아오는 경우
        //   본인 자기 데이터는 직접 쿼리로 합쳐 fallback 보장.
        if (_state.rows.length === 0 && _state.userId) {
            try {
                const myOwn = await getMyFeedbacks(_state.userId, 200);
                if (myOwn.length > 0) {
                    console.log(`[feedbackAdmin] fallback: 본인 자기 ${myOwn.length}건 합류`);
                    _state.rows = myOwn;
                }
            } catch (e2) {
                console.warn('[feedbackAdmin] my-own fallback failed:', e2);
            }
        }
    } catch (e) {
        console.error('[feedbackAdmin] load failed:', e);
        // collectionGroup 쿼리 실패 — 본인 자기 데이터만이라도 보여주기
        try {
            const myOwn = await getMyFeedbacks(_state.userId, 200);
            _state.rows = myOwn;
            console.warn('[feedbackAdmin] fallback to my-own only:', myOwn.length);
        } catch (e2) {
            container.innerHTML = `
                <div class="fbadmin-empty">
                    <p>불러오기에 실패했어요. 새로고침해 볼까요?</p>
                    <p style="color:var(--ink-tertiary);font-size:13px">${escapeHtml(e?.message || String(e))}</p>
                </div>`;
            return;
        }
    }

    if (_state.mode === 'detail' && _state.detailId) {
        renderDetail(container);
    } else {
        renderList(container);
    }
}

// ─── 리스트 렌더 ─────────────────────────────────────────────

function renderList(container) {
    const filtered = applyFilters(_state.rows, _state.kindTab, _state);
    _state.filtered = filtered;
    // (2026-05-18) 페이지 크기 적용 — 클라이언트 자르기
    const visible = filtered.slice(0, _state.pageSize);
    _state.visible = visible;

    // 탭별 카운트
    const counts = countByKind(_state.rows);
    // (2026-05-18) 전체 선택 체크박스 자리 — 현재 보이는 자리 모두 선택됐는지
    const allSelected = visible.length > 0 && visible.every(r => _state.selectedIds.has(r.id));
    const someSelected = visible.some(r => _state.selectedIds.has(r.id));

    container.innerHTML = `
        <header class="fbadmin-header">
            <h2 class="fbadmin-title">피드백 관리</h2>
            <p class="fbadmin-subtitle">베타 사용자 풍선 + SWAN 사전·사후 설문 결과</p>
        </header>

        <nav class="fbadmin-tabs" role="tablist">
            ${renderTabButton('feedback',   '피드백',     counts.feedback)}
            ${renderTabButton('preSurvey',  '사전 설문',  counts.preSurvey)}
            ${renderTabButton('postSurvey', '사후 설문',  counts.postSurvey)}
            ${renderTabButton('trash',      '휴지통',     counts.trash)}
        </nav>

        <!-- (2026-05-18) 네이버 메일 톤 — 액션 줄 + 필터 줄 2단 -->
        <div class="fbadmin-action-row">
            <label class="fbadmin-select-all-box">
                <input type="checkbox" id="fbadmin-select-all"
                       ${allSelected ? 'checked' : ''}>
            </label>
            ${_state.kindTab === 'trash' ? `
                <button type="button" class="fbadmin-action-btn" id="fbadmin-bulk-restore">↩ 복구</button>
                <button type="button" class="fbadmin-action-btn fbadmin-action-danger" id="fbadmin-bulk-hard-delete">영구 삭제</button>
            ` : `
                <button type="button" class="fbadmin-action-btn" id="fbadmin-bulk-read">읽음</button>
                <button type="button" class="fbadmin-action-btn" id="fbadmin-bulk-unread">안읽음</button>
                <button type="button" class="fbadmin-action-btn fbadmin-action-danger" id="fbadmin-bulk-soft-delete">🗑 삭제</button>
            `}
            <button type="button" class="fbadmin-action-btn" id="fbadmin-bulk-copy">📋 복사</button>
            <span class="fbadmin-action-count">${_state.selectedIds.size > 0 ? `${_state.selectedIds.size}건 선택` : ''}</span>
        </div>

        <div class="fbadmin-toolbar">
            <input type="search" id="fbadmin-search" class="fbadmin-search"
                   placeholder="본문·요약·닉네임 검색…" value="${escapeHtml(_state.search)}">
            <select id="fbadmin-status-filter" class="fbadmin-select">
                <option value="all"    ${_state.statusF==='all'?'selected':''}>전체</option>
                <option value="unread" ${_state.statusF==='unread'?'selected':''}>미확인</option>
                <option value="read"   ${_state.statusF==='read'?'selected':''}>확인</option>
            </select>
            ${_state.kindTab === 'feedback' ? `
                <select id="fbadmin-category-filter" class="fbadmin-select">
                    <option value="all"             ${_state.categoryF==='all'?'selected':''}>전체 분류</option>
                    <option value="error"           ${_state.categoryF==='error'?'selected':''}>🔴 오류</option>
                    <option value="ux_ui"           ${_state.categoryF==='ux_ui'?'selected':''}>🟡 UX·UI</option>
                    <option value="feature_request" ${_state.categoryF==='feature_request'?'selected':''}>🔵 신기능</option>
                    <option value="other"           ${_state.categoryF==='other'?'selected':''}>⚪ 기타</option>
                </select>
            ` : ''}
            <select id="fbadmin-sort" class="fbadmin-select">
                <option value="desc" ${_state.sortDir==='desc'?'selected':''}>최신순</option>
                <option value="asc"  ${_state.sortDir==='asc'?'selected':''}>오래된순</option>
            </select>
            <select id="fbadmin-page-size" class="fbadmin-select" aria-label="페이지 크기">
                <option value="10"  ${_state.pageSize===10?'selected':''}>10줄 보기</option>
                <option value="50"  ${_state.pageSize===50?'selected':''}>50줄 보기</option>
                <option value="100" ${_state.pageSize===100?'selected':''}>100줄 보기</option>
            </select>
        </div>

        <div class="fbadmin-list-meta">
            전체 ${filtered.length}건 · 지금 ${visible.length}건 표시${filtered.length > visible.length ? ` (${filtered.length - visible.length}건 더 있음)` : ''}
        </div>

        <div class="fbadmin-list">
            ${filtered.length === 0
                ? `<div class="fbadmin-empty"><p>아직 ${tabLabel(_state.kindTab)} 자료가 없어요.</p></div>`
                : visible.map(row => renderListRow(row, _state.kindTab)).join('')}
        </div>
    `;

    // indeterminate 상태는 HTML attribute 로 안 박힘 — JS 로 자리잡기
    const selectAllEl = container.querySelector('#fbadmin-select-all');
    if (selectAllEl && !allSelected && someSelected) {
        selectAllEl.indeterminate = true;
    }

    // 이벤트 바인딩
    container.querySelectorAll('.fbadmin-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _state.kindTab = btn.dataset.kind;
            _state.selectedIds.clear();
            renderList(container);
        });
    });
    container.querySelector('#fbadmin-search')?.addEventListener('input', (e) => {
        _state.search = e.target.value;
        renderList(container);
        const focusEl = container.querySelector('#fbadmin-search');
        if (focusEl) {
            focusEl.focus();
            // 캐럿 보존 — 끝으로 이동
            const len = focusEl.value.length;
            try { focusEl.setSelectionRange(len, len); } catch (_) {}
        }
    });
    container.querySelector('#fbadmin-status-filter')?.addEventListener('change', (e) => {
        _state.statusF = e.target.value;
        renderList(container);
    });
    container.querySelector('#fbadmin-category-filter')?.addEventListener('change', (e) => {
        _state.categoryF = e.target.value;
        renderList(container);
    });
    container.querySelector('#fbadmin-sort')?.addEventListener('change', (e) => {
        _state.sortDir = e.target.value;
        refreshAndRender();   // 서버에서 다시 정렬 받아옴
    });
    // (2026-05-18) 페이지 크기 select — 클라이언트 자르기, refetch X
    container.querySelector('#fbadmin-page-size')?.addEventListener('change', (e) => {
        const n = Number(e.target.value);
        if ([10, 50, 100].includes(n)) {
            _state.pageSize = n;
            renderList(container);
        }
    });
    // (2026-05-18) 전체 선택 체크박스 — 현재 보이는 자리 모두 토글
    container.querySelector('#fbadmin-select-all')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            _state.visible.forEach(r => _state.selectedIds.add(r.id));
        } else {
            _state.visible.forEach(r => _state.selectedIds.delete(r.id));
        }
        renderList(container);
    });
    // (2026-05-18) 네이버 톤 묶음 액션 — 읽음 / 안읽음 / 삭제 / 복구 / 영구 삭제 / 복사
    container.querySelector('#fbadmin-bulk-copy')?.addEventListener('click', handleBulkCopy);
    container.querySelector('#fbadmin-bulk-read')?.addEventListener('click', () => handleBulkStatus('read'));
    container.querySelector('#fbadmin-bulk-unread')?.addEventListener('click', () => handleBulkStatus('unread'));
    container.querySelector('#fbadmin-bulk-soft-delete')?.addEventListener('click', handleBulkSoftDelete);
    container.querySelector('#fbadmin-bulk-restore')?.addEventListener('click', handleBulkRestore);
    container.querySelector('#fbadmin-bulk-hard-delete')?.addEventListener('click', handleBulkHardDelete);

    // 리스트 행 클릭/체크박스
    container.querySelectorAll('.fbadmin-row').forEach(rowEl => {
        rowEl.addEventListener('click', (e) => {
            if (e.target.closest('.fbadmin-row-checkbox')) return; // 체크박스 자체 클릭 X
            const id = rowEl.dataset.feedbackId;
            const userId = rowEl.dataset.userId;
            if (id && userId) openDetail(id, userId);
        });
    });
    container.querySelectorAll('.fbadmin-row-checkbox input').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.target.dataset.feedbackId;
            if (e.target.checked) _state.selectedIds.add(id);
            else _state.selectedIds.delete(id);
            const countEl = container.querySelector('#fbadmin-bulk-count');
            if (countEl) countEl.textContent = String(_state.selectedIds.size);
        });
    });
}

function renderTabButton(kind, label, count) {
    const active = _state.kindTab === kind;
    return `
        <button type="button" class="fbadmin-tab ${active ? 'active' : ''}"
                data-kind="${kind}" role="tab" aria-selected="${active}">
            ${label} <span class="fbadmin-tab-count">${count}</span>
        </button>`;
}

function renderListRow(row, kindTab) {
    const dt   = formatKST(row.createdAt);
    const cat  = categoryEmoji(row.category);
    const cBadge = kindTab === 'feedback' ? `<span class="fbadmin-row-cat">${cat}</span>` : '';
    const checked = _state.selectedIds.has(row.id) ? 'checked' : '';
    const readDot = row.status === 'read' ? '●' : '○';
    const summary = row.summary || (row.turns?.find(t => t.role === 'user')?.text?.slice(0, 60)) || '(빈 대화)';

    return `
        <div class="fbadmin-row ${row.status === 'read' ? 'is-read' : 'is-unread'}"
             data-feedback-id="${escapeHtml(row.id)}"
             data-user-id="${escapeHtml(row.userId)}">
            <label class="fbadmin-row-checkbox" onclick="event.stopPropagation()">
                <input type="checkbox" data-feedback-id="${escapeHtml(row.id)}" ${checked}>
            </label>
            <span class="fbadmin-row-status" aria-label="${row.status === 'read' ? '확인' : '미확인'}">${readDot}</span>
            <div class="fbadmin-row-body">
                <div class="fbadmin-row-meta">
                    <span>${escapeHtml(dt)}</span>
                    <span>·</span>
                    <span>${escapeHtml(row.nickname || '익명')}</span>
                    ${row.screenPath ? `<span>·</span><span>${escapeHtml(row.screenPath)}</span>` : ''}
                </div>
                <div class="fbadmin-row-summary">
                    ${cBadge}
                    <span>${escapeHtml(summary)}</span>
                </div>
            </div>
        </div>
    `;
}

// ─── 상세 렌더 ───────────────────────────────────────────────

async function openDetail(feedbackId, ownerUserId) {
    _state.mode = 'detail';
    _state.detailId = feedbackId;
    _state.detailOwnerUserId = ownerUserId;

    // (2026-05-18 fix) 뒤로가기 자연 — history 에 detail 자리 추가.
    //   browser back → popstate → setupBrowserNav → switchView('feedback-admin')
    //   → renderFeedbackAdminView 가 history.state 보고 list 모드로 자연 복원.
    try {
        if (typeof history !== 'undefined' && history.state?.detailId !== feedbackId) {
            history.pushState({
                sanctum: true,
                view: 'feedback-admin',
                detailId: feedbackId,
                ownerUserId,
            }, '', location.pathname + location.search);
        }
    } catch (_) {}

    // 자동 read 토글 (사용자 합의 §10 — 권장)
    const row = _state.rows.find(r => r.id === feedbackId);
    if (row && row.status !== 'read') {
        try {
            await markAsRead(ownerUserId, feedbackId);
            row.status = 'read';
        } catch (e) {
            console.warn('[feedbackAdmin] markAsRead failed:', e);
        }
    }

    const container = document.getElementById('view-feedback-admin');
    if (container) renderDetail(container);
}

function renderDetail(container) {
    const row = _state.rows.find(r => r.id === _state.detailId);
    if (!row) {
        container.innerHTML = `<div class="fbadmin-empty"><p>못 찾았어요.</p></div>`;
        return;
    }

    const dt = formatKST(row.createdAt);
    const dtEnd = formatKST(row.endedAt);
    const isPreSurvey = row.kind === 'preSurvey';
    const isPostSurvey = row.kind === 'postSurvey';

    container.innerHTML = `
        <header class="fbadmin-detail-header">
            <button type="button" id="fbadmin-back" class="fbadmin-back-btn">← 목록</button>
            <h2 class="fbadmin-detail-title">
                ${tabLabel(row.kind || 'feedback')} · ${escapeHtml(row.nickname || '익명')}
            </h2>
            <button type="button" id="fbadmin-toggle-read" class="fbadmin-toggle-btn">
                ${row.status === 'read' ? '● 확인됨' : '○ 미확인'}
            </button>
        </header>

        <section class="fbadmin-meta">
            <div><strong>시각:</strong> ${escapeHtml(dt)}${dtEnd ? ` ~ ${escapeHtml(dtEnd)}` : ''}</div>
            <div><strong>화면:</strong> ${escapeHtml(row.screenPath || '-')} · <code>${escapeHtml(row.moduleName || '-')}</code></div>
            <div><strong>환경:</strong> ${escapeHtml(row.userAgent || '-')} · ${escapeHtml(row.viewport || '-')}</div>
            <div><strong>종료:</strong> ${escapeHtml(row.endReason || '-')}</div>
            ${row.consoleErrors?.length ? `
                <details class="fbadmin-errors">
                    <summary>콘솔 에러 ${row.consoleErrors.length}건</summary>
                    <ul>${row.consoleErrors.map(e => `<li>[${escapeHtml(e.level)}] ${escapeHtml(e.text)}</li>`).join('')}</ul>
                </details>
            ` : `<div><strong>콘솔 에러:</strong> 없음</div>`}
        </section>

        ${!isPreSurvey && !isPostSurvey ? `
            <section class="fbadmin-section">
                <h3 class="fbadmin-section-title">자동 분류 & 요약</h3>
                <div class="fbadmin-category-row">
                    <span class="fbadmin-category-readonly">
                        ${categoryEmoji(row.category)} ${escapeHtml(categoryLabel(row.category))}
                    </span>
                    <span class="fbadmin-confidence">신뢰도 ${Math.round((row.categoryConfidence || 0) * 100)}%</span>
                </div>
                <p class="fbadmin-summary">${escapeHtml(row.summary || '(요약 없음)')}</p>
            </section>
        ` : `
            <section class="fbadmin-section">
                <h3 class="fbadmin-section-title">요약</h3>
                <p class="fbadmin-summary">${escapeHtml(row.summary || '(요약 없음)')}</p>
            </section>
            ${row.surveyExtract ? `
                <section class="fbadmin-section">
                    <h3 class="fbadmin-section-title">구조화 결과</h3>
                    ${renderSurveyExtract(row.surveyExtract, row.kind)}
                </section>
            ` : ''}
        `}

        <section class="fbadmin-section">
            <h3 class="fbadmin-section-title">대화 (${row.turns?.length || 0}턴)</h3>
            <ul class="fbadmin-turns">
                ${(row.turns || []).map(t => `
                    <li class="fbadmin-turn fbadmin-turn-${t.role}">
                        <span class="fbadmin-turn-role">${t.role === 'swan' ? 'SWAN' : '사용자'}</span>
                        <p>${escapeHtml(t.text)}</p>
                    </li>
                `).join('')}
            </ul>
        </section>

        ${row.swanNote ? `
            <section class="fbadmin-section">
                <h3 class="fbadmin-section-title">운영자 메모 (읽기 전용)</h3>
                <p class="fbadmin-summary">${escapeHtml(row.swanNote)}</p>
            </section>
        ` : ''}

        <footer class="fbadmin-detail-footer">
            <button type="button" id="fbadmin-copy-single" class="fbadmin-btn">📋 markdown 복사</button>
            ${row.deletedAt ? `
                <button type="button" id="fbadmin-restore" class="fbadmin-btn fbadmin-btn-soft">↩ 복구</button>
                <button type="button" id="fbadmin-hard-delete" class="fbadmin-btn fbadmin-btn-danger">영구 삭제</button>
            ` : `
                <button type="button" id="fbadmin-soft-delete" class="fbadmin-btn fbadmin-btn-danger">🗑 삭제</button>
            `}
        </footer>
    `;

    // 이벤트 바인딩
    container.querySelector('#fbadmin-back')?.addEventListener('click', () => {
        if (typeof history !== 'undefined' && history.state?.detailId) {
            history.back();
        } else {
            _state.mode = 'list';
            _state.detailId = null;
            renderList(container);
        }
    });
    container.querySelector('#fbadmin-toggle-read')?.addEventListener('click', () => toggleRead(row));
    container.querySelector('#fbadmin-copy-single')?.addEventListener('click', () => copyMarkdown([row]));

    // (2026-05-18) 삭제·복구·영구삭제
    container.querySelector('#fbadmin-soft-delete')?.addEventListener('click', () => handleSoftDelete(row));
    container.querySelector('#fbadmin-restore')?.addEventListener('click', () => handleRestore(row));
    container.querySelector('#fbadmin-hard-delete')?.addEventListener('click', () => handleHardDelete(row));
}

function renderSurveyExtract(extract, kind) {
    if (!extract) return '<p>구조화 결과 없음</p>';
    if (kind === 'preSurvey') {
        // 검증 시나리오 §1 스키마 키 그대로 표 렌더
        const fields = [
            ['q1_focus',            '요즘 마음에 둔 것'],
            ['q2_frequency',        '최근 한 달 묵상 빈도'],
            ['q3_recent_failure',   '실패 경험'],
            ['q4_pastAttempts',     '과거 해결 시도'],
            ['q5_currentApps',      '현재 사용 앱'],
            ['q6_meditationToLife', '묵상-삶 연결 자기 진단'],
            ['q7_productivityTools','생산성 도구'],
            ['q8_paidInvestment',   '과거 투자 행동'],
            ['q9_valuePerception',  '가치 기준'],
            ['q10_personalGoal',    '개인 베타 기대치'],
        ];
        return `
            <table class="fbadmin-survey-table">
                <thead><tr><th>질문</th><th>응답</th></tr></thead>
                <tbody>
                    ${fields.map(([k, label]) => {
                        const v = extract[k];
                        if (v == null) return `<tr><td>${label}</td><td class="fbadmin-survey-na">미응답</td></tr>`;
                        return `<tr><td>${label}</td><td>${escapeHtml(stringifyValue(v))}</td></tr>`;
                    }).join('')}
                </tbody>
            </table>
        `;
    }
    // postSurvey 등은 일단 raw JSON 펼쳐 보기
    return `<pre class="fbadmin-survey-raw">${escapeHtml(JSON.stringify(extract, null, 2))}</pre>`;
}

function stringifyValue(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v === null) return '미응답';
    if (Array.isArray(v)) return v.map(stringifyValue).join(', ');
    if (typeof v === 'object') {
        return Object.entries(v)
            .filter(([k]) => k !== 'raw')   // raw 는 길어서 따로
            .map(([k, val]) => {
                const s = stringifyValue(val);
                return s ? `${k}: ${s}` : '';
            })
            .filter(Boolean)
            .join(' · ') + (v.raw ? `\n"${v.raw}"` : '');
    }
    return String(v);
}

// ─── 액션 (읽음·분류·메모·복사) ──────────────────────────────

async function toggleRead(row) {
    try {
        if (row.status === 'read') {
            await markAsUnread(row.userId, row.id);
            row.status = 'unread';
        } else {
            await markAsRead(row.userId, row.id);
            row.status = 'read';
        }
        const container = document.getElementById('view-feedback-admin');
        if (container) renderDetail(container);
    } catch (e) {
        console.error('[feedbackAdmin] toggleRead failed:', e);
        showToast('상태 바꾸기에 실패했어요.');
    }
}

// (2026-05-18) 삭제·복구·영구 삭제 — 사용자 명시 "수정은 안 됨, 삭제·복구는 OK"
async function handleSoftDelete(row) {
    if (!confirm('이 항목을 휴지통으로 옮길까요? (휴지통 탭에서 복구할 수 있어요)')) return;
    try {
        await softDeleteFeedback(row.userId, row.id);
        row.deletedAt = new Date();
        showToast('휴지통으로 옮겼어요.');
        // 목록 자리로 자연 복귀
        if (typeof history !== 'undefined' && history.state?.detailId) {
            history.back();
        } else {
            _state.mode = 'list';
            _state.detailId = null;
            const container = document.getElementById('view-feedback-admin');
            if (container) renderList(container);
        }
    } catch (e) {
        console.error('[feedbackAdmin] soft delete failed:', e);
        showToast('삭제에 실패했어요.');
    }
}

async function handleRestore(row) {
    try {
        await restoreFeedback(row.userId, row.id);
        row.deletedAt = null;
        showToast('복구했어요.');
        if (typeof history !== 'undefined' && history.state?.detailId) {
            history.back();
        } else {
            _state.mode = 'list';
            _state.detailId = null;
            const container = document.getElementById('view-feedback-admin');
            if (container) renderList(container);
        }
    } catch (e) {
        console.error('[feedbackAdmin] restore failed:', e);
        showToast('복구에 실패했어요.');
    }
}

async function handleHardDelete(row) {
    if (!confirm('영구 삭제하시겠어요? 한 번 지우면 복구할 수 없어요.')) return;
    try {
        await deleteFeedback(row.userId, row.id);
        // _state.rows 에서도 제거
        _state.rows = _state.rows.filter(r => r.id !== row.id);
        showToast('영구 삭제했어요.');
        if (typeof history !== 'undefined' && history.state?.detailId) {
            history.back();
        } else {
            _state.mode = 'list';
            _state.detailId = null;
            const container = document.getElementById('view-feedback-admin');
            if (container) renderList(container);
        }
    } catch (e) {
        console.error('[feedbackAdmin] hard delete failed:', e);
        showToast('영구 삭제에 실패했어요.');
    }
}

function handleBulkCopy() {
    if (_state.selectedIds.size === 0) {
        showToast('먼저 복사할 자료를 골라 주세요.');
        return;
    }
    const rows = _state.rows.filter(r => _state.selectedIds.has(r.id));
    copyMarkdown(rows);
}

// (2026-05-18) 네이버 톤 묶음 액션 — 읽음 / 안읽음 / 삭제 / 복구 / 영구 삭제
function _selectedRows() {
    return _state.rows.filter(r => _state.selectedIds.has(r.id));
}

async function handleBulkStatus(status) {
    const rows = _selectedRows();
    if (rows.length === 0) {
        showToast('먼저 자료를 골라 주세요.');
        return;
    }
    try {
        const fn = status === 'read' ? markAsRead : markAsUnread;
        await Promise.all(rows.map(r => fn(r.userId, r.id).catch(e => console.warn(e))));
        rows.forEach(r => { r.status = status; });
        showToast(`${rows.length}건 ${status === 'read' ? '읽음' : '안읽음'} 처리했어요.`);
        _state.selectedIds.clear();
        const container = document.getElementById('view-feedback-admin');
        if (container) renderList(container);
    } catch (e) {
        console.error('[feedbackAdmin] bulk status failed:', e);
        showToast('처리에 실패했어요.');
    }
}

async function handleBulkSoftDelete() {
    const rows = _selectedRows();
    if (rows.length === 0) {
        showToast('먼저 삭제할 자료를 골라 주세요.');
        return;
    }
    if (!confirm(`${rows.length}건을 휴지통으로 옮길까요? (휴지통 탭에서 복구할 수 있어요)`)) return;
    try {
        await Promise.all(rows.map(r => softDeleteFeedback(r.userId, r.id).catch(e => console.warn(e))));
        rows.forEach(r => { r.deletedAt = new Date(); });
        showToast(`${rows.length}건 휴지통으로 옮겼어요.`);
        _state.selectedIds.clear();
        const container = document.getElementById('view-feedback-admin');
        if (container) renderList(container);
    } catch (e) {
        console.error('[feedbackAdmin] bulk soft delete failed:', e);
        showToast('삭제에 실패했어요.');
    }
}

async function handleBulkRestore() {
    const rows = _selectedRows();
    if (rows.length === 0) {
        showToast('먼저 복구할 자료를 골라 주세요.');
        return;
    }
    try {
        await Promise.all(rows.map(r => restoreFeedback(r.userId, r.id).catch(e => console.warn(e))));
        rows.forEach(r => { r.deletedAt = null; });
        showToast(`${rows.length}건 복구했어요.`);
        _state.selectedIds.clear();
        const container = document.getElementById('view-feedback-admin');
        if (container) renderList(container);
    } catch (e) {
        console.error('[feedbackAdmin] bulk restore failed:', e);
        showToast('복구에 실패했어요.');
    }
}

async function handleBulkHardDelete() {
    const rows = _selectedRows();
    if (rows.length === 0) {
        showToast('먼저 삭제할 자료를 골라 주세요.');
        return;
    }
    if (!confirm(`${rows.length}건을 영구 삭제하시겠어요? 한 번 지우면 복구할 수 없어요.`)) return;
    try {
        await Promise.all(rows.map(r => deleteFeedback(r.userId, r.id).catch(e => console.warn(e))));
        const removedIds = new Set(rows.map(r => r.id));
        _state.rows = _state.rows.filter(r => !removedIds.has(r.id));
        showToast(`${rows.length}건 영구 삭제했어요.`);
        _state.selectedIds.clear();
        const container = document.getElementById('view-feedback-admin');
        if (container) renderList(container);
    } catch (e) {
        console.error('[feedbackAdmin] bulk hard delete failed:', e);
        showToast('영구 삭제에 실패했어요.');
    }
}

async function copyMarkdown(rows) {
    if (!rows.length) return;
    const md = rows.map(toMarkdown).join('\n\n---\n\n');
    try {
        await navigator.clipboard.writeText(md);
        showToast(`${rows.length}건 복사했어요.`);
    } catch (e) {
        console.error('[feedbackAdmin] clipboard write failed:', e);
        // fallback — 텍스트 영역 만들어서 select
        const ta = document.createElement('textarea');
        ta.value = md;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast(`${rows.length}건 복사했어요.`); }
        catch (_) { showToast('복사에 실패했어요. 직접 골라 주세요.'); }
        ta.remove();
    }
}

function toMarkdown(row) {
    const dt = formatKST(row.createdAt);
    const kindLabel = tabLabel(row.kind || 'feedback');
    const cat = (row.kind === 'feedback' || !row.kind)
        ? `**자동 분류**: ${categoryEmoji(row.category)} ${categoryLabel(row.category)} (신뢰도 ${Math.round((row.categoryConfidence || 0) * 100)}%)\n`
        : '';
    const errors = row.consoleErrors?.length
        ? row.consoleErrors.map(e => `- [${e.level}] ${e.text}`).join('\n')
        : '(없음)';
    const turns = (row.turns || []).map(t =>
        `**${t.role === 'swan' ? 'SWAN' : '사용자'}**: ${t.text}`
    ).join('\n\n');
    const surveyBlock = row.surveyExtract
        ? `\n### 구조화 결과\n\`\`\`json\n${JSON.stringify(row.surveyExtract, null, 2)}\n\`\`\`\n`
        : '';
    const noteBlock = row.swanNote ? `\n**운영자 메모**: ${row.swanNote}\n` : '';

    return `## ${kindLabel} — ${dt} — ${row.nickname || '익명'}

**화면**: ${row.screenPath || '-'} · \`${row.moduleName || '-'}\`
**환경**: ${row.userAgent || '-'} · ${row.viewport || '-'}
**콘솔 에러**:
${errors}
${cat}**자동 요약**: ${row.summary || '(없음)'}${noteBlock}${surveyBlock}
### 대화
${turns}`;
}

// ─── 헬퍼 ────────────────────────────────────────────────────

function applyFilters(rows, kindTab, st) {
    // (2026-05-18) trash 탭은 deletedAt 있는 자리만, 다른 탭은 deletedAt 없는 자리만.
    if (kindTab === 'trash') {
        return rows.filter(r => {
            if (!r.deletedAt) return false;
            if (st.search) {
                const q = st.search.toLowerCase();
                const hay = [
                    r.summary || '',
                    r.nickname || '',
                    r.screenPath || '',
                    ...(r.turns || []).map(t => t.text || ''),
                ].join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }
    return rows.filter(r => {
        if (r.deletedAt) return false;       // 삭제된 자리는 일반 탭에 X
        const rk = r.kind || 'feedback';
        if (rk !== kindTab) return false;
        if (st.statusF !== 'all'   && r.status   !== st.statusF)   return false;
        if (st.categoryF !== 'all' && (r.category || 'other') !== st.categoryF) return false;
        if (st.search) {
            const q = st.search.toLowerCase();
            const hay = [
                r.summary || '',
                r.nickname || '',
                r.screenPath || '',
                ...(r.turns || []).map(t => t.text || ''),
            ].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

function countByKind(rows) {
    const out = { feedback: 0, preSurvey: 0, postSurvey: 0, trash: 0 };
    for (const r of rows) {
        if (r.deletedAt) { out.trash++; continue; }
        const k = r.kind || 'feedback';
        if (out[k] != null) out[k]++;
    }
    return out;
}

function tabLabel(kind) {
    return ({ feedback: '피드백', preSurvey: '사전 설문', postSurvey: '사후 설문', trash: '휴지통' })[kind] || kind;
}

function categoryEmoji(c) {
    return ({ error: '🔴', ux_ui: '🟡', feature_request: '🔵', other: '⚪' })[c] || '⚪';
}
function categoryLabel(c) {
    return ({ error: '오류', ux_ui: 'UX·UI', feature_request: '신기능', other: '기타' })[c] || '기타';
}

function formatKST(ts) {
    if (!ts) return '-';
    // Firestore Timestamp 또는 ISO string 둘 다 처리
    let d;
    if (ts.toDate)      d = ts.toDate();
    else if (ts.seconds) d = new Date(ts.seconds * 1000);
    else                 d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    const fmt = new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Asia/Seoul',
    });
    return fmt.format(d).replace(/\./g, '-').replace(/-(\d)/g, '-$1').replace(/- /, ' ');
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[ch]));
}

// ─── (2026-05-18) 사이드바 미확인 뱃지 — onSnapshot listener ────────
let _badgeUnsubscribe = null;

/**
 * SWAN 관리자 사이드바 자리 — 미확인 피드백 수를 실시간 표시.
 * 베타 사용자가 풍선 보내면 즉시 갱신. onSnapshot 정렬·필터 없이 단순 자리 (인덱스 의존 X).
 */
export function startFeedbackUnreadBadgeWatch(userId) {
    if (!isSwanAdmin(userId)) return;
    if (_badgeUnsubscribe) { try { _badgeUnsubscribe(); } catch (_) {} }
    try {
        const q = collectionGroup(db, 'feedbacks');
        _badgeUnsubscribe = onSnapshot(q, (snap) => {
            let unread = 0;
            snap.forEach(d => {
                const data = d.data() || {};
                if (data.status === 'unread') unread++;
            });
            _updateBadge(unread);
        }, (err) => {
            console.warn('[feedbackBadge] onSnapshot error:', err?.message || err);
        });
    } catch (e) {
        console.warn('[feedbackBadge] watch start failed:', e?.message || e);
    }
}

export function stopFeedbackUnreadBadgeWatch() {
    if (_badgeUnsubscribe) {
        try { _badgeUnsubscribe(); } catch (_) {}
        _badgeUnsubscribe = null;
    }
}

function _updateBadge(count) {
    const badge = document.getElementById('feedback-unread-badge');
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}
