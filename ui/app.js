/**
 * app.js — Sanctum OS v2.0 진입점
 * 모든 모듈을 연결하고 앱 초기화를 관장합니다.
 */

import {
    db, auth, doc, setDoc, getDoc, serverTimestamp,
    GoogleAuthProvider, signInWithCredential
} from '../data/firebase.js';
import { setupNewVault, unlockVault, recoverWithWords, KDF_PARAMS } from '../crypto/keyManager.js';
import { initLockScreen, setUnlocked, lock, showLockError, showLockScreen, hideLockScreen } from './lockScreen.js';
import { initAuth, showSetupScreen, hideSetupScreen, showGoogleLoginScreen, hideGoogleLoginScreen, showPasswordMigrationModal } from './auth.js';
import { POLICY_VERSION } from '../crypto/passwordPolicy.js';
import { initAutoLock, registerFailedAttempt, isLockoutActive, getLockoutRemainingSec, resetFailedAttempts, getSavedTimeoutMinutes, saveTimeoutMinutes } from '../security/autoLock.js';
import { logAuditAction } from '../security/auditLog.js';
import { initGlobalErrorHandler } from '../security/errorHandler.js';
import { initQuickReview, showToast } from './quickReview.js';
import { initSensitiveMode } from './sensitiveMode.js';
import { initThemeManager } from './themeManager.js';
import { renderScriptureForDate, loadBibleData as loadBibleDataModule, bindScriptureSettingsListener } from './scripture.js';
import { applyFontSizeToCSS as applyScriptureFontSize } from './scriptureSettings.js';
import { initTodayView, refreshTodayView } from './todayView.js';
import { initTimeline, refreshTimeline, scrollTimelineToNow } from './timeline.js';
// 기존 v2 자동 리포트 생성은 사용자 버튼 트리거로 대체 (reports/dailyReportFlow.js)
import { initializeSeedData } from '../seeds.js';

// ── UI Views ──
import { renderPrinciplesView } from './principles.js';
import { renderGoalsView } from './goals.js';
import { renderDashboardView } from './dashboard.js';
import { renderReportsView } from './reports.js';
import { renderSettingsView } from './settings.js';
import { renderPastMeditationsView } from './pastMeditations.js';
import { renderPersonsView } from './personCard.js';
import { renderOrganizationsView } from './orgCard.js';
import { renderEconomyView, getTodaysTxSummary } from './economy.js';
import { openQuickAdd as openEconomyQuickAdd } from './economyQuickAdd.js';
import { bucketLabel as economyBucketLabel, categoryLabel as economyCategoryLabel } from '../config/economyBuckets.js';
// Phase E-7: 우측 상단 알람 종 + 자동 알람 생성기
import { initRemindersUI, refreshRemindersUI } from './reminders.js';
import { generateAllAutoReminders } from '../data/reminderGenerator.js';
// 단축키 / 모달 매니저 — Phase E-9 (Step 1)
import { initShortcuts } from '../shortcuts/router.js';

// 옛 형식(v1) 데이터를 처음 만난 순간에 한 번만 사용자에게 알림.
// cryptoService.readDocument 가 dispatchEvent 함. 모듈 로드 시 한 번 등록.
window.addEventListener('sanctum:legacy-data-seen', () => {
    // showToast 가 이미 위에서 import 됨
    showToast('🗂️ 옛 형식 데이터가 일부 보여요. 안전하게 읽었어요. 설정에서 한 번에 정리할 수 있어요.');
}, { once: true });

// Phase F: 거래 생성·삭제 통합 이벤트 — 오늘 카드 + 오늘 리포트 거래 블록 동기화
window.addEventListener('sanctum:economy-changed', () => {
    refreshTodayEconomyCard();
    // 오늘 리포트 안의 거래 블록도 갱신
    if (typeof window.__sanctumRefreshTodayReportEconomy === 'function') {
        window.__sanctumRefreshTodayReportEconomy();
    }
});

// ─── 전역 상태 ───
window.appStarted = true;
let currentUserId = 'anonymous';   // Firebase Auth UID (보안 규칙 매칭용)
let currentUserEmail = null;       // 표시용/로그용
// toISOString()은 UTC 기준이라 KST 자정~오전 9시 사이엔 하루 전 날짜를 줌. 로컬 기준으로 계산.
function todayLocalISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
let currentDate = todayLocalISO();

// ─── 부팅 상태 표시기 (사이드바 footer) ───
function setBootStatus(text, level = 'info') {
    console.log(`[boot:${level}]`, text);
    const el = document.getElementById('boot-status');
    if (!el) return;
    el.textContent = text;
    if (level === 'error') {
        el.style.color = 'var(--dot-red, #E5654A)';
        el.style.background = 'rgba(229,101,74,0.08)';
    } else if (level === 'ok') {
        el.style.color = 'var(--dot-green, #6BBF7B)';
        el.style.background = 'transparent';
    } else if (level === 'wait') {
        el.style.color = 'var(--dot-yellow, #F5C84B)';
        el.style.background = 'rgba(245,200,75,0.08)';
    } else {
        el.style.color = 'var(--text-secondary)';
        el.style.background = 'transparent';
    }
}

function showMainContent() {
    document.getElementById('main-content')?.classList.remove('hidden');
}
function hideMainContent() {
    document.getElementById('main-content')?.classList.add('hidden');
}

// Google API globals
let tokenClient;
let gapiInited = false;
let gisInited = false;
// 비로그인 첫 진입 → landing.html 거쳐 ?login=true 로 돌아오면 GIS 준비 직후 자동 로그인 트리거
let _isLoginFlow = false;
const GOOGLE_CLIENT_ID = '760231593146-7gkia8st114oiojjgjljjk0rdduhgafl.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'AIzaSyDdQAmIWoKy5z1I6w4BWE3xK9a1ryBZXHQ';
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";
const TOKEN_KEY = 'gcal_token';

// Bible data: ui/scripture.js 모듈로 이전

/**
 * 비밀번호 관리자(1Password/LastPass/Bitwarden/브라우저 내장 등)가 결단·인물·조직·
 * 묵상 노트 같은 일반 텍스트 input을 비밀번호 필드로 잘못 잡는 걸 막음.
 * 잠금 화면의 진짜 password input(#lock-password-input)은 건드리지 않음.
 */
function disablePasswordManagerOnNonPasswordInputs() {
    const tag = (el) => {
        if (!el || el.tagName !== 'INPUT') return;
        const type = (el.type || 'text').toLowerCase();
        if (type === 'password') return;            // 진짜 비번 input은 통과
        if (el.id === 'lock-password-input') return; // 안전망
        if (el.dataset.pmOff === '1') return;
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('spellcheck', 'false');
        el.setAttribute('data-1p-ignore', '');
        el.setAttribute('data-lpignore', 'true');
        el.setAttribute('data-bwignore', 'true');
        el.dataset.pmOff = '1';
    };

    document.querySelectorAll('input').forEach(tag);
    new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes.forEach(n => {
            if (!n || n.nodeType !== 1) return;
            if (n.tagName === 'INPUT') tag(n);
            n.querySelectorAll && n.querySelectorAll('input').forEach(tag);
        }));
    }).observe(document.body, { childList: true, subtree: true });
}

// ─── 초기화 ───
async function init() {
    // 0-a. 비로그인 첫 진입 가드 — Firebase 세션 없으면 landing.html로
    //      ?login=true 가 붙어 있으면 랜딩에서 돌아온 것이므로 통과 후 자동 로그인 트리거
    const _params = new URLSearchParams(location.search);
    _isLoginFlow = _params.get('login') === 'true';
    if (!_isLoginFlow) {
        const hasAuthSession = Object.keys(localStorage)
            .some(k => k.startsWith('firebase:authUser:'));
        if (!hasAuthSession) {
            location.replace('landing.html');
            return;
        }
    } else {
        // ?login=true 즉시 정리 — 새로고침 시 무한 트리거 방지
        history.replaceState({}, '', location.pathname);

        // Phase E-9/M-1: 카카오톡 등 인앱 webview면 Google OAuth가 막힘 → 안내 모달.
        // 사용자가 외부 브라우저로 옮길 때까지 자동 로그인 트리거를 멈춤.
        if (window.SanctumInApp && window.SanctumInApp.detect()) {
            _isLoginFlow = false;
            try {
                window.SanctumInApp.showGuideModal({
                    targetUrl: location.origin + location.pathname + '?login=true'
                });
            } catch (e) { console.warn('inapp guide failed:', e); }
        }
    }

    // Phase E-9/M-1: service worker 등록 — PWA installable
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW register failed:', e));
    }

    // 0. 글로벌 에러 핸들러 (가장 먼저 — 이후 모든 에러를 안전하게 잡기)
    initGlobalErrorHandler();
    disablePasswordManagerOnNonPasswordInputs();

    setBootStatus('잠깐만요, 준비 중이에요...');
    // 1. 잠금 화면 (일단 숨김 상태로 초기화)
    initLockScreen({
        onUnlock: onVaultUnlocked,
        onLock: onVaultLocked,
        timeoutMinutes: 15,
        startHidden: true // 부팅 제어권을 app.js가 가짐
    });

    // 2. 인증 모듈 초기화
    initAuth({
        onSetupComplete: (dek, opts = {}) => {
            // 사용자 선택을 글로벌에 잠시 보관 → onVaultUnlocked가 시드 호출 시 사용
            window.__sanctumSeedOpts = opts;
            setUnlocked(dek);
        }
    });

    // 3. 자동 잠금 머신 초기화 (사용자가 설정에서 바꾼 분 단위 적용)
    initAutoLock(getSavedTimeoutMinutes());

    // 4. 잠금 해제 이벤트 핸들러
    document.addEventListener('sanctum:unlock-attempt', async (e) => {
        const { password } = e.detail;
        if (isLockoutActive()) {
            showLockError(`잠시 막아둘게요. ${getLockoutRemainingSec()}초 뒤에 다시 해볼까요?`);
            return;
        }

        // Phase E-9/UL-FIX: unlock 흐름 단계별 로그 + 타임아웃 안전망.
        // 어딘가 hang 하면 "여는 중..."에 영원히 stuck — 12초 후 무응답이면 버튼 복구.
        let unlockSucceeded = false;
        const watchdog = setTimeout(() => {
            if (unlockSucceeded) return;
            console.error('[unlock] 12초 응답 없음 — 안전망 발동');
            showLockError('네트워크가 더디네요. 한 번만 더 해볼까요?');
        }, 12000);

        try {
            console.log('[unlock] step 1: loadUserVaultData');
            const userData = await loadUserVaultData();
            if (!userData) {
                showLockError('계정 정보를 찾을 수 없어요. 한 번 새로고침해 주세요.');
                return;
            }
            console.log('[unlock] step 2: unlockVault (PBKDF2)');
            const dek = await unlockVault(
                password,
                userData.masterKeySalt,
                userData.wrappedDEK_master,
                userData.wrappedDEK_master_iv,
                userData.kdfParams || null
            );
            console.log('[unlock] step 3: unlock 성공, 후속 처리');
            unlockSucceeded = true;
            resetFailedAttempts();
            logAuditAction(currentUserId, 'unlock_success');

            // 비밀번호 정책 마이그레이션 체크 (구 정책으로 unlock 성공한 사용자)
            const userPolicyVersion = userData.passwordPolicyVersion || 1;
            if (userPolicyVersion < POLICY_VERSION) {
                showPasswordMigrationModal({
                    dek,
                    userId: currentUserId,
                    onComplete: (migratedDek) => {
                        setUnlocked(migratedDek);
                        logAuditAction(currentUserId, 'password_policy_migrated');
                    }
                });
            } else {
                setUnlocked(dek);
            }
        } catch (err) {
            console.error('[unlock] 실패:', err);
            registerFailedAttempt(currentUserId);
            if (err.message === 'WRONG_PASSWORD') {
                showLockError('비밀번호가 다른 것 같아요.');
            } else {
                showLockError('잠깐 문제가 있었어요. 다시 한 번 해볼까요?');
            }
        } finally {
            clearTimeout(watchdog);
        }
    });

    // 구글 로그인 요청 이벤트
    document.addEventListener('sanctum:request-google-login', handleAuthClick);

    // 4. 평가 모달 & 유틸 + 테마
    initQuickReview({ onSaved: refreshTodayData });
    initSensitiveMode();
    initThemeManager();
    // 말씀 폰트 크기 — localStorage에 저장된 값을 CSS 변수로 박아둠 (잠금 전에도 적용)
    applyScriptureFontSize();
    bindScriptureSettingsListener();
    setupNavigation();
    renderLucideIcons();

    // 5. 부팅 시퀀스 시작
    hideLoading();
    setBootStatus('Google과 연결하는 중이에요...');
    setupGoogleAuth(); // 여기서 로그인 상태 체크 후 부팅 분기
    setupDatePicker();
    // 성경 데이터 사전 로드 (인증 없이도 가능, 캐시 워밍업)
    loadBibleDataModule().catch(e => console.warn('bible preload failed:', e));
}

// ─── Boot Flow 분기 ───
async function checkBootState() {
    hideMainContent(); // 부팅 단계에선 메인 숨김 — 잠금 해제 시점에만 보임

    if (currentUserId === 'anonymous') {
        hideLockScreen();
        hideSetupScreen();
        showGoogleLoginScreen();
        setBootStatus('Google 로그인을 기다리고 있어요', 'wait');
        return;
    }

    hideGoogleLoginScreen();
    setBootStatus('내 보관함을 찾고 있어요...');

    let userData = null;
    try {
        userData = await loadUserVaultData();
    } catch (e) {
        console.error('[boot] vault read failed:', e);
        const msg = e?.code === 'permission-denied'
            ? '보관함 접근 권한이 막혀있어요. 잠시 후 다시 시도해 주세요.'
            : `보관함을 못 가져왔어요: ${e?.message || e}`;
        setBootStatus(msg, 'error');
        return;
    }

    if (userData) {
        hideSetupScreen();
        showLockScreen();
        setBootStatus('비밀번호로 열어주세요', 'wait');
    } else {
        hideLockScreen();
        showSetupScreen(currentUserId);
        setBootStatus('첫 비밀번호를 만들어 볼까요?', 'wait');
    }
}

// ─── Vault ───
export async function loadUserVaultData() {
    if (currentUserId === 'anonymous') return null;
    const snap = await getDoc(doc(db, 'users', currentUserId));
    return snap.exists() ? snap.data() : null;
}

async function onVaultUnlocked(dek) {
    // 잠금 해제 후엔 부팅 상태 표시가 더 이상 필요 없음. 사이드바를 깨끗하게 둠.
    const bootEl = document.getElementById('boot-status');
    if (bootEl) { bootEl.textContent = ''; bootEl.style.display = 'none'; }
    showMainContent();

    // 시드 데이터 확인 (가입 시 사용자 선택을 반영)
    try {
        const seedOpts = window.__sanctumSeedOpts || {};
        await initializeSeedData(dek, currentUserId, seedOpts);
        delete window.__sanctumSeedOpts;
    } catch (e) { console.warn('seed init failed:', e); }

    // 오늘 뷰 컴포넌트 마운트 + 데이터 로드 (핀 원칙 띠, 묵상 노트, 결단 패널)
    initTodayView({ userId: currentUserId, date: currentDate });
    await refreshTodayView({ userId: currentUserId, date: currentDate });

    // 통합 타임라인 마운트 + 데이터 로드 (결단 박힌 슬롯, GCal 일정, 도트)
    initTimeline({
        userId: currentUserId,
        date: currentDate,
        onChange: () => refreshTodayView({ userId: currentUserId, date: currentDate }),
    });
    // 첫 마운트엔 현재 시간이 상단에 오게 자동 스크롤
    await refreshTimeline({ userId: currentUserId, date: currentDate, scrollToNow: true });

    // 대시보드(첫 화면)에 표시될 목표·지표 카드 렌더 — 부팅 직후 빈 화면 방지
    try {
        renderGoalsView(currentUserId);
        renderDashboardView(currentUserId);
    } catch (e) { console.warn('dashboard initial render failed:', e); }

    // 성경 본문 렌더
    renderScriptureForDate(new Date(currentDate + 'T00:00:00')).catch(e =>
        console.warn('scripture render failed:', e)
    );

    // 일간 리포트 자동 생성 제거 — 사용자가 "오늘 리포트 만들기" 버튼으로 직접 트리거
    // (todayView.js / reports/dailyReportFlow.js)

    // Phase E-7: 알람 UI 마운트 + 자동 알람 4종 생성 (background, 실패해도 메인은 안 막힘)
    initRemindersUI(currentUserId).catch(e => console.warn('reminders UI init failed:', e));
    generateAllAutoReminders(dek, currentUserId, currentDate)
        .then((result) => {
            const g = result?.generated || {};
            const total = (g.weekly || 0) + (g.yesterday || 0) + (g.stale || 0) + (g.principle || 0);
            if (total > 0) refreshRemindersUI();
        })
        .catch(e => console.warn('auto reminders failed:', e));

    showToast('🔓 안전하게 열렸어요');

    // 단축키 시스템 — 잠금 해제 후 한 번만 초기화 (router 가 중복 호출 가드)
    try { initShortcuts(); } catch (e) { console.warn('[shortcuts] init failed:', e); }
}

function onVaultLocked() {
    hideMainContent();
    const bootEl = document.getElementById('boot-status');
    if (bootEl) bootEl.style.display = '';
    setBootStatus('🔒 잠시 잠겨있어요', 'wait');
}

// 평가 모달 저장 후 호출되는 콜백 — 타임라인+결단 패널 동시 갱신
async function refreshTodayData() {
    if (!currentUserId || !currentDate) return;
    await refreshTimeline({ userId: currentUserId, date: currentDate });
    await refreshTodayView({ userId: currentUserId, date: currentDate });
    await refreshTodayEconomyCard();
}

// 오늘 화면의 "오늘의 현금흐름" 카드 본문 갱신 (Phase F)
async function refreshTodayEconomyCard() {
    const list = document.getElementById('today-tx-list');
    if (!list || !currentUserId) return;
    try {
        const { list: txs } = await getTodaysTxSummary(currentUserId, currentDate);
        if (!txs || txs.length === 0) {
            list.innerHTML = `<p style="color:var(--ink-secondary); font-size:13px">
                오늘 적은 거래가 여기에 모여요. 위 [거래 한 건] 으로 빠르게 적을 수 있어요.
            </p>`;
            return;
        }
        list.innerHTML = txs.map(t => {
            const sign = t.direction === 'income' ? '+' : '−';
            const dirClass = t.direction === 'income' ? 'econ-tx-in' : 'econ-tx-out';
            const exact = t.exactAmount != null
                ? `<span class="sensitive">${sign}${Number(t.exactAmount).toLocaleString('ko-KR')}원</span>`
                : '';
            const cat = t.category || '';
            const desc = t.description || '';
            return `<div class="today-tx-row ${dirClass}" data-tx-id="${t.id}">
                <span class="today-tx-bucket econ-bucket-${t.amountBucket}">${economyBucketLabel(t.amountBucket) || ''}</span>
                <span class="today-tx-cat">${economyCategoryLabel(cat) || ''}</span>
                <span class="today-tx-desc">${desc}</span>
                <span class="today-tx-exact">${exact}</span>
                <button type="button" class="today-tx-del-btn text-btn" data-id="${t.id}" title="지우기" aria-label="거래 지우기">×</button>
            </div>`;
        }).join('');

        // 삭제 핸들러
        list.querySelectorAll('.today-tx-del-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const txId = btn.dataset.id;
                if (!confirm('이 거래를 지울까요? 되돌릴 수 없어요.')) return;
                try {
                    const repo = await import('../data/economyRepo.js');
                    await repo.deleteTransaction(currentUserId, txId);
                    showToast('거래를 지웠어요');
                    window.dispatchEvent(new CustomEvent('sanctum:economy-changed', { detail: { type: 'delete', id: txId }}));
                } catch (err) {
                    console.error('[economy] today delete failed:', err);
                    showToast('지우는 중에 잠깐 막혔어요.');
                }
            });
        });

        // 행 클릭 → 수정 모달 (X 버튼은 stopPropagation 으로 막힘)
        list.querySelectorAll('.today-tx-row').forEach(row => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                const txId = row.dataset.txId;
                if (!txId) return;
                const tx = txs.find(t => t.id === txId);
                if (!tx) return;
                openEconomyQuickAdd({
                    userId: currentUserId,
                    date: currentDate,
                    editingTx: tx,
                    onSaved: () => refreshTodayEconomyCard(),
                });
            });
        });
    } catch (e) {
        console.warn('[economy] today card refresh failed:', e);
    }
}

// ─── 네비게이션 ───
function setupNavigation() {
    // nav-goals 메뉴는 제거됨 — '나의 목표'는 대시보드 안으로 통합.
    const navMap = {
        'nav-dashboard': 'dashboard',
        'nav-today': 'today',
        'nav-past': 'past',
        'nav-principles': 'principles',
        'nav-reports': 'reports',
        'nav-persons': 'persons',
        'nav-organizations': 'organizations',
        'nav-economy': 'economy',
        'nav-settings': 'settings',
    };

    Object.entries(navMap).forEach(([btnId, viewId]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => switchView(viewId));
        }
    });

    // 오늘 화면의 "거래 한 건" 빠른 추가 (Phase F)
    const addTxBtn = document.getElementById('today-add-tx-btn');
    if (addTxBtn) {
        addTxBtn.addEventListener('click', () => {
            openEconomyQuickAdd({
                userId: currentUserId,
                date: currentDate,
                onSaved: () => refreshTodayEconomyCard(),
            });
        });
    }

    // 모바일 메뉴 토글 (사이드바 + 백드롭)
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            const open = sidebar.classList.toggle('open');
            document.body.classList.toggle('sidebar-open', open);
        });
    }
    // 백드롭(body 가짜 요소) 클릭 시 닫기 — body 클릭 영역 중 사이드바 외 영역
    document.body.addEventListener('click', (e) => {
        if (!document.body.classList.contains('sidebar-open')) return;
        if (sidebar?.contains(e.target) || menuToggle?.contains(e.target)) return;
        sidebar?.classList.remove('open');
        document.body.classList.remove('sidebar-open');
    });

    // 카드 헤더의 [접기/펼치기] 토글 — 이벤트 위임으로 모든 .collapsible-toggle 버튼 처리
    document.body.addEventListener('click', (e) => {
        const toggle = e.target.closest('.collapsible-toggle');
        if (!toggle) return;
        const targetId = toggle.dataset.target;
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (!target) return;
        const willCollapse = !target.classList.contains('collapsed');
        target.classList.toggle('collapsed', willCollapse);
        toggle.textContent = willCollapse ? '펼치기' : '접기';
    });

    // 오늘 뷰 전체 접기/펼치기
    const collapseAllBtn = document.getElementById('today-collapse-all-btn');
    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            const willCollapse = collapseAllBtn.dataset.state !== 'collapsed';
            // 오늘 뷰 안의 모든 카드 본문 + 각 토글 버튼 라벨을 일괄 토글
            const view = document.getElementById('view-today');
            if (!view) return;
            view.querySelectorAll('.collapsible-body').forEach(el => {
                el.classList.toggle('collapsed', willCollapse);
            });
            view.querySelectorAll('.collapsible-toggle').forEach(btn => {
                btn.textContent = willCollapse ? '펼치기' : '접기';
            });
            collapseAllBtn.dataset.state = willCollapse ? 'collapsed' : 'expanded';
            collapseAllBtn.innerHTML = willCollapse
                ? '<i data-lucide="chevrons-up-down" class="btn-icon"></i> 전체 펼치기'
                : '<i data-lucide="chevrons-up-down" class="btn-icon"></i> 전체 접기';
            if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
        });
    }
}

/**
 * Lucide 아이콘 렌더 — index.html 안의 `<i data-lucide="...">` 자리에 SVG를 그림.
 * Lucide 스크립트가 defer 로드라 아직 안 붙어 있을 수도 있어 짧게 재시도.
 */
function renderLucideIcons() {
    const tryRender = () => {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
            return true;
        }
        return false;
    };
    if (tryRender()) return;
    let tries = 0;
    const t = setInterval(() => {
        tries++;
        if (tryRender() || tries > 30) clearInterval(t);
    }, 100);
}
window.__sanctumRenderLucide = renderLucideIcons;

// "저녁 회고" 메뉴는 제거됨 (사용자 결정 2026-05-11).
// 도트 평가는 시간표에서 이미 끝남. 리포트 생성은 오늘 화면의 "오늘 리포트 만들기" 버튼.
// 토요일 추가 회고(주/월/분기/연)는 토요일에만 오늘 화면에 단계별로 버튼이 더 붙음.

// ─── 앱 내 내비 히스토리 (Alt+←/→) ───
// 브라우저 history 와 별개. 시스템 호출(back/forward) 시엔 push 생략.
const _navHistory = [];
let _navIndex = -1;
let _navSilent = false;

function _recordNav(viewId) {
    if (_navSilent) return;
    // 동일 viewId 연속 push 방지
    if (_navHistory[_navIndex] === viewId) return;
    // 현재 인덱스 이후의 forward 항목은 폐기
    _navHistory.length = _navIndex + 1;
    _navHistory.push(viewId);
    _navIndex = _navHistory.length - 1;
    // 메모리 보호 — 최근 50개만
    if (_navHistory.length > 50) {
        _navHistory.shift();
        _navIndex--;
    }
}

window.__sanctumNavHistory = {
    back() {
        if (_navIndex <= 0) return false;
        _navIndex--;
        _navSilent = true;
        switchView(_navHistory[_navIndex]);
        _navSilent = false;
        return true;
    },
    forward() {
        if (_navIndex >= _navHistory.length - 1) return false;
        _navIndex++;
        _navSilent = true;
        switchView(_navHistory[_navIndex]);
        _navSilent = false;
        return true;
    },
};

function switchView(viewId) {
    _recordNav(viewId);

    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    const navBtn = document.getElementById(`nav-${viewId}`);
    if (navBtn) navBtn.classList.add('active');

    // 뷰별 초기화
    if (viewId === 'evening') {
        import('./eveningLoop.js').then(m => m.openEveningLoop(currentUserId, currentDate));
    } else if (viewId === 'principles') {
        renderPrinciplesView(currentUserId);
    } else if (viewId === 'dashboard') {
        // 대시보드 = 나의 목표 + 지표 카드. 둘 다 한 번에 렌더.
        renderGoalsView(currentUserId);
        renderDashboardView(currentUserId);
    } else if (viewId === 'reports') {
        renderReportsView(currentUserId);
    } else if (viewId === 'past') {
        renderPastMeditationsView(currentUserId);
    } else if (viewId === 'settings') {
        renderSettingsView(currentUserId, currentUserEmail);
    } else if (viewId === 'persons') {
        renderPersonsView(currentUserId);
    } else if (viewId === 'organizations') {
        renderOrganizationsView(currentUserId);
    } else if (viewId === 'economy') {
        renderEconomyView(currentUserId);
    }

    // 뷰 전환 직후엔 항상 새 뷰의 최상단에서 시작 (main-content + window 둘 다).
    const main = document.getElementById('main-content');
    if (main) main.scrollTop = 0;
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);

    // '오늘' 뷰는 시간표가 항상 '지금 시간' 근처를 보여주도록 자동 스크롤.
    // utl-body가 화면에 그려진 직후에 호출돼야 scrollTop이 먹힘 → 다음 프레임에 실행.
    if (viewId === 'today') {
        requestAnimationFrame(() => scrollTimelineToNow());
    }

    // 모바일 사이드바 닫기
    document.getElementById('sidebar')?.classList.remove('open');
    document.body.classList.remove('sidebar-open');
}

// v3-①-D 정식 메뉴 도착 전까지 외부(설정 뷰의 임시 진입 버튼 등)에서 호출하기 위한 노출
window.__sanctumSwitchView = switchView;
// 단축키 시스템(registry.js) 이 사용. 이름이 짧고 의미가 명확해서 신규 코드는 이쪽을 사용.
window.__sanctumNav = switchView;

/**
 * "내일 묵상 시작하기" — 오늘 뷰 하단 버튼이 호출.
 * currentDate를 다음 날로 옮기고 묵상 노트로 스크롤 + 포커스.
 */
window.__sanctumGoToNextDay = async function() {
    const d = new Date(currentDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await setCurrentDate(next);
    setTimeout(() => {
        document.getElementById('section-scripture')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('meditation-note')?.focus();
    }, 200);
    showToast('🌅 새 하루를 시작해 봐요');
};

/**
 * (Phase E-8/A) 지난 묵상 카드에서 특정 날짜로 점프.
 * "오늘" 뷰로 전환 + currentDate 변경 + 묵상 노트로 스크롤.
 * dateStr 형식: 'YYYY-MM-DD'.
 */
window.__sanctumGoToDate = async function(dateStr) {
    if (!dateStr) return;
    if (typeof window.__sanctumSwitchView === 'function') window.__sanctumSwitchView('today');
    await setCurrentDate(dateStr);
    setTimeout(() => {
        document.getElementById('section-scripture')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
};

// 핀 원칙 띠는 ui/todayView.js로 이전

// ─── 날짜 ───
function setupDatePicker() {
    const input = document.getElementById('calendar-input');
    if (input) {
        input.value = currentDate;
        input.addEventListener('change', async () => {
            await setCurrentDate(input.value);
        });
    }
    updateDateDisplay();
}

/**
 * 외부(eveningLoop의 "내일 묵상 시작" 버튼 등)에서 날짜를 바꿀 때 사용.
 * date picker 값까지 함께 동기화하고 오늘 뷰의 모든 요소를 다시 그림.
 */
export async function setCurrentDate(dateStr) {
    if (!dateStr) return;
    currentDate = dateStr;
    const input = document.getElementById('calendar-input');
    if (input) input.value = dateStr;
    updateDateDisplay();
    if (currentUserId && currentUserId !== 'anonymous') {
        await refreshTodayView({ userId: currentUserId, date: currentDate });
        // 날짜 변경도 스크롤 리셋 — 새 날짜의 현재 시간(또는 09:00)으로
        await refreshTimeline({ userId: currentUserId, date: currentDate, scrollToNow: true });
    }
    renderScriptureForDate(new Date(currentDate + 'T00:00:00')).catch(() => {});
}

function updateDateDisplay() {
    const display = document.getElementById('current-date-display');
    if (!display) return;
    const d = new Date(currentDate + 'T00:00:00');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    display.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

// ─── Google Auth (레거시 보존) ───
function setupGoogleAuth() {
    const profile = document.getElementById('user-profile-btn');
    if (profile) {
        profile.addEventListener('click', () => {
            if (gapiInited && !gapi.client.getToken()) handleAuthClick();
        });
    }
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) authBtn.addEventListener('click', () => {
        if (gisInited) handleAuthClick();
        else showToast('Google 연결을 준비하는 중이에요. 잠시 후에 다시 눌러 주실래요?');
    });

    gapiLoaded();
    gisLoaded();
}

/**
 * Google 토큰이 활성 상태인가에 따라 툴바 버튼 표시 토글.
 * 로그인 직후 / 토큰 만료 시 호출.
 */
function reflectGcalAuthUI() {
    const hasToken = gapiInited && !!gapi.client.getToken();
    const authBtn = document.getElementById('auth-btn');
    const syncBtn = document.getElementById('sync-btn');
    const pushBtn = document.getElementById('gcal-push-btn');
    if (authBtn) authBtn.classList.toggle('hidden', hasToken);
    if (syncBtn) syncBtn.classList.toggle('hidden', !hasToken);
    if (pushBtn) pushBtn.classList.toggle('hidden', !hasToken);
}
window.__sanctumReflectGcalAuthUI = reflectGcalAuthUI;

// gapi/google 스크립트는 async defer라 app.js 실행 시점엔 아직 안 붙어 있을 수 있다.
// 한 번 보고 없다고 그냥 return하면 부팅이 'Google과 연결하는 중...'에서 영구 멈춤.
// → 최대 ~5초까지 100ms 간격으로 폴링.
const SCRIPT_WAIT_MS = 100;
const SCRIPT_WAIT_MAX_TRIES = 60; // 6초

function gapiLoaded(tries = 0) {
    if (typeof gapi === 'undefined') {
        if (tries < SCRIPT_WAIT_MAX_TRIES) {
            setTimeout(() => gapiLoaded(tries + 1), SCRIPT_WAIT_MS);
        } else {
            setBootStatus('Google API 스크립트를 못 받았어요. 새로고침(Ctrl+Shift+R)해 주실래요?', 'error');
        }
        return;
    }
    gapi.load('client', async () => {
        await gapi.client.init({ apiKey: GOOGLE_API_KEY, discoveryDocs: DISCOVERY_DOCS });
        gapiInited = true;
        const saved = localStorage.getItem(TOKEN_KEY);
        if (saved) {
            const token = JSON.parse(saved);
            if (token.expires_at > Date.now()) {
                gapi.client.setToken(token);
                await loadUserProfile();
                reflectGcalAuthUI();
                return;
            }
        }
        reflectGcalAuthUI();
        checkBootState(); // 토큰 만료 또는 없음
    });
}

function gisLoaded(tries = 0) {
    if (typeof google === 'undefined') {
        if (tries < SCRIPT_WAIT_MAX_TRIES) {
            setTimeout(() => gisLoaded(tries + 1), SCRIPT_WAIT_MS);
        } else {
            setBootStatus('Google 로그인 모듈을 못 받았어요. 새로고침(Ctrl+Shift+R)해 주실래요?', 'error');
        }
        return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
            if (resp.error) { console.warn('GIS callback error:', resp.error); return; }
            const token = gapi.client.getToken();
            token.expires_at = Date.now() + token.expires_in * 1000;
            localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
            await loadUserProfile();
            reflectGcalAuthUI();
            // 새 토큰이 들어왔으니 timeline·오늘 뷰의 GCal 일정을 다시 가져오게
            try { await refreshTodayData(); } catch (e) { console.warn('post-auth refresh failed:', e); }
        },
    });
    gisInited = true;

    // 랜딩에서 돌아온 흐름이면 GIS 준비 직후 자동으로 Google 로그인 모달 발사
    if (_isLoginFlow) {
        _isLoginFlow = false; // 한 번만
        document.dispatchEvent(new CustomEvent('sanctum:request-google-login'));
    }
}

function handleAuthClick() {
    if (!gisInited) return;
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function loadUserProfile() {
    try {
        const token = gapi.client.getToken();
        if (!token) {
            setBootStatus('Google 로그인이 필요해요', 'wait');
            checkBootState();
            return;
        }

        setBootStatus('내 정보 가져오는 중...');
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token.access_token}` }
        });
        const profile = await res.json();
        currentUserEmail = profile.email;

        // ── Firebase Auth 자격 증명 (Firestore 보안 규칙 매칭에 필수) ──
        setBootStatus('안전하게 인증 중...');
        try {
            const credential = GoogleAuthProvider.credential(null, token.access_token);
            const userCred = await signInWithCredential(auth, credential);
            currentUserId = userCred.user.uid;
            window.currentUserId = currentUserId; // auth.js의 recovery flow fallback에서 참조

            // 1회 마이그레이션: 이전에 이메일을 키로 만든 vault doc이 있으면 UID 키로 이전
            await migrateVaultKeyIfNeeded(currentUserEmail, currentUserId);
        } catch (authErr) {
            console.error('Firebase Auth sign-in failed:', authErr);
            // Auth 실패 시 fallback (보안 규칙 효력 없음 — 사용자에게 알림)
            currentUserId = currentUserEmail;
            const code = authErr?.code || 'unknown';
            setBootStatus(`인증에 문제가 있어요 (${code})`, 'error');
            const status = document.getElementById('user-name');
            if (status) status.textContent = '⚠ 인증 문제';
        }

        const nameEl = document.getElementById('user-name');
        if (nameEl && currentUserId !== currentUserEmail) nameEl.textContent = profile.name;
        const avatarEl = document.getElementById('user-avatar');
        if (avatarEl) { avatarEl.src = profile.picture; avatarEl.style.display = 'block'; }

        reflectGcalAuthUI();
        checkBootState();
    } catch (e) {
        console.error('Profile load error:', e);
        setBootStatus(`내 정보를 못 가져왔어요: ${e?.message || e}`, 'error');
        checkBootState();
    }
}

/**
 * 이전 빌드는 이메일을 vault doc 키로 사용했음.
 * Firebase Auth 도입 후 키를 UID로 통일하기 위한 1회성 이전.
 * users/{email} 문서가 있고 users/{uid}가 없으면 복사 후 원본 삭제.
 */
async function migrateVaultKeyIfNeeded(email, uid) {
    if (!email || !uid || email === uid) return;
    try {
        const uidRef = doc(db, 'users', uid);
        const uidSnap = await getDoc(uidRef);
        if (uidSnap.exists()) return; // 이미 UID로 저장됨

        const emailRef = doc(db, 'users', email);
        const emailSnap = await getDoc(emailRef);
        if (!emailSnap.exists()) return; // 이전할 데이터 없음

        await setDoc(uidRef, { ...emailSnap.data(), migratedFromEmail: email, migratedAt: serverTimestamp() });
        // 원본은 보존(롤백 가능). 보안 규칙은 새 UID 키만 매칭하므로 해는 없음.
        console.log(`[vault] migrated key: ${email} → ${uid}`);
    } catch (e) {
        console.warn('Vault key migration skipped:', e);
    }
}

/**
 * 특정 날짜의 Google Calendar 이벤트 가져오기.
 * 통합 타임라인 컴포넌트가 이 함수를 호출해 events 배열을 받음.
 * @returns {Promise<Array>} GCal events
 */
export async function listUpcomingEvents() {
    if (!gapiInited) return [];
    const tok = gapi.client.getToken();
    if (!tok) return [];
    try {
        const [y, m, d] = currentDate.split('-').map(Number);
        const start = new Date(y, m - 1, d, 0, 0, 0).toISOString();
        const end = new Date(y, m - 1, d, 23, 59, 59).toISOString();
        const resp = await gapi.client.calendar.events.list({
            calendarId: 'primary', timeMin: start, timeMax: end,
            showDeleted: false, singleEvents: true, maxResults: 50, orderBy: 'startTime',
        });
        const items = resp.result.items || [];
        console.log(`[gcal] ${currentDate} 일정 ${items.length}건 가져옴`);
        return items;
    } catch (e) {
        const status = e?.result?.error?.code || e?.status;
        console.error('GCal error:', status, e);
        // 401(unauthorized) / 403(token revoked) — 토큰을 비우고 재로그인 유도
        if (status === 401 || status === 403) {
            try { localStorage.removeItem(TOKEN_KEY); } catch {}
            try { gapi.client.setToken(''); } catch {}
            reflectGcalAuthUI();
            showToast('Google 연결이 만료됐어요. [Google 연결]을 다시 한 번 눌러 주실래요?');
        }
        return [];
    }
}

/**
 * 박힌 결단들을 Google Calendar에 (없으면) 만들거나 (있으면) 갱신.
 * 모바일 알림은 기본 reminder(팝업 10분 전)로 자동 옴.
/**
 * Google Calendar 이벤트 1개 삭제. Phase B-3 결단 정리 흐름이 사용.
 * 404(이미 삭제됨) 는 성공으로 간주한다.
 * @param {string} eventId
 * @returns {Promise<{ok:boolean, status?:number, reason?:string}>}
 */
export async function deleteCalendarEventById(eventId) {
    if (!gapiInited || !gapi.client.getToken()) {
        return { ok: false, reason: 'no-token' };
    }
    if (!eventId) return { ok: false, reason: 'no-id' };
    try {
        await gapi.client.calendar.events.delete({
            calendarId: 'primary',
            eventId,
        });
        return { ok: true };
    } catch (e) {
        const status = e?.result?.error?.code || e?.status;
        // 404 = 이미 사라진 이벤트 — 사용자 입장에선 목적 달성. 성공으로 처리.
        if (status === 404 || status === 410) return { ok: true, status };
        console.warn('gcal delete failed:', eventId, status, e);
        return { ok: false, status };
    }
}

/**
 * @param {Array} placedDecisions  timeSlot != null 인 결단들
 * @returns {Promise<{created:number, updated:number, failed:number}>}
 */
export async function pushDecisionsToGoogleCalendar(placedDecisions) {
    if (!gapiInited || !gapi.client.getToken()) {
        return { created: 0, updated: 0, failed: 0, reason: 'no-token' };
    }
    let created = 0, updated = 0, failed = 0;

    const [y, m, day] = currentDate.split('-').map(Number);
    for (const d of placedDecisions) {
        if (d.timeSlot == null) continue;
        try {
            const dur = d.durationSlots || 4;
            const startMin = d.timeSlot * 15;
            const endMin = (d.timeSlot + dur) * 15;
            const startDate = new Date(y, m - 1, day, Math.floor(startMin / 60), startMin % 60, 0);
            const endDate = new Date(y, m - 1, day, Math.floor(endMin / 60), endMin % 60, 0);
            const body = {
                // Phase B: d 는 daily 목표 객체. title 우선, 결단 시절 호환은 fallback.
                summary: (d.title ?? d.text) || '(이름 없는 목표)',
                description: `Sanctum OS 오늘의 목표\nid:${d.id}`,
                start: { dateTime: startDate.toISOString() },
                end: { dateTime: endDate.toISOString() },
                reminders: {
                    useDefault: false,
                    overrides: [{ method: 'popup', minutes: 10 }],
                },
                extendedProperties: {
                    private: { sanctumDecisionId: d.id },
                },
            };

            if (d.gcalEventId) {
                await gapi.client.calendar.events.update({
                    calendarId: 'primary', eventId: d.gcalEventId, resource: body,
                });
                updated++;
            } else {
                const resp = await gapi.client.calendar.events.insert({
                    calendarId: 'primary', resource: body,
                });
                d.gcalEventId = resp.result.id;
                // Phase B: gcal id 를 daily 목표에 박아두기 (다음 갱신 시 update 경로 사용)
                const dek = (await import('./lockScreen.js')).getDEK();
                if (dek) {
                    const { saveGoal } = await import('../data/goalsRepo.js');
                    await saveGoal(dek, d);
                }
                created++;
            }
        } catch (err) {
            console.warn('GCal push failed for', d.id, err);
            failed++;
        }
    }
    return { created, updated, failed };
}

// ─── 로딩 ───
function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.transition = 'opacity 300ms';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    }
}

// ─── 시작 ───
init();
