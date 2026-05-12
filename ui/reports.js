/**
 * reports.js — 리포트 뷰 UI
 *
 * Phase E-5-A: day 탭 새 dayReport spec.
 * Phase E-5-B: week 탭 새 weekReport spec(reports/weekReportRepo) 으로 전환.
 *   카드 — 통계 행 + 사실(aiSummary) + 가설(반복 횟수 뱃지) + 결단의 흐름 + 묵상 질문.
 * 나머지 탭(month/quarter/year)은 옛 data/reportPipeline 그대로 — 새 spec 구축 전 호환 유지.
 */

import { listDayReports } from '../reports/dayReportRepo.js';
import { listWeekReports } from '../reports/weekReportRepo.js';
import { generateWeeklyReport } from '../reports/weeklyReportFlow.js';
import { listMonthReports } from '../reports/monthReportRepo.js';
import { generateMonthlyReport } from '../reports/monthlyReportFlow.js';
import { getReports } from '../data/reportPipeline.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
// Phase E-9/R-DD: 리포트 카드 드릴다운 (spec §1.6 2층 "raw 데이터")
import { attachDrillDown } from './reportDrillDown.js';
// Phase E-9/R-QA: A3 확장 — 카드 하단 Q&A 입력창
import { mountReportQna } from './reportQna.js';

let _userId = null;
let _currentTab = 'day';

// month 는 STEP 2 에서 새 spec 으로 전환됨. quarter/year 만 옛 흐름 유지.
const OLD_COLLECTION_MAP = {
    quarter: 'quarterReports',
    year:    'yearReports',
};

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

    try {
        if (_currentTab === 'day') {
            const reports = await listDayReports(dek, _userId, 30);
            container.innerHTML = renderDayList(reports);
            bindDayQna(container, dek, reports);
        } else if (_currentTab === 'week') {
            const reports = await listWeekReports(dek, _userId, 12);
            container.innerHTML = renderWeekList(reports);
            bindWeekRegenerateButtons(dek);
            bindWeekDrillDown(container, dek, reports);
            bindWeekQna(container, dek, reports);
        } else if (_currentTab === 'month') {
            // Phase E-9/R-2: 월간도 새 spec 카드로
            const reports = await listMonthReports(dek, _userId, 6);
            container.innerHTML = renderMonthList(reports);
            bindMonthRegenerateButtons(dek);
            bindMonthDrillDown(container, dek, reports);
            bindMonthQna(container, dek, reports);
        } else {
            // 옛 흐름 (quarter/year) — 새 spec 구축 전이라 호환 유지
            const reports = await getReports(dek, OLD_COLLECTION_MAP[_currentTab], _userId, 10);
            container.innerHTML = renderOldList(reports);
        }
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    } catch (e) {
        console.error('reports load failed:', e);
        container.innerHTML = '<div class="no-data">리포트를 불러오는 중에 잠깐 막혔어요.</div>';
    }
}

// ─── day 탭 (새 spec) ────────────────────────────────────
function renderDayList(reports) {
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
                <h3>${escapeHtml(r.startDate || '')}</h3>
            </header>
            ${statsRow}
            ${summaryBlock}
            ${obsBlock}
            ${qBlock}
            <div class="report-card-foot">여기까지가 데이터예요. 다음은 묵상 안에서.</div>
        </article>
    `;
}

// ─── week 탭 (새 spec — Phase E-5-B) ────────────────────
function renderWeekList(reports) {
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
                <h3>${escapeHtml(r.startDate || '')} ~ ${escapeHtml(r.endDate || '')}</h3>
                ${stats.yearWeek ? `<span class="report-card-meta">${escapeHtml(stats.yearWeek)}</span>` : ''}
            </header>
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
}

function bindWeekQna(container, dek, reports) {
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
}

function bindMonthQna(container, dek, reports) {
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
            btn.textContent = '다시 만드는 중이에요...';
            try {
                await generateWeeklyReport(dek, _userId, weekStart, weekEnd, { force: true });
                await loadReports();   // 목록 통째로 다시
                showToast('주간 리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('week regenerate failed:', e);
                showToast('재작성이 잠깐 막혔어요. 잠시 후 다시 시도해 주세요');
                btn.disabled = false;
                btn.textContent = '↻ 리포트 재작성하기';
            }
        });
    });
}

// ─── month 탭 (새 spec — Phase E-9/R-2) ─────────────────
function renderMonthList(reports) {
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
                <h3>${escapeHtml(stats.yearMonth || r.startDate || '')}</h3>
                ${r.startDate && r.endDate ? `<span class="report-card-meta">${escapeHtml(r.startDate)} ~ ${escapeHtml(r.endDate)}</span>` : ''}
            </header>
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
            btn.textContent = '다시 만드는 중이에요...';
            try {
                await generateMonthlyReport(dek, _userId, monthStart, monthEnd, { force: true });
                await loadReports();
                showToast('월간 리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('month regenerate failed:', e);
                showToast('재작성이 잠깐 막혔어요. 잠시 후 다시 시도해 주세요');
                btn.disabled = false;
                btn.textContent = '↻ 리포트 재작성하기';
            }
        });
    });
}

// ─── 옛 탭 (quarter/year) — 새 spec 구축 전 호환 ───
function renderOldList(reports) {
    if (!reports || reports.length === 0) {
        return `<div class="no-data">아직 이 단계의 리포트가 없어요. 곧 만들어질 예정이에요.</div>`;
    }
    return reports.map(r => {
        const stats = r.stats || {};
        return `
            <article class="report-card card-section">
                <header class="report-card-header">
                    <h3>${escapeHtml(r.startDate || '')} ~ ${escapeHtml(r.endDate || '')}</h3>
                    <span class="report-card-meta">만족도 ${stats.avgSatisfaction ?? '-'}</span>
                </header>
                <div class="report-summary">
                    <p>${escapeHtml(r.aiSummary || 'AI 요약이 아직 채워지지 않았어요.')}</p>
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
