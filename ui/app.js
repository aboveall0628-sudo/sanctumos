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
import { renderOrganizationsView } from './orgCard.js';

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

    reflectSaturdayMenuVisibility();

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
}

/**
 * [저녁 회고] 사이드바 메뉴는 평일엔 숨기고 토요일에만 보임.
 * 매주 토요일에 주 회고가 있고, 마지막 토요일이면 월/분기/연/5·10년이 추가됨.
 */
function reflectSaturdayMenuVisibility() {
    const navEvening = document.getElementById('nav-evening');
    if (!navEvening) return;
    const isSaturday = new Date().getDay() === 6;
    navEvening.classList.toggle('hidden', !isSaturday);
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
    } else if (viewId === 'organizations') {
        renderOrganizationsView(currentUserId);
    }

    // 모바일 사이드바 닫기
    document.getElementById('sidebar')?.classList.remove('open');
    document.body.classList.remove('sidebar-open');
}

// v3-①-D 정식 메뉴 도착 전까지 외부(설정 뷰의 임시 진입 버튼 등)에서 호출하기 위한 노출
window.__sanctumSwitchView = switchView;

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
        await refreshTimeline({ userId: currentUserId, date: currentDate });
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
                reflectGcalAuthUI();
                return;
            }
        }
        reflectGcalAuthUI();
        checkBootState(); // 토큰 만료 또는 없음
    });
}

function gisLoaded() {
    if (typeof google === 'undefined') return;
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
                summary: d.text || '(이름 없는 결단)',
                description: `Sanctum OS 오늘의 결단\nid:${d.id}`,
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
                // 결단에 gcal id 박아두기 (다음에 갱신할 때 사용)
                const dek = (await import('./lockScreen.js')).getDEK();
                if (dek) {
                    const { saveDecision } = await import('../data/decisionsRepo.js');
                    await saveDecision(dek, d);
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
