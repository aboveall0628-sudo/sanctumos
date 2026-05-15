/**
 * missionGate.js — 사이드바 잠금 가드 + 진행도 도트 블록 + 미션 안내 모달
 *
 * (본인 프로필 재기획 트랙 2026-05-14 S-C)
 *
 * 합의:
 *  - 잠긴 사이드바 모듈 = 글자 회색 톤 (자물쇠 아이콘 X). 클릭은 가능.
 *  - 클릭하면 미션 안내 모달 — 아이콘 + 제목 + 힌트 + 버튼 2개 ("나중에" / "지금 시작")
 *  - "지금 시작" 누르면 그 모듈의 view 로 그대로 이동 (1차 액션 자리 자동 open 은 후속)
 *  - 진행도 도트 블록 — view-today 머리말 (오늘의 시작 영역 안 맨 위)
 *  - 도트 점 채워짐 ●●●●○○ — 6 미션 (경제 deferred 제외)
 *  - hover/tap 시 미션 title tooltip
 *
 * 단일 출처:
 *  - config/missionCatalog.js (미션 메타)
 *  - data/personRepo.js (isModuleLocked, getOpenMissions, markMissionComplete, getSelfCard)
 *
 * 갱신 흐름:
 *  - 사용자 진입·뷰 전환·미션 클리어 후 refreshMissionGateUI() 호출
 *  - missionStatus 변경 자동 detect 는 후속 (Firestore subscribe). 1차는 명시 갱신.
 */

import { MISSION_CATALOG, getActiveMissionIds, getRecommendedMissions } from '../config/missionCatalog.js';
import { isModuleLocked, getOpenMissions, getSelfCard } from '../data/personRepo.js';

// nav 버튼 id ↔ moduleId 매핑.
//   - 'today', 'self-profile', 'settings', 'economy', 'meditation' 같은 항상 unlocked 모듈은 X
//   - 'dashboard', 'past', 'principles' 는 잠금 가드 없음 (관제탑·지난 묵상·원칙 목록은 빈 페이지 OK)
//   1차 잠금 가드 대상: persons, organizations, reports.
const NAV_LOCK_TARGETS = {
    'nav-persons': 'persons',
    'nav-organizations': 'organizations',
    'nav-reports': 'reports',
};

// 추천 카드 클릭 시 이동할 view 키 — missionId → switchView 키.
//   (S-E 2026-05-15) 미션별로 진입 자리가 다름. moduleId 단순 매핑으로 부족.
//   예: past_meditation_revisit 은 moduleId=meditation 이지만 "지난 묵상" view 로 가야 함.
const ROUTE_BY_MISSION = {
    person_first_dot: 'persons',
    org_first_dot: 'organizations',
    economy_first_transaction: 'economy',
    goal_first_save: 'today',
    decision_first_record: 'today',
    report_first_weekly: 'reports',
    meditation_first_save: 'today',
    past_meditation_revisit: 'past',
    notification_setup: 'settings',
    settings_explore: 'settings',
};

/**
 * 사이드바 잠금 가드 attach — 잠긴 모듈 회색 톤 + 클릭 시 모달.
 *
 *   ui/app.js setupNavigation 의 nav.click 핸들러보다 먼저 호출되어야 함.
 *   기존 핸들러는 그대로 두고, 이 함수가 capture 단계에서 가로채 잠긴 경우 stopPropagation.
 *
 * @param {Function} getCtx - () => ({ dek, userId }) 반환. dek/userId 변동 가능 (잠금 해제·로그인 흐름).
 */
export function attachSidebarLockGuard(getCtx) {
    Object.entries(NAV_LOCK_TARGETS).forEach(([btnId, moduleId]) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.addEventListener('click', async (e) => {
            const ctx = getCtx();
            if (!ctx?.dek || !ctx?.userId) return; // 잠금 해제 전이면 가드 X
            try {
                const locked = await isModuleLocked(ctx.dek, ctx.userId, moduleId);
                if (locked) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    openMissionGateModal(moduleId, ctx);
                }
            } catch (err) {
                console.warn('[missionGate] lock check failed:', err?.message || err);
            }
        }, { capture: true });
    });
}

/**
 * 사이드바 회색 톤 적용 — missionStatus 따라 잠긴 모듈에 `.nav-locked` 클래스.
 *   사용자 진입 / 뷰 전환 / 미션 클리어 후 호출.
 */
export async function refreshSidebarLockStyles(dek, userId) {
    if (!dek || !userId) return;
    for (const [btnId, moduleId] of Object.entries(NAV_LOCK_TARGETS)) {
        const btn = document.getElementById(btnId);
        if (!btn) continue;
        try {
            const locked = await isModuleLocked(dek, userId, moduleId);
            btn.classList.toggle('nav-locked', !!locked);
        } catch (e) {
            // 실패해도 사이드바 자체 동작 끊지 않음
        }
    }
}

/**
 * 미션 안내 모달 — 잠긴 모듈 클릭 시 띄움.
 *   "나중에" → 모달 닫기. "지금 시작" → 해당 모듈 view 로 이동 (switchView 호출).
 *
 * @param {string} moduleId  - 'persons' | 'organizations' | 'reports' 등
 * @param {Object} ctx       - { dek, userId } — 1차엔 사용 X. 후속 카탈로그 외 데이터 노출 시 활용.
 */
export function openMissionGateModal(moduleId, ctx) {
    const entry = Object.entries(MISSION_CATALOG).find(([_, m]) => m.moduleId === moduleId);
    if (!entry) return;
    const [missionId, mission] = entry;

    closeMissionGateModal(); // 기존 모달 있으면 제거

    const backdrop = document.createElement('div');
    backdrop.className = 'mission-gate-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'mission-gate-title');

    backdrop.innerHTML = `
      <div class="mission-gate-modal">
        <div class="mission-gate-icon">${escapeHtml(mission.icon)}</div>
        <h2 class="mission-gate-title" id="mission-gate-title">${escapeHtml(mission.title)}</h2>
        <p class="mission-gate-hint">${escapeHtml(mission.hint)}</p>
        <p class="mission-gate-foot">${escapeHtml(mission.unlockCopy)}</p>
        <div class="mission-gate-actions">
          <button type="button" class="mission-gate-btn mission-gate-btn-secondary" data-action="later">나중에</button>
          <button type="button" class="mission-gate-btn mission-gate-btn-primary" data-action="start">지금 시작</button>
        </div>
        <div class="mission-gate-recommend" id="mission-gate-recommend"></div>
      </div>
    `;

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeMissionGateModal();
    });
    backdrop.querySelector('[data-action="later"]').addEventListener('click', closeMissionGateModal);
    backdrop.querySelector('[data-action="start"]').addEventListener('click', () => {
        closeMissionGateModal();
        // 모듈 view 로 이동 — switchView 는 ui/app.js 가 window 에 노출
        if (typeof window.__sanctumSwitchView === 'function') {
            window.__sanctumSwitchView(moduleId);
        }
    });

    document.body.appendChild(backdrop);
    // ESC 닫기
    backdrop._escHandler = (e) => { if (e.key === 'Escape') closeMissionGateModal(); };
    document.addEventListener('keydown', backdrop._escHandler);

    // 모달 안 "다른 추천 미션" 2개 — 현재 누른 미션 제외, 난이도 오름차순.
    if (ctx?.dek && ctx?.userId) {
        renderRecommendInModal(missionId, ctx.dek, ctx.userId).catch(() => {});
    }
}

/**
 * 모달 안 "다른 추천 미션" 카드 — 현재 누른 missionId 빼고 2개.
 */
async function renderRecommendInModal(currentMissionId, dek, userId) {
    const slot = document.getElementById('mission-gate-recommend');
    if (!slot) return;
    let completedIds;
    try {
        completedIds = await getCompletedMissionIds(dek, userId);
    } catch (_) { return; }
    const completedPlusCurrent = [...completedIds, currentMissionId];
    const recs = getRecommendedMissions(completedPlusCurrent, 2);
    if (!recs.length) {
        slot.innerHTML = '';
        return;
    }
    slot.innerHTML = `
      <div class="mission-gate-rec-head">다른 추천 미션</div>
      <div class="mission-gate-rec-cards">
        ${recs.map(r => `
          <button type="button" class="mission-rc-card mission-rc-card-sm" data-mission-id="${escapeHtml(r.missionId)}">
            <span class="mission-rc-icon">${escapeHtml(r.mission.icon)}</span>
            <span class="mission-rc-title">${escapeHtml(r.mission.title)}</span>
          </button>
        `).join('')}
      </div>
    `;
    slot.querySelectorAll('[data-mission-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mid = btn.getAttribute('data-mission-id');
            closeMissionGateModal();
            routeToMission(mid);
        });
    });
}

export function closeMissionGateModal() {
    const existing = document.querySelector('.mission-gate-backdrop');
    if (!existing) return;
    if (existing._escHandler) document.removeEventListener('keydown', existing._escHandler);
    existing.remove();
}

// ─── 진행도 도트 블록 ───────────────────────────────────────────────

/**
 * view-today 머리말의 미션 진행도 도트 블록 렌더.
 *   active 미션 (deferred 제외) 10개 도트로 그림. ●(완료) ○(미완료).
 *   클릭 시 미션 허브 모달 펼침 (완료/미완료 한 자리에서 회고).
 *
 *   모든 미션 클리어 시 "수료" 카드로 자리 유지 (자동 숨김 X — S-E2 합의).
 *   "다 한 거야? 처음부터 없던 거야?" 구분 가능하게.
 *
 * @param {string} containerId - mount 자리 id
 */
export async function renderMissionProgressBlock(containerId, dek, userId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!dek || !userId) {
        container.innerHTML = '';
        return;
    }

    // (S-E3 2026-05-15) missionId 단위 완료 판단 — moduleId 기준 부정확함 해소.
    let completedIds;
    try {
        completedIds = await getCompletedMissionIds(dek, userId);
    } catch (e) {
        console.warn('[missionGate] getCompletedMissionIds failed:', e?.message || e);
        container.innerHTML = '';
        return;
    }
    const completedSet = new Set(completedIds);

    const activeIds = getActiveMissionIds(); // deferred 제외
    const completedCount = activeIds.filter(mid => completedSet.has(mid)).length;
    const allDone = completedCount >= activeIds.length;

    const dotsHtml = activeIds.map(mid => {
        const m = MISSION_CATALOG[mid];
        const done = completedSet.has(mid);
        const cls = done ? 'mission-dot mission-dot-done' : 'mission-dot';
        const tip = `${m.icon} ${m.title}${done ? ' — 완료' : ` — ${m.hint}`}`;
        return `<span class="${cls}" title="${escapeHtml(tip)}" data-mission-id="${mid}" aria-label="${escapeHtml(tip)}"></span>`;
    }).join('');

    if (allDone) {
        // 수료 카드 — 모든 미션 클리어. 클릭 시 허브 모달로 회고.
        container.innerHTML = `
          <button type="button" class="mission-progress-block mission-progress-graduated" aria-label="튜토리얼 미션 회고 펼치기" id="mission-progress-clickable">
            <span class="mission-progress-label">🎉 ${activeIds.length}/${activeIds.length} 미션 모두 끝났어요</span>
            <span class="mission-progress-dots">${dotsHtml}</span>
            <span class="mission-progress-cta">회고</span>
          </button>
        `;
    } else {
        container.innerHTML = `
          <button type="button" class="mission-progress-block mission-progress-clickable" aria-label="튜토리얼 미션 ${completedCount}/${activeIds.length} — 전체 보기" id="mission-progress-clickable">
            <span class="mission-progress-label">오늘의 미션 ${completedCount}/${activeIds.length}</span>
            <span class="mission-progress-dots">${dotsHtml}</span>
            <span class="mission-progress-cta">전체 보기</span>
          </button>
        `;
    }

    const clickable = container.querySelector('#mission-progress-clickable');
    if (clickable) {
        clickable.addEventListener('click', () => {
            openMissionHubModal(dek, userId).catch(() => {});
        });
    }
}

/**
 * 미션 허브 모달 — 완료/미완료 한 자리에서 회고.
 *   완료 미션: 아이콘 + 제목 + 클리어 날짜 (tutorialState.completedAt)
 *   미완료 미션: 아이콘 + 제목 + 힌트 + [시작] 버튼
 *
 *   (S-E2 2026-05-15) 사용자 명시: "내가 했던 것들을 확인할 자리 자체가 없다"
 */
export async function openMissionHubModal(dek, userId) {
    if (!dek || !userId) return;
    closeMissionHubModal();

    let self;
    try {
        self = await getSelfCard(dek, userId);
    } catch (_) { return; }
    if (!self) return;

    const tutorialState = self.tutorialState || {};
    const missionStatus = self.missionStatus || {};
    const activeIds = getActiveMissionIds();

    // 완료/미완료 분리 + 완료된 건 completedAt 가져오기.
    const done = [];
    const todo = [];
    for (const mid of activeIds) {
        const m = MISSION_CATALOG[mid];
        if (!m) continue;
        const completedAt = tutorialState[mid]?.completedAt
            || (missionStatus[m.moduleId]?.completed ? (missionStatus[m.moduleId].unlockedAt || null) : null);
        if (completedAt || missionStatus[m.moduleId]?.completed) {
            done.push({ missionId: mid, mission: m, completedAt });
        } else {
            todo.push({ missionId: mid, mission: m });
        }
    }
    // 완료는 최신순, 미완료는 난이도 오름차순.
    done.sort((a, b) => {
        const ta = a.completedAt ? Date.parse(a.completedAt) || 0 : 0;
        const tb = b.completedAt ? Date.parse(b.completedAt) || 0 : 0;
        return tb - ta;
    });
    todo.sort((a, b) => {
        const da = a.mission.difficulty ?? 99;
        const db = b.mission.difficulty ?? 99;
        return da - db;
    });

    const completedCount = done.length;
    const total = activeIds.length;
    const allDone = completedCount >= total;

    const doneHtml = done.length
        ? `
          <div class="mission-hub-section">
            <h3 class="mission-hub-section-title">완료한 미션 (${done.length})</h3>
            <ul class="mission-hub-list mission-hub-list-done">
              ${done.map(d => `
                <li class="mission-hub-item mission-hub-item-done">
                  <span class="mission-hub-icon" aria-hidden="true">${escapeHtml(d.mission.icon)}</span>
                  <span class="mission-hub-title">${escapeHtml(d.mission.title)}</span>
                  <span class="mission-hub-date">${formatKoreanDate(d.completedAt)}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        `
        : '';

    const todoHtml = todo.length
        ? `
          <div class="mission-hub-section">
            <h3 class="mission-hub-section-title">남은 미션 (${todo.length}) — 가벼운 순</h3>
            <ul class="mission-hub-list">
              ${todo.map(t => `
                <li class="mission-hub-item">
                  <span class="mission-hub-icon" aria-hidden="true">${escapeHtml(t.mission.icon)}</span>
                  <div class="mission-hub-body">
                    <span class="mission-hub-title">${escapeHtml(t.mission.title)}</span>
                    <span class="mission-hub-hint">${escapeHtml(t.mission.hint)}</span>
                  </div>
                  <button type="button" class="mission-hub-start" data-mission-id="${escapeHtml(t.missionId)}">시작</button>
                </li>
              `).join('')}
            </ul>
          </div>
        `
        : '';

    const graduatedHtml = allDone
        ? `<p class="mission-hub-graduated">🎉 모든 미션을 끝냈어요. 천천히 다시 펼쳐봐도 좋아요.</p>`
        : '';

    const backdrop = document.createElement('div');
    backdrop.className = 'mission-hub-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'mission-hub-title');

    backdrop.innerHTML = `
      <div class="mission-hub-modal">
        <div class="mission-hub-head">
          <h2 class="mission-hub-title" id="mission-hub-title">튜토리얼 미션 ${completedCount}/${total}</h2>
          <button type="button" class="mission-hub-close" aria-label="닫기" data-action="close">×</button>
        </div>
        ${graduatedHtml}
        ${todoHtml}
        ${doneHtml}
        ${(!done.length && !todo.length) ? '<p class="mission-hub-empty">불러올 미션이 없어요.</p>' : ''}
      </div>
    `;

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeMissionHubModal();
    });
    backdrop.querySelector('[data-action="close"]').addEventListener('click', closeMissionHubModal);
    backdrop.querySelectorAll('[data-mission-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mid = btn.getAttribute('data-mission-id');
            closeMissionHubModal();
            routeToMission(mid);
        });
    });

    document.body.appendChild(backdrop);
    backdrop._escHandler = (e) => { if (e.key === 'Escape') closeMissionHubModal(); };
    document.addEventListener('keydown', backdrop._escHandler);
}

export function closeMissionHubModal() {
    const existing = document.querySelector('.mission-hub-backdrop');
    if (!existing) return;
    if (existing._escHandler) document.removeEventListener('keydown', existing._escHandler);
    existing.remove();
}

function formatKoreanDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const m = d.getMonth() + 1;
        const day = d.getDate();
        return `${m}월 ${day}일`;
    } catch (_) { return ''; }
}

/**
 * 사이드바 + 진행도 + 추천 카드 + 사이드바 풋터 한 번에 갱신.
 *   미션 클리어 후 / 뷰 전환 시.
 */
export async function refreshMissionGateUI(dek, userId, progressContainerId, recommendContainerId, sidebarFooterId) {
    await Promise.all([
        refreshSidebarLockStyles(dek, userId),
        progressContainerId
            ? renderMissionProgressBlock(progressContainerId, dek, userId)
            : Promise.resolve(),
        recommendContainerId
            ? renderMissionRecommendCards(recommendContainerId, dek, userId)
            : Promise.resolve(),
        sidebarFooterId
            ? renderSidebarMissionFooter(sidebarFooterId, dek, userId)
            : Promise.resolve(),
    ]);
}

/**
 * 미션 클리어 즉시 UI 갱신 — personRepo.markMissionComplete 가 발화하는
 *   `sanctum:mission-unlocked` 이벤트를 listen 해서 사이드바 회색 톤·진행도·추천·풋터 즉시 갱신.
 *   동시에 조용한 토스트 한 번 노출 ("○○ 미션 완료").
 *
 *   app.js init 시 1회만 호출. getCtx 클로저로 dek/userId 최신값 추적.
 */
export function bindMissionUnlockListener(getCtx, progressContainerId, recommendContainerId, sidebarFooterId) {
    if (typeof window === 'undefined') return;
    if (window.__sanctumMissionUnlockBound) return;
    window.__sanctumMissionUnlockBound = true;
    window.addEventListener('sanctum:mission-unlocked', (e) => {
        // (S-E3 2026-05-15) 토스트 → 중간 카드. "분명하게 보이게" 사용자 명시.
        const missionId = e?.detail?.missionId;
        if (missionId && MISSION_CATALOG[missionId]) {
            showMissionAchievement(MISSION_CATALOG[missionId]);
        }

        const ctx = getCtx();
        if (!ctx?.dek || !ctx?.userId) return;
        // 각 mount 자리가 현재 DOM 에 있을 때만 갱신.
        const hasProgress = !!document.getElementById(progressContainerId);
        const hasRecommend = !!document.getElementById(recommendContainerId);
        const hasFooter = !!document.getElementById(sidebarFooterId);
        refreshMissionGateUI(
            ctx.dek,
            ctx.userId,
            hasProgress ? progressContainerId : null,
            hasRecommend ? recommendContainerId : null,
            hasFooter ? sidebarFooterId : null
        ).catch(() => {});
    });
}

// ─── 추천 미션 카드 (대시보드) ──────────────────────────────────────

/**
 * "다음 해볼 만한 미션" 카드 3개 — 대시보드 도트 블록 바로 아래.
 *   미완료 미션 중 난이도 오름차순. 카드 클릭 → 해당 모듈 view 로 이동.
 *   데스크톱 가로 3개, 모바일 가로 스와이프 캐러셀 (CSS 처리).
 *   모든 미션 클리어 시 영역 자체 숨김.
 */
export async function renderMissionRecommendCards(containerId, dek, userId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!dek || !userId) {
        container.innerHTML = '';
        return;
    }

    let completedIds;
    try {
        completedIds = await getCompletedMissionIds(dek, userId);
    } catch (e) {
        console.warn('[missionGate] getCompletedMissionIds failed:', e?.message || e);
        container.innerHTML = '';
        return;
    }
    const recs = getRecommendedMissions(completedIds, 3);
    if (!recs.length) {
        container.innerHTML = '';
        return;
    }

    const cardsHtml = recs.map(r => `
      <button type="button" class="mission-rc-card" data-mission-id="${escapeHtml(r.missionId)}" aria-label="${escapeHtml(r.mission.title)} 시작">
        <span class="mission-rc-icon" aria-hidden="true">${escapeHtml(r.mission.icon)}</span>
        <span class="mission-rc-title">${escapeHtml(r.mission.title)}</span>
        <span class="mission-rc-hint">${escapeHtml(r.mission.hint)}</span>
        <span class="mission-rc-cta">시작</span>
      </button>
    `).join('');

    container.innerHTML = `
      <div class="mission-recommend-wrap">
        <div class="mission-recommend-head">다음 해볼 만한 미션</div>
        <div class="mission-recommend-cards">${cardsHtml}</div>
      </div>
    `;

    container.querySelectorAll('[data-mission-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mid = btn.getAttribute('data-mission-id');
            routeToMission(mid);
        });
    });
}

// ─── 사이드바 풋터 미니 힌트 ────────────────────────────────────────

/**
 * 사이드바 하단 미니 풋터 — 짧은 한 줄 힌트 3개.
 *   공간 좁아서 아이콘 + 짧은 title 만. 클릭 시 해당 모듈 view 로 이동.
 *   모든 미션 클리어 시 영역 숨김.
 */
export async function renderSidebarMissionFooter(containerId, dek, userId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!dek || !userId) {
        container.innerHTML = '';
        return;
    }

    let completedIds;
    try {
        completedIds = await getCompletedMissionIds(dek, userId);
    } catch (e) {
        container.innerHTML = '';
        return;
    }
    const recs = getRecommendedMissions(completedIds, 3);
    if (!recs.length) {
        container.innerHTML = '';
        return;
    }

    const itemsHtml = recs.map(r => `
      <button type="button" class="sidebar-mission-item" data-mission-id="${escapeHtml(r.missionId)}" title="${escapeHtml(r.mission.title)}" aria-label="${escapeHtml(r.mission.title)}">
        <span class="sidebar-mission-icon" aria-hidden="true">${escapeHtml(r.mission.icon)}</span>
        <span class="sidebar-mission-label">${escapeHtml(r.mission.title)}</span>
      </button>
    `).join('');

    container.innerHTML = `
      <div class="sidebar-mission-footer">
        <div class="sidebar-mission-head">다음 미션</div>
        ${itemsHtml}
      </div>
    `;

    container.querySelectorAll('[data-mission-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mid = btn.getAttribute('data-mission-id');
            routeToMission(mid);
        });
    });
}

// ─── 헬퍼: missionId → view 이동 ────────────────────────────────────

function routeToMission(missionId) {
    const view = ROUTE_BY_MISSION[missionId] || 'today';
    if (typeof window !== 'undefined' && typeof window.__sanctumSwitchView === 'function') {
        window.__sanctumSwitchView(view);
    }
}

// ─── 헬퍼: 완료 missionId 목록 ──────────────────────────────────────

/**
 * selfCard.tutorialState 에서 완료된 missionId 목록 추출.
 *   (S-E3 2026-05-15) tutorialState[missionId] 단일 기준 — missionStatus moduleId fallback 제거.
 *   같은 모듈 두 미션이 한 번에 묶여서 거짓 완료로 잡히는 문제 해결.
 *
 *   사용자가 실제로 트리거 시점을 거치지 않은 미션은 아직 미완료로 표시. 정확함.
 */
async function getCompletedMissionIds(dek, userId) {
    const self = await getSelfCard(dek, userId);
    if (!self) return [];
    const tutorialState = self.tutorialState || {};

    const done = [];
    for (const [missionId, mission] of Object.entries(MISSION_CATALOG)) {
        if (mission.deferred) continue;
        if (tutorialState[missionId]?.completedAt) {
            done.push(missionId);
        }
    }
    return done;
}

// ─── 헬퍼: 미션 클리어 중간 카드 (S-E3 토스트 대체) ──────────────────

/**
 * 미션 클리어 알림 카드 — 화면 위 중앙에 3초 노출.
 *   아이콘 크게 + 제목 + 힌트 + X 닫기 버튼. 3초 후 자동 fade-out.
 *   사용자 명시 (S-E3 2026-05-15) "분명하게 알 수 있는 장치" — 1.5초 토스트로는 부족.
 *
 *   동시 발화 시 element 가 쌓이지 않게 기존 카드 제거 후 새로 띄움.
 */
function showMissionAchievement(mission) {
    if (typeof document === 'undefined') return;
    try {
        // 기존 카드 제거
        document.querySelectorAll('.mission-achievement').forEach(el => el.remove());

        const card = document.createElement('div');
        card.className = 'mission-achievement';
        card.setAttribute('role', 'status');
        card.setAttribute('aria-live', 'polite');
        card.innerHTML = `
          <span class="mission-achievement-icon" aria-hidden="true">${escapeHtml(mission.icon || '🎯')}</span>
          <div class="mission-achievement-body">
            <div class="mission-achievement-head">미션 완료</div>
            <div class="mission-achievement-title">${escapeHtml(mission.title || '')}</div>
            <div class="mission-achievement-hint">${escapeHtml(mission.unlockCopy || '')}</div>
          </div>
          <button type="button" class="mission-achievement-close" aria-label="닫기">×</button>
        `;
        document.body.appendChild(card);
        // 다음 프레임에 .show — 진입 애니메이션
        requestAnimationFrame(() => card.classList.add('show'));

        const dismiss = () => {
            card.classList.remove('show');
            setTimeout(() => card.remove(), 240);
        };
        card.querySelector('.mission-achievement-close').addEventListener('click', dismiss);
        // 3초 자동 닫기
        const autoTimer = setTimeout(dismiss, 3000);
        // 사용자 X 눌렀을 때 타이머 정리
        card.addEventListener('remove', () => clearTimeout(autoTimer), { once: true });
    } catch (_) { /* 알림 실패는 무시 */ }
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
