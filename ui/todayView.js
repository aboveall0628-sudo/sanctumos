/**
 * todayView.js — 오늘 화면 컴포넌트
 *
 * 책임:
 * - 핀 원칙 띠 (항상 노출, 핀 원칙 변경 시 갱신)
 * - 묵상 노트 자동 저장 (디바운스 1초, 암호화 후 Firestore)
 * - 결단 패널: 동적 리스트 + 추가/수정/삭제 + 드래그 핸들 (drop은 timeline.js가 처리)
 * - 통합 타임라인 진입점은 별도 파일(Chunk 3에서 timeline.js 신규)
 */

import { db, doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp } from '../data/firebase.js';
import { readDocument, prepareDocument } from '../crypto/cryptoService.js';
import { getDEK } from './lockScreen.js';
import { showToast } from './quickReview.js';
// Phase B: 결단 → daily 목표 흡수. goalsRepo 가 단일 source of truth.
// DOM ID(decisions-list 등)와 CSS 클래스는 점진 정리를 위해 일부 유지.
import {
    getDailyGoals, saveGoal, deleteGoal
} from '../data/goalsRepo.js';
import { getDotsByDate } from '../data/dotsRepo.js';
import { computeTopTasks, computeTopLabels, computeTopCategories, formatMinutesShort } from '../data/dotInsights.js';
import { findCategory } from '../data/dotCategories.js';
// Reports 모듈 v3 — 새 spec dayReport 표시
import { getDayReport } from '../reports/dayReportRepo.js';
import { generateDailyReport } from '../reports/dailyReportFlow.js';
// Phase F: 오늘 리포트 안에 거래 통계 블록
import { getTransactionsByDate } from '../data/economyRepo.js';
import { bucketLabel, categoryLabel } from '../config/economyBuckets.js';
// Phase E-5-B: 주간 리포트 토요일 흐름
import { generateWeeklyReport } from '../reports/weeklyReportFlow.js';
// Phase E-9/R-2: 월말 토요일 월간 리포트 흐름
import { generateMonthlyReport } from '../reports/monthlyReportFlow.js';
import { getMonthRange } from '../reports/monthlyAggregator.js';
// 토요일이면 주/월/분기/연/5·10년 회고가 단계별로 추가 (eveningLoop의 토요일 감지 재사용)
import { determineLayers } from './eveningLoop.js';
// Phase E-9/R-DD: 인라인 카드에도 드릴다운
import { attachDrillDown } from './reportDrillDown.js';
// Phase E-9/R-QA: 카드 하단 Q&A 입력창
import { mountReportQna } from './reportQna.js';

let _userId = null;
let _date = null;
let _decisions = [];

/**
 * 오늘 뷰 초기화 (앱 시작 시 1회)
 */
export function initTodayView({ userId, date }) {
    _userId = userId;
    _date = date;
    bindMeditationAutosave();
    bindDecisionsPanel();
    bindNextDayButton();
}

/**
 * 날짜 변경 시 호출 — 핀/노트/결단 다시 로드
 */
export async function refreshTodayView({ userId, date }) {
    _userId = userId;
    _date = date;
    const dek = getDEK();
    if (!dek) return;
    await loadPinnedPrinciple(dek);
    await loadMeditationNote(dek);
    await loadDecisions(dek);
    await loadTodayReport(dek);
}

// ─── 오늘 리포트 카드 (시간표 하단) ───
// 사용자가 도트 평가 끝났다고 판단하면 "오늘 리포트 만들기" 버튼 → 새 흐름 트리거.
// 리포트 있으면 새 spec 카드(사실/관찰/묵상 질문) 표시.
async function loadTodayReport(dek) {
    const body = document.getElementById('today-report-body');
    if (!body) return;
    try {
        const report = await getDayReport(dek, _userId, _date);

        // 아직 AI 응답이 없으면 → 버튼 + 거래 통계 블록만
        if (!report || !report.aiSummary) {
            renderTodayReportButton(body, dek);
            loadTodayEconomyBlock();
            return;
        }

        // 리포트 있음 → 새 spec 8섹션 카드
        const stats       = report.stats || {};
        const ds          = stats.dotStats || {};
        const sat         = stats.satisfactionDistribution || {};
        const align       = stats.alignment || {};
        const observation = (report.observations || [])[0] || null;
        const questions   = report.questionsForMeditation || [];

        const matchPct = (align.decisionExecutionRate !== null && align.decisionExecutionRate !== undefined)
            ? Math.round(align.decisionExecutionRate * 100) : '-';

        const observationHtml = observation
            ? `<div class="ai-summary-card" style="border-left:3px solid var(--accent-primary, #5b8def); margin-top:12px">
                   <strong style="display:block; margin-bottom:6px">관찰</strong>
                   <p style="margin:0">${escapeHtml(observation)}</p>
               </div>` : '';

        const questionsHtml = questions.length > 0
            ? `<div class="ai-summary-card" style="background:var(--bg-quiet, rgba(0,0,0,0.03)); margin-top:12px">
                   <strong style="display:block; margin-bottom:8px">묵상에 가져갈 질문</strong>
                   <ul style="margin:0; padding-left:1.2em">
                       ${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}
                   </ul>
               </div>` : '';

        // 오늘 도트 가져와 '어떤 일을 했나' 블록 만들기 (실패해도 리포트 본체는 살리기)
        let insightsHtml = '';
        try {
            const todayDots = await getDotsByDate(dek, _userId, _date);
            insightsHtml = buildInsightsBlock(todayDots);
        } catch (e) { console.warn('today insights load failed:', e); }

        body.innerHTML = `
            <div class="el-stat-row">
                <div class="el-stat"><span class="el-stat-num">${ds.doneCount || 0}<small>/${ds.totalDots || 0}</small></span><span class="el-stat-lbl">완료</span></div>
                <div class="el-stat"><span class="el-stat-num">${sat.avg ?? '-'}</span><span class="el-stat-lbl">만족도</span></div>
                <div class="el-stat"><span class="el-stat-num">${matchPct}<small>%</small></span><span class="el-stat-lbl">결단 실행률</span></div>
            </div>
            ${insightsHtml}
            <div class="ai-summary-card" style="margin-top: 12px">
                <p style="margin:0; white-space:pre-wrap">${escapeHtml(report.aiSummary)}</p>
            </div>
            ${observationHtml}
            ${questionsHtml}
            <div style="text-align:center; margin-top:14px">
                <button id="today-regenerate-report-btn" class="text-btn" style="font-size:13px; color:var(--text-secondary, #888); cursor:pointer">
                    ↻ 리포트 재작성하기
                </button>
            </div>
        `;
        // Phase E-9/R-QA: 일간 리포트 Q&A 입력창 — 푸터 anchor 를 만들어 박음
        attachQnaToTodayReport(body, dek, report);

        // 리포트가 이미 있을 때도 토요일이면 주/월/분기/연 회고 단계별 버튼 노출
        renderSaturdayLayers(body);

        // Phase F: 거래 통계 블록도 함께
        loadTodayEconomyBlock();

        // 재작성 버튼 — 기존 리포트 + 캐시 모두 무시하고 Gemini 새로 호출
        document.getElementById('today-regenerate-report-btn')?.addEventListener('click', async () => {
            const btn = document.getElementById('today-regenerate-report-btn');
            if (btn) { btn.disabled = true; btn.textContent = '다시 만드는 중이에요...'; }
            try {
                const result = await generateDailyReport(dek, _userId, _date, { force: true });
                if (result.status === 'no-dots') {
                    showToast('오늘 기록된 도트가 없어요');
                    if (btn) { btn.disabled = false; btn.textContent = '↻ 리포트 재작성하기'; }
                    return;
                }
                // 성공 → 새 카드로 다시 그림
                await loadTodayReport(dek);
                showToast('리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('today report regenerate failed:', e);
                showToast('재작성이 잠깐 막혔어요. 잠시 후 다시 시도해 주세요');
                if (btn) { btn.disabled = false; btn.textContent = '↻ 리포트 재작성하기'; }
            }
        });
    } catch (e) {
        console.warn('today report load failed:', e);
        body.innerHTML = `<p style="color:var(--text-secondary); font-size:13px">리포트를 불러오는 중에 잠깐 막혔어요.</p>`;
    }
}

// Phase F: 오늘 리포트 안의 "오늘의 거래" 통계 블록.
// AI 리포트와 무관하게 항상 표시 — 거래가 있을 때만 노출.
async function loadTodayEconomyBlock() {
    const body = document.getElementById('today-report-body');
    if (!body) return;
    let block = document.getElementById('today-tx-stat-block');
    if (!block) {
        block = document.createElement('div');
        block.id = 'today-tx-stat-block';
        block.style.marginTop = '14px';
        body.appendChild(block);
    }
    const dek = getDEK();
    if (!dek || !_userId || !_date) { block.innerHTML = ''; return; }
    try {
        const txs = await getTransactionsByDate(dek, _userId, _date);
        if (!txs || txs.length === 0) { block.innerHTML = ''; return; }

        let inCount = 0, outCount = 0;
        let inExact = 0, outExact = 0;
        const bucketCount = {};
        const catCount = {};
        for (const t of txs) {
            if (t.direction === 'income') {
                inCount++;
                if (t.exactAmount != null) inExact += Number(t.exactAmount) || 0;
            } else {
                outCount++;
                if (t.exactAmount != null) outExact += Number(t.exactAmount) || 0;
            }
            bucketCount[t.amountBucket] = (bucketCount[t.amountBucket] || 0) + 1;
            catCount[t.category] = (catCount[t.category] || 0) + 1;
        }
        const topCats = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const bucketLine = Object.entries(bucketCount)
            .map(([b, n]) => `${bucketLabel(b)} ${n}`).join(' · ');
        const catLine = topCats.length > 0
            ? topCats.map(([c, n]) => `${categoryLabel(c)} ${n}건`).join(', ')
            : '';

        const netExact = inExact - outExact;
        const netLabel = netExact >= 0 ? '순수입' : '순지출';
        const netSign = netExact >= 0 ? '+' : '−';
        const netExactHtml = (inExact > 0 || outExact > 0)
            ? `<div class="sensitive" style="font-size:12px; margin-top:6px">
                   ${netLabel}: ${netSign}${Math.abs(netExact).toLocaleString('ko-KR')}원
                   (수입 ${inExact.toLocaleString('ko-KR')} · 지출 ${outExact.toLocaleString('ko-KR')})
               </div>`
            : '';

        block.innerHTML = `
            <div class="ai-summary-card" style="background:var(--bg-quiet, rgba(0,0,0,0.03));">
                <strong style="display:block; margin-bottom:6px">오늘의 거래</strong>
                <div style="font-size:13px; color:var(--text-secondary, var(--ink-secondary)); line-height:1.7">
                    총 ${txs.length}건 · 수입 ${inCount} · 지출 ${outCount}<br>
                    크기: ${bucketLine}<br>
                    ${catLine ? '많이: ' + escapeHtml(catLine) : ''}
                </div>
                ${netExactHtml}
            </div>
        `;
    } catch (e) {
        console.warn('today economy block load failed:', e);
        block.innerHTML = '';
    }
}

// 외부(app.js 의 economy-changed listener)에서 호출 가능하도록 노출
window.__sanctumRefreshTodayReportEconomy = loadTodayEconomyBlock;

function renderTodayReportButton(body, dek) {
    body.innerHTML = `
        <p style="color:var(--text-secondary); font-size:13px; margin-bottom: 12px">
            도트 평가가 끝났다고 생각되시면, 오늘의 결을 정리해 볼게요.
        </p>
        <div style="text-align:center">
            <button id="today-make-report-btn" class="primary-btn">오늘 리포트 만들기 →</button>
        </div>
    `;
    document.getElementById('today-make-report-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('today-make-report-btn');
        if (btn) { btn.disabled = true; btn.textContent = '만드는 중이에요...'; }
        try {
            const result = await generateDailyReport(dek, _userId, _date);
            if (result.status === 'no-dots') {
                body.innerHTML = `<p style="color:var(--text-secondary); font-size:13px">오늘 기록된 도트가 아직 없어요. 평가를 채워가 봐요.</p>`;
                renderSaturdayLayers(body);
                return;
            }
            // 생성 성공 → 다시 로드해서 새 spec 카드로 갱신
            await loadTodayReport(dek);
        } catch (e) {
            console.error('today report generate failed:', e);
            body.innerHTML = `<p style="color:var(--dot-red); font-size:13px">리포트를 만드는 중에 잠깐 막혔어요. 잠시 후 다시 시도해 주실래요?</p>`;
        }
    });

    // 일간 리포트 버튼 아래에 토요일이면 주/월/분기/연 회고 단계별 버튼 노출
    renderSaturdayLayers(body);
}

// 토요일 추가 회고 — 단계별 버튼.
// week 는 실제 generateWeeklyReport 흐름. month/quarter/year/decade 는 placeholder 유지.
function renderSaturdayLayers(body) {
    const date = new Date(_date + 'T00:00:00');
    const layers = determineLayers(date);
    if (layers.length === 0) return;   // 토요일 아니면 종료

    const layerLabels = {
        week:    { label: '이번 주 리포트',   icon: '📅' },
        month:   { label: '이번 달 리포트',   icon: '🗓️' },
        quarter: { label: '이번 분기 리포트', icon: '📊' },
        year:    { label: '올해 리포트',      icon: '🎯' },
        decade:  { label: '5·10년 점검',     icon: '🌌' },
    };

    const layerButtonsHtml = layers.map(layer => `
        <div style="text-align:center; margin-top:10px">
            <button class="primary-btn" data-layer="${layer}" style="opacity:0.85">
                ${layerLabels[layer].icon} ${layerLabels[layer].label} 만들기 →
            </button>
        </div>
    `).join('');

    const section = document.createElement('div');
    section.style.cssText = 'margin-top:20px; padding-top:16px; border-top:1px solid var(--border, rgba(0,0,0,0.1))';
    section.innerHTML = `
        ${layerButtonsHtml}
        <div id="today-week-report-inline"></div>
        <div id="today-month-report-inline"></div>
        <div style="text-align:center; margin-top:10px">
            <button class="primary-btn" id="today-go-next-day-btn">🌅 내일 묵상 시작하기 →</button>
        </div>
    `;
    body.appendChild(section);

    // 단계별 회고 버튼 — week / month 가 실제 흐름. quarter/year/decade 는 placeholder.
    section.querySelectorAll('button[data-layer]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const layer = btn.dataset.layer;
            if (layer === 'week')  { await handleWeekReportClick(btn);  return; }
            if (layer === 'month') { await handleMonthReportClick(btn); return; }
            showToast(`${layerLabels[layer].label}는 곧 만들어질 예정이에요`);
        });
    });

    // "내일 묵상 시작하기" — 페이지 하단 next-day-btn과 동일 동작
    section.querySelector('#today-go-next-day-btn')?.addEventListener('click', () => {
        if (typeof window.__sanctumGoToNextDay === 'function') {
            window.__sanctumGoToNextDay();
        }
    });
}

/**
 * 이번 주 리포트 생성 트리거 — 토요일 회고 인라인 표시.
 * weekStart = today-6, weekEnd = today (대시보드와 같은 7일 윈도우).
 */
async function handleWeekReportClick(btn) {
    const dek = getDEK();
    if (!dek) { showToast('잠금 해제가 필요해요'); return; }

    const inline = document.getElementById('today-week-report-inline');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '만드는 중이에요...';

    try {
        const { weekStart, weekEnd } = computeWeekWindow(_date);
        const result = await generateWeeklyReport(dek, _userId, weekStart, weekEnd);

        if (result.status === 'no-dots') {
            if (inline) {
                inline.innerHTML = `<p style="color:var(--text-secondary); font-size:13px; margin-top:12px; text-align:center">이번 주는 아직 기록된 도트가 없어서 리포트가 만들어지지 않았어요.</p>`;
            }
            btn.disabled = false;
            btn.textContent = originalLabel;
            return;
        }

        if (inline) inline.innerHTML = renderWeekReportInline(result.report);
        btn.style.display = 'none';   // 이미 만들었으니 같은 버튼 숨김
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        bindInlineDrill(inline, dek);

        // 인라인 카드의 재작성 버튼
        document.getElementById('week-report-regenerate-btn')?.addEventListener('click', async () => {
            const rb = document.getElementById('week-report-regenerate-btn');
            if (rb) { rb.disabled = true; rb.textContent = '다시 만드는 중이에요...'; }
            try {
                const r2 = await generateWeeklyReport(dek, _userId, weekStart, weekEnd, { force: true });
                if (inline) inline.innerHTML = renderWeekReportInline(r2.report);
                if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
                bindInlineDrill(inline, dek);
                showToast('주간 리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('weekly regenerate failed:', e);
                showToast('재작성이 잠깐 막혔어요');
                if (rb) { rb.disabled = false; rb.textContent = '↻ 리포트 재작성하기'; }
            }
        });
    } catch (e) {
        console.error('weekly report generate failed:', e);
        showToast('주간 리포트 생성이 잠깐 막혔어요');
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
}

function computeWeekWindow(todayStr) {
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date(todayStr + 'T00:00:00');
    const past = new Date(today);
    past.setDate(today.getDate() - 6);
    return { weekStart: fmt(past), weekEnd: fmt(today) };
}

/**
 * 주간 리포트 인라인 카드 — 토요일 회고 안에서 표시.
 * ui/reports.js 의 week 탭 카드와 같은 시각 언어를 쓰되, 인라인용으로 약간 축소.
 */
function renderWeekReportInline(r) {
    if (!r) return '';
    const stats = r.stats || {};
    const totalDots = stats.totalDots ?? 0;

    // 시간대 가장 만족도 높은 구간 하나만 stat 행에 노출
    const bands = Object.values(stats.timeBandPattern || {}).filter(b => typeof b?.avg === 'number');
    const topBand = bands.length > 0 ? bands.reduce((a, b) => a.avg > b.avg ? a : b) : null;

    const hypothesesHtml = (r.hypotheses || []).length > 0
        ? `<div class="report-section" style="margin-top:14px">
               <div class="report-section-label" style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:6px">
                   <i data-lucide="lightbulb" class="report-section-icon"></i> 가설
               </div>
               <ul style="margin:0; padding-left:20px">
                   ${r.hypotheses.map(h => `
                       <li style="margin-bottom:6px">
                           ${h.repetitionCount ? `<span style="display:inline-block; padding:1px 6px; background:var(--bg-secondary, #f0f0f0); border-radius:10px; font-size:11px; margin-right:6px">${escapeHtml(h.repetitionCount)}</span>` : ''}
                           ${escapeHtml(h.text)}
                       </li>
                   `).join('')}
               </ul>
           </div>`
        : '';

    const weeklyDecisionSamples = stats.decisionFlow?.sampleSize ?? 0;
    const decisionFlowHtml = r.decisionFlow
        ? `<div class="report-section" style="margin-top:14px">
               <div class="report-section-label" style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:6px">
                   <i data-lucide="compass" class="report-section-icon"></i> 결단의 흐름
               </div>
               <p style="margin:0; white-space:pre-wrap">${escapeHtml(r.decisionFlow)}</p>
               ${weeklyDecisionSamples > 0
                    ? `<button class="drill-link" data-inline-drill="decision" data-start="${escapeHtml(r.startDate || '')}" data-end="${escapeHtml(r.endDate || '')}" style="margin-top:8px">▶ 이 결단들의 raw 목록 보기</button>`
                    : ''}
           </div>`
        : '';

    const questionsHtml = (r.questionsForMeditation || []).length > 0
        ? `<div class="report-section" style="margin-top:14px">
               <div class="report-section-label" style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:6px">
                   <i data-lucide="message-circle-question" class="report-section-icon"></i> 묵상에 가져갈 질문
               </div>
               <ul style="margin:0; padding-left:20px">${r.questionsForMeditation.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
           </div>`
        : '';

    return `
        <article class="card-section week-report-inline" style="margin-top:16px; padding:16px" data-start="${escapeHtml(r.startDate || '')}" data-end="${escapeHtml(r.endDate || '')}">
            <header style="margin-bottom:10px">
                <h3 style="margin:0; font-size:15px">${escapeHtml(r.startDate || '')} ~ ${escapeHtml(r.endDate || '')}</h3>
            </header>
            <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:10px; font-size:13px; color:var(--text-secondary)">
                <span><strong>${totalDots}</strong> 도트</span>
                ${topBand ? `<span><strong>${topBand.avg}</strong> ${escapeHtml(topBand.label)}</span>` : ''}
            </div>
            ${r.aiSummary ? `<div class="ai-summary-card"><p style="margin:0; white-space:pre-wrap">${escapeHtml(r.aiSummary)}</p></div>` : ''}
            ${hypothesesHtml}
            ${decisionFlowHtml}
            ${questionsHtml}
            <div style="text-align:center; margin-top:14px">
                <button id="week-report-regenerate-btn" class="text-btn" style="font-size:13px; color:var(--text-secondary, #888); cursor:pointer; background:none; border:none">
                    ↻ 리포트 재작성하기
                </button>
            </div>
            <div style="text-align:center; margin-top:10px; padding-top:10px; border-top:1px solid var(--border, rgba(0,0,0,0.08)); font-size:12px; color:var(--text-secondary)">
                여기까지가 데이터예요. 다음은 묵상 안에서.
            </div>
        </article>
    `;
}

/**
 * Phase E-9/R-2: 이번 달 리포트 생성 트리거 — 월말 토요일 회고 인라인.
 * monthStart = 그 달의 1일, monthEnd = 그 달의 마지막 날 (getMonthRange로 계산).
 */
async function handleMonthReportClick(btn) {
    const dek = getDEK();
    if (!dek) { showToast('잠금 해제가 필요해요'); return; }

    const inline = document.getElementById('today-month-report-inline');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '만드는 중이에요...';

    try {
        const yearMonth = (_date || '').slice(0, 7);   // 'YYYY-MM'
        const { start, end } = getMonthRange(yearMonth);
        const result = await generateMonthlyReport(dek, _userId, start, end);

        if (result.status === 'no-dots') {
            if (inline) {
                inline.innerHTML = `<p style="color:var(--text-secondary); font-size:13px; margin-top:12px; text-align:center">이번 달은 아직 기록된 도트가 없어서 리포트가 만들어지지 않았어요.</p>`;
            }
            btn.disabled = false;
            btn.textContent = originalLabel;
            return;
        }

        if (inline) inline.innerHTML = renderMonthReportInline(result.report);
        btn.style.display = 'none';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        bindInlineDrill(inline, dek);

        document.getElementById('month-report-regenerate-btn')?.addEventListener('click', async () => {
            const rb = document.getElementById('month-report-regenerate-btn');
            if (rb) { rb.disabled = true; rb.textContent = '다시 만드는 중이에요...'; }
            try {
                const r2 = await generateMonthlyReport(dek, _userId, start, end, { force: true });
                if (inline) inline.innerHTML = renderMonthReportInline(r2.report);
                if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
                bindInlineDrill(inline, dek);
                showToast('월간 리포트가 새로 만들어졌어요');
            } catch (e) {
                console.error('monthly regenerate failed:', e);
                showToast('재작성이 잠깐 막혔어요');
                if (rb) { rb.disabled = false; rb.textContent = '↻ 리포트 재작성하기'; }
            }
        });
    } catch (e) {
        console.error('monthly report generate failed:', e);
        showToast('월간 리포트 생성이 잠깐 막혔어요');
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
}

/**
 * 월간 리포트 인라인 카드 — 토요일 회고 안에서 표시.
 * ui/reports.js 의 month 탭 카드와 같은 시각 언어, 인라인용으로 약간 축소.
 */
function renderMonthReportInline(r) {
    if (!r) return '';
    const stats = r.stats || {};
    const totalDots = stats.totalDots ?? 0;
    const weeksWithData = stats.weeklyMatrix?.weeksWithData ?? 0;
    const cats = stats.categorySatisfactionMatrix?.items || [];
    const topCat = cats[0];
    const topCatHours = topCat ? Math.round((topCat.durationMinutes || 0) / 60 * 10) / 10 : null;
    const personCount = stats.personNetwork?.totalUniquePersons ?? 0;

    const hypothesesHtml = (r.hypotheses || []).length > 0
        ? `<div class="report-section" style="margin-top:14px">
               <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:6px">
                   <i data-lucide="lightbulb"></i> 가설
               </div>
               <ul style="margin:0; padding-left:20px">
                   ${r.hypotheses.map(h => `
                       <li style="margin-bottom:6px">
                           ${h.repetitionCount ? `<span style="display:inline-block; padding:1px 6px; background:var(--bg-secondary, #f0f0f0); border-radius:10px; font-size:11px; margin-right:6px">${escapeHtml(h.repetitionCount)}</span>` : ''}
                           ${escapeHtml(h.text)}
                       </li>
                   `).join('')}
               </ul>
           </div>`
        : '';

    const patterns = r.patternsObserved || [];
    const patternsHtml = patterns.length > 0
        ? `<div class="report-section" style="margin-top:14px">
               <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:6px">
                   <i data-lucide="repeat"></i> 이번 달 자주 관찰된 패턴
               </div>
               ${patterns.map(p => `
                   <div style="margin-top:8px; padding:10px; background:var(--bg-elev); border-left:3px solid var(--accent); border-radius:6px">
                       <strong style="font-size:13px">${escapeHtml(p.title || '관찰된 패턴')}</strong>
                       <p style="margin:4px 0 0; font-size:13px; line-height:1.6; white-space:pre-wrap">${escapeHtml(p.body || '')}</p>
                   </div>
               `).join('')}
           </div>`
        : '';

    const monthlyDecisionSamples = stats.decisionFlow?.sampleSize ?? 0;
    const decisionFlowHtml = r.decisionFlow
        ? `<div class="report-section" style="margin-top:14px">
               <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:6px">
                   <i data-lucide="compass"></i> 결단의 흐름
               </div>
               <p style="margin:0; white-space:pre-wrap">${escapeHtml(r.decisionFlow)}</p>
               ${monthlyDecisionSamples > 0
                    ? `<button class="drill-link" data-inline-drill="decision" data-start="${escapeHtml(r.startDate || '')}" data-end="${escapeHtml(r.endDate || '')}" style="margin-top:8px">▶ 이 결단들의 raw 목록 보기</button>`
                    : ''}
           </div>`
        : '';

    const questionsHtml = (r.questionsForMeditation || []).length > 0
        ? `<div class="report-section" style="margin-top:14px">
               <div style="font-weight:600; font-size:13px; color:var(--text-secondary); margin-bottom:6px">
                   <i data-lucide="message-circle-question"></i> 묵상에 가져갈 질문
               </div>
               <ul style="margin:0; padding-left:20px">${r.questionsForMeditation.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
           </div>`
        : '';

    return `
        <article class="card-section month-report-inline" style="margin-top:16px; padding:16px" data-start="${escapeHtml(r.startDate || '')}" data-end="${escapeHtml(r.endDate || '')}">
            <header style="margin-bottom:10px">
                <h3 style="margin:0; font-size:15px">${escapeHtml(stats.yearMonth || r.startDate || '')}</h3>
                ${r.startDate && r.endDate ? `<p style="margin:4px 0 0; font-size:12px; color:var(--text-secondary)">${escapeHtml(r.startDate)} ~ ${escapeHtml(r.endDate)}</p>` : ''}
            </header>
            <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:10px; font-size:13px; color:var(--text-secondary)">
                <span><strong>${totalDots}</strong> 도트</span>
                ${weeksWithData > 0 ? `<span><strong>${weeksWithData}</strong> 주 합류</span>` : ''}
                ${topCat ? `<span><strong>${topCatHours}h</strong> ${escapeHtml(topCat.category)}</span>` : ''}
                ${personCount > 0 ? `<span><strong>${personCount}</strong> 만난 사람</span>` : ''}
            </div>
            ${r.aiSummary ? `<div class="ai-summary-card"><p style="margin:0; white-space:pre-wrap">${escapeHtml(r.aiSummary)}</p></div>` : ''}
            ${hypothesesHtml}
            ${patternsHtml}
            ${decisionFlowHtml}
            ${questionsHtml}
            <div style="text-align:center; margin-top:14px">
                <button id="month-report-regenerate-btn" class="text-btn" style="font-size:13px; color:var(--text-secondary, #888); cursor:pointer; background:none; border:none">
                    ↻ 리포트 재작성하기
                </button>
            </div>
            <div style="text-align:center; margin-top:10px; padding-top:10px; border-top:1px solid var(--border, rgba(0,0,0,0.08)); font-size:12px; color:var(--text-secondary)">
                여기까지가 데이터예요. 다음은 묵상 안에서.
            </div>
        </article>
    `;
}

/**
 * Phase E-9/R-DD: 인라인 카드의 [상세] 버튼에 드릴다운 부착.
 * 인라인은 길이를 절제해 결단 흐름만 부착. 인물·라벨 chip은 리포트 메뉴에서.
 */
function bindInlineDrill(inlineRoot, dek) {
    if (!inlineRoot) return;
    inlineRoot.querySelectorAll('[data-inline-drill="decision"]').forEach(btn => {
        const start = btn.dataset.start;
        const end = btn.dataset.end;
        if (!start || !end) return;
        attachDrillDown(btn, {
            type: 'decision',
            params: {},
            range: { start, end },
            dek,
            userId: _userId,
            label: '이 기간 결단의 흐름 (raw)',
        });
    });
    // Phase E-9/R-QA: 인라인 카드 안에 Q&A 입력창 — 푸터(여기까지가 데이터예요…) 앞에.
    inlineRoot.querySelectorAll('.week-report-inline, .month-report-inline').forEach(card => {
        // 마지막 자식이 "여기까지가 데이터예요…" 푸터. 거기 앞에 박음.
        const foot = [...card.children].reverse().find(el => el.textContent?.includes('여기까지가 데이터'));
        if (!foot) return;
        const isMonth = card.classList.contains('month-report-inline');
        const start = card.dataset.start;
        const end = card.dataset.end;
        const reportId = isMonth ? (start || '').slice(0, 7) : weeklyKeyFromRange(start, end);
        mountReportQna(foot, {
            reportId,
            reportType: isMonth ? 'month' : 'week',
            // 인라인은 stats를 따로 들고 다니지 않음 — Q&A 호출 시 그 자리에서 lazy 로딩 가능하지만
            // 우선 빈 stats로 보내고, 답변 톤은 시스템 프롬프트가 책임짐.
            stats: {},
            context: {},
            dek,
            userId: _userId,
        });
    });
}

/**
 * 오늘 리포트(today-report-body)에 Q&A 입력창 부착.
 * 푸터 자리가 없으므로 임시 anchor div를 끝에 박고 그 앞에 mountReportQna.
 */
function attachQnaToTodayReport(body, dek, report) {
    if (!body) return;
    if (body.querySelector('.qna-wrap')) return;
    const anchor = document.createElement('div');
    anchor.className = 'report-card-foot today-qna-anchor';
    anchor.textContent = '여기까지가 데이터예요. 다음은 묵상 안에서.';
    body.appendChild(anchor);
    mountReportQna(anchor, {
        reportId:   _date,
        reportType: 'day',
        stats:      report?.stats || {},
        context:    {},
        dek,
        userId: _userId,
    });
}

function weeklyKeyFromRange(start, end) {
    // 'YYYY-MM-DD' end → ISO yearWeek 'YYYY-Www'
    if (!end) return start || '';
    const d = new Date(end + 'T00:00:00');
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ─── 다음 날 묵상 버튼 ───
function bindNextDayButton() {
    const btn = document.getElementById('next-day-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (typeof window.__sanctumGoToNextDay === 'function') {
            window.__sanctumGoToNextDay();
        }
    });
}

// ─── 핀 원칙 띠 ───
async function loadPinnedPrinciple(dek) {
    const banner = document.getElementById('pinned-principle-banner');
    const text = document.getElementById('pinned-principle-text');
    if (!banner || !text) return;

    try {
        const q = query(
            collection(db, 'principles'),
            where('userId', '==', _userId),
            where('pinned', '==', true)
        );
        const snap = await getDocs(q);
        if (snap.docs.length === 0) {
            banner.classList.add('hidden');
            return;
        }
        const data = await readDocument(dek, snap.docs[0].data());
        text.textContent = data.title || '';
        banner.classList.remove('hidden');
    } catch (e) {
        console.warn('pinned principle load failed:', e);
        banner.classList.add('hidden');
    }
}

// ─── 묵상 노트 자동 저장 (디바운스 1초) ───
let _saveTimer = null;

function bindMeditationAutosave() {
    const editor = document.getElementById('meditation-note');
    if (!editor) return;

    editor.addEventListener('input', () => {
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => saveMeditationNote(editor.innerText), 1000);
    });

    // 외부에서 복사해 온 텍스트는 폰트/배경/색상 인라인 스타일을 모두 떼고
    // 순수 텍스트만 받아 옴 → 묵상 노트 폰트(프리텐다드)와 테마 색상이 그대로 적용됨
    editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const cd = e.clipboardData || window.clipboardData;
        const text = cd ? cd.getData('text/plain') : '';
        if (!text) return;
        // execCommand는 deprecated이지만 contenteditable 호환성이 가장 좋음
        if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
            document.execCommand('insertText', false, text);
        } else {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(text));
            range.collapse(false);
        }
    });
}

async function saveMeditationNote(content) {
    const dek = getDEK();
    if (!dek || !_userId || !_date) return;

    const status = document.getElementById('meditation-save-status');
    if (status) status.textContent = '저장하는 중...';

    try {
        const id = `meditation_${_userId}_${_date}`;
        const meta = { id, userId: _userId, date: _date, createdAt: serverTimestamp() };
        const sensitive = { content };
        const document_ = await prepareDocument(dek, meta, sensitive);
        await setDoc(doc(db, 'meditations', id), document_, { merge: true });

        if (status) {
            status.textContent = '🔐 안전하게 보관됐어요';
            setTimeout(() => { if (status) status.textContent = ''; }, 1500);
        }
    } catch (e) {
        console.error('meditation save failed:', e);
        if (status) status.textContent = '저장이 잘 안 됐어요';
    }
}

async function loadMeditationNote(dek) {
    const editor = document.getElementById('meditation-note');
    if (!editor) return;

    try {
        const id = `meditation_${_userId}_${_date}`;
        const snap = await getDoc(doc(db, 'meditations', id));
        if (snap.exists()) {
            const data = await readDocument(dek, snap.data());
            editor.innerText = data.content || '';
        } else {
            editor.innerText = '';
        }
    } catch (e) {
        console.warn('meditation load failed:', e);
        editor.innerText = '';
    }
}

// ─── 결단 패널 ───
function bindDecisionsPanel() {
    const addBtn = document.getElementById('decision-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', addNewDecision);
    }
}

async function loadDecisions(dek) {
    try {
        // Phase B: 결단 컬렉션 대신 goals(period=daily)에서 가져옴.
        // 현재 보고 있는 날짜(_date)의 daily 목표만 표시 (날짜별 캘린더 모델).
        _decisions = await getDailyGoals(dek, _userId, _date);
    } catch (e) {
        console.error('daily goals load failed:', e);
        _decisions = [];
    }
    renderDecisions();
}

function renderDecisions() {
    const list = document.getElementById('decisions-list');
    if (!list) return;

    if (_decisions.length === 0) {
        list.innerHTML = `
            <p style="font-size:12px;color:var(--text-secondary);padding:8px;">
                아직 오늘의 목표가 없어요. 아래 [+ 새 목표 적기]를 눌러 시작해 볼까요?
            </p>
        `;
        return;
    }

    list.innerHTML = _decisions.map(d => renderDecisionCard(d)).join('');
    bindCardEvents();
}

function renderDecisionCard(d) {
    const placed = d.timeSlot != null;
    const slotLabel = placed
        ? `⏰ ${slotToTime(d.timeSlot)}~${slotToTime(d.timeSlot + (d.durationSlots || 4))}`
        : '미배치';
    // daily 목표의 텍스트는 title 필드. 호환: 결단 시절의 text 도 fallback.
    const textValue = d.title ?? d.text ?? '';
    return `
        <div class="decision-card ${placed ? 'placed' : ''}" data-id="${d.id}">
            <span class="decision-handle" draggable="true" title="잡고 시간표로 끌어 옮겨 보세요">⋮⋮</span>
            <input type="text" class="decision-text" value="${escapeHtml(textValue)}"
                   placeholder="오늘 옮길 한 걸음" data-id="${d.id}" />
            <span class="decision-slot">${slotLabel}</span>
            <button class="decision-action delete-btn" data-id="${d.id}" title="삭제">×</button>
        </div>
    `;
}

function slotToTime(slot) {
    const h = Math.floor(slot / 4);
    const m = (slot % 4) * 15;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/**
 * '오늘 어떤 일을 했나' 블록 — 대시보드 주간 카드의 dash-insights 와 같은 톤,
 * 같은 CSS 클래스 재사용. 오늘 도트 한정.
 */
function buildInsightsBlock(dots) {
    if (!dots || dots.length === 0) return '';
    const topTasks  = computeTopTasks(dots, 3);
    const topCats   = computeTopCategories(dots, 3);
    const topLabels = computeTopLabels(dots, 3);

    const taskItems = topTasks.length
        ? topTasks.map(t => `<li>${escapeHtml(t.task)} <span class="dash-insight-meta">${formatMinutesShort(t.minutes)}</span></li>`).join('')
        : '<li class="dash-insight-empty">아직 적힌 일이 없어요</li>';
    const catItems = topCats.length
        ? topCats.map(c => {
            const meta = findCategory(c.categoryId);
            const label = meta ? `${meta.icon} ${meta.label}` : c.categoryId;
            return `<li>${escapeHtml(label)} <span class="dash-insight-meta">${formatMinutesShort(c.minutes)}</span></li>`;
        }).join('')
        : '<li class="dash-insight-empty">카테고리를 골라보세요</li>';
    const labelItems = topLabels.length
        ? topLabels.map(l => `<li>${escapeHtml(l.label)} <span class="dash-insight-meta">×${l.count}</span></li>`).join('')
        : '<li class="dash-insight-empty">아직 고른 라벨이 없어요</li>';

    return `
        <div class="dash-insights" style="margin-top: 12px;">
            <div class="dash-insight-col">
                <div class="dash-insight-title">오늘 시간을 많이 쓴 일</div>
                <ol class="dash-insight-list">${taskItems}</ol>
            </div>
            <div class="dash-insight-col">
                <div class="dash-insight-title">활동 카테고리</div>
                <ol class="dash-insight-list">${catItems}</ol>
            </div>
            <div class="dash-insight-col">
                <div class="dash-insight-title">고른 라벨</div>
                <ol class="dash-insight-list">${labelItems}</ol>
            </div>
        </div>
    `;
}

function bindCardEvents() {
    const list = document.getElementById('decisions-list');
    if (!list) return;

    // 텍스트 인라인 편집 (blur 시 저장 + Enter 시 다음 목표로) — daily goal.title 기준
    list.querySelectorAll('.decision-text').forEach(input => {
        input.addEventListener('blur', async () => {
            const id = input.dataset.id;
            const goal = _decisions.find(d => d.id === id);
            if (!goal) return;
            const newText = input.value.trim();
            if (newText === (goal.title || '')) return;
            goal.title = newText;
            const dek = getDEK();
            if (dek) await saveGoal(dek, goal);
        });
        input.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const id = input.dataset.id;
            const goal = _decisions.find(d => d.id === id);
            const value = input.value.trim();
            // 변경이 있으면 먼저 저장
            if (goal && value !== (goal.title || '')) {
                goal.title = value;
                const dek = getDEK();
                if (dek) await saveGoal(dek, goal);
            }
            if (value) {
                // 빈 카드가 아니면 다음 목표를 새로 만들고 포커스
                await addNewDecision();
            } else {
                // 빈 카드에서 엔터는 무한 추가 방지
                input.blur();
            }
        });
    });

    // 삭제 버튼
    list.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (!confirm('이 목표를 지워도 괜찮을까요?')) return;
            await deleteGoal(id);
            _decisions = _decisions.filter(d => d.id !== id);
            renderDecisions();
        });
    });

    // 드래그 시작 — 핸들(⋮⋮)에서만 시작.
    // 카드 전체를 draggable로 두면 input 위 마우스다운이 텍스트 선택으로 가버려서
    // 드래그 자체가 시작되지 않는 문제가 있음.
    list.querySelectorAll('.decision-handle').forEach(handle => {
        handle.addEventListener('dragstart', (e) => {
            const card = handle.closest('.decision-card');
            if (!card) return;
            const id = card.dataset.id;
            try { e.dataTransfer.setData('application/x-sanctum-decision', id); } catch {}
            try { e.dataTransfer.setData('text/plain', id); } catch {} // fallback
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
        });
        handle.addEventListener('dragend', () => {
            handle.closest('.decision-card')?.classList.remove('dragging');
        });
    });
}

async function addNewDecision() {
    const dek = getDEK();
    if (!dek) { showToast('잠시 잠겨 있어요. 비밀번호로 열어 주실래요?'); return; }

    // Phase B: daily 목표 (period='daily') 한 장 신규 생성. 결단 시절 필드를 새 모델로 매핑.
    const newGoal = {
        id: `goal_${_userId.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: _userId,
        period: 'daily',
        title: '',
        description: '',
        parentGoalId: null,
        startDate: _date,
        endDate: '',
        status: 'active',
        progress: 0,
        // 시간표 박기용 필드 — encryptionPolicy.goals.plaintext 에 정합
        timeSlot: null,
        durationSlots: 4,
        placedAt: null,
        order: _decisions.length,
    };
    await saveGoal(dek, newGoal);
    _decisions.push(newGoal);
    renderDecisions();

    // 새로 추가된 입력란에 포커스
    setTimeout(() => {
        const inputs = document.querySelectorAll('.decision-text');
        const last = inputs[inputs.length - 1];
        if (last) last.focus();
    }, 50);
}

// (B-4 정리) 외부 dead exports getDecisions/getDecisionById 제거.
// timeline.js 는 자체적으로 goalsRepo 를 import 해 사용.
