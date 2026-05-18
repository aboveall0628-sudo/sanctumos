/**
 * reports.js — 리포트 뷰 UI
 *
 * Phase E-5-A: day 탭 새 dayReport spec.
 * Phase E-5-B: week 탭 새 weekReport spec(reports/weekReportRepo) 으로 전환.
 *   카드 — 통계 행 + 사실(aiSummary) + 가설(반복 횟수 뱃지) + 결단의 흐름 + 묵상 질문.
 * 나머지 탭(month/quarter/year)은 옛 data/reportPipeline 그대로 — 새 spec 구축 전 호환 유지.
 */

import { listDayReports } from '../reports/dayReportRepo.js';
// (Phase C 2026-05-16 fix) 리포트 재작성 inline thinking 카드
import { inlineThinkingForButton, THINKING_COPY } from './aiThinking.js';
import { listWeekReports } from '../reports/weekReportRepo.js';
import { generateWeeklyReport } from '../reports/weeklyReportFlow.js';
import { listMonthReports } from '../reports/monthReportRepo.js';
import { generateMonthlyReport } from '../reports/monthlyReportFlow.js';
import { listQuarterReports } from '../reports/quarterReportRepo.js';
import { generateQuarterlyReport } from '../reports/quarterlyReportFlow.js';
import { listYearReports } from '../reports/yearReportRepo.js';
import { generateYearlyReport } from '../reports/yearlyReportFlow.js';
import { getReports } from '../data/reportPipeline.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
// Phase E-9/R-DD: 리포트 카드 드릴다운 (spec §1.6 2층 "raw 데이터")
import { attachDrillDown } from './reportDrillDown.js';
// Phase E-9/R-QA: A3 확장 — 카드 하단 Q&A 입력창
import { mountReportQna } from './reportQna.js';

let _userId = null;
let _currentTab = 'day';

// STEP 3 완료 — quarter / year 모두 새 spec.
// OLD_COLLECTION_MAP은 더 이상 사용 안 함 (호환을 위해 빈 객체 유지).
const OLD_COLLECTION_MAP = {};

export async function renderReportsView(userId) {
    _userId = userId;
    const tabs = document.querySelectorAll('.report-tabs .tab-btn');
    tabs.forEach(t => {
        t.addEventListener('click', (e) => {
            tabs.forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            _currentTab = e.target.dataset.tab;
            loadReports();
        });
    });

    loadReports();
}

async function loadReports() {
    const container = document.getElementById('reports-list');
    if (!container) return;

    const dek = getDEK();
    if (!dek) {
        container.innerHTML = '<div class="no-data">잠금 해제가 필요합니다.</div>';
        return;
    }

    container.innerHTML = '<div class="loading-spinner"></div>';

    // Phase E-9/R-FIX: 각 list 호출을 개별 catch — 한 문서 복호화 실패가 메뉴 전체를 막지 않게.
    // baseRepo.queryRecords가 한 문서 깨지면 throw하는 정책이라, 여기서 흡수.
    const safeList = async (fn, label) => {
        try { return await fn(); }
        catch (e) {
            console.warn(`[reports] ${label} 일부 또는 전체 로드 실패:`, e);
            return null;
        }
    };

    try {
        if (_currentTab === 'day') {
            const reports = await safeList(() => listDayReports(dek, _userId, 365), 'day');
            container.innerHTML = renderDayList(reports);
            bindDayQna(container, dek, reports || []);
            bindCollapsibleCards(container);
        } else if (_currentTab === 'week') {
            const reports = await safeList(() => listWeekReports(dek, _userId, 52), 'week');
            container.innerHTML = renderWeekList(reports);
            bindWeekRegenerateButtons(dek);
            bindWeekDrillDown(container, dek, reports || []);
            bindWeekQna(container, dek, reports || []);
            bindCollapsibleCards(container);
        } else if (_currentTab === 'month') {
            const reports = await safeList(() => listMonthReports(dek, _userId, 24), 'month');
            container.innerHTML = renderMonthList(reports);
            bindMonthRegenerateButtons(dek);
            bindMonthDrillDown(container, dek, reports || []);
            bindMonthQna(container, dek, reports || []);
            bindCollapsibleCards(container);
        } else if (_currentTab === 'quarter') {
            const reports = await safeList(() => listQuarterReports(dek, _userId, 8), 'quarter');
            container.innerHTML = renderQuarterList(reports);
            bindQuarterRegenerateButtons(dek);
            bindQuarterDrillDown(container, dek, reports || []);
            bindQuarterQna(container, dek, reports || []);
            bindCollapsibleCards(container);
        } else if (_currentTab === 'year') {
            // Phase E-9/R-4: 연간도 새 spec 카드로
            const reports = await safeList(() => listYearReports(dek, _userId, 5), 'year');
            container.innerHTML = renderYearList(reports);
            bindYearRegenerateButtons(dek);
            bindYearDrillDown(container, dek, reports || []);
            bindYearQna(container, dek, reports || []);
            bindCollapsibleCards(container);
        } else {
            container.innerHTML = `<div class="no-data">알 수 없는 탭이에요.</div>`;
        }
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    } catch (e) {
        console.error('reports load failed:', e);
        container.innerHTML = `
            <div class="no-data">
                리포트를 불러오는 중에 잠깐 막혔어요.
                <p style="font-size:11px; color:var(--text-secondary); margin-top:8px">
                    ${escapeHtml(e?.message || '')}
                </p>
            </div>`;
    }
}

/**
 * Phase E-9/R-FIX: 리포트 카드 라디오 패턴 — 처음엔 모두 접힘(제목·미리보기 한 줄만).
 * 헤더 클릭 또는 Enter/Space → 그 카드만 펼침/접힘. 여러 개 동시 펼침 OK.
 */
function bindCollapsibleCards(container) {
    container.querySelectorAll('.report-card').forEach(card => {
        // 기본 접힘
        if (!card.hasAttribute('data-expanded')) card.setAttribute('data-collapsed', '');
        const header = card.querySelector('.report-card-header');
        if (!header || header.dataset.collapsibleBound === '1') return;
        header.dataset.collapsibleBound = '1';
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        const toggle = (e) => {
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (card.hasAttribute('data-collapsed')) {
                card.removeAttribute('data-collapsed');
                card.setAttribute('data-expanded', '');
            } else {
                card.removeAttribute('data-expanded');
                card.setAttribute('data-collapsed', '');
            }
        };
        header.addEventListener('click', toggle);
        header.addEventListener('keydown', toggle);
    });
}

/**
 * 카드 미리보기 한 줄 — AI 산문 첫 줄을 70자 이내로.
 * 산문이 없으면 stat 한 줄 요약.
 */
function previewLine(r) {
    const s = String(r?.aiSummary || '').replace(/\s+/g, ' ').trim();
    if (s.length > 0) {
        return s.length > 70 ? s.slice(0, 70) + '…' : s;
    }
    return '아직 AI 산문이 채워지지 않았어요. 펼쳐서 다시 만들어 보세요.';
}

// ─── day 탭 (새 spec) ────────────────────────────────────
function renderDayList(reports) {
    if (reports === null) {
        // safeList가 null 반환 — 부분 실패. 헤더만이라도 빈 상태로.
        return `
            <div class="no-data">
                일부 또는 전체 리포트를 불러오지 못했어요. 콘솔에 사유가 남았어요.
            </div>
        `;
    }
    if (!reports || reports.length === 0) {
        return `
            <div class="no-data">
                아직 만든 일간 리포트가 없어요. 오늘 화면 하단의 [오늘 리포트 만들기]를 눌러 보세요.
            </div>
        `;
    }
    return reports.map(renderDayCard).join('');
}

function renderDayCard(r) {
    const stats     = r.stats || {};
    const dotStats  = stats.dotStats || {};
    const satDist   = stats.satisfactionDistribution || {};
    const align     = stats.alignment || {};
    const totalDots = dotStats.totalDots ?? 0;
    const doneCount = dotStats.doneCount ?? 0;
    const avgSat    = satDist.avg;
    const matchPct  = (align.decisionExecutionRate != null)
        ? Math.round(align.decisionExecutionRate * 100) : null;

    const observation = (r.observations || [])[0] || null;
    const questions   = r.questionsForMeditation || [];

    const summaryBlock = r.aiSummary
        ? `<div class="report-summary"><p>${escapeHtml(r.aiSummary)}</p></div>`
        : `<div class="report-summary report-summary-empty">
               이 날은 아직 AI 산문이 채워지지 않았어요. 오늘 화면 하단의 [오늘 리포트 만들기]에서 다시 만들 수 있어요.
           </div>`;

    // STEP A-6 (17 흡수): 시간순 도트 펼치기 — raw 투명성 (3층 분리 중 드릴다운 자리)
    const timelineBlock = renderDotsTimelineDetails(stats.dotsTimeline);

    const obsBlock = observation
        ? `<div class="report-observation">
               <span class="report-section-label"><i data-lucide="eye" class="report-section-icon"></i> 관찰</span>
               <p>${escapeHtml(observation)}</p>
           </div>`
        : '';

    const qBlock = questions.length > 0
        ? `<div class="report-questions">
               <span class="report-section-label"><i data-lucide="message-circle-question" class="report-section-icon"></i> 묵상에 가져갈 질문</span>
               <ul>${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
           </div>`
        : '';

    const statsRow = `
        <div class="report-stats-row">
            <span class="report-stat"><strong>${doneCount}</strong>/${totalDots} <small>완료</small></span>
            ${avgSat != null ? `<span class="report-stat"><strong>${avgSat}</strong> <small>만족도</small></span>` : ''}
            ${matchPct != null ? `<span class="report-stat"><strong>${matchPct}%</strong> <small>결단 실행률</small></span>` : ''}
        </div>
    `;

    return `
        <article class="report-card card-section" data-day-id="${escapeHtml(r.startDate || '')}">
            <header class="report-card-header">
                <h3>${escapeHtml(r.startDate || '')} <span class="report-day-of-week">${escapeHtml(dayOfWeekKr(r.startDate))}</span></h3>
                <p class="report-preview">${escapeHtml(previewLine(r))}</p>
                <i class="report-card-chev" data-lucide="chevron-down"></i>
            </header>
            <div class="report-card-body">
                ${statsRow}
                ${summaryBlock}
                ${timelineBlock}
                ${obsBlock}
                ${qBlock}
                <div class="report-card-foot">여기까지가 데이터예요. 다음은 묵상 안에서.</div>
            </div>
        </article>
    `;
}

// STEP A-6: 시간순 도트 표 details/summary — 산문 아래 접어둠.
//   17번 흡수: 사용자가 "오늘 그대로" 보고 싶을 때 펼침. 평소엔 산문이 메인.
//   todayView 의 일간 리포트 카드에서도 동일한 토글 노출하려고 export.
export function renderDotsTimelineDetails(timeline) {
    if (!Array.isArray(timeline) || timeline.length === 0) return '';
    const rows = timeline.map(t => {
        const satCells = [];
        if (typeof t.executionSatisfaction === 'number') satCells.push(`실행 ${t.executionSatisfaction}`);
        if (typeof t.outcomeSatisfaction === 'number')   satCells.push(`결과 ${t.outcomeSatisfaction}`);
        const sats = satCells.join(' · ');
        const reasonHtml = t.reason
            ? `<div class="dot-row-reason">"${escapeHtml(t.reason)}"</div>`
            : '';
        return `
            <li class="dot-row">
                <span class="dot-row-time">${escapeHtml(t.time || '')}</span>
                <div class="dot-row-body">
                    <div class="dot-row-title">${escapeHtml(t.title || '')}</div>
                    ${reasonHtml}
                    ${sats ? `<div class="dot-row-meta">${escapeHtml(sats)}</div>` : ''}
                </div>
            </li>
        `;
    }).join('');
    return `
        <details class="report-timeline">
            <summary>시간순 도트 ${timeline.length}개 펼치기</summary>
            <ul class="dot-timeline-list">${rows}</ul>
        </details>
    `;
}

function dayOfWeekKr(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()] + '요일';
}

// ─── week 탭 (새 spec — Phase E-5-B) ────────────────────
function renderWeekList(reports) {
    if (reports === null) {
        return `<div class="no-data">일부 또는 전체 주간 리포트를 불러오지 못했어요.</div>`;
    }
    if (!reports || reports.length === 0) {
        return `
            <div class="no-data">
                아직 만든 주간 리포트가 없어요. 토요일 저녁 회고에서 [이번 주 리포트 만들기]를 눌러 보세요.
            </div>
        `;
    }
    return reports.map(renderWeekCard).join('');
}

function renderWeekCard(r) {
    const stats     = r.stats || {};
    const totalDots = stats.totalDots ?? 0;

    // 시간대 가장 만족도 높은 구간 (요약 통계용)
    const bands = Object.values(stats.timeBandPattern || {}).filter(b => typeof b?.avg === 'number');
    const topBand = bands.length > 0 ? bands.reduce((a, b) => a.avg > b.avg ? a : b) : null;

    const decisionDistance = stats.decisionFlow?.avgDistanceDays;
    const decisionSample   = stats.decisionFlow?.sampleSize ?? 0;

    const pinnedTotal = (stats.pinnedPrincipleApplication?.items || [])
        .reduce((sum, p) => sum + (p.appliedCount || 0), 0);
    const personCount = (stats.personCounts?.items || []).length;

    const statsRow = `
        <div class="report-stats-row">
            <span class="report-stat"><strong>${totalDots}</strong> <small>도트</small></span>
            ${topBand ? `<span class="report-stat"><strong>${topBand.avg}</strong> <small>${escapeHtml(topBand.label)} 만족도</small></span>` : ''}
            ${decisionSample > 0 ? `<span class="report-stat"><strong>${decisionDistance}일</strong> <small>결단→실행 평균 거리</small></span>` : ''}
            ${pinnedTotal > 0 ? `<span class="report-stat"><strong>${pinnedTotal}</strong> <small>핀 원칙 적용</small></span>` : ''}
            ${personCount > 0 ? `<span class="report-stat"><strong>${personCount}</strong> <small>만난 사람</small></span>` : ''}
        </div>
    `;

    const summaryBlock = r.aiSummary
        ? `<div class="report-summary"><p>${escapeHtml(r.aiSummary)}</p></div>`
        : `<div class="report-summary report-summary-empty">
               이 주는 아직 AI 산문이 채워지지 않았어요. 카드 하단의 [리포트 재작성하기]를 눌러 보세요.
           </div>`;

    const hypotheses = r.hypotheses || [];
    const hypothesesBlock = hypotheses.length > 0
        ? `<div class="report-section report-hypotheses" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="lightbulb" class="report-section-icon"></i> 가설</span>
               <ul style="margin:6px 0 0 0; padding-left:20px">
                   ${hypotheses.map(h => `
                       <li style="margin-bottom:6px">
                           ${h.repetitionCount ? `<span class="hypothesis-badge" style="display:inline-block; padding:1px 6px; background:var(--bg-secondary, #f0f0f0); border-radius:10px; font-size:11px; margin-right:6px">${escapeHtml(h.repetitionCount)}</span>` : ''}
                           ${escapeHtml(h.text)}
                       </li>
                   `).join('')}
               </ul>
           </div>`
        : '';

    const decisionSampleCount = stats.decisionFlow?.sampleSize ?? 0;
    const decisionFlowBlock = r.decisionFlow
        ? `<div class="report-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="compass" class="report-section-icon"></i> 결단의 흐름</span>
               <p style="margin:6px 0 0 0; white-space:pre-wrap">${escapeHtml(r.decisionFlow)}</p>
               ${decisionSampleCount > 0
                    ? `<button class="drill-link" data-drill-decision style="margin-top:8px">▶ 이 결단들의 raw 목록 보기</button>`
                    : ''}
           </div>`
        : '';

    // Phase E-9/R-DD: 2층 — raw 데이터 드릴다운 진입점. 산문에 추상화된 흐름이 어디서 왔는지.
    const persons = stats.personCounts?.items || [];
    const labelPairs = stats.labelCorrelation?.topPairs || [];
    const pinnedItems = stats.pinnedPrincipleApplication?.items || [];
    const drillBlock = (persons.length > 0 || labelPairs.length > 0 || pinnedItems.length > 0)
        ? `<div class="report-section drill-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="search" class="report-section-icon"></i> 자세히 보기</span>
               ${persons.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">함께한 사람</span>
                       <div class="drill-chip-row">
                           ${persons.slice(0, 8).map(p => `
                               <span class="drill-chip" data-drill="person" data-person-id="${escapeHtml(p.personId)}">
                                   ${escapeHtml(p.personId.slice(0, 8))} · ${p.interactionCount}회
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
               ${labelPairs.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">자주 함께 등장한 라벨</span>
                       <div class="drill-chip-row">
                           ${labelPairs.slice(0, 8).map(pair => `
                               <span class="drill-chip" data-drill="labelPair" data-a="${escapeHtml(pair.a)}" data-b="${escapeHtml(pair.b)}">
                                   ${escapeHtml(pair.a)} × ${escapeHtml(pair.b)} · ${pair.count}
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
               ${pinnedItems.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">핀 원칙 적용</span>
                       <div class="drill-chip-row">
                           ${pinnedItems.map(p => `
                               <span class="drill-chip" data-drill="pinnedPrinciple" data-principle-id="${escapeHtml(p.principleId)}" data-title="${escapeHtml(p.title || '')}">
                                   ${escapeHtml(p.title || '(원칙)')} · ${p.appliedCount}회
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
           </div>`
        : '';

    const questions = r.questionsForMeditation || [];
    const qBlock = questions.length > 0
        ? `<div class="report-questions">
               <span class="report-section-label"><i data-lucide="message-circle-question" class="report-section-icon"></i> 묵상에 가져갈 질문</span>
               <ul>${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
           </div>`
        : '';

    return `
        <article class="report-card card-section" data-year-week="${escapeHtml(stats.yearWeek || '')}" data-start="${escapeHtml(r.startDate || '')}" data-end="${escapeHtml(r.endDate || '')}">
            <header class="report-card-header">
                <h3>${escapeHtml(r.startDate || '')} ~ ${escapeHtml(r.endDate || '')} ${stats.yearWeek ? `<span class="report-card-meta">${escapeHtml(stats.yearWeek)}</span>` : ''}</h3>
                <p class="report-preview">${escapeHtml(previewLine(r))}</p>
                <i class="report-card-chev" data-lucide="chevron-down"></i>
            </header>
            <div class="report-card-body">
            ${statsRow}
            ${summaryBlock}
            ${hypothesesBlock}
            ${decisionFlowBlock}
            ${drillBlock}
            ${qBlock}
            <div style="text-align:center; margin-top:14px">
                <button class="text-btn week-regenerate-btn" style="font-size:13px; color:var(--text-secondary, #888); cursor:pointer; background:none; border:none">
                    ↻ 리포트 재작성하기
                </button>
            </div>
            <div class="report-card-foot">여기까지가 데이터예요. 다음은 묵상 안에서.</div>
            </div>
        </article>
    `;
}

/**
 * Phase E-9/R-DD: week 카드의 drill chip·decision 버튼에 드릴다운 부착.
 * 또 personId chip의 텍스트를 실제 이름으로 lazy 교체.
 */
function bindWeekDrillDown(container, dek, reports) {
    const cards = container.querySelectorAll('[data-year-week]');
    cards.forEach((card, idx) => {
        const r = reports[idx];
        if (!r) return;
        const range = { start: r.startDate, end: r.endDate };

        // chip 들
        card.querySelectorAll('[data-drill]').forEach(chip => {
            const type = chip.dataset.drill;
            if (type === 'person') {
                attachDrillDown(chip, {
                    type: 'person',
                    params: { personId: chip.dataset.personId },
                    range, dek, userId: _userId,
                });
            } else if (type === 'labelPair') {
                attachDrillDown(chip, {
                    type: 'labelPair',
                    params: { a: chip.dataset.a, b: chip.dataset.b },
                    range, dek, userId: _userId,
                });
            } else if (type === 'pinnedPrinciple') {
                attachDrillDown(chip, {
                    type: 'pinnedPrinciple',
                    params: { principleId: chip.dataset.principleId, title: chip.dataset.title },
                    range, dek, userId: _userId,
                });
            }
        });

        // 결단 흐름 버튼
        const decisionBtn = card.querySelector('[data-drill-decision]');
        if (decisionBtn) {
            attachDrillDown(decisionBtn, {
                type: 'decision',
                params: {},
                range, dek, userId: _userId,
                label: '이 기간 결단의 흐름 (raw)',
            });
        }

        // person chip 텍스트 → 실제 이름 (lazy)
        enrichPersonChips(card, dek);
    });
}

/**
 * Phase E-9/R-QA: 카드별 Q&A 입력창 부착.
 * 푸터(.report-card-foot) 앞에 reportQna 컴포넌트를 박음.
 */
function bindDayQna(container, dek, reports) {
    try {
        container.querySelectorAll('[data-day-id]').forEach((card, idx) => {
            const r = reports[idx];
            if (!r) return;
            const foot = card.querySelector('.report-card-foot');
            if (!foot) return;
            mountReportQna(foot, {
                reportId:   r.startDate,
                reportType: 'day',
                stats:      r.stats || {},
                context:    {},
                dek, userId: _userId,
            });
        });
    } catch (e) { console.warn('bindDayQna failed:', e); }
}

function bindWeekQna(container, dek, reports) {
    try {
        container.querySelectorAll('[data-year-week]').forEach((card, idx) => {
            const r = reports[idx];
            if (!r) return;
            const foot = card.querySelector('.report-card-foot');
            if (!foot) return;
            const yearWeek = card.dataset.yearWeek || r.stats?.yearWeek || r.startDate;
            mountReportQna(foot, {
                reportId:   yearWeek,
                reportType: 'week',
                stats:      r.stats || {},
                context:    {},
                dek, userId: _userId,
            });
        });
    } catch (e) { console.warn('bindWeekQna failed:', e); }
}

function bindMonthQna(container, dek, reports) {
    try {
        container.querySelectorAll('[data-year-month]').forEach((card, idx) => {
            const r = reports[idx];
            if (!r) return;
            const foot = card.querySelector('.report-card-foot');
            if (!foot) return;
            const yearMonth = card.dataset.yearMonth || r.stats?.yearMonth || r.startDate?.slice(0, 7);
            mountReportQna(foot, {
                reportId:   yearMonth,
                reportType: 'month',
                stats:      r.stats || {},
                context:    {},
                dek, userId: _userId,
            });
        });
    } catch (e) { console.warn('bindMonthQna failed:', e); }
}

async function enrichPersonChips(card, dek) {
    const chips = [...card.querySelectorAll('.drill-chip[data-drill="person"]')];
    if (chips.length === 0) return;
    try {
        const { getAllPersons } = await import('../data/personRepo.js');
        const all = await getAllPersons(dek, _userId).catch(() => []);
        const nameById = new Map(all.map(p => [p.id, p.name || '(이름 미지정)']));
        chips.forEach(chip => {
            const id = chip.dataset.personId;
            const name = nameById.get(id);
            if (!name) return;
            // 형식 유지: "이름 · N회"
            const countMatch = chip.textContent.match(/(\d+)회/);
            const count = countMatch ? `${countMatch[1]}회` : '';
            chip.textContent = `${name}${count ? ` · ${count}` : ''}`;
        });
    } catch (e) {
        console.warn('enrich person chips failed:', e);
    }
}

function bindWeekRegenerateButtons(dek) {
    document.querySelectorAll('.week-regenerate-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const card = e.target.closest('[data-year-week]');
            if (!card) return;
            const weekStart = card.dataset.start;
            const weekEnd   = card.dataset.end;
            if (!weekStart || !weekEnd) {
                showToast('이 카드는 기간 정보가 없어요');
                return;
            }
            btn.disabled = true;
            const thinkingHandle = inlineThinkingForButton(btn, { labels: THINKING_COPY.reportGenerate });
            try {
                await generateWeeklyReport(dek, _userId, weekStart, weekEnd, { force: true });
                thinkingHandle.finish();
                await loadReports();   // 목록 통째로 다시
                showToast('주간 리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('week regenerate failed:', e);
                thinkingHandle.dispose();
                showToast('재작성이 잠깐 막혔어요. 잠시 후 다시 시도해 주세요');
                btn.disabled = false;
            }
        });
    });
}

// ─── month 탭 (새 spec — Phase E-9/R-2) ─────────────────
function renderMonthList(reports) {
    if (reports === null) {
        return `<div class="no-data">일부 또는 전체 월간 리포트를 불러오지 못했어요.</div>`;
    }
    if (!reports || reports.length === 0) {
        return `
            <div class="no-data">
                아직 만든 월간 리포트가 없어요. 월말 토요일에 오늘 화면 하단에서 [이번 달 리포트 만들기]를 눌러 보세요.
            </div>
        `;
    }
    return reports.map(renderMonthCard).join('');
}

function renderMonthCard(r) {
    const stats     = r.stats || {};
    const totalDots = stats.totalDots ?? 0;
    const weeksWithData = stats.weeklyMatrix?.weeksWithData ?? 0;

    // 카테고리 점유 top 1 — 시간 합계로 요약
    const cats = stats.categorySatisfactionMatrix?.items || [];
    const topCat = cats[0];
    const topCatHours = topCat ? Math.round((topCat.durationMinutes || 0) / 60 * 10) / 10 : null;

    const decisionDistance = stats.decisionFlow?.avgDistanceDays;
    const decisionSample   = stats.decisionFlow?.sampleSize ?? 0;

    const personCount = stats.personNetwork?.totalUniquePersons ?? 0;

    const pinned = stats.pinnedPrincipleEffectiveness || {};
    const pinnedDelta = (pinned.hasPinned
        && pinned.applied?.avgSatisfaction != null
        && pinned.unapplied?.avgSatisfaction != null)
        ? Math.round((pinned.applied.avgSatisfaction - pinned.unapplied.avgSatisfaction) * 100) / 100
        : null;

    const statsRow = `
        <div class="report-stats-row">
            <span class="report-stat"><strong>${totalDots}</strong> <small>도트</small></span>
            ${weeksWithData > 0 ? `<span class="report-stat"><strong>${weeksWithData}</strong> <small>주 합류</small></span>` : ''}
            ${topCat ? `<span class="report-stat"><strong>${topCatHours}h</strong> <small>${escapeHtml(topCat.category)}</small></span>` : ''}
            ${decisionSample > 0 ? `<span class="report-stat"><strong>${decisionDistance}일</strong> <small>결단→실행 평균</small></span>` : ''}
            ${personCount > 0 ? `<span class="report-stat"><strong>${personCount}</strong> <small>만난 사람</small></span>` : ''}
            ${pinnedDelta != null ? `<span class="report-stat"><strong>${pinnedDelta > 0 ? '+' : ''}${pinnedDelta}</strong> <small>핀 원칙 효과</small></span>` : ''}
        </div>
    `;

    const summaryBlock = r.aiSummary
        ? `<div class="report-summary"><p style="white-space:pre-wrap">${escapeHtml(r.aiSummary)}</p></div>`
        : `<div class="report-summary report-summary-empty">
               이 달은 아직 AI 산문이 채워지지 않았어요. 카드 하단의 [리포트 재작성하기]를 눌러 보세요.
           </div>`;

    const hypotheses = r.hypotheses || [];
    const hypothesesBlock = hypotheses.length > 0
        ? `<div class="report-section report-hypotheses" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="lightbulb" class="report-section-icon"></i> 가설</span>
               <ul style="margin:6px 0 0 0; padding-left:20px">
                   ${hypotheses.map(h => `
                       <li style="margin-bottom:6px">
                           ${h.repetitionCount ? `<span class="hypothesis-badge" style="display:inline-block; padding:1px 6px; background:var(--bg-secondary, #f0f0f0); border-radius:10px; font-size:11px; margin-right:6px">${escapeHtml(h.repetitionCount)}</span>` : ''}
                           ${escapeHtml(h.text)}
                       </li>
                   `).join('')}
               </ul>
           </div>`
        : '';

    // A1 — 이번 달 자주 관찰된 패턴 (도트 ID 노출 X, 산문)
    const patterns = r.patternsObserved || [];
    const patternsBlock = patterns.length > 0
        ? `<div class="report-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="repeat" class="report-section-icon"></i> 이번 달 자주 관찰된 패턴</span>
               ${patterns.map(p => `
                   <div class="report-pattern" style="margin-top:10px; padding:12px; background:var(--bg-elev); border-left:3px solid var(--accent); border-radius:6px">
                       <h4 style="margin:0 0 6px; font-size:13px; font-weight:600">${escapeHtml(p.title || '관찰된 패턴')}</h4>
                       <p style="margin:0; font-size:13px; line-height:1.6; white-space:pre-wrap">${escapeHtml(p.body || '')}</p>
                   </div>
               `).join('')}
           </div>`
        : '';

    const monthDecisionSamples = stats.decisionFlow?.sampleSize ?? 0;
    const decisionFlowBlock = r.decisionFlow
        ? `<div class="report-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="compass" class="report-section-icon"></i> 결단의 흐름</span>
               <p style="margin:6px 0 0 0; white-space:pre-wrap">${escapeHtml(r.decisionFlow)}</p>
               ${monthDecisionSamples > 0
                    ? `<button class="drill-link" data-drill-decision style="margin-top:8px">▶ 이 결단들의 raw 목록 보기</button>`
                    : ''}
           </div>`
        : '';

    // Phase E-9/R-DD: 월간 카드 raw 드릴다운
    const monthPersons = stats.personNetwork?.items || [];
    const monthLabelPairs = stats.labelCorrelation?.topPairs || [];
    const monthCats = stats.categorySatisfactionMatrix?.items || [];
    const monthDrillBlock = (monthPersons.length > 0 || monthLabelPairs.length > 0 || monthCats.length > 0)
        ? `<div class="report-section drill-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="search" class="report-section-icon"></i> 자세히 보기</span>
               ${monthCats.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">카테고리</span>
                       <div class="drill-chip-row">
                           ${monthCats.slice(0, 8).map(c => {
                               const hours = Math.round((c.durationMinutes || 0) / 60 * 10) / 10;
                               return `
                                   <span class="drill-chip" data-drill="category" data-category-id="${escapeHtml(c.category)}">
                                       ${escapeHtml(c.category)} · ${hours}h · ${c.count}회
                                   </span>`;
                           }).join('')}
                       </div>
                   </div>` : ''}
               ${monthPersons.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">함께한 사람</span>
                       <div class="drill-chip-row">
                           ${monthPersons.slice(0, 8).map(p => `
                               <span class="drill-chip" data-drill="person" data-person-id="${escapeHtml(p.personId)}">
                                   ${escapeHtml(p.personId.slice(0, 8))} · ${p.interactionCount}회
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
               ${monthLabelPairs.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">자주 함께 등장한 라벨</span>
                       <div class="drill-chip-row">
                           ${monthLabelPairs.slice(0, 8).map(pair => `
                               <span class="drill-chip" data-drill="labelPair" data-a="${escapeHtml(pair.a)}" data-b="${escapeHtml(pair.b)}">
                                   ${escapeHtml(pair.a)} × ${escapeHtml(pair.b)} · ${pair.count}
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
           </div>`
        : '';

    const questions = r.questionsForMeditation || [];
    const qBlock = questions.length > 0
        ? `<div class="report-questions">
               <span class="report-section-label"><i data-lucide="message-circle-question" class="report-section-icon"></i> 묵상에 가져갈 질문</span>
               <ul>${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
           </div>`
        : '';

    return `
        <article class="report-card card-section" data-year-month="${escapeHtml(stats.yearMonth || '')}" data-start="${escapeHtml(r.startDate || '')}" data-end="${escapeHtml(r.endDate || '')}">
            <header class="report-card-header">
                <h3>${escapeHtml(stats.yearMonth || r.startDate || '')} ${r.startDate && r.endDate ? `<span class="report-card-meta">${escapeHtml(r.startDate)} ~ ${escapeHtml(r.endDate)}</span>` : ''}</h3>
                <p class="report-preview">${escapeHtml(previewLine(r))}</p>
                <i class="report-card-chev" data-lucide="chevron-down"></i>
            </header>
            <div class="report-card-body">
            ${statsRow}
            ${summaryBlock}
            ${hypothesesBlock}
            ${patternsBlock}
            ${decisionFlowBlock}
            ${monthDrillBlock}
            ${qBlock}
            <div style="text-align:center; margin-top:14px">
                <button class="text-btn month-regenerate-btn" style="font-size:13px; color:var(--text-secondary, #888); cursor:pointer; background:none; border:none">
                    ↻ 리포트 재작성하기
                </button>
            </div>
            <div class="report-card-foot">여기까지가 데이터예요. 다음은 묵상 안에서.</div>
            </div>
        </article>
    `;
}

/**
 * Phase E-9/R-DD: month 카드 drill 부착. week 와 같은 패턴 + 카테고리 chip 추가.
 */
function bindMonthDrillDown(container, dek, reports) {
    const cards = container.querySelectorAll('[data-year-month]');
    cards.forEach((card, idx) => {
        const r = reports[idx];
        if (!r) return;
        const range = { start: r.startDate, end: r.endDate };

        card.querySelectorAll('[data-drill]').forEach(chip => {
            const type = chip.dataset.drill;
            if (type === 'person') {
                attachDrillDown(chip, {
                    type: 'person',
                    params: { personId: chip.dataset.personId },
                    range, dek, userId: _userId,
                });
            } else if (type === 'category') {
                attachDrillDown(chip, {
                    type: 'category',
                    params: { categoryId: chip.dataset.categoryId },
                    range, dek, userId: _userId,
                });
            } else if (type === 'labelPair') {
                attachDrillDown(chip, {
                    type: 'labelPair',
                    params: { a: chip.dataset.a, b: chip.dataset.b },
                    range, dek, userId: _userId,
                });
            }
        });

        const decisionBtn = card.querySelector('[data-drill-decision]');
        if (decisionBtn) {
            attachDrillDown(decisionBtn, {
                type: 'decision',
                params: {},
                range, dek, userId: _userId,
                label: '이 기간 결단의 흐름 (raw)',
            });
        }

        enrichPersonChips(card, dek);
    });
}

function bindMonthRegenerateButtons(dek) {
    document.querySelectorAll('.month-regenerate-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const card = e.target.closest('[data-year-month]');
            if (!card) return;
            const monthStart = card.dataset.start;
            const monthEnd   = card.dataset.end;
            if (!monthStart || !monthEnd) {
                showToast('이 카드는 기간 정보가 없어요');
                return;
            }
            btn.disabled = true;
            const thinkingHandle = inlineThinkingForButton(btn, { labels: THINKING_COPY.reportGenerate });
            try {
                await generateMonthlyReport(dek, _userId, monthStart, monthEnd, { force: true });
                thinkingHandle.finish();
                await loadReports();
                showToast('월간 리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('month regenerate failed:', e);
                thinkingHandle.dispose();
                showToast('재작성이 잠깐 막혔어요. 잠시 후 다시 시도해 주세요');
                btn.disabled = false;
            }
        });
    });
}

// ─── quarter 탭 (새 spec — Phase E-9/R-3) ─────────────
function renderQuarterList(reports) {
    if (reports === null) {
        return `<div class="no-data">일부 또는 전체 분기 리포트를 불러오지 못했어요.</div>`;
    }
    if (!reports || reports.length === 0) {
        return `
            <div class="no-data">
                아직 만든 분기 리포트가 없어요. 분기말 토요일(3·6·9·12월 마지막 토)에 오늘 화면 하단에서 [이번 분기 리포트 만들기]를 눌러 보세요.
            </div>
        `;
    }
    return reports.map(renderQuarterCard).join('');
}

function renderQuarterCard(r) {
    const stats = r.stats || {};
    const totalDots = stats.totalDots ?? 0;
    const months = stats.monthlyMatrix?.months || [];
    const monthsWithData = stats.monthlyMatrix?.monthsWithData ?? 0;

    const decisionDistance = stats.decisionFlow?.avgDistanceDays;
    const decisionSample   = stats.decisionFlow?.sampleSize ?? 0;
    const personCount = stats.personNetwork?.totalUniquePersons ?? 0;

    const pinned = stats.pinnedPrincipleEffectiveness || {};
    const pinnedDelta = (pinned.hasPinned
        && pinned.applied?.avgSatisfaction != null
        && pinned.unapplied?.avgSatisfaction != null)
        ? Math.round((pinned.applied.avgSatisfaction - pinned.unapplied.avgSatisfaction) * 100) / 100
        : null;

    const statsRow = `
        <div class="report-stats-row">
            <span class="report-stat"><strong>${totalDots}</strong> <small>도트</small></span>
            ${monthsWithData > 0 ? `<span class="report-stat"><strong>${monthsWithData}</strong> <small>월 합류</small></span>` : ''}
            ${decisionSample > 0 ? `<span class="report-stat"><strong>${decisionDistance}일</strong> <small>결단→실행 평균</small></span>` : ''}
            ${personCount > 0 ? `<span class="report-stat"><strong>${personCount}</strong> <small>만난 사람</small></span>` : ''}
            ${pinnedDelta != null ? `<span class="report-stat"><strong>${pinnedDelta > 0 ? '+' : ''}${pinnedDelta}</strong> <small>핀 원칙 효과</small></span>` : ''}
        </div>
    `;

    const summaryBlock = r.aiSummary
        ? `<div class="report-summary"><p style="white-space:pre-wrap">${escapeHtml(r.aiSummary)}</p></div>`
        : `<div class="report-summary report-summary-empty">
               이 분기는 아직 AI 산문이 채워지지 않았어요. 카드 하단의 [리포트 재작성하기]를 눌러 보세요.
           </div>`;

    const hypotheses = r.hypotheses || [];
    const hypothesesBlock = hypotheses.length > 0
        ? `<div class="report-section report-hypotheses" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="lightbulb" class="report-section-icon"></i> 가설 (3개월 일관성)</span>
               <ul style="margin:6px 0 0 0; padding-left:20px">
                   ${hypotheses.map(h => `
                       <li style="margin-bottom:6px">
                           ${h.repetitionCount ? `<span class="hypothesis-badge" style="display:inline-block; padding:1px 6px; background:var(--bg-secondary, #f0f0f0); border-radius:10px; font-size:11px; margin-right:6px">${escapeHtml(h.repetitionCount)}</span>` : ''}
                           ${escapeHtml(h.text)}
                       </li>
                   `).join('')}
               </ul>
           </div>`
        : '';

    const qDecisionSamples = stats.decisionFlow?.sampleSize ?? 0;
    const decisionFlowBlock = r.decisionFlow
        ? `<div class="report-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="compass" class="report-section-icon"></i> 결단의 흐름</span>
               <p style="margin:6px 0 0 0; white-space:pre-wrap">${escapeHtml(r.decisionFlow)}</p>
               ${qDecisionSamples > 0
                    ? `<button class="drill-link" data-drill-decision style="margin-top:8px">▶ 이 결단들의 raw 목록 보기</button>`
                    : ''}
           </div>`
        : '';

    // Drill (인물 / 라벨 쌍 — 카테고리는 월별로만 의미 있어 분기에는 안 둠)
    const qPersons = stats.personNetwork?.items || [];
    const qLabelPairs = stats.labelCorrelation?.topPairs || [];
    const qDrillBlock = (qPersons.length > 0 || qLabelPairs.length > 0)
        ? `<div class="report-section drill-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="search" class="report-section-icon"></i> 자세히 보기</span>
               ${qPersons.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">함께한 사람</span>
                       <div class="drill-chip-row">
                           ${qPersons.slice(0, 10).map(p => `
                               <span class="drill-chip" data-drill="person" data-person-id="${escapeHtml(p.personId)}">
                                   ${escapeHtml(p.personId.slice(0, 8))} · ${p.interactionCount}회
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
               ${qLabelPairs.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">자주 함께 등장한 라벨</span>
                       <div class="drill-chip-row">
                           ${qLabelPairs.slice(0, 10).map(pair => `
                               <span class="drill-chip" data-drill="labelPair" data-a="${escapeHtml(pair.a)}" data-b="${escapeHtml(pair.b)}">
                                   ${escapeHtml(pair.a)} × ${escapeHtml(pair.b)} · ${pair.count}
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
           </div>`
        : '';

    const questions = r.questionsForMeditation || [];
    const qBlock = questions.length > 0
        ? `<div class="report-questions">
               <span class="report-section-label"><i data-lucide="message-circle-question" class="report-section-icon"></i> 묵상에 가져갈 질문</span>
               <ul>${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
           </div>`
        : '';

    return `
        <article class="report-card card-section" data-year-quarter="${escapeHtml(stats.yearQuarter || '')}" data-start="${escapeHtml(r.startDate || '')}" data-end="${escapeHtml(r.endDate || '')}">
            <header class="report-card-header">
                <h3>${escapeHtml(stats.yearQuarter || r.startDate || '')} ${r.startDate && r.endDate ? `<span class="report-card-meta">${escapeHtml(r.startDate)} ~ ${escapeHtml(r.endDate)}</span>` : ''}</h3>
                <p class="report-preview">${escapeHtml(previewLine(r))}</p>
                <i class="report-card-chev" data-lucide="chevron-down"></i>
            </header>
            <div class="report-card-body">
            ${statsRow}
            ${summaryBlock}
            ${hypothesesBlock}
            ${decisionFlowBlock}
            ${qDrillBlock}
            ${qBlock}
            <div style="text-align:center; margin-top:14px">
                <button class="text-btn quarter-regenerate-btn" style="font-size:13px; color:var(--text-secondary, #888); cursor:pointer; background:none; border:none">
                    ↻ 리포트 재작성하기
                </button>
            </div>
            <div class="report-card-foot">여기까지가 데이터예요. 다음은 묵상 안에서.</div>
            </div>
        </article>
    `;
}

function bindQuarterRegenerateButtons(dek) {
    document.querySelectorAll('.quarter-regenerate-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const card = e.target.closest('[data-year-quarter]');
            if (!card) return;
            const quarterStart = card.dataset.start;
            const quarterEnd   = card.dataset.end;
            if (!quarterStart || !quarterEnd) {
                showToast('이 카드는 기간 정보가 없어요');
                return;
            }
            btn.disabled = true;
            const thinkingHandle = inlineThinkingForButton(btn, { labels: THINKING_COPY.reportGenerate });
            try {
                await generateQuarterlyReport(dek, _userId, quarterStart, quarterEnd, { force: true });
                thinkingHandle.finish();
                await loadReports();
                showToast('분기 리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('quarter regenerate failed:', e);
                thinkingHandle.dispose();
                showToast('재작성이 잠깐 막혔어요. 잠시 후 다시 시도해 주세요');
                btn.disabled = false;
            }
        });
    });
}

function bindQuarterDrillDown(container, dek, reports) {
    const cards = container.querySelectorAll('[data-year-quarter]');
    cards.forEach((card, idx) => {
        const r = reports[idx];
        if (!r) return;
        const range = { start: r.startDate, end: r.endDate };

        card.querySelectorAll('[data-drill]').forEach(chip => {
            const type = chip.dataset.drill;
            if (type === 'person') {
                attachDrillDown(chip, {
                    type: 'person',
                    params: { personId: chip.dataset.personId },
                    range, dek, userId: _userId,
                });
            } else if (type === 'labelPair') {
                attachDrillDown(chip, {
                    type: 'labelPair',
                    params: { a: chip.dataset.a, b: chip.dataset.b },
                    range, dek, userId: _userId,
                });
            }
        });

        const decisionBtn = card.querySelector('[data-drill-decision]');
        if (decisionBtn) {
            attachDrillDown(decisionBtn, {
                type: 'decision',
                params: {},
                range, dek, userId: _userId,
                label: '이 분기 결단의 흐름 (raw)',
            });
        }

        enrichPersonChips(card, dek);
    });
}

function bindQuarterQna(container, dek, reports) {
    try {
        container.querySelectorAll('[data-year-quarter]').forEach((card, idx) => {
            const r = reports[idx];
            if (!r) return;
            const foot = card.querySelector('.report-card-foot');
            if (!foot) return;
            const yearQuarter = card.dataset.yearQuarter || r.stats?.yearQuarter || r.startDate;
            mountReportQna(foot, {
                reportId:   yearQuarter,
                reportType: 'quarter',
                stats:      r.stats || {},
                context:    {},
                dek, userId: _userId,
            });
        });
    } catch (e) { console.warn('bindQuarterQna failed:', e); }
}

// ─── year 탭 (새 spec — Phase E-9/R-4) ─────────────
function renderYearList(reports) {
    if (reports === null) {
        return `<div class="no-data">일부 또는 전체 연간 리포트를 불러오지 못했어요.</div>`;
    }
    if (!reports || reports.length === 0) {
        return `
            <div class="no-data">
                아직 만든 연간 리포트가 없어요. 연말 토요일(12월 마지막 토)에 오늘 화면 하단에서 [올해 리포트 만들기]를 눌러 보세요.
            </div>
        `;
    }
    return reports.map(renderYearCard).join('');
}

function renderYearCard(r) {
    const stats = r.stats || {};
    const totalDots = stats.totalDots ?? 0;
    const quarters = stats.quarterlyMatrix?.quarters || [];
    const quartersWithData = stats.quarterlyMatrix?.quartersWithData ?? 0;
    const personCount = stats.personNetwork?.totalUniquePersons ?? 0;
    const med = stats.meditationFlow || {};
    const medHours = med.totalMinutes ? Math.round(med.totalMinutes / 60 * 10) / 10 : null;
    const decisionDistance = stats.decisionFlow?.avgDistanceDays;
    const decisionSample   = stats.decisionFlow?.sampleSize ?? 0;

    const statsRow = `
        <div class="report-stats-row">
            <span class="report-stat"><strong>${totalDots}</strong> <small>도트</small></span>
            ${quartersWithData > 0 ? `<span class="report-stat"><strong>${quartersWithData}</strong> <small>분기 합류</small></span>` : ''}
            ${decisionSample > 0 ? `<span class="report-stat"><strong>${decisionDistance}일</strong> <small>결단→실행 평균</small></span>` : ''}
            ${personCount > 0 ? `<span class="report-stat"><strong>${personCount}</strong> <small>만난 사람</small></span>` : ''}
            ${medHours != null && medHours > 0 ? `<span class="report-stat"><strong>${medHours}h</strong> <small>묵상 시간</small></span>` : ''}
        </div>
    `;

    const summaryBlock = r.aiSummary
        ? `<div class="report-summary"><p style="white-space:pre-wrap">${escapeHtml(r.aiSummary)}</p></div>`
        : `<div class="report-summary report-summary-empty">
               올해는 아직 AI 산문이 채워지지 않았어요. 카드 하단의 [리포트 재작성하기]를 눌러 보세요.
           </div>`;

    const hypotheses = r.hypotheses || [];
    const hypothesesBlock = hypotheses.length > 0
        ? `<div class="report-section report-hypotheses" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="lightbulb" class="report-section-icon"></i> 가설 (4분기 일관성)</span>
               <ul style="margin:6px 0 0 0; padding-left:20px">
                   ${hypotheses.map(h => `
                       <li style="margin-bottom:6px">
                           ${h.repetitionCount ? `<span class="hypothesis-badge" style="display:inline-block; padding:1px 6px; background:var(--bg-secondary, #f0f0f0); border-radius:10px; font-size:11px; margin-right:6px">${escapeHtml(h.repetitionCount)}</span>` : ''}
                           ${escapeHtml(h.text)}
                       </li>
                   `).join('')}
               </ul>
           </div>`
        : '';

    const yDecisionSamples = stats.decisionFlow?.sampleSize ?? 0;
    const decisionFlowBlock = r.decisionFlow
        ? `<div class="report-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="compass" class="report-section-icon"></i> 결단의 흐름</span>
               <p style="margin:6px 0 0 0; white-space:pre-wrap">${escapeHtml(r.decisionFlow)}</p>
               ${yDecisionSamples > 0
                    ? `<button class="drill-link" data-drill-decision style="margin-top:8px">▶ 이 결단들의 raw 목록 보기</button>`
                    : ''}
           </div>`
        : '';

    // Drill (인물 + 라벨 — 라벨 분포는 top 단일 컬렉션이라 쌍이 아님, 그래서 단일 라벨)
    const yPersons = stats.personNetwork?.items || [];
    const yLabels = stats.labelDistribution?.top || [];
    const yDrillBlock = (yPersons.length > 0 || yLabels.length > 0)
        ? `<div class="report-section drill-section" style="margin-top:14px">
               <span class="report-section-label"><i data-lucide="search" class="report-section-icon"></i> 자세히 보기</span>
               ${yPersons.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">올해 함께한 사람</span>
                       <div class="drill-chip-row">
                           ${yPersons.slice(0, 12).map(p => `
                               <span class="drill-chip" data-drill="person" data-person-id="${escapeHtml(p.personId)}">
                                   ${escapeHtml(p.personId.slice(0, 8))} · ${p.interactionCount}회
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
               ${yLabels.length > 0 ? `
                   <div class="drill-group">
                       <span class="drill-group-label">자주 나온 라벨</span>
                       <div class="drill-chip-row">
                           ${yLabels.slice(0, 12).map(l => `
                               <span class="drill-chip drill-chip--readonly">
                                   ${escapeHtml(l.label)} · ${l.count}
                               </span>
                           `).join('')}
                       </div>
                   </div>` : ''}
           </div>`
        : '';

    const questions = r.questionsForMeditation || [];
    const qBlock = questions.length > 0
        ? `<div class="report-questions">
               <span class="report-section-label"><i data-lucide="message-circle-question" class="report-section-icon"></i> 묵상에 가져갈 질문</span>
               <ul>${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
           </div>`
        : '';

    return `
        <article class="report-card card-section" data-year="${escapeHtml(String(stats.year || ''))}" data-start="${escapeHtml(r.startDate || '')}" data-end="${escapeHtml(r.endDate || '')}">
            <header class="report-card-header">
                <h3>${escapeHtml(String(stats.year || r.startDate?.slice(0, 4) || ''))}년 ${r.startDate && r.endDate ? `<span class="report-card-meta">${escapeHtml(r.startDate)} ~ ${escapeHtml(r.endDate)}</span>` : ''}</h3>
                <p class="report-preview">${escapeHtml(previewLine(r))}</p>
                <i class="report-card-chev" data-lucide="chevron-down"></i>
            </header>
            <div class="report-card-body">
            ${statsRow}
            ${summaryBlock}
            ${hypothesesBlock}
            ${decisionFlowBlock}
            ${yDrillBlock}
            ${qBlock}
            <div style="text-align:center; margin-top:14px">
                <button class="text-btn year-regenerate-btn" style="font-size:13px; color:var(--text-secondary, #888); cursor:pointer; background:none; border:none">
                    ↻ 리포트 재작성하기
                </button>
            </div>
            <div class="report-card-foot">여기까지가 데이터예요. 다음은 묵상 안에서.</div>
            </div>
        </article>
    `;
}

function bindYearRegenerateButtons(dek) {
    document.querySelectorAll('.year-regenerate-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const card = e.target.closest('[data-year]');
            if (!card) return;
            const yearStart = card.dataset.start;
            const yearEnd   = card.dataset.end;
            if (!yearStart || !yearEnd) {
                showToast('이 카드는 기간 정보가 없어요');
                return;
            }
            btn.disabled = true;
            const thinkingHandle = inlineThinkingForButton(btn, { labels: THINKING_COPY.reportGenerate });
            try {
                await generateYearlyReport(dek, _userId, yearStart, yearEnd, { force: true });
                thinkingHandle.finish();
                await loadReports();
                showToast('연간 리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('yearly regenerate failed:', e);
                thinkingHandle.dispose();
                showToast('재작성이 잠깐 막혔어요. 잠시 후 다시 시도해 주세요');
                btn.disabled = false;
            }
        });
    });
}

function bindYearDrillDown(container, dek, reports) {
    const cards = container.querySelectorAll('[data-year]');
    cards.forEach((card, idx) => {
        const r = reports[idx];
        if (!r) return;
        const range = { start: r.startDate, end: r.endDate };

        card.querySelectorAll('[data-drill="person"]').forEach(chip => {
            attachDrillDown(chip, {
                type: 'person',
                params: { personId: chip.dataset.personId },
                range, dek, userId: _userId,
            });
        });

        const decisionBtn = card.querySelector('[data-drill-decision]');
        if (decisionBtn) {
            attachDrillDown(decisionBtn, {
                type: 'decision',
                params: {},
                range, dek, userId: _userId,
                label: '올해 결단의 흐름 (raw)',
            });
        }

        enrichPersonChips(card, dek);
    });
}

function bindYearQna(container, dek, reports) {
    try {
        container.querySelectorAll('[data-year]').forEach((card, idx) => {
            const r = reports[idx];
            if (!r) return;
            const foot = card.querySelector('.report-card-foot');
            if (!foot) return;
            const year = card.dataset.year || String(r.stats?.year || r.startDate?.slice(0, 4) || '');
            mountReportQna(foot, {
                reportId:   year,
                reportType: 'year',
                stats:      r.stats || {},
                context:    {},
                dek, userId: _userId,
            });
        });
    } catch (e) { console.warn('bindYearQna failed:', e); }
}

// ─── (옛 흐름 제거됨 — STEP 3 완료로 모든 탭이 새 spec) ───
function renderOldList(reports) {
    if (reports === null) {
        return `<div class="no-data">일부 또는 전체 리포트를 불러오지 못했어요.</div>`;
    }
    if (!reports || reports.length === 0) {
        return `<div class="no-data">아직 이 단계의 리포트가 없어요. 곧 만들어질 예정이에요.</div>`;
    }
    return reports.map(r => {
        const stats = r.stats || {};
        return `
            <article class="report-card card-section">
                <header class="report-card-header">
                    <h3>${escapeHtml(r.startDate || '')} ~ ${escapeHtml(r.endDate || '')} <span class="report-card-meta">만족도 ${stats.avgSatisfaction ?? '-'}</span></h3>
                    <p class="report-preview">${escapeHtml(previewLine(r))}</p>
                    <i class="report-card-chev" data-lucide="chevron-down"></i>
                </header>
                <div class="report-card-body">
                    <div class="report-summary">
                        <p>${escapeHtml(r.aiSummary || 'AI 요약이 아직 채워지지 않았어요.')}</p>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
