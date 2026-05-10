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
import { initAuth, showSetupScreen, hideSetupScreen, showGoogleLoginScreen, hideGoogleLoginScreen } from './auth.js';
import { initAutoLock, registerFailedAttempt, isLockoutActive, getLockoutRemainingSec, resetFailedAttempts } from '../security/autoLock.js';
import { logAuditAction } from '../security/auditLog.js';
import { initGlobalErrorHandler } from '../security/errorHandler.js';
import { initQuickReview, showToast } from './quickReview.js';
import { initSensitiveMode } from './sensitiveMode.js';
import { initThemeManager } from './themeManager.js';
import { renderScriptureForDate, loadBibleData as loadBibleDataModule } from './scripture.js';
import { initTodayView, refreshTodayView } from './todayView.js';
import { initTimeline, refreshTimeline } from './timeline.js';
import { runReportChecks } from '../data/reportPipeline.js';
import { initializeSeedData } from '../seeds.js';

// ── UI Views ──
import { renderPrinciplesView } from './principles.js';
import { renderGoalsView } from './goals.js';
import { renderDashboardView } from './dashboard.js';
import { renderReportsView } from './reports.js';
import { renderSettingsView } from './settings.js';
import { renderPastMeditationsView } from './pastMeditations.js';
import { renderPersonsView } from './personCard.js';

// ─── 전역 상태 ───
window.appStarted = true;
let currentUserId = 'anonymous';   // Firebase Auth UID (보안 규칙 매칭용)
let currentUserEmail = null;       // 표시용/로그용
let currentDate = new Date().toISOString().split('T')[0];

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
const GOOGLE_CLIENT_ID = '760231593146-7gkia8st114oiojjgjljjk0rdduhgafl.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'AIzaSyDdQAmIWoKy5z1I6w4BWE3xK9a1ryBZXHQ';
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";
const TOKEN_KEY = 'gcal_token';

// Bible data: ui/scripture.js 모듈로 이전

// ─── 초기화 ───
async function init() {
    // 0. 글로벌 에러 핸들러 (가장 먼저 — 이후 모든 에러를 안전하게 잡기)
    initGlobalErrorHandler();

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

    // 3. 자동 잠금 머신 초기화
    initAutoLock(15);

    // 4. 잠금 해제 이벤트 핸들러
    document.addEventListener('sanctum:unlock-attempt', async (e) => {
        const { password } = e.detail;
        if (isLockoutActive()) {
            showLockError(`잠시 막아둘게요. ${getLockoutRemainingSec()}초 뒤에 다시 해볼까요?`);
            return;
        }

        try {
            const userData = await loadUserVaultData();
            if (!userData) {
                showLockError('계정 정보를 찾을 수 없어요. 한 번 새로고침해 주세요.');
                return;
            }
            const dek = await unlockVault(
                password,
                userData.masterKeySalt,
                userData.wrappedDEK_master,
                userData.wrappedDEK_master_iv,
                userData.kdfParams || null
            );
            setUnlocked(dek);
            resetFailedAttempts();
            logAuditAction(currentUserId, 'unlock_success');
        } catch (e) {
            registerFailedAttempt(currentUserId);
            if (e.message === 'WRONG_PASSWORD') {
                showLockError('비밀번호가 다른 것 같아요.');
            } else {
                showLockError('잠깐 문제가 있었어요. 다시 한 번 해볼까요?');
                console.error(e);
            }
        }
    });

    // 구글 로그인 요청 이벤트
    document.addEventListener('sanctum:request-google-login', handleAuthClick);

    // 4. 평가 모달 & 유틸 + 테마
    initQuickReview({ onSaved: refreshTodayData });
    initSensitiveMode();
    initThemeManager();
    setupNavigation();
    
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
    setBootStatus('✅ 열렸어요', 'ok');
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
    await refreshTimeline({ userId: currentUserId, date: currentDate });

    // 성경 본문 렌더
    renderScriptureForDate(new Date(currentDate + 'T00:00:00')).catch(e =>
        console.warn('scripture render failed:', e)
    );

    // 저녁(18시 이후) 안내 바 트리거
    maybeShowEveningHint();

    // 리포트 자동 생성 체크
    runReportChecks(dek, currentUserId).then(ids => {
        if (ids.length > 0) console.log('Auto-generated reports:', ids);
    });

    showToast('🔓 안전하게 열렸어요');
}

function onVaultLocked() {
    hideMainContent();
    setBootStatus('🔒 잠시 잠겨있어요', 'wait');
}

// 평가 모달 저장 후 호출되는 콜백 — 타임라인+결단 패널 동시 갱신
async function refreshTodayData() {
    if (!currentUserId || !currentDate) return;
    await refreshTimeline({ userId: currentUserId, date: currentDate });
    await refreshTodayView({ userId: currentUserId, date: currentDate });
}

// ─── 저녁 안내 바 (18시 이후 자동 노출) ───
function maybeShowEveningHint() {
    const bar = document.getElementById('evening-hint-bar');
    if (!bar) return;
    const h = new Date().getHours();
    if (h >= 18 || h < 4) {
        bar.classList.remove('hidden');
        document.getElementById('nav-evening')?.classList.add('evening-pulse');
    }
    document.getElementById('evening-hint-start')?.addEventListener('click', () => {
        switchView('evening');
    });
}

// ─── 네비게이션 ───
function setupNavigation() {
    const navMap = {
        'nav-goals': 'goals',
        'nav-today': 'today',
        'nav-evening': 'evening',
        'nav-dashboard': 'dashboard',
        'nav-past': 'past',
        'nav-principles': 'principles',
        'nav-reports': 'reports',
        'nav-settings': 'settings',
    };

    Object.entries(navMap).forEach(([btnId, viewId]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => switchView(viewId));
        }
    });

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
}

function switchView(viewId) {
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
    } else if (viewId === 'goals') {
        renderGoalsView(currentUserId);
    } else if (viewId === 'dashboard') {
        renderDashboardView(currentUserId);
    } else if (viewId === 'reports') {
        renderReportsView(currentUserId);
    } else if (viewId === 'past') {
        renderPastMeditationsView(currentUserId);
    } else if (viewId === 'settings') {
        renderSettingsView(currentUserId, currentUserEmail);
    } else if (viewId === 'persons') {
        renderPersonsView(currentUserId);
    }

    // 모바일 사이드바 닫기
    document.getElementById('sidebar')?.classList.remove('open');
    document.body.classList.remove('sidebar-open');
}

// v3-①-D 정식 메뉴 도착 전까지 외부(설정 뷰의 임시 진입 버튼 등)에서 호출하기 위한 노출
window.__sanctumSwitchView = switchView;

// 핀 원칙 띠는 ui/todayView.js로 이전

// ─── 날짜 ───
function setupDatePicker() {
    const input = document.getElementById('calendar-input');
    if (input) {
        input.value = currentDate;
        input.addEventListener('change', async () => {
            currentDate = input.value;
            updateDateDisplay();
            // 날짜 바뀔 때마다 핀/노트/결단/도트/말씀 모두 갱신
            await refreshTodayView({ userId: currentUserId, date: currentDate });
            await refreshTimeline({ userId: currentUserId, date: currentDate });
            renderScriptureForDate(new Date(currentDate + 'T00:00:00')).catch(() => {});
        });
    }
    updateDateDisplay();
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
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) syncBtn.addEventListener('click', listUpcomingEvents);

    gapiLoaded();
    gisLoaded();
}

function gapiLoaded() {
    if (typeof gapi === 'undefined') return;
    gapi.load('client', async () => {
        await gapi.client.init({ apiKey: GOOGLE_API_KEY, discoveryDocs: DISCOVERY_DOCS });
        gapiInited = true;
        const saved = localStorage.getItem(TOKEN_KEY);
        if (saved) {
            const token = JSON.parse(saved);
            if (token.expires_at > Date.now()) {
                gapi.client.setToken(token);
                await loadUserProfile();
                return;
            }
        }
        checkBootState(); // 토큰 만료 또는 없음
    });
}

function gisLoaded() {
    if (typeof google === 'undefined') return;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
            if (resp.error) return;
            const token = gapi.client.getToken();
            token.expires_at = Date.now() + token.expires_in * 1000;
            localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
            await loadUserProfile();
        },
    });
    gisInited = true;
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
 * Chunk 3에서 통합 타임라인 컴포넌트가 이 함수를 호출해 events 배열을 받음.
 * @returns {Promise<Array>} GCal events
 */
export async function listUpcomingEvents() {
    if (!gapiInited || !gapi.client.getToken()) return [];
    try {
        const [y, m, d] = currentDate.split('-').map(Number);
        const start = new Date(y, m - 1, d, 0, 0, 0).toISOString();
        const end = new Date(y, m - 1, d, 23, 59, 59).toISOString();
        const resp = await gapi.client.calendar.events.list({
            calendarId: 'primary', timeMin: start, timeMax: end,
            showDeleted: false, singleEvents: true, maxResults: 50, orderBy: 'startTime',
        });
        return resp.result.items || [];
    } catch (e) {
        console.error('GCal error:', e);
        return [];
    }
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
