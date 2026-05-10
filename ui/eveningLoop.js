/**
 * eveningLoop.js — 저녁 회고
 *
 * 매일 4단계 회고: 시간 채우기 → 도트 평가 → 오늘 리포트 → 회고 읽기
 * 기도 / 내일 결단 / 내일 시간 잡기는 별도 화면에서 자연스럽게 하므로 여기선 다루지 않음.
 *
 * 토요일 규칙 (자동):
 * - 매주 토요일: 이번 주 회고 추가
 * - 매월 마지막 토요일: 이번 달 회고 추가
 * - 분기 마지막(3·6·9·12월) 마지막 토요일: 이번 분기 회고 추가
 * - 12월 마지막 토요일: 올해 회고 + 5·10년 점검 추가
 *
 * 마지막엔 "다음 날 묵상 시작" 버튼 → 오늘 메뉴의 내일 날짜로 이동.
 */

import { getDEK } from './lockScreen.js';
import { getDotsByDate } from '../data/dotsRepo.js';
import { checkAndGenerateDayReport, getReport, getReports } from '../data/reportPipeline.js';
import { generateLocalFallback } from '../infra/cloudFunctionProxy.js';
import { showToast } from './quickReview.js';
import { callLLM } from './aiClient.js';
import { setCurrentDate } from './app.js';

const DAILY_STEPS = [
    { id: 'fill',     title: '시간 정직하게 보기',  icon: '⏰', desc: '오늘 빈 시간에 무엇을 했는지 떠올려 봐요.' },
    { id: 'evaluate', title: '도트 평가',         icon: '📊', desc: '각 시간을 한마디로 짧게 마음에 새겨요.' },
    { id: 'report',   title: '오늘의 리포트',      icon: '📈', desc: '오늘 하루를 정리해 볼게요.' },
    { id: 'reflect',  title: '회고 읽기',         icon: '🔍', desc: '내가 발견한 결을 천천히 살펴봐요.' },
];

const LAYER_CONFIGS = {
    week:    { id: 'review-week',    title: '이번 주 회고',  icon: '📅', collection: 'weekReports' },
    month:   { id: 'review-month',   title: '이번 달 회고',  icon: '🗓', collection: 'monthReports' },
    quarter: { id: 'review-quarter', title: '이번 분기 회고', icon: '📊', collection: 'quarterReports' },
    year:    { id: 'review-year',    title: '올해 회고',     icon: '🎯', collection: 'yearReports' },
    decade:  { id: 'review-decade',  title: '5년·10년 점검', icon: '🌌', collection: 'yearReports' },
};

let _userId = null;
let _dateStr = null;
let _steps = DAILY_STEPS;

/**
 * 진입점 — switchView('evening')에서 호출됨
 */
export function openEveningLoop(userId, dateStr) {
    _userId = userId;
    _dateStr = dateStr;
    _steps = buildDynamicSteps(new Date(dateStr + 'T00:00:00'));

    const container = document.getElementById('evening-loop-container');
    if (!container) return;
    container.classList.remove('hidden');

    renderEveningPage();
    _steps.forEach(s => loadSectionContent(s).catch(e => console.warn(`[eveningLoop] ${s.id} 로드 실패:`, e)));
}

export function buildDynamicSteps(date) {
    const steps = [...DAILY_STEPS];
    const layers = determineLayers(date);
    if (layers.includes('week'))    steps.push({ ...LAYER_CONFIGS.week,    bonus: true });
    if (layers.includes('month'))   steps.push({ ...LAYER_CONFIGS.month,   bonus: true });
    if (layers.includes('quarter')) steps.push({ ...LAYER_CONFIGS.quarter, bonus: true });
    if (layers.includes('year'))    steps.push({ ...LAYER_CONFIGS.year,    bonus: true });
    if (layers.includes('decade'))  steps.push({ ...LAYER_CONFIGS.decade,  bonus: true });
    return steps;
}

/**
 * 토요일 규칙: 토요일이 아니면 빈 배열.
 * 7일 뒤 토요일이 다음 달이면 그 토요일이 "이번 달의 마지막 토요일"
 */
export function determineLayers(date = new Date()) {
    if (date.getDay() !== 6) return [];
    const layers = ['week'];
    const nextSat = new Date(date);
    nextSat.setDate(nextSat.getDate() + 7);
    const isLastSatOfMonth = nextSat.getMonth() !== date.getMonth();
    if (!isLastSatOfMonth) return layers;
    layers.push('month');
    const month = date.getMonth() + 1;
    if ([3, 6, 9, 12].includes(month)) layers.push('quarter');
    if (month === 12) { layers.push('year'); layers.push('decade'); }
    return layers;
}

// ─── 페이지 전체 렌더 ───
function renderEveningPage() {
    const indicator = document.getElementById('evening-step-indicator');
    const body = document.getElementById('evening-step-body');
    if (!indicator || !body) return;

    indicator.innerHTML = _steps.map((s, i) => `
        <a href="#el-${s.id}" class="el-indicator-dot ${s.bonus ? 'bonus' : ''}" data-step="${s.id}">
            <span class="el-indicator-num">${i + 1}</span>
            <span class="el-indicator-title">${s.icon} ${s.title}</span>
        </a>
    `).join('');
    indicator.classList.add('el-sticky-indicator');

    body.innerHTML = _steps.map((s) => `
        <section class="el-section" id="el-${s.id}" data-step="${s.id}">
            <div class="el-section-header">
                <span class="el-section-icon">${s.icon}</span>
                <h2 class="el-section-title">${s.title}</h2>
                ${s.bonus ? '<span class="el-section-bonus">특별 회고</span>' : ''}
            </div>
            <p class="el-section-desc">${s.desc || ''}</p>
            <div class="el-section-body" data-step-body="${s.id}">
                <div class="el-section-loading">잠깐만요, 가져오는 중이에요...</div>
            </div>
        </section>
    `).join('') + `
        <section class="el-section el-section-finish">
            <div class="el-section-header">
                <span class="el-section-icon">🌙</span>
                <h2 class="el-section-title">수고하셨어요</h2>
            </div>
            <p class="el-section-desc">
                오늘을 정직하게 마주해 주셨네요.<br>
                내일은 새 마음으로 시작해 봐요.
            </p>
            <div style="text-align:center; margin-top: 24px">
                <button id="el-next-day-btn" class="primary-btn">다음 날 묵상 시작하기 →</button>
            </div>
        </section>
    `;

    // 인디케이터 클릭 → 부드러운 스크롤
    indicator.querySelectorAll('.el-indicator-dot').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const id = el.dataset.step;
            const target = document.getElementById(`el-${id}`);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    document.getElementById('el-next-day-btn')?.addEventListener('click', goToNextDayMeditation);

    setupScrollTracking();
}

/**
 * 다음 날 묵상으로 시작 — 오늘 메뉴의 내일 날짜로 이동 + 묵상 노트로 스크롤
 */
async function goToNextDayMeditation() {
    const today = new Date(_dateStr + 'T00:00:00');
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    try {
        await setCurrentDate(tomorrowStr);
    } catch (e) {
        console.warn('setCurrentDate failed:', e);
    }
    document.getElementById('nav-today')?.click();
    setTimeout(() => {
        const sec = document.getElementById('section-scripture') || document.getElementById('section-meditation');
        sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('meditation-note')?.focus();
    }, 200);
    showToast('🌅 새 하루를 시작해 봐요');
}

function setupScrollTracking() {
    const sections = document.querySelectorAll('.el-section');
    const dots = document.querySelectorAll('.el-indicator-dot');
    if (sections.length === 0 || dots.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const id = entry.target.dataset.step || entry.target.id.replace('el-', '');
                dots.forEach(d => d.classList.toggle('active', d.dataset.step === id));
            }
        });
    }, { rootMargin: '-30% 0px -50% 0px', threshold: 0 });

    sections.forEach(s => observer.observe(s));
}

// ─── 각 섹션 컨텐츠 ───
async function loadSectionContent(step) {
    const body = document.querySelector(`[data-step-body="${step.id}"]`);
    if (!body) return;
    const dek = getDEK();

    if (step.id.startsWith('review-')) {
        await renderLayerReview(step, body);
        return;
    }

    switch (step.id) {
        case 'fill':
            body.innerHTML = `
                <div class="el-tip">
                    오늘 화면 위 시간표로 잠시 돌아가서 빈 칸을 채워 봐요.<br>
                    한 줄로 적으면 되고, 정확하지 않아도 괜찮아요.
                </div>
                <button id="el-jump-today" class="text-btn">→ 오늘 화면으로 잠깐 다녀오기</button>
            `;
            body.querySelector('#el-jump-today')?.addEventListener('click', () => {
                document.getElementById('nav-today')?.click();
            });
            break;

        case 'evaluate': {
            if (!dek) { body.innerHTML = '<p>잠시 잠겨 있어요. 비밀번호로 열어 주실래요?</p>'; return; }
            try {
                const dots = await getDotsByDate(dek, _userId, _dateStr);
                const unevaluated = dots.filter(d => !d.executed || d.executed === 'pending');
                body.innerHTML = `
                    <div class="el-stat-row">
                        <div class="el-stat"><span class="el-stat-num">${unevaluated.length}</span><span class="el-stat-lbl">아직 평가 전</span></div>
                        <div class="el-stat"><span class="el-stat-num">${dots.length}</span><span class="el-stat-lbl">전체 슬롯</span></div>
                    </div>
                    <p class="el-tip">
                        오늘 화면의 시간표에서 슬롯을 톡 누르면 3초 안에 평가할 수 있어요.<br>
                        키보드 1~4를 누르면 더 빠르게 끝나요.
                    </p>
                `;
            } catch (e) {
                body.innerHTML = `<p style="color:var(--dot-red)">잠깐 막혔어요. 한 번만 더 시도해 주실래요?</p>`;
            }
            break;
        }

        case 'report':
            body.innerHTML = '<div class="spinner" style="margin: 0 auto"></div><p style="text-align:center">오늘 리포트를 만드는 중이에요...</p>';
            if (dek) {
                try {
                    const reportId = await checkAndGenerateDayReport(dek, _userId);
                    body.innerHTML = reportId
                        ? '<p style="color:var(--dot-green); text-align:center">✅ 오늘 리포트가 만들어졌어요!</p>'
                        : '<p style="text-align:center">이미 오늘 리포트가 있거나, 아직 평가가 부족해요.</p>';
                } catch (e) {
                    body.innerHTML = `<p style="color:var(--dot-red)">생성이 잠깐 막혔어요. 잠시 후 다시 들어와 주실래요?</p>`;
                }
            }
            break;

        case 'reflect': {
            if (!dek) return;
            const report = await getReport(dek, 'dayReports', `${_userId}_${_dateStr}`);
            if (!report) {
                body.innerHTML = '<p>아직 리포트가 없어요. 평가를 마저 하시고 위에서 다시 만들어 볼까요?</p>';
                return;
            }
            const stats = report.stats || {};
            body.innerHTML = `
                <div class="el-stat-row">
                    <div class="el-stat"><span class="el-stat-num">${stats.doneCount || 0}<small>/${stats.totalSlots || 0}</small></span><span class="el-stat-lbl">완료</span></div>
                    <div class="el-stat"><span class="el-stat-num">${stats.avgSatisfaction || '-'}</span><span class="el-stat-lbl">만족도</span></div>
                    <div class="el-stat"><span class="el-stat-num">${stats.matchRate || 0}<small>%</small></span><span class="el-stat-lbl">계획 일치율</span></div>
                </div>
                <div class="ai-summary-card">
                    <p id="reflect-ai-text">잠깐만요, 패턴을 살펴보고 있어요...</p>
                    <p id="reflect-ai-tag" style="font-size:11px;color:var(--text-secondary);margin-top:8px"></p>
                </div>
                <p class="el-tip">
                    숫자는 비교가 아니라 거울이에요. 잘잘못 가리기보다는, 어떤 결이 보이는지만 살펴봐요.
                </p>
            `;

            (async () => {
                let text = report.aiSummary;
                let isFallback = false;
                if (!text) {
                    const result = await callLLM('dayReport', {
                        date: _dateStr,
                        stats,
                        context: { persons: [], amounts: [] },
                    }, { stats });
                    text = result.text;
                    isFallback = result.fallback;
                }
                const aiEl = document.getElementById('reflect-ai-text');
                const tagEl = document.getElementById('reflect-ai-tag');
                if (aiEl) aiEl.textContent = text;
                if (tagEl) tagEl.textContent = isFallback
                    ? '※ 지금은 간단 요약만 보여드려요. AI 분석은 곧 활성화될 예정이에요.'
                    : '🌟 AI가 살펴본 오늘의 결';
            })();
            break;
        }
    }
}

/**
 * 토요일에만 보이는 추가 회고 섹션 — 주/월/분기/연/5·10년
 * 끝에는 "🎯 나의 목표 메뉴로 가서 새 목표 세우기" 안내 버튼.
 */
async function renderLayerReview(step, body) {
    const dek = getDEK();
    if (!dek) { body.innerHTML = '<p>잠시 잠겨 있어요. 비밀번호로 열어 주실래요?</p>'; return; }

    try {
        const reports = await getReports(dek, step.collection, _userId, 1);
        const goalsButton = `
            <div style="margin-top: 16px">
                <button class="text-btn el-goto-goals">→ 🎯 나의 목표 메뉴에서 새 목표 세우기</button>
            </div>
        `;

        if (reports.length === 0) {
            body.innerHTML = `
                <p>${step.title} 리포트가 아직 없어요.</p>
                <p class="el-tip">자동 생성은 다음 단계에서 활성화될 예정이에요.</p>
                ${goalsButton}
            `;
        } else {
            const r = reports[0];
            const stats = r.stats || {};
            const fallback = generateLocalFallback(stats);
            body.innerHTML = `
                <div class="el-stat-row">
                    <div class="el-stat"><span class="el-stat-num">${stats.totalSlots || 0}</span><span class="el-stat-lbl">전체</span></div>
                    <div class="el-stat"><span class="el-stat-num">${stats.doneCount || 0}</span><span class="el-stat-lbl">완료</span></div>
                    <div class="el-stat"><span class="el-stat-num">${stats.avgSatisfaction || '-'}</span><span class="el-stat-lbl">만족도</span></div>
                </div>
                <div class="ai-summary-card">
                    <p>${r.aiSummary || fallback.aiSummary}</p>
                </div>
                <p class="el-tip">
                    이번 ${step.title.replace(' 회고', '')}을 정리하며 떠오른 결단을, 새 목표로 박아 둬 봐요.
                </p>
                ${goalsButton}
            `;
        }

        body.querySelector('.el-goto-goals')?.addEventListener('click', () => {
            document.getElementById('nav-goals')?.click();
        });
    } catch (e) {
        body.innerHTML = `<p style="color:var(--dot-red)">못 가져왔어요: ${e?.message || e}</p>`;
    }
}

export function closeEveningLoop() {
    const container = document.getElementById('evening-loop-container');
    if (container) container.classList.add('hidden');
    document.getElementById('nav-today')?.click();
}
