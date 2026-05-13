/**
 * dashboard.js — 대시보드 뷰 (Phase D: "묵상의 자리")
 *
 * 영역 (세로 순서):
 *   1) 오늘의 시작 (#today-start-content)
 *      - 시간대별 인사
 *      - 핀 원칙 한 줄
 *      - 어제 묵상에 가져갔던 질문 (어제 dayReport.questionsForMeditation[0])
 *
 *   2) 나의 목표 (goals-container — goals.js 가 채움)
 *
 *   3) 이번 주의 결 (#dashboard-prose)
 *      - 산문 한 줄: "이번 주 도트 N개 중 M개 완료, 평균 X점. 패턴 한 마디."
 *
 *   4) 숫자로 보기 토글 (#dashboard-cards)
 *      - 토글 펼치면 기존 카드 (히트맵 / 도트 / 통독 / 묵상 / 일치율 등)
 *
 * 정책 (memory/project_reports_module.md + reports-spec §1.6):
 *   - 처방 톤 금지. 산문은 "관찰" 톤.
 *   - 비교의 함정 회피 — "더 / 덜" 같은 표현은 데이터가 있을 때만 신중히.
 */

import { db, collection, query, where, getDocs } from '../data/firebase.js';
import { getDotsByDateRange, computeDotStats } from '../data/dotsRepo.js';
import { getAllPersons } from '../data/personRepo.js';
import { getAllOrganizations } from '../data/orgRepo.js';
import { computeAllPersonStats, computeAllOrgStats, formatMinutes, ratingDotsHtml } from '../data/cardStats.js';
import { readDocument } from '../crypto/cryptoService.js';
import { getDayReport } from '../reports/dayReportRepo.js';
import { getDashboardWeeklyBrief } from './aiClient.js';
import { getDEK } from './lockScreen.js';
// Phase E-8/D: 통독 진도 = 활성 plan + anchor 기반 자동 계산. Firestore bibleProgress 의존 제거.
import { computePlanProgress } from './scripture.js';
import { getActivePlan } from './scriptureSettings.js';
// Phase E-9/R-QA 3세: 다음 아침 게이트에 미열람 Q&A 자동 노출
import { listUnseenReportQuestions, markQuestionSeen } from '../reports/reportQuestionsRepo.js';
import { computeTopTasks, computeTopLabels, computeTopCategories, formatMinutesShort } from '../data/dotInsights.js';
import { findCategory } from '../data/dotCategories.js';

export async function renderDashboardView(userId) {
    // R-QA 3세 게이트 헬퍼에서 사용 — module-private이 아니라 lazy fetch에서 안전하게 읽으려고
    window.__sanctumUserId = userId;
    const dek = getDEK();
    if (!dek) {
        renderLocked();
        return;
    }

    // 데이터 fetching — 모든 영역에 필요한 입력 한 번에
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const endDate = fmt(today);
    const past7 = new Date();
    past7.setDate(today.getDate() - 6);
    const startDate = fmt(past7);

    const [dots, meditationCount, persons, orgs, workflows] = await Promise.all([
        getDotsByDateRange(dek, userId, startDate, endDate).catch(() => []),
        countMeditations(userId, startDate, endDate).catch(() => 0),
        getAllPersons(dek, userId).catch(() => []),
        getAllOrganizations(dek, userId).catch(() => []),
        // 워크플로우 트랙 STEP 2 활용 — 활성 등산로 진척
        import('../data/workflowsRepo.js').then(m => m.getActiveWorkflows(dek, userId)).catch(() => []),
    ]);
    // 핀 원칙은 S6 묵상의 결에 살짝 비춰주려고만 — view-today의 오늘의 시작이 메인 책임
    const pinned = await getPinnedPrinciple(dek, userId).catch(() => null);

    // 통독 진도는 외부 fetch 없음 — 활성 plan + anchor로 즉시 계산
    const bibleProgressView = computePlanProgress(getActivePlan());

    // 페이지 재진입 시 AI 캐시 초기화 — 다음 클릭에서 새 데이터로 다시 호출
    _aiBriefCache = null;

    // 2026-05-13 재기획: renderTodayStart 와 renderCallSection 은 view-today 책임으로 이동.
    // 대시보드는 "삶 전체 큰 그림" — S2~S7 카드만.
    renderProseLine(dots, pinned, persons, orgs);       // S2 — 산문 + AI 듣기
    // S3 목표 트리 = renderGoalsView(userId) — switchView 에서 별도 호출 (옛 패턴 유지)
    renderActiveWorkflowsCard(workflows);                // S4 — 활성 등산로 진척 (신규)
    renderNextReviewsCard(dots);                         // S5 — 다음 회고 안내 (신규)
    renderMeditationRhythmCard(meditationCount);         // S6 — 묵상의 결 (신규)
    renderPeopleSection(dots, persons, orgs);            // 이번 주 관계의 결
    renderNumberCards(dots, bibleProgressView, meditationCount);
    bindNumbersToggle();
    bindDashboardQuickNav();                             // 카드 헤더 chevron 바로가기

    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

/**
 * (2026-05-13) view-today 위 "오늘의 시작" 영역을 위한 진입.
 * 대시보드와 분리 — view-today 진입 시 호출. 같은 #today-start-content id 재사용.
 */
export async function renderTodayStartIntoView(userId) {
    window.__sanctumUserId = userId;
    const dek = getDEK();
    if (!dek) return;
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = fmt(yesterday);
    const [pinned, yesterdayReport] = await Promise.all([
        getPinnedPrinciple(dek, userId).catch(() => null),
        getDayReport(dek, userId, yesterdayStr).catch(() => null),
    ]);
    renderTodayStart(pinned, yesterdayReport);
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

function renderLocked() {
    const root = document.getElementById('today-start-content');
    if (root) {
        root.innerHTML = `
            <div class="empty-state">
                <i class="empty-state-icon" data-lucide="lock"></i>
                <h3>잠시 잠겨있어요</h3>
                <p class="empty-state-desc">비밀번호로 열어주세요.</p>
            </div>`;
    }
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

// ─── 1) 오늘의 시작 ───────────────────────────────────────
function renderTodayStart(pinned, yesterdayReport) {
    const root = document.getElementById('today-start-content');
    if (!root) return;

    const greeting = greetingByHour();
    const userName = (document.getElementById('user-name')?.textContent || '').trim();
    const namePart = userName && userName !== '로그인' ? `, ${userName}` : '';

    const pinnedBlock = pinned
        ? `
            <div class="today-start-line">
                <i class="today-start-icon" data-lucide="pin"></i>
                <span class="today-start-label">오늘의 핀 원칙</span>
                <span class="today-start-text">${escapeHtml(pinned)}</span>
            </div>
        ` : '';

    const yesterdayQ = (yesterdayReport?.questionsForMeditation || [])[0] || null;
    const yesterdayBlock = yesterdayQ
        ? `
            <div class="today-start-line today-start-line-quiet">
                <i class="today-start-icon" data-lucide="sparkles"></i>
                <span class="today-start-label">어제 묵상에 가져간 질문</span>
                <span class="today-start-text">${escapeHtml(yesterdayQ)}</span>
            </div>
        ` : '';

    root.innerHTML = `
        <div class="today-start-card">
            <div class="today-start-greeting">${escapeHtml(greeting)}${escapeHtml(namePart)}</div>
            ${pinnedBlock}
            ${yesterdayBlock}
            ${(!pinned && !yesterdayQ) ? `
                <div class="today-start-empty">
                    오늘의 핀 원칙을 정하면 여기에 나타나요.<br>
                    어제 묵상에 가져간 질문도 자동으로 이어집니다.
                </div>
            ` : ''}
            <div id="today-start-unseen-qna"></div>
        </div>
    `;

    // Phase E-9/R-QA 3세 — 미열람 리포트 Q&A 자동 노출 (lazy)
    renderUnseenReportQuestions().catch(e => console.warn('unseen Q&A render failed:', e));
}

async function renderUnseenReportQuestions() {
    const slot = document.getElementById('today-start-unseen-qna');
    if (!slot) return;
    const dek = getDEK();
    if (!dek) return;
    const userId = document.body.dataset.uid;
    // userId는 dashboard fetch 시점의 인자로 받음 — module 스코프에 보관되지 않음
    // 대신 lockScreen이 dek를 들고 있고, 우리는 currentUserId가 필요. 임시 우회:
    // 이미 root.innerHTML 가 그려진 시점에는 _userIdHelper 가 있다고 가정 안 함.
    // 안전: window.appUserId 가 없으면 그냥 skip.
    const uid = window.__sanctumUserId;
    if (!uid) return;
    try {
        const items = await listUnseenReportQuestions(dek, uid, 3);
        if (!items || items.length === 0) return;
        slot.innerHTML = `
            <div class="today-start-qna-wrap">
                <div class="today-start-qna-head">
                    <i data-lucide="message-circle" class="today-start-icon"></i>
                    <span class="today-start-label">묵상에 가져갈 질문 (어제 던진 것)</span>
                </div>
                ${items.map(it => `
                    <article class="today-start-qna-card" data-qid="${escapeHtml(it.id)}">
                        <p class="today-start-qna-q">"${escapeHtml(it.question || '')}"</p>
                        ${it.returnToMeditation
                            ? `<p class="today-start-qna-tail">${escapeHtml(it.returnToMeditation).replace(/\n/g, '<br>')}</p>`
                            : ''}
                    </article>
                `).join('')}
            </div>
        `;
        // 노출 즉시 seen 마킹 — 다음 아침엔 안 보임
        items.forEach(it => {
            markQuestionSeen(uid, it.id).catch(() => {});
        });
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    } catch (e) {
        console.warn('listUnseenReportQuestions failed:', e);
    }
}

function greetingByHour() {
    const h = new Date().getHours();
    if (h >= 4 && h < 6)   return '조용한 새벽이에요';
    if (h >= 6 && h < 12)  return '좋은 아침이에요';
    if (h >= 12 && h < 17) return '낮 시간에 잠깐 들렀네요';
    if (h >= 17 && h < 20) return '저녁 시간이에요';
    return '오늘 하루 수고하셨어요';
}

// ─── 3) 이번 주의 결 — 산문 한 줄 + (E-2) AI 듣기 ─────────
// 모듈 스코프 캐시 — 같은 페이지 진입 동안엔 AI 호출 결과 보존
let _aiBriefCache = null;

function renderProseLine(dots, pinned, persons, orgs) {
    const root = document.getElementById('dashboard-prose');
    if (!root) return;

    if (!dots || dots.length === 0) {
        root.innerHTML = `
            <p class="dash-prose">이번 주 도트가 아직 없어요. 시간표에 한 칸 채우는 것부터 시작해도 좋아요.</p>
        `;
        return;
    }

    const stats = computeDotStats(dots);
    const done = stats.doneCount;
    const total = stats.totalSlots;
    const avg = stats.avgSatisfaction;

    // 어느 시간대가 두드러진지 — 처방 없이 관찰만
    const hourBuckets = { '아침(06-12)': [], '낮(12-17)': [], '저녁(17-22)': [], '밤(22-06)': [] };
    dots.forEach(d => {
        if (d.timeSlot == null) return;
        const h = Math.floor(d.timeSlot / 4);
        const sat = d.executionSatisfaction || 0;
        if (h >= 6 && h < 12) hourBuckets['아침(06-12)'].push(sat);
        else if (h >= 12 && h < 17) hourBuckets['낮(12-17)'].push(sat);
        else if (h >= 17 && h < 22) hourBuckets['저녁(17-22)'].push(sat);
        else hourBuckets['밤(22-06)'].push(sat);
    });
    const bucketAvgs = Object.entries(hourBuckets)
        .map(([name, arr]) => ({ name, avg: arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null, count: arr.length }))
        .filter(b => b.count >= 2);

    let patternNote = '';
    if (bucketAvgs.length >= 2) {
        const sorted = bucketAvgs.slice().sort((a, b) => b.avg - a.avg);
        const top = sorted[0];
        const bottom = sorted[sorted.length - 1];
        if ((top.avg - bottom.avg) >= 0.7) {
            patternNote = ` ${top.name} 시간대가 ${bottom.name} 시간대보다 살짝 높게 관찰됐어요.`;
        }
    }

    root.innerHTML = `
        <p class="dash-prose">
            이번 주 도트 <strong>${total}개</strong> 중 <strong>${done}개</strong> 완료,
            평균 <strong>${avg}점</strong>${patternNote ? '.' + patternNote : '.'}
        </p>
        ${renderInsightsBlock(dots)}
        <p class="dash-prose-quiet">여기까지가 데이터예요. 다음은 묵상 안에서.</p>

        <div class="dash-ai-row">
            <button class="dash-ai-toggle" id="dash-ai-toggle" type="button" aria-expanded="false">
                <i class="dash-icon" data-lucide="sparkles"></i>
                <span>AI 한 단락 듣기</span>
            </button>
        </div>
        <div id="dash-ai-panel" class="dash-ai-panel hidden" aria-live="polite"></div>
    `;
    bindAiToggle(stats, pinned, persons, orgs, dots);
}

/**
 * '어떤 일을 했나' 블록 — 시간 TOP 3 + 카테고리 TOP 3 + 라벨 TOP 3 나란히.
 * 도트가 1개라도 있어야 부르는 자리.
 */
function renderInsightsBlock(dots) {
    const topTasks = computeTopTasks(dots, 3);
    const topCats = computeTopCategories(dots, 3);
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
        <div class="dash-insights">
            <div class="dash-insight-col">
                <div class="dash-insight-title">시간을 많이 쓴 일</div>
                <ol class="dash-insight-list">${taskItems}</ol>
            </div>
            <div class="dash-insight-col">
                <div class="dash-insight-title">활동 카테고리</div>
                <ol class="dash-insight-list">${catItems}</ol>
            </div>
            <div class="dash-insight-col">
                <div class="dash-insight-title">자주 고른 라벨</div>
                <ol class="dash-insight-list">${labelItems}</ol>
            </div>
        </div>
    `;
}

// ─── AI 한 단락 — 클릭 시 호출, 결과 캐시. 정책: 묵상의 자리 톤 / 처방 X ───
function bindAiToggle(stats, pinned, persons, orgs, dots) {
    const btn = document.getElementById('dash-ai-toggle');
    const panel = document.getElementById('dash-ai-panel');
    if (!btn || !panel) return;

    btn.onclick = async () => {
        const isOpen = !panel.classList.contains('hidden');
        if (isOpen) {
            panel.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
            return;
        }

        panel.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');

        // 캐시 우선 — 같은 페이지 세션 안에선 재호출 안 함
        if (_aiBriefCache) {
            renderAiPanel(panel, _aiBriefCache);
            return;
        }

        panel.innerHTML = `<p class="dash-ai-loading">잠깐만요, 이번 주를 한 단락으로 모으는 중...</p>`;
        btn.disabled = true;

        try {
            // 이번 주 도트에 등장한 사람·조직 이름 (가명화에 사용)
            const personNames = collectPersonNamesFromDots(dots, persons);
            const orgNames    = collectOrgNamesFromDots(dots, orgs);
            const principles  = pinned ? [{ title: pinned, body: '' }] : [];

            const result = await getDashboardWeeklyBrief(stats, principles, {
                persons: personNames,
                orgs:    orgNames,
            });
            _aiBriefCache = result;
            renderAiPanel(panel, result);
        } catch (e) {
            console.warn('dashboard AI brief failed:', e);
            panel.innerHTML = `<p class="dash-ai-loading">잠깐 막혔어요. 다시 한 번 눌러 주실래요?</p>`;
        } finally {
            btn.disabled = false;
        }
    };
}

function renderAiPanel(panel, result) {
    const tag = result.fallback
        ? '<span class="dash-ai-fallback-tag">인터넷이 멀거나 AI 가 잠시 쉬는 중이에요 — 로컬 안내로 대체했어요</span>'
        : '';
    panel.innerHTML = `
        ${tag}
        <p class="dash-ai-text">${escapeHtml(result.text || '')}</p>
        <p class="dash-prose-quiet">이 한 단락도 진단일 뿐이에요. 다음은 묵상 안에서.</p>
    `;
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

function collectPersonNamesFromDots(dots, persons) {
    const ids = new Set();
    dots.forEach(d => (d.linkedPersonIds || []).forEach(id => ids.add(id)));
    return persons
        .filter(p => !p.isFallback && ids.has(p.id))
        .map(p => p.name)
        .filter(Boolean);
}

function collectOrgNamesFromDots(dots, orgs) {
    const ids = new Set();
    dots.forEach(d => (d.linkedOrgIds || []).forEach(id => ids.add(id)));
    return orgs
        .filter(o => ids.has(o.id))
        .map(o => o.name)
        .filter(Boolean);
}

// ─── D-3) 이번 주 관계의 결 — 최근 만난 사람·조직 ───────────
function renderPeopleSection(dots, persons, orgs) {
    const root = document.getElementById('dashboard-people');
    if (!root) return;

    const personStats = computeAllPersonStats(dots);
    const orgStats    = computeAllOrgStats(dots);

    // 이번 주 함께한 사람·조직 추출 (meetingCount>0)
    const peopleRows = persons
        .filter(p => !p.isFallback)
        .map(p => ({ card: p, stats: personStats.get(p.id) || null }))
        .filter(x => x.stats && x.stats.meetingCount > 0)
        .sort((a, b) => b.stats.meetingCount - a.stats.meetingCount);

    const orgRows = orgs
        .map(o => ({ card: o, stats: orgStats.get(o.id) || null }))
        .filter(x => x.stats && x.stats.meetingCount > 0)
        .sort((a, b) => b.stats.meetingCount - a.stats.meetingCount);

    // 둘 다 비어 있으면 안내문
    if (peopleRows.length === 0 && orgRows.length === 0) {
        root.innerHTML = `
            <p class="dash-prose-quiet">
                이번 주 도트에 함께한 사람·조직이 아직 없어요.
                평가에서 칩으로 추가해 두면 여기에 누적돼요.
            </p>
        `;
        return;
    }

    // 산문 한 줄 — 사람 수, 만남 횟수, 평균 만족도
    const peopleCount = peopleRows.length;
    const totalMeetings = peopleRows.reduce((sum, x) => sum + x.stats.meetingCount, 0);
    const ratingSamples = peopleRows.filter(x => x.stats.avgRating != null);
    const avgPeopleRating = ratingSamples.length > 0
        ? (ratingSamples.reduce((sum, x) => sum + x.stats.avgRating, 0) / ratingSamples.length).toFixed(1)
        : null;

    const proseParts = [];
    if (peopleCount > 0) {
        proseParts.push(`이번 주 <strong>${peopleCount}명</strong>과 <strong>${totalMeetings}번</strong>`);
        if (avgPeopleRating != null) proseParts.push(`평균 <strong>${avgPeopleRating}점</strong>`);
    }
    if (orgRows.length > 0) {
        proseParts.push(`조직 <strong>${orgRows.length}곳</strong>`);
    }
    const proseLine = proseParts.length > 0
        ? `<p class="dash-prose">${proseParts.join(', ')}.</p>`
        : '';

    // 사람 5명 아바타 줄 (만남 횟수 순)
    const topPeople = peopleRows.slice(0, 5);
    const avatarsHtml = topPeople.length > 0
        ? `
            <div class="dash-people-avatars" role="list">
                ${topPeople.map(x => `
                    <button class="dash-person-chip" data-person-id="${escapeAttr(x.card.id)}" role="listitem"
                            title="${escapeAttr(x.card.name || '')} · 만남 ${x.stats.meetingCount}번${
                                x.stats.avgRating != null ? ` · ${x.stats.avgRating.toFixed(1)}점` : ''
                            }">
                        <span class="dash-person-avatar" style="background:${avatarColor(x.card.id)}">
                            ${escapeHtml((x.card.name || '?').slice(0, 1))}
                        </span>
                        <span class="dash-person-meta">
                            <span class="dash-person-name">${escapeHtml(x.card.name || '이름 미상')}</span>
                            <span class="dash-person-stats">
                                ${x.stats.avgRating != null ? ratingDotsHtml(x.stats.avgRating) : ''}
                                <span class="dash-person-count">${x.stats.meetingCount}번 · ${formatMinutes(x.stats.totalMinutes)}</span>
                            </span>
                        </span>
                    </button>
                `).join('')}
            </div>
        ` : '';

    // 조직 줄 (있을 때만)
    const orgsHtml = orgRows.length > 0
        ? `
            <div class="dash-orgs-row">
                ${orgRows.slice(0, 3).map(x => `
                    <button class="dash-org-chip" data-org-id="${escapeAttr(x.card.id)}"
                            title="${escapeAttr(x.card.name || '')} · 만남 ${x.stats.meetingCount}번">
                        <i data-lucide="building-2" class="dash-org-icon"></i>
                        <span>${escapeHtml(x.card.name || '이름 미상')}</span>
                        <span class="dash-org-count">${x.stats.meetingCount}번</span>
                    </button>
                `).join('')}
            </div>
        ` : '';

    root.innerHTML = proseLine + avatarsHtml + orgsHtml;

    // 클릭 시 인물/조직 페이지 진입 (deep link 는 다음 단계 — 일단 페이지만)
    root.querySelectorAll('.dash-person-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof window.__sanctumSwitchView === 'function') {
                window.__sanctumSwitchView('persons');
            }
        });
    });
    root.querySelectorAll('.dash-org-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof window.__sanctumSwitchView === 'function') {
                window.__sanctumSwitchView('organizations');
            }
        });
    });
}

// ─── D-4) 토요일 회고 CTA + 빈 상태 가이드 ──────────────────
function renderCallSection(dots) {
    const section = document.getElementById('dash-section-call');
    const root    = document.getElementById('dashboard-call');
    if (!section || !root) return;

    // 빈 상태: 지난 7일 도트가 0개 — 시작 가이드
    if (!dots || dots.length === 0) {
        section.removeAttribute('hidden');
        root.innerHTML = `
            <div class="dash-call-card dash-call-empty">
                <i class="dash-call-icon" data-lucide="footprints"></i>
                <div class="dash-call-body">
                    <h3>아직 도트가 없어요</h3>
                    <p>오늘 화면의 시간표에서 빈 칸을 누르면 첫 도트를 적을 수 있어요.</p>
                </div>
                <button class="primary-btn dash-call-btn" data-go="today">오늘로 가기</button>
            </div>
        `;
        bindCallActions(root);
        return;
    }

    // 토요일이면 주간 회고 CTA — eveningLoop의 layer 감지와 같은 규칙 (요일==6)
    const isSaturday = new Date().getDay() === 6;
    if (isSaturday) {
        section.removeAttribute('hidden');
        root.innerHTML = `
            <div class="dash-call-card dash-call-saturday">
                <i class="dash-call-icon" data-lucide="moon"></i>
                <div class="dash-call-body">
                    <h3>이번 주를 닫는 토요일이에요</h3>
                    <p>오늘 화면 아래에 주간 회고 단계가 펼쳐져 있어요. 한 호흡으로 정리해 볼까요?</p>
                </div>
                <button class="primary-btn dash-call-btn" data-go="today">주간 회고로 가기</button>
            </div>
        `;
        bindCallActions(root);
        return;
    }

    // 평일 + 도트 있음 — 섹션 자체 숨김
    section.setAttribute('hidden', '');
    root.innerHTML = '';
}

function bindCallActions(root) {
    bindDeepLinks(root);
}

/**
 * Phase E-4: data-go 속성 기반 deep link 핸들러.
 * - "today" → 오늘 뷰로 이동
 * - "today-scripture" → 오늘 뷰 + 말씀 섹션으로 스크롤
 * - 그 외 viewId → 단순 switchView
 */
function bindDeepLinks(root) {
    root.querySelectorAll('[data-go]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.go;
            handleDeepLink(target);
        });
    });
}

function handleDeepLink(target) {
    if (typeof window.__sanctumSwitchView !== 'function') return;

    if (target === 'today-scripture') {
        window.__sanctumSwitchView('today');
        // view-today 가 렌더되고 보일 때까지 한 프레임 기다린 뒤 스크롤
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                document.getElementById('section-scripture')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
        return;
    }
    window.__sanctumSwitchView(target);
}

// 아바타 배경색 — 인물 카드와 동일 알고리즘
function avatarColor(id) {
    let h = 0;
    const s = id || 'x';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h}, 50%, 80%)`;
}

function escapeAttr(s) { return escapeHtml(s); }

// ─── 4) 숫자로 보기 — 디폴트 접힘 ─────────────────────────
function renderNumberCards(dots, bible, meditationCount) {
    const container = document.getElementById('dashboard-cards');
    if (!container) return;

    const stats = computeDotStats(dots);
    const meditationRate = Math.round((meditationCount / 7) * 100);

    container.innerHTML = `
        <div class="dash-card">
            <h3><i class="dash-icon" data-lucide="footprints"></i> 이번 주 발자국</h3>
            <div class="dash-value">${stats.doneCount + stats.partialCount}<span style="font-size:14px;color:var(--ink-secondary)"> / ${stats.totalSlots}</span></div>
            <p class="dash-desc">지난 7일 동안 남긴 시간 흔적</p>
        </div>

        <div class="dash-card" style="grid-column: 1/-1">
            <h3><i class="dash-icon" data-lucide="book-open"></i> 통독 진도</h3>
            ${renderBibleProgressCard(bible)}
            <button class="dash-card-action" data-go="today-scripture">
                <i data-lucide="arrow-right" class="btn-icon"></i> 오늘의 말씀으로
            </button>
        </div>

        <div class="dash-card">
            <h3><i class="dash-icon" data-lucide="hand"></i> 묵상 한 줄</h3>
            <div class="dash-value">${meditationCount}<span style="font-size:14px;color:var(--ink-secondary)"> / 7일</span></div>
            <p class="dash-desc">${meditationRate}% — 천천히 한 줄씩 이어가요</p>
        </div>

        <div class="dash-card">
            <h3>계획 일치율</h3>
            <div class="dash-value">${stats.matchRate}%</div>
            <p class="dash-desc">계획대로 살아낸 비율</p>
        </div>
        <div class="dash-card">
            <h3>평균 만족도</h3>
            <div class="dash-value">${stats.avgSatisfaction} <span style="font-size:14px;color:var(--text-secondary)">/ 5</span></div>
            <p class="dash-desc">${stats.totalSlots}개 시간</p>
        </div>
        <div class="dash-card">
            <h3>이번 주 흐름</h3>
            <p class="dash-desc" style="margin-top:0; font-size: 13px">
                완료 ${stats.doneCount} · 조금 ${stats.partialCount}<br>
                다른 일 ${stats.replacedCount} · 못함 ${stats.skippedCount}
            </p>
        </div>
    `;
    // 카드 안의 data-go 진입점 (통독 카드의 [오늘의 말씀으로] 등)
    bindDeepLinks(container);
}

function bindNumbersToggle() {
    const toggle = document.getElementById('dash-numbers-toggle');
    const grid = document.getElementById('dashboard-cards');
    if (!toggle || !grid) return;
    toggle.onclick = () => {
        const willOpen = grid.classList.contains('hidden');
        grid.classList.toggle('hidden', !willOpen);
        toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        toggle.innerHTML = willOpen
            ? '<i class="dash-icon" data-lucide="chevron-up"></i> 숫자 접기'
            : '<i class="dash-icon" data-lucide="chevron-down"></i> 숫자로 보기';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
    };
}

// ─── 통독 진도 ────────────────────────────────────────────
// Phase E-8/D: bibleProgress Firestore + 수동 완료 체크는 폐기.
// computePlanProgress(getActivePlan())가 활성 plan + 각 파트 anchor로 자동 계산해서 돌려줌.

function renderBibleProgressCard(bible) {
    if (!bible || bible.parts.length === 0) {
        return `
            <div class="dash-value highlight">0%</div>
            <p class="dash-desc">묵상 계획이 비어있어요. 설정 → 말씀 본문에서 계획을 골라 주세요.</p>
        `;
    }
    if (bible.isEmpty) {
        return `
            <div class="dash-value highlight">0%</div>
            <p class="dash-desc">아직 시작 안 했어요. 오늘부터 한 장씩 시작해 볼까요?</p>
        `;
    }
    const partsHtml = bible.parts.map(p => `
        <div class="bible-part-row">
            <div class="bible-part-row-head">
                <span class="bible-part-name">${escapeHtml(p.label)}</span>
                <span class="bible-part-stat">${p.done} / ${p.total}장 · <strong>${p.percent}%</strong></span>
            </div>
            <div class="bible-part-bar"><div class="bible-part-bar-fill" style="width:${Math.min(100, p.percent)}%"></div></div>
        </div>
    `).join('');

    return `
        <div class="bible-progress-head">
            <div class="dash-value highlight">${bible.percent}%</div>
            <p class="dash-desc">활성 계획 안에서 ${bible.totalDone} / ${bible.totalAll}장 읽었어요</p>
        </div>
        <div class="bible-parts-list">${partsHtml}</div>
    `;
}

// ─── 묵상 작성 횟수 ───────────────────────────────────────
// 사용자별 모든 묵상을 한 번 fetch 후 클라이언트에서 date 범위 필터.
// 묵상은 하루 1건 수준이라 데이터량 작음. composite index 회피.
async function countMeditations(userId, startDate, endDate) {
    try {
        const q = query(
            collection(db, 'meditations'),
            where('userId', '==', userId),
        );
        const snap = await getDocs(q);
        let count = 0;
        snap.docs.forEach(d => {
            const date = d.data().date;
            if (date && date >= startDate && date <= endDate) count++;
        });
        return count;
    } catch (e) {
        console.warn('meditations count failed:', e);
        return 0;
    }
}

// ─── 핀 원칙 ──────────────────────────────────────────────
async function getPinnedPrinciple(dek, userId) {
    try {
        const q = query(
            collection(db, 'principles'),
            where('userId', '==', userId),
            where('pinned', '==', true)
        );
        const snap = await getDocs(q);
        if (snap.docs.length === 0) return null;
        const data = await readDocument(dek, snap.docs[0].data());
        return data.title || null;
    } catch (e) {
        console.warn('pinned principle load failed:', e);
        return null;
    }
}

// ─── S4) 활성 등산로 진척 카드 (2026-05-13 신규) ────────────
function renderActiveWorkflowsCard(workflows) {
    const root = document.getElementById('dashboard-workflows');
    if (!root) return;

    if (!workflows || workflows.length === 0) {
        root.innerHTML = `
            <p class="dash-prose-quiet">
                활성 등산로(워크플로우)가 아직 없어요.
                오늘 화면의 [등산로] 카드에서 만들어 보세요.
            </p>
        `;
        return;
    }

    const rows = workflows.map(wf => {
        const steps = Array.isArray(wf.steps) ? wf.steps : [];
        const total = steps.length || 1;
        const done = steps.filter(s => s.status === 'done').length;
        const pct = Math.round((done / total) * 100);
        return `
            <div class="dash-wf-row">
                <div class="dash-wf-bar"><div class="dash-wf-bar-fill" style="width:${pct}%"></div></div>
                <span class="dash-wf-progress">${done}/${total}</span>
                <span class="dash-wf-title">${escapeHtml(wf.title || '(이름 없는 등산로)')}</span>
            </div>
        `;
    }).join('');

    root.innerHTML = `<div class="dash-wf-list">${rows}</div>`;
}

// ─── S5) 다음 회고 안내 카드 (2026-05-13 신규) ──────────────
function renderNextReviewsCard(dots) {
    const root = document.getElementById('dashboard-next-reviews');
    if (!root) return;

    // 다음 토요일(주간), 다음 월말 토요일(월간), 다음 분기말(3·6·9·12월), 다음 12월말(연간)
    const today = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayName = (d) => ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];

    const nextSaturday = (() => {
        const d = new Date(today);
        const diff = (6 - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        return d;
    })();
    const lastSatOfMonth = (() => {
        const d = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const diff = (d.getDay() - 6 + 7) % 7;
        d.setDate(d.getDate() - diff);
        if (d < today) {
            // 이번 달 마지막 토요일이 이미 지났으면 다음 달 마지막 토요일
            const next = new Date(today.getFullYear(), today.getMonth() + 2, 0);
            const nd = (next.getDay() - 6 + 7) % 7;
            next.setDate(next.getDate() - nd);
            return next;
        }
        return d;
    })();
    const nextQuarterEnd = (() => {
        const quarters = [2, 5, 8, 11]; // 3월(2), 6월(5), 9월(8), 12월(11)
        for (const m of quarters) {
            for (let y = today.getFullYear(); y <= today.getFullYear() + 1; y++) {
                const d = new Date(y, m + 1, 0);
                const diff = (d.getDay() - 6 + 7) % 7;
                d.setDate(d.getDate() - diff);
                if (d >= today) return d;
            }
        }
        return null;
    })();

    const dotsCount = (dots || []).length;
    const rows = [
        { layer: '주간', d: nextSaturday, tab: 'week', highlight: true },
        { layer: '월간', d: lastSatOfMonth, tab: 'month' },
        { layer: '분기', d: nextQuarterEnd, tab: 'quarter' },
    ].filter(r => r.d);

    root.innerHTML = `
        <ul class="dash-next-list">
            ${rows.map(r => `
                <li class="dash-next-row ${r.highlight ? 'dash-next-row-soon' : ''}" data-go="reports:${r.tab}">
                    <i class="dash-next-icon" data-lucide="calendar-days"></i>
                    <span class="dash-next-layer">${r.layer} 회고</span>
                    <span class="dash-next-date">${fmt(r.d)} (${dayName(r.d)})</span>
                    ${r.highlight ? `<span class="dash-next-meta">모인 도트 ${dotsCount}개 미리보기</span>` : ''}
                </li>
            `).join('')}
        </ul>
    `;
}

// ─── S6) 묵상의 결 카드 (2026-05-13 신규) ──────────────────
// 강제 X 스트릭 X — 그저 관찰. "걸어다니는 성경" 정체성.
async function renderMeditationRhythmCard(meditationCount) {
    const root = document.getElementById('dashboard-meditation-rhythm');
    if (!root) return;

    // 7일 점 (이번 주 묵상 일수 만큼만 채움) — 평가/판단 표현 X
    const filled = Math.max(0, Math.min(7, meditationCount || 0));
    const dotsHtml = Array.from({ length: 7 }).map((_, i) =>
        `<span class="dash-medit-dot ${i < filled ? 'filled' : ''}"></span>`
    ).join('');

    root.innerHTML = `
        <div class="dash-medit-row">
            <span class="dash-medit-line">이번 주 묵상 <strong>${filled}일</strong></span>
            <div class="dash-medit-dots" aria-hidden="true">${dotsHtml}</div>
        </div>
        <p class="dash-medit-quiet">오늘의 말씀이 펼쳐져 있어요.</p>
    `;
}

// ─── 카드 헤더 바로가기 chevron 이벤트 위임 (2026-05-13 신규) ───
// data-go="today:section-id" or data-go="reports:week" or data-go="reports"
function bindDashboardQuickNav() {
    const view = document.getElementById('view-dashboard');
    if (!view) return;
    // 한 번만 박힘 — 같은 컨테이너에 다시 위임 시 중복 방지
    if (view.dataset.quicknavBound === '1') return;
    view.dataset.quicknavBound = '1';

    view.addEventListener('click', (e) => {
        const btn = e.target.closest('.dash-card-quicknav, .dash-next-row[data-go]');
        if (!btn) return;
        const target = btn.dataset.go;
        if (!target) return;
        handleDashboardQuickNav(target);
    });
}

function handleDashboardQuickNav(target) {
    if (typeof window.__sanctumSwitchView !== 'function') return;

    // "today:section-workflows" 형태 — view-today 진입 + 해당 섹션으로 스크롤
    if (target.startsWith('today:')) {
        const sectionId = target.slice('today:'.length);
        window.__sanctumSwitchView('today');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                document.getElementById(sectionId)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
        return;
    }

    // "reports:week" — 리포트 메뉴 + 해당 탭 활성화
    if (target.startsWith('reports:')) {
        const tab = target.slice('reports:'.length);
        window.__sanctumSwitchView('reports');
        // 리포트 탭 활성화 — 다음 프레임에 탭 버튼 클릭 시뮬레이션
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                document.querySelector(`.report-tabs .tab-btn[data-tab="${tab}"]`)?.click();
            });
        });
        return;
    }

    // 단순 view 이름
    window.__sanctumSwitchView(target);
}

// ─── utils ────────────────────────────────────────────────
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
