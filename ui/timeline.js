/**
 * timeline.js — 통합 타임라인 컴포넌트 (STEP 1 핵심)
 *
 * 한 화면에 시간축 + 계획 레인(결단/캘린더) + 실제 레인(시계부)을 펼친다.
 * 사용자 신고 4·5·8·9번을 한 번에 해결.
 *
 * 슬롯 모델
 * - timeSlot: 0~95 (15분 단위, 0 = 00:00)
 * - durationSlots: 1~96
 * - 행 높이: 16px (1시간 = 64px)
 *
 * 데이터 소스
 * - daily 목표 (goalsRepo, period='daily'): timeSlot != null 인 것은 plan 레인 슬롯
 * - Google Calendar events: plan 레인에 회색-아닌 accent 띠로 표시 (origin = 'gcal')
 * - 도트 (dotsRepo): actual 레인에 표시. dot.executionSatisfaction에 따라 색
 *
 * Drop 인터랙션
 * - daily 목표 카드 → plan 레인의 슬롯으로 drop → goalsRepo.placeGoal
 * - plan 슬롯 본문 drag → 시간 이동
 * - plan 슬롯 하단 6px drag → 길이 조절
 *
 * 평가
 * - plan 슬롯 클릭 → quickReview 모달 → 저장 시 dot 생성 + actual 레인에 반영
 * - actual 빈 셀 클릭 → 인라인 입력 → dot 직접 생성 (plannedTask 없는 항목)
 */

import { getDEK } from './lockScreen.js';
import { saveDot, getDotsByDate, deleteDot } from '../data/dotsRepo.js';
// Phase B: 결단 → daily 목표 전환. plan 레인 슬롯의 source 는 이제 goalsRepo.
// 기존 함수명은 placeGoal/unplaceGoal/saveGoal/getDailyGoals 로 매핑.
import {
    getDailyGoals, placeGoal, unplaceGoal, saveGoal,
} from '../data/goalsRepo.js';
import { openQuickReview, showToast } from './quickReview.js';
import { listUpcomingEvents, pushDecisionsToGoogleCalendar } from './app.js';
// Phase E-6 C-1: GCal 이벤트를 daily 목표로 자동 변환 (시간표·목표·리포트 정합)
import { syncGcalEventsToDailyGoals } from '../data/gcalSync.js';

const SLOTS_PER_DAY = 96;
const ROW_HEIGHT = 16; // px per 15min slot

let _userId = null;
let _date = null;
let _decisions = [];   // timeSlot != null 인 것만 plan 레인에 그림
let _dots = [];        // actual 레인
let _gcalEvents = [];  // plan 레인의 외부 일정

let _onChange = null;  // 데이터 갱신 시 외부에 알리기 (todayView가 결단 패널 다시 그릴 수 있게)

/**
 * 타임라인 마운트 (앱 시작 시 1회)
 */
export function initTimeline({ userId, date, onChange }) {
    _userId = userId;
    _date = date;
    _onChange = onChange || null;
    bindGlobalEvents();
}

/**
 * 데이터 다시 로드 + 렌더 (잠금 해제, 날짜 변경, 평가 저장 후 호출)
 */
export async function refreshTimeline({ userId, date, scrollToNow = false }) {
    _userId = userId;
    _date = date;
    const dek = getDEK();
    if (!dek) return;

    // 하나가 실패해도 나머지는 살아남도록 allSettled. decisions 인덱스가 빠져 있어
    // throw가 나도 도트/캘린더는 그대로 보임.
    const [decisionsR, dotsR, gcalR] = await Promise.allSettled([
        getDailyGoals(dek, _userId, _date),
        getDotsByDate(dek, _userId, _date),
        listUpcomingEvents(),
    ]);
    if (decisionsR.status === 'fulfilled') _decisions = decisionsR.value;
    else console.error('decisions load failed:', decisionsR.reason);
    if (dotsR.status === 'fulfilled') _dots = dotsR.value;
    else console.error('dots load failed:', dotsR.reason);
    if (gcalR.status === 'fulfilled') _gcalEvents = gcalR.value;
    else console.error('gcal load failed:', gcalR.reason);

    // Phase E-6 C-2: GCal 이벤트를 daily 목표로 자동 동기화.
    // 새/변경된 이벤트가 있으면 goals 컬렉션에 반영하고, 그 결과를 _decisions 에 다시 반영.
    // 실패해도 시간표 자체는 그려져야 하므로 try/catch 로 감쌈.
    if (_gcalEvents.length > 0) {
        try {
            const sync = await syncGcalEventsToDailyGoals(dek, _userId, _gcalEvents, _date);
            if (sync.created > 0 || sync.updated > 0) {
                _decisions = await getDailyGoals(dek, _userId, _date);
            }
        } catch (e) {
            console.warn('[gcalSync] failed:', e);
        }
    }

    render();
    // 마운트/날짜 변경/사용자 명시 액션에서만 현재 시간으로 이동.
    // 인라인 저장 후 refresh 같은 자동 refresh는 사용자 스크롤 위치를 보존.
    if (scrollToNow) scrollTimelineToNow();
}

/**
 * 시간표 컨테이너의 현재 시간 라인을 상단 근처로 스크롤.
 * isToday일 때만 동작. 그 외 날짜는 09:00 근처로 스크롤(아침에 시작).
 */
export function scrollTimelineToNow() {
    const body = document.getElementById('utl-body');
    if (!body) return;
    let targetSlot;
    if (isToday(_date)) {
        const now = new Date();
        targetSlot = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
    } else {
        targetSlot = 9 * 4; // 09:00
    }
    // 현재 시간이 상단 안쪽으로 약간 들어오게 -2 슬롯 여유.
    const top = Math.max(0, (targetSlot - 2) * ROW_HEIGHT);
    body.scrollTop = top;
}

// ─── 렌더 ───
function render() {
    renderDesktop();
    renderMobile();
}

function renderDesktop() {
    const body = document.getElementById('utl-body');
    if (!body) return;

    // 항상 0~23시 그리드를 그리고, 그 위에 결단/캘린더/도트 슬롯을 띄움.
    // (빈 상태에도 그리드가 보여야 결단을 그 시간대로 끌어다 박을 수 있음)
    body.innerHTML = '';

    const axisCol = document.createElement('div');
    axisCol.className = 'utl-axis-col';
    const planCol = document.createElement('div');
    planCol.className = 'utl-plan-col';
    const actualCol = document.createElement('div');
    actualCol.className = 'utl-actual-col';

    for (let i = 0; i < SLOTS_PER_DAY; i++) {
        // 시간축
        const tick = document.createElement('div');
        tick.className = 'utl-time-tick' + (i % 4 === 0 ? '' : i % 2 === 0 ? ' half' : ' minor');
        if (i % 4 === 0) tick.textContent = `${String(Math.floor(i / 4)).padStart(2, '0')}:00`;
        axisCol.appendChild(tick);

        // 계획 셀
        const planCell = document.createElement('div');
        planCell.className = 'utl-cell' + (i % 4 === 0 ? ' hour-mark' : i % 2 === 0 ? ' half-mark' : '');
        planCell.dataset.slot = i;
        planCell.dataset.lane = 'plan';
        planCol.appendChild(planCell);

        // 실제 셀
        const actualCell = document.createElement('div');
        actualCell.className = 'utl-cell' + (i % 4 === 0 ? ' hour-mark' : i % 2 === 0 ? ' half-mark' : '');
        actualCell.dataset.slot = i;
        actualCell.dataset.lane = 'actual';
        actualCol.appendChild(actualCell);
    }

    body.appendChild(axisCol);
    body.appendChild(planCol);
    body.appendChild(actualCol);

    // 현재 시간 라인
    if (isToday(_date)) {
        const now = new Date();
        const nowSlot = now.getHours() * 4 + now.getMinutes() / 15;
        const line = document.createElement('div');
        line.className = 'utl-now-line';
        line.style.top = `${nowSlot * ROW_HEIGHT}px`;
        body.appendChild(line);
    }

    // 박힌 결단 슬롯 그리기 (plan 레인)
    // Phase E-6 C-2: GCal 이벤트도 동기화 후 _decisions 에 포함되므로 별도 렌더링 불필요.
    // gcalEventId 있는 목표는 createPlanSlot 안에서 📅 prefix 로 시각 구분.
    _decisions.forEach(d => {
        if (d.timeSlot == null) return;
        const slotEl = createPlanSlot(d, 'decision');
        positionSlot(slotEl, d.timeSlot, d.durationSlots || 4);
        planCol.appendChild(slotEl);
    });

    // 도트 그리기 (actual 레인) — durationSlots 지원, 없으면 1슬롯
    _dots.forEach(dot => {
        if (dot.timeSlot == null) return;
        const slotEl = createActualSlot(dot);
        positionSlot(slotEl, dot.timeSlot, dot.durationSlots || 1);
        actualCol.appendChild(slotEl);
    });

    bindCellEvents(planCol, 'plan');
    bindCellEvents(actualCol, 'actual');
}

// 모바일 탭 상태 (워크플로우 트랙 STEP 2 — 사용자 결정: 계획/실제 분리 스와이프)
let _mobileTab = 'plan'; // 'plan' | 'actual'

function renderMobile() {
    const list = document.getElementById('utl-mobile-list');
    if (!list) return;

    const planSlots = _decisions.filter(d => d.timeSlot != null).map(d => ({
        slot: d.timeSlot,
        duration: d.durationSlots || 4,
        label: (d.gcalEventId ? '📅 ' : '') + (d.title ?? d.text ?? '(이름 없음)'),
        kind: 'decision'
    })).sort((a, b) => a.slot - b.slot);

    const actualSlots = _dots.filter(d => d.timeSlot != null).map(d => ({
        slot: d.timeSlot,
        duration: d.durationSlots || 1,
        label: d.actualTask || d.plannedTask || '(아직 평가 전)',
        dotClass: dotColorClass(d),
        fromWorkflow: !!d.linkedWorkflowStepId,
        kind: 'dot',
        id: d.id
    })).sort((a, b) => a.slot - b.slot);

    const planEmpty = planSlots.length === 0;
    const actualEmpty = actualSlots.length === 0;

    const tabsHtml = `
        <div class="utl-mobile-tabs" role="tablist">
            <button class="utl-mobile-tab ${_mobileTab === 'plan' ? 'active' : ''}"
                    data-tab="plan" role="tab" aria-selected="${_mobileTab === 'plan'}">
                계획 ${planSlots.length ? `(${planSlots.length})` : ''}
            </button>
            <button class="utl-mobile-tab ${_mobileTab === 'actual' ? 'active' : ''}"
                    data-tab="actual" role="tab" aria-selected="${_mobileTab === 'actual'}">
                실제 ${actualSlots.length ? `(${actualSlots.length})` : ''}
            </button>
        </div>
    `;

    const renderRow = (item) => {
        const endSlot = item.slot + (item.duration || 1);
        const timeLabel = (item.duration || 1) > 1
            ? `${slotToTime(item.slot)}~${slotToTime(endSlot)}`
            : slotToTime(item.slot);
        const cls = [
            'utl-mobile-card',
            item.dotClass || 'dot-gray',
            item.fromWorkflow ? 'from-workflow' : ''
        ].join(' ').trim();
        // (2026-05-13 HC#1 A-1 종결) plan 카드도 data-slot 으로 클릭 → quickReview 진입.
        const dotAttr = item.id ? `data-dot-id="${escapeHtml(item.id)}"` : '';
        return `
            <div class="${cls}" ${dotAttr} data-slot="${item.slot}">
                <span class="utl-mobile-time">${timeLabel}</span>
                <div class="utl-mobile-body">
                    <div class="utl-mobile-plan">${escapeHtml(item.label)}</div>
                </div>
            </div>
        `;
    };

    const emptyHtml = (msg) => `
        <div class="utl-empty-card" style="border:none">
            <p>${escapeHtml(msg)}</p>
        </div>
    `;

    const bodyHtml = _mobileTab === 'plan'
        ? (planEmpty
            ? emptyHtml('아직 계획이 비어있어요. 오늘의 목표를 적거나, 등산로에서 한 걸음을 박아 보세요.')
            : planSlots.map(renderRow).join(''))
        : (actualEmpty
            ? emptyHtml('아직 기록이 없어요. 계획 탭의 슬롯을 톡 눌러 평가하거나, 빈 시간을 채워 보세요.')
            : actualSlots.map(renderRow).join(''));

    list.innerHTML = `${tabsHtml}<div class="utl-mobile-body-wrap">${bodyHtml}</div>`;

    // 탭 클릭
    list.querySelectorAll('.utl-mobile-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _mobileTab = btn.dataset.tab;
            renderMobile();
        });
    });

    // (2026-05-13 HC#1 A-1 종결) plan/actual 두 탭 다 카드 클릭 → quickReview 모달.
    // actual 카드는 data-dot-id 기반 재평가, plan 카드는 data-slot 기반 — 같은 slot 의
    // 도트가 이미 있으면 그 도트 재평가, 없으면 신규 평가 (plannedTask 는 결단·캘린더 제목 prefill).
    // 안내 문구 "계획 탭의 슬롯을 톡 눌러 평가"와 실제 동작이 이제 일치.
    list.querySelectorAll('.utl-mobile-card').forEach(card => {
        card.addEventListener('click', () => {
            const dotId = card.dataset.dotId;
            const slot = parseInt(card.dataset.slot ?? '', 10);
            if (dotId) {
                const dot = _dots.find(d => d.id === dotId);
                if (!dot) return;
                openQuickReview({
                    timeSlot: dot.timeSlot,
                    cells: [],
                    userId: _userId,
                    date: _date,
                    plannedTask: dot.plannedTask || '',
                    existingDot: dot,
                });
            } else if (!Number.isNaN(slot)) {
                const existing = _dots.find(d => d.timeSlot === slot);
                const decision = _decisions.find(d => d.timeSlot === slot);
                openQuickReview({
                    timeSlot: slot,
                    cells: [],
                    userId: _userId,
                    date: _date,
                    plannedTask: existing?.plannedTask || decision?.title || decision?.text || '',
                    existingDot: existing || null,
                });
            }
        });
    });

    // 좌우 스와이프 — 사용자 결정 (2026-05-13)
    bindMobileSwipe(list);
}

let _swipeStartX = null;
function bindMobileSwipe(el) {
    el.addEventListener('touchstart', (e) => {
        _swipeStartX = e.touches[0]?.clientX ?? null;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (_swipeStartX == null) return;
        const endX = e.changedTouches[0]?.clientX ?? _swipeStartX;
        const dx = endX - _swipeStartX;
        _swipeStartX = null;
        // 50px 이상 좌우 스와이프 시 탭 전환
        if (Math.abs(dx) < 50) return;
        if (dx < 0 && _mobileTab === 'plan')  { _mobileTab = 'actual'; renderMobile(); }
        if (dx > 0 && _mobileTab === 'actual') { _mobileTab = 'plan';   renderMobile(); }
    });
}

// ─── 슬롯 컴포넌트 ───
function createPlanSlot(decision, source) {
    const el = document.createElement('div');
    // Phase E-6 C-2: GCal 출처 목표는 시각 구분 — gcal-source 클래스 + 📅 prefix.
    const gcalCls = decision.gcalEventId ? ' gcal-source' : '';
    el.className = `utl-slot ${dotColorClassForDecision(decision)}${gcalCls}`;
    el.dataset.decisionId = decision.id;
    el.dataset.source = source;
    if (decision.gcalEventId) el.dataset.gcalId = decision.gcalEventId;
    el.draggable = true;
    const dur = decision.durationSlots || 4;
    const endSlot = (decision.timeSlot || 0) + dur;
    const titleText = decision.title ?? decision.text ?? '(아직 이름이 없어요)';
    const titleDisplay = decision.gcalEventId ? `📅 ${titleText}` : titleText;
    el.innerHTML = `
        <button class="slot-delete" type="button" title="시간표에서 빼기" aria-label="시간표에서 빼기">×</button>
        <span class="slot-time">${slotToTime(decision.timeSlot)}~${slotToTime(endSlot)}</span>
        <span class="slot-title">${escapeHtml(titleDisplay)}</span>
        <span class="slot-resize" data-decision-id="${decision.id}" title="아래로 끌어 시간 늘리기"></span>
    `;
    return el;
}

function createGcalSlot(ev) {
    const el = document.createElement('div');
    el.className = 'utl-slot gcal-source';
    el.dataset.gcalId = ev.id;
    el.title = ev.summary || '';
    const range = gcalEventToSlotRange(ev);
    el.innerHTML = `
        <span class="slot-time">${slotToTime(range.start)}~${slotToTime(range.end)}</span>
        <span class="slot-title">📅 ${escapeHtml(ev.summary || '(이름 없는 일정)')}</span>
    `;
    return el;
}

function createActualSlot(dot) {
    const el = document.createElement('div');
    // 워크플로우-발 도트는 시각 구별 (워크플로우 트랙 STEP 2)
    const fromWf = dot.linkedWorkflowStepId ? ' from-workflow' : '';
    el.className = `utl-slot ${dotColorClass(dot)}${fromWf}`;
    el.dataset.dotId = dot.id;
    const dur = dot.durationSlots || 1;
    const endSlot = dot.timeSlot + dur;
    const timeLabel = dur > 1
        ? `${slotToTime(dot.timeSlot)}~${slotToTime(endSlot)}`
        : slotToTime(dot.timeSlot);
    el.innerHTML = `
        <button class="slot-delete" type="button" title="이 기록 지우기" aria-label="이 기록 지우기">×</button>
        <span class="slot-time">${timeLabel}</span>
        <span class="slot-title">${escapeHtml(dot.actualTask || dot.plannedTask || '(아직 평가 전이에요)')}</span>
        <span class="slot-resize actual-resize" data-dot-id="${dot.id}" title="아래로 끌어 시간 늘리기"></span>
    `;
    return el;
}

function positionSlot(el, slot, duration) {
    el.style.top = `${slot * ROW_HEIGHT}px`;
    el.style.height = `${Math.max(1, duration) * ROW_HEIGHT - 2}px`;
}

// ─── 자동 스크롤 (드래그/리사이즈 중 화면 가장자리 시 스크롤) ───
// 마우스가 viewport 상하단 60px 안에 들어오면 그 거리에 비례해서 window를 스크롤.
let _autoScrollDir = 0;     // -1=위, 0=정지, 1=아래
let _autoScrollRAF = null;
const SCROLL_EDGE_PX = 60;
const SCROLL_MAX_SPEED = 14;  // 한 프레임 최대 픽셀

function updateAutoScrollFromEvent(e) {
    const vh = window.innerHeight;
    if (e.clientY < SCROLL_EDGE_PX) {
        const ratio = (SCROLL_EDGE_PX - e.clientY) / SCROLL_EDGE_PX;
        _autoScrollDir = -Math.min(SCROLL_MAX_SPEED, Math.max(2, ratio * SCROLL_MAX_SPEED));
    } else if (e.clientY > vh - SCROLL_EDGE_PX) {
        const ratio = (e.clientY - (vh - SCROLL_EDGE_PX)) / SCROLL_EDGE_PX;
        _autoScrollDir = Math.min(SCROLL_MAX_SPEED, Math.max(2, ratio * SCROLL_MAX_SPEED));
    } else {
        _autoScrollDir = 0;
    }
}
function startAutoScroll() {
    if (_autoScrollRAF) return;
    const step = () => {
        if (_autoScrollDir !== 0) {
            // window.scrollBy는 main 컨테이너가 스크롤 가능한 경우에도 동작.
            // body/html이 안 되면 가장 가까운 스크롤 부모를 찾아 fallback.
            const before = window.scrollY;
            window.scrollBy(0, _autoScrollDir);
            if (window.scrollY === before) {
                // window가 안 스크롤된다 — main-content가 자체 스크롤일 수 있음
                const main = document.getElementById('main-content');
                if (main) main.scrollTop += _autoScrollDir;
            }
        }
        _autoScrollRAF = requestAnimationFrame(step);
    };
    _autoScrollRAF = requestAnimationFrame(step);
}
function stopAutoScroll() {
    if (_autoScrollRAF) cancelAnimationFrame(_autoScrollRAF);
    _autoScrollRAF = null;
    _autoScrollDir = 0;
}

// ─── 색상 매핑 ───
function dotColorClass(dot) {
    if (!dot) return 'dot-gray';
    if (!dot.executed) return 'dot-yellow';
    const sat = dot.executionSatisfaction || 0;
    if (sat >= 4) return 'dot-green';
    if (sat >= 2) return 'dot-orange';
    if (sat >= 1) return 'dot-red';
    if (dot.executed === 'spiritual_high') return 'dot-purple';
    return 'dot-gray';
}

function dotColorClassForDecision(decision) {
    // 박힌 결단의 시간이 지났는데 평가가 없으면 노랑(평가 대기)
    if (!isToday(_date)) return 'dot-gray';
    const now = new Date();
    const nowSlot = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
    const endSlot = (decision.timeSlot || 0) + (decision.durationSlots || 4);
    if (endSlot < nowSlot) {
        const matched = _dots.find(d => d.timeSlot === decision.timeSlot);
        if (!matched) return 'dot-yellow';
    }
    return 'dot-gray';
}

// ─── Google Calendar event → slot 범위 ───
function gcalEventToSlotRange(ev) {
    try {
        const startStr = ev.start?.dateTime || ev.start?.date;
        const endStr = ev.end?.dateTime || ev.end?.date;
        if (!startStr || !endStr) return null;
        const s = new Date(startStr);
        const e = new Date(endStr);
        const startSlot = Math.floor((s.getHours() * 60 + s.getMinutes()) / 15);
        const endSlot = Math.ceil((e.getHours() * 60 + e.getMinutes()) / 15);
        return { start: startSlot, end: Math.max(startSlot + 1, endSlot) };
    } catch { return null; }
}

// ─── 셀 이벤트 (drop, mousedown-drag, click) ───
function bindCellEvents(col, lane) {
    col.querySelectorAll('.utl-cell').forEach(cell => {
        // 드래그 인 - 결단 카드 / 워크플로우 스텝을 받기 (plan 레인만)
        cell.addEventListener('dragover', (e) => {
            if (lane !== 'plan') return;
            const types = e.dataTransfer.types;
            if (!types.includes('application/x-sanctum-decision') &&
                !types.includes('application/x-sanctum-slot') &&
                !types.includes('application/x-sanctum-workflow-step')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            cell.classList.add('drop-target');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
        cell.addEventListener('drop', async (e) => {
            cell.classList.remove('drop-target');
            if (lane !== 'plan') return;
            e.preventDefault();
            const slot = parseInt(cell.dataset.slot);
            const decisionId = e.dataTransfer.getData('application/x-sanctum-decision');
            const slotMoveId = e.dataTransfer.getData('application/x-sanctum-slot');
            const workflowStepRaw = e.dataTransfer.getData('application/x-sanctum-workflow-step');

            const dek = getDEK();
            if (!dek) { showToast('잠시 잠겨 있어요. 비밀번호로 열어 주실래요?'); return; }

            try {
                if (workflowStepRaw) {
                    // 워크플로우 스텝 드롭 — 도트 즉시 생성 (워크플로우 트랙 STEP 2)
                    let payload = null;
                    try { payload = JSON.parse(workflowStepRaw); } catch {}
                    if (payload?.workflowId && payload?.stepId) {
                        const { createDotFromStep } = await import('./workflows.js');
                        await createDotFromStep({
                            workflowId: payload.workflowId,
                            stepId: payload.stepId,
                            parentGoalId: payload.parentGoalId || null,
                            slot,
                            date: _date
                        });
                        // createDotFromStep 내부에서 onDotCreated 콜백으로 timeline 갱신됨.
                        // 추가로 refresh 한 번 더 → 동기화 안정성.
                        await refreshTimeline({ userId: _userId, date: _date });
                        if (_onChange) await _onChange({ type: 'refresh' });
                        return;
                    }
                }
                if (decisionId) {
                    let d = _decisions.find(x => x.id === decisionId);
                    if (!d) {
                        const all = await getDailyGoals(dek, _userId);
                        d = all.find(x => x.id === decisionId);
                    }
                    if (d) {
                        await placeGoal(dek, d, slot, d.durationSlots || 4);
                    } else {
                        showToast('이 목표를 찾지 못했어요. 한 번만 더 옮겨 주실래요?');
                    }
                } else if (slotMoveId) {
                    let d = _decisions.find(x => x.id === slotMoveId);
                    if (!d) {
                        const all = await getDailyGoals(dek, _userId);
                        d = all.find(x => x.id === slotMoveId);
                    }
                    if (d) await placeGoal(dek, d, slot, d.durationSlots || 4);
                }
                await refreshTimeline({ userId: _userId, date: _date });
                if (_onChange) await _onChange({ type: 'refresh' });
            } catch (err) {
                console.error('drop failed:', err);
                showToast('옮기는 중에 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
            }
        });

        // actual 레인 빈 셀: mousedown → 드래그로 시간 범위 선택 → 인라인 입력
        cell.addEventListener('mousedown', (e) => {
            if (lane !== 'actual') return;
            if (e.button !== 0) return;                  // 좌클릭만
            if (e.target.closest('.utl-slot')) return;   // 기존 도트 위에선 무시 (평가는 슬롯 클릭으로)
            e.preventDefault();
            const slot = parseInt(cell.dataset.slot);
            startActualCreateDrag(col, cell, slot);
        });
    });

    // 슬롯 자체 — 클릭/리사이즈/삭제/드래그-이동
    col.querySelectorAll('.utl-slot').forEach(slot => {
        // 본문 드래그 시작 (시간 이동) — plan 레인의 결단 슬롯만
        slot.addEventListener('dragstart', (e) => {
            const did = slot.dataset.decisionId;
            if (!did) { e.preventDefault(); return; }
            e.dataTransfer.setData('application/x-sanctum-slot', did);
            e.dataTransfer.effectAllowed = 'move';
            slot.classList.add('dragging');
        });
        slot.addEventListener('dragend', () => {
            slot.classList.remove('dragging');
        });

        slot.addEventListener('click', (e) => {
            // 리사이즈 핸들 / 삭제 버튼 클릭은 자체 핸들러가 처리
            if (e.target.closest('.slot-resize')) return;
            if (e.target.closest('.slot-delete')) return;

            const decisionId = slot.dataset.decisionId;
            const dotId = slot.dataset.dotId;
            const gcalId = slot.dataset.gcalId;

            // 계획 레인(결단/캘린더)에선 평가 모달을 띄우지 않음.
            // 평가는 실제 레인의 도트에 대해서만.
            if (decisionId) {
                showToast('평가는 아래 [실제] 레인에서 해 주세요. 계획은 의도를 적는 곳이에요.');
            } else if (gcalId) {
                showToast('이 일정에 대한 평가는 [실제] 레인에서 같은 시간에 도트를 만들어 해 주세요.');
            } else if (dotId) {
                const dot = _dots.find(x => x.id === dotId);
                if (dot) openEvalForDot(dot);
            }
        });

        // 가장자리 리사이즈 — 결단/도트 둘 다 지원
        const resizeHandle = slot.querySelector('.slot-resize');
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const decisionId = resizeHandle.dataset.decisionId;
                const dotId = resizeHandle.dataset.dotId;
                if (decisionId) startResize('decision', decisionId, e.clientY, slot);
                else if (dotId)  startResize('dot', dotId, e.clientY, slot);
            });
        }

        // X 버튼 — 계획=시간표에서 빼기(unplace), 실제=완전 삭제
        const deleteBtn = slot.querySelector('.slot-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const decisionId = slot.dataset.decisionId;
                const dotId = slot.dataset.dotId;
                const dek = getDEK();
                if (!dek) { showToast('잠시 잠겨 있어요.'); return; }
                try {
                    if (decisionId) {
                        const d = _decisions.find(x => x.id === decisionId);
                        if (!d) return;
                        await unplaceGoal(dek, d);
                        showToast('시간표에서 빼냈어요. 목표 카드로 다시 돌아갔어요.');
                    } else if (dotId) {
                        if (!confirm('이 시간 기록을 지울까요?')) return;
                        await deleteDot(dotId);
                    } else {
                        return;
                    }
                    await refreshTimeline({ userId: _userId, date: _date });
                    if (_onChange) await _onChange({ type: 'refresh' });
                } catch (err) {
                    console.error('slot delete failed:', err);
                    showToast('지우는 중에 잠깐 막혔어요.');
                }
            });
        }
    });
}

// ─── 실제 레인 드래그-생성 ───
// 빈 actual 셀에서 mousedown → mousemove로 길이 늘림 → mouseup → 인라인 입력 → 저장 → 평가 모달
function startActualCreateDrag(col, _startCell, startSlot) {
    closeAllInlinePanels(); // 새 드래그 시작 시 기존 인라인 패널 정리
    let endSlot = startSlot;

    const ghost = document.createElement('div');
    ghost.className = 'utl-slot utl-ghost';
    ghost.innerHTML = `<span class="slot-time">${slotToTime(startSlot)}</span>`;
    positionSlot(ghost, startSlot, 1);
    col.appendChild(ghost);

    const updateGhost = () => {
        const min = Math.min(startSlot, endSlot);
        const max = Math.max(startSlot, endSlot);
        const duration = max - min + 1;
        positionSlot(ghost, min, duration);
        const timeEl = ghost.querySelector('.slot-time');
        if (timeEl) {
            timeEl.textContent = duration > 1
                ? `${slotToTime(min)}~${slotToTime(min + duration)} (${duration * 15}분)`
                : slotToTime(min);
        }
    };

    startAutoScroll();

    const onMove = (ev) => {
        updateAutoScrollFromEvent(ev);
        // ghost는 pointer-events:none 이므로 hit-test에 안 잡힘 (CSS 참조).
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetCell = target?.closest('.utl-cell[data-lane="actual"]');
        if (!targetCell) return;
        endSlot = parseInt(targetCell.dataset.slot);
        updateGhost();
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        stopAutoScroll();
        ghost.remove();
        const min = Math.min(startSlot, endSlot);
        const max = Math.max(startSlot, endSlot);
        const duration = max - min + 1;
        openInlineActualInput(col, min, duration);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// ─── 평가 모달 진입점 ───
// 사용자 정책: "계획에 평가는 일어날 수 없다" — 결단/캘린더 슬롯 클릭은 평가 모달 안 띄움.
// 도트(실제 레인)만 평가 가능.
function openEvalForDot(dot) {
    openQuickReview({
        timeSlot: dot.timeSlot,
        cells: [dot.timeSlot],
        userId: _userId,
        date: _date,
        plannedTask: dot.plannedTask || '',
        existingDot: dot,
    });
}

// ─── 인라인 평가 패널 (옵션 A) ───
// 빈 셀에서 드래그하면 그 범위 전체에 펼쳐진 인라인 패널이 뜬다.
// [텍스트] 😀 🙂 🔄 😣 [저장] 한 줄.
//  - 텍스트만 적고 [저장] → 기본 'done', 만족도 3 으로 도트 저장
//  - 4개 상태 버튼 중 하나 클릭 → 그 상태로 즉시 저장
//  - 평가 모달 자동 오픈은 하지 않음 (자세한 평가는 도트 슬롯 클릭 시)
//  - 외부 클릭 / ESC → 닫기. 새 드래그 시작 시 자동 정리.
const STATUS_BUTTONS = [
    { key: 'done',     emoji: '😀', label: '잘 했어요',     sat: 4 },
    { key: 'partial',  emoji: '🙂', label: '조금 했어요',   sat: 3 },
    { key: 'replaced', emoji: '🔄', label: '다른 걸 했어요', sat: 3 },
    { key: 'skipped',  emoji: '😣', label: '못 했어요',     sat: 1 },
];

function closeAllInlinePanels() {
    document.querySelectorAll('.utl-inline-panel').forEach(el => el.remove());
}

function openInlineActualInput(col, slot, duration = 1) {
    if (!col) return;
    // 누적 방지: 기존 인라인 패널은 모두 정리
    closeAllInlinePanels();

    const endSlot = slot + duration;
    const timeLabel = duration > 1
        ? `${slotToTime(slot)}~${slotToTime(endSlot)} · ${duration * 15}분`
        : slotToTime(slot);

    // 드래그 범위 전체에 펼쳐진 패널을 actualCol 위에 absolute로 띄움
    const panel = document.createElement('div');
    panel.className = 'utl-inline-panel';
    panel.style.top = `${slot * ROW_HEIGHT}px`;
    panel.style.height = `${Math.max(2, duration) * ROW_HEIGHT - 2}px`;
    panel.innerHTML = `
        <div class="utl-inline-row">
            <span class="utl-inline-time">${timeLabel}</span>
            <input type="text" class="utl-inline-text" placeholder="이 시간에 뭐 했어요?" autocomplete="off" />
            <div class="utl-inline-status" role="group" aria-label="상태">
                ${STATUS_BUTTONS.map(b => `
                    <button type="button" class="utl-inline-status-btn" data-status="${b.key}" data-sat="${b.sat}" title="${b.label}">${b.emoji}</button>
                `).join('')}
            </div>
            <button type="button" class="utl-inline-save">저장</button>
        </div>
    `;
    col.appendChild(panel);

    const input = panel.querySelector('.utl-inline-text');
    input.focus();

    let _saved = false;
    const saveWith = async (status, sat) => {
        if (_saved) return;
        // 텍스트 없이도 이모지만 누르면 저장 OK — 빠르게 도트 한 칸 찍는 흐름 허용.
        // 텍스트 빈 도트는 화면에서 '(이름 없는 시간)' 으로 표시되고 나중에 도트 다시 클릭하면
        // 모달에서 채울 수 있음.
        const text = input.value.trim();
        _saved = true;
        const dek = getDEK();
        if (!dek) { showToast('잠시 잠겨 있어요. 비밀번호로 열어 주실래요?'); _saved = false; return; }
        try {
            // Phase E-1: 같은 시간대에 daily 목표가 박혀 있으면 자동 연결 + plannedTask 도 그 목표 텍스트로.
            const linkedGoal = findGoalCoveringSlot(slot);
            const dot = {
                userId: _userId,
                date: _date,
                timeSlot: slot,
                durationSlots: duration,
                executed: status,
                executionSatisfaction: sat,
                outcomeSatisfaction: sat,
                actualTask: text,
                plannedTask: (linkedGoal?.title || linkedGoal?.text || ''),
                linkedGoalId: linkedGoal?.id || null,
                reason: '',
                labelIds: [],
                // 정직성 인프라: 타임라인 인라인에서 사용자가 직접 찍은 도트.
                source: 'self_report',
            };
            await saveDot(dek, dot);
            panel.remove();
            // Optimistic — 같은 id의 기존 도트 교체 후 즉시 렌더.
            _dots = _dots.filter(d => d.id !== dot.id);
            _dots.push(dot);
            render();
            refreshTimeline({ userId: _userId, date: _date }).catch(e =>
                console.warn('post-save refresh failed:', e)
            );
            showToast('🔐 보관했어요. 자세히 평가하려면 도트를 다시 눌러 주세요.');
        } catch (e) {
            console.error('actual save failed:', e);
            showToast('저장이 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
            _saved = false;
        }
    };

    // 상태 버튼 클릭 → 그 상태로 저장
    panel.querySelectorAll('.utl-inline-status-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const status = btn.dataset.status;
            const sat = parseInt(btn.dataset.sat);
            saveWith(status, sat);
        });
    });

    // 기본 저장 = 'done', sat=3 (보통)
    panel.querySelector('.utl-inline-save').addEventListener('click', () => saveWith('done', 3));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveWith('done', 3); }
        if (e.key === 'Escape') { e.preventDefault(); panel.remove(); }
    });

    // 외부 클릭 시 닫기 — 패널 바깥을 누르면 정리. 단 자기 자신 안 클릭은 무시.
    // panel이 외부 경로(ESC/저장/closeAllInlinePanels)로 사라져도 다음 클릭에서 자동 정리.
    const onOutside = (ev) => {
        if (!panel.isConnected) {
            document.removeEventListener('mousedown', onOutside, true);
            return;
        }
        if (!panel.contains(ev.target)) {
            panel.remove();
            document.removeEventListener('mousedown', onOutside, true);
        }
    };
    // mousedown 캡처 단계로 잡아야 다른 핸들러보다 먼저 동작
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}

// ─── 슬롯 리사이즈 (가장자리 드래그로 15분 단위 길이 조절) ───
// kind: 'decision' | 'dot'. 둘 다 같은 인터랙션이지만 저장 대상이 다름.
function startResize(kind, id, startY, slotEl) {
    let item = null;
    if (kind === 'decision') item = _decisions.find(x => x.id === id);
    else if (kind === 'dot')  item = _dots.find(x => x.id === id);
    if (!item) return;
    const startDuration = item.durationSlots || (kind === 'dot' ? 1 : 4);
    const startSlot = item.timeSlot || 0;
    slotEl.classList.add('resizing');
    startAutoScroll();

    const onMove = (e) => {
        updateAutoScrollFromEvent(e);
        const dy = e.clientY - startY;
        const dSlots = Math.round(dy / ROW_HEIGHT);
        const newDuration = Math.max(1, Math.min(SLOTS_PER_DAY - startSlot, startDuration + dSlots));
        slotEl.style.height = `${newDuration * ROW_HEIGHT - 2}px`;
        slotEl.dataset.tempDuration = String(newDuration);
        const titleEl = slotEl.querySelector('.slot-time');
        if (titleEl) {
            titleEl.textContent = `${slotToTime(startSlot)}~${slotToTime(startSlot + newDuration)} (${newDuration * 15}분)`;
        }
    };
    const onUp = async () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        stopAutoScroll();
        slotEl.classList.remove('resizing');
        const newDuration = parseInt(slotEl.dataset.tempDuration || '0');
        if (newDuration > 0 && newDuration !== startDuration) {
            item.durationSlots = newDuration;
            const dek = getDEK();
            if (!dek) return;
            if (kind === 'decision') {
                // 'decision' kind 는 daily 목표를 가리킴 (변수명만 호환 유지)
                await saveGoal(dek, item);
            } else {
                await saveDot(dek, item);
            }
            await refreshTimeline({ userId: _userId, date: _date });
            if (_onChange) await _onChange({ type: 'refresh' });
        }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// ─── 글로벌 이벤트 (툴바 버튼) ───
function bindGlobalEvents() {
    const sync = document.getElementById('sync-btn');
    if (sync) sync.addEventListener('click', async () => {
        await refreshTimeline({ userId: _userId, date: _date });
        showToast('일정을 새로 가져왔어요');
    });
    const push = document.getElementById('gcal-push-btn');
    if (push) push.addEventListener('click', async () => {
        // (2026-05-13 #39) in-flight 락 — 중복 클릭/핸들러 누적으로 일정 2개씩 생기는 회귀 차단
        if (push.dataset.inFlight === '1') return;
        push.dataset.inFlight = '1';
        const placed = _decisions.filter(d => d.timeSlot != null);
        if (placed.length === 0) {
            showToast('시간표에 옮겨둔 목표가 아직 없어요. 목표 카드의 ⋮⋮를 잡고 시간표로 옮겨 보실래요?');
            push.dataset.inFlight = '';
            return;
        }
        // 같은 목표가 _decisions 안에 중복 들어있는 경우(레이스/캐시 갱신) 안전 디듀프
        const seen = new Set();
        const unique = placed.filter(d => {
            const k = d.id || `${d.title}@${d.timeSlot}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        push.disabled = true;
        const orig = push.textContent;
        push.textContent = '📤 캘린더에 옮기는 중...';
        // 무한 진행 보호 — 30초 후 강제 복원
        const safetyTimer = setTimeout(() => {
            push.disabled = false;
            push.textContent = orig;
            push.dataset.inFlight = '';
        }, 30000);
        try {
            const r = await pushDecisionsToGoogleCalendar(unique);
            if (r.reason === 'no-token') {
                showToast('Google 계정과 먼저 연결해 주실래요?');
            } else {
                const parts = [];
                if (r.created) parts.push(`새로 ${r.created}개`);
                if (r.updated) parts.push(`갱신 ${r.updated}개`);
                if (r.failed) parts.push(`못 옮긴 항목 ${r.failed}개`);
                showToast(parts.length ? `📤 ${parts.join(', ')} 옮겼어요` : '새로 옮길 변경 사항이 없었어요');
                await refreshTimeline({ userId: _userId, date: _date });
            }
        } catch (e) {
            console.error('gcal push error:', e);
            showToast('옮기는 중에 잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
        } finally {
            clearTimeout(safetyTimer);
            push.disabled = false;
            push.textContent = orig;
            push.dataset.inFlight = '';
        }
    });
}

// (B-4 정리) 외부 dead export unplaceDecisionFromTimeline 제거.
// 시간표 plan 슬롯의 X 버튼이 unplaceGoal 을 직접 호출.

// ─── Phase E-1: 도트 ↔ daily 목표 자동 연결 ───
// actual 슬롯이 어떤 daily 목표 범위 안에 들어있다면 그 목표를 반환.
// 같은 시간대를 여러 목표가 덮으면 가장 먼저 매치된 것 사용 (실무상 거의 안 겹침).
function findGoalCoveringSlot(slot) {
    return _decisions.find(g => {
        if (g.timeSlot == null) return false;
        const start = g.timeSlot;
        const end = start + (g.durationSlots || 4);
        return slot >= start && slot < end;
    }) || null;
}

// ─── 유틸 ───
function slotToTime(slot) {
    const h = Math.floor(slot / 4);
    const m = (slot % 4) * 15;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isToday(dateStr) {
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    return dateStr === today;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
