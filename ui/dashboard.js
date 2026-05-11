/**
 * dashboard.js — 대시보드 뷰 UI
 *
 * 카드 구성:
 * - 🌟 오늘의 발견 (성장 지표 — 영적 톤)
 * - 📖 통독 진도 (4파트, bibleProgress 컬렉션 + scripture.js의 진도 계산)
 * - 🙏 묵상 충실도 (최근 7일 묵상 노트 작성률)
 * - 💚 감사 도트 (최근 7일 spiritual_high)
 * - (고급 — 디폴트 숨김) 일치율 / 평균 만족도 / 실행 분포
 */

import { db, collection, query, where, getDocs, limit } from '../data/firebase.js';
import { getDotsByDateRange, computeDotStats } from '../data/dotsRepo.js';
import { getDEK } from './lockScreen.js';

export async function renderDashboardView(userId) {
    const container = document.getElementById('dashboard-cards');
    if (!container) return;

    const dek = getDEK();
    if (!dek) {
        container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1"><i class="empty-state-icon" data-lucide="lock"></i><h3>잠시 잠겨있어요</h3><p class="empty-state-desc">비밀번호로 열어주세요.</p></div>';
        if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        return;
    }

    container.innerHTML = '<div class="spinner" style="grid-column: 1/-1; margin: 40px auto"></div>';

    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const endDate = fmt(today);
    const past7 = new Date();
    past7.setDate(today.getDate() - 6);
    const startDate = fmt(past7);

    const [dots, bibleProgress, meditationCount] = await Promise.all([
        getDotsByDateRange(dek, userId, startDate, endDate).catch(() => []),
        getBibleProgress(userId).catch(() => []),
        countMeditations(userId, startDate, endDate).catch(() => 0),
    ]);

    const stats = computeDotStats(dots);
    const bible = computeBibleProgress(bibleProgress);
    const meditationRate = Math.round((meditationCount / 7) * 100);

    container.innerHTML = `
        <div class="dash-card" style="grid-column: 1/-1">
            <h3><i class="dash-icon" data-lucide="calendar-days"></i> 주간 히트맵</h3>
            <p class="dash-desc" style="margin-bottom: var(--sp-3)">지난 7일 동안 시간을 어떻게 보냈는지 색으로 보여드릴게요.</p>
            ${renderHeatmap(dots, startDate, endDate)}
        </div>

        <div class="dash-card">
            <h3><i class="dash-icon" data-lucide="footprints"></i> 이번 주 발자국</h3>
            <div class="dash-value">${stats.doneCount + stats.partialCount}<span style="font-size:14px;color:var(--ink-secondary)"> / ${stats.totalSlots}</span></div>
            <p class="dash-desc">지난 7일 동안 남긴 시간 흔적</p>
        </div>

        <div class="dash-card">
            <h3><i class="dash-icon" data-lucide="book-open"></i> 통독 진도</h3>
            <div class="dash-value highlight">${bible.percent}%</div>
            <p class="dash-desc">${bible.detail}</p>
        </div>

        <div class="dash-card">
            <h3><i class="dash-icon" data-lucide="hand"></i> 묵상 한 줄</h3>
            <div class="dash-value">${meditationCount}<span style="font-size:14px;color:var(--ink-secondary)"> / 7일</span></div>
            <p class="dash-desc">${meditationRate}% — 천천히 한 줄씩 이어가요</p>
        </div>

        <div class="dash-card">
            <h3><i class="dash-icon" data-lucide="heart"></i> 감사한 순간</h3>
            <div class="dash-value">${stats.doneCount}</div>
            <p class="dash-desc">계획한 대로 살아낸 시간</p>
        </div>

        <div class="dash-card" style="grid-column: 1/-1; cursor: pointer; opacity: 0.85" id="dash-advanced-toggle">
            <h3><i class="dash-icon" data-lucide="bar-chart-3"></i> 자세히 보기 <i data-lucide="chevron-down" class="btn-icon"></i></h3>
            <p class="dash-desc">숫자 지표는 평소엔 숨겨둬요. 비교에 휘말리지 않도록.</p>
        </div>

        <div id="dash-advanced" class="hidden" style="grid-column: 1/-1; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-4)">
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
        </div>
    `;

    const toggle = document.getElementById('dash-advanced-toggle');
    const advanced = document.getElementById('dash-advanced');
    if (toggle && advanced) {
        toggle.addEventListener('click', () => {
            const isHidden = advanced.classList.toggle('hidden');
            const h3 = toggle.querySelector('h3');
            if (h3) {
                h3.innerHTML = isHidden
                    ? '<i class="dash-icon" data-lucide="bar-chart-3"></i> 자세히 보기 <i data-lucide="chevron-down" class="btn-icon"></i>'
                    : '<i class="dash-icon" data-lucide="bar-chart-3"></i> 다시 닫기 <i data-lucide="chevron-up" class="btn-icon"></i>';
                if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
            }
        });
    }
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

// ─── 주간 히트맵 (7일 × 24시간) ───
function renderHeatmap(dots, startDate, endDate) {
    // 날짜별 시간(0~23)별 도트 평균 만족도 매핑
    const grid = {};
    const days = [];
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = fmt(d);
        days.push(key);
        grid[key] = {};
    }
    dots.forEach(dot => {
        if (!grid[dot.date]) return;
        const hour = Math.floor((dot.timeSlot || 0) / 4);
        if (!grid[dot.date][hour]) grid[dot.date][hour] = [];
        grid[dot.date][hour].push(dot.executionSatisfaction || 0);
    });

    const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];

    let html = '<div class="heatmap-wrap"><div class="heatmap-grid">';
    // 시간 헤더
    html += '<div class="heatmap-corner"></div>';
    for (let h = 0; h < 24; h++) {
        html += `<div class="heatmap-hour-label">${h % 6 === 0 ? String(h).padStart(2, '0') : ''}</div>`;
    }
    // 각 날짜 행
    days.forEach(date => {
        const d = new Date(date + 'T00:00:00');
        html += `<div class="heatmap-day-label">${d.getMonth() + 1}/${d.getDate()} ${dayLabels[d.getDay()]}</div>`;
        for (let h = 0; h < 24; h++) {
            const sats = grid[date][h] || [];
            const avg = sats.length ? sats.reduce((a, b) => a + b, 0) / sats.length : null;
            const cls = avg == null ? 'empty'
                : avg >= 4 ? 'lvl-4'
                : avg >= 3 ? 'lvl-3'
                : avg >= 2 ? 'lvl-2'
                : 'lvl-1';
            const tooltip = avg == null ? '' : `${date} ${h}시: 만족도 ${avg.toFixed(1)} (${sats.length}개)`;
            html += `<div class="heatmap-cell ${cls}" title="${tooltip}"></div>`;
        }
    });
    html += '</div></div>';
    return html;
}

// ─── 통독 진도 ───
async function getBibleProgress(userId) {
    try {
        const q = query(
            collection(db, 'bibleProgress'),
            where('userId', '==', userId),
            limit(2000)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data());
    } catch (e) {
        console.warn('bibleProgress query failed:', e);
        return [];
    }
}

function computeBibleProgress(records) {
    if (!records || records.length === 0) {
        return { percent: 0, detail: '아직 기록이 없어요. 오늘부터 한 장씩 시작해 볼까요?' };
    }
    // 4파트 각각의 완독 비율 평균. completed=true인 것 카운트.
    const partTotals = { 1: 281, 2: 410, 3: 249, 4: 260 }; // scripture.js의 4파트 챕터 수 합계
    const completedByPart = { 1: 0, 2: 0, 3: 0, 4: 0 };

    records.forEach(r => {
        if (r.completed && r.partId && completedByPart[r.partId] !== undefined) {
            completedByPart[r.partId]++;
        }
    });

    const partPercents = [1, 2, 3, 4].map(p => Math.round((completedByPart[p] / partTotals[p]) * 100));
    const overall = Math.round(partPercents.reduce((a, b) => a + b, 0) / 4);
    return {
        percent: overall,
        detail: `시가 ${partPercents[0]}% · 모세+대선지 ${partPercents[1]}% · 역사+소선지 ${partPercents[2]}% · 신약 ${partPercents[3]}%`,
    };
}

// ─── 묵상 작성 횟수 ───
async function countMeditations(userId, startDate, endDate) {
    try {
        const q = query(
            collection(db, 'meditations'),
            where('userId', '==', userId),
            where('date', '>=', startDate),
            where('date', '<=', endDate),
        );
        const snap = await getDocs(q);
        return snap.docs.length;
    } catch (e) {
        console.warn('meditations count failed:', e);
        return 0;
    }
}
