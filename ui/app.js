/**
 * app.js — Sanctum OS v2.0 진입점
 * 모든 모듈을 연결하고 앱 초기화를 관장합니다.
 */

import {
    db, auth, doc, setDoc, getDoc, getDocs, collection, query, where, serverTimestamp,
    GoogleAuthProvider, signInWithCredential
} from '../data/firebase.js';
import { setupNewVault, unlockVault, recoverWithWords, KDF_PARAMS } from '../crypto/keyManager.js';
import { initLockScreen, setUnlocked, lock, getDEK, isLocked, showLockError, showLockScreen, hideLockScreen } from './lockScreen.js';
import { initAuth, showSetupScreen, hideSetupScreen, showGoogleLoginScreen, hideGoogleLoginScreen } from './auth.js';
import { initAutoLock, registerFailedAttempt, isLockoutActive, getLockoutRemainingSec, resetFailedAttempts } from '../security/autoLock.js';
import { logAuditAction } from '../security/auditLog.js';
import { initQuickReview, showToast } from './quickReview.js';
import { initSensitiveMode } from './sensitiveMode.js';
import { initThemeManager } from './themeManager.js';
import { getDotsByDate } from '../data/dotsRepo.js';
import { runReportChecks } from '../data/reportPipeline.js';
import { initializeSeedData } from '../seeds.js';

// ── UI Views ──
import { renderPrinciplesView } from './principles.js';
import { renderGoalsView } from './goals.js';
import { renderDashboardView } from './dashboard.js';
import { renderReportsView } from './reports.js';
import { renderSettingsView } from './settings.js';

// ─── 전역 상태 ───
window.appStarted = true;
let currentUserId = 'anonymous';   // Firebase Auth UID (보안 규칙 매칭용)
let currentUserEmail = null;       // 표시용/로그용
let currentDate = new Date().toISOString().split('T')[0];
let todayDots = [];

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

// Bible data (from legacy)
const REMOTE_URL = 'https://raw.githubusercontent.com/aboveall0628-sudo/bible-data/refs/heads/main/bible.json';
const DB_NAME = 'BibleAlimiDB';
const STORE_NAME = 'bibleData';
const ANCHOR_DATE = new Date('2026-05-08T00:00:00');
const ANCHOR_INDICES = { 1: 84, 2: 200, 3: 17, 4: 63 };
let bibleData = null;

// ─── 초기화 ───
async function init() {
    setBootStatus('1/5 모듈 초기화 중...');
    // 1. 잠금 화면 (일단 숨김 상태로 초기화)
    initLockScreen({
        onUnlock: onVaultUnlocked,
        onLock: onVaultLocked,
        timeoutMinutes: 15,
        startHidden: true // 부팅 제어권을 app.js가 가짐
    });

    // 2. 인증 모듈 초기화
    initAuth({
        onSetupComplete: (dek) => {
            setUnlocked(dek); // 온보딩 완료 시 자동 잠금해제
        }
    });

    // 3. 자동 잠금 머신 초기화
    initAutoLock(15);

    // 4. 잠금 해제 이벤트 핸들러
    document.addEventListener('sanctum:unlock-attempt', async (e) => {
        const { password } = e.detail;
        if (isLockoutActive()) {
            showLockError(`연속 실패로 잠금 처리되었습니다. ${getLockoutRemainingSec()}초 후 시도하세요.`);
            return;
        }

        try {
            const userData = await loadUserVaultData();
            if (!userData) {
                showLockError('계정을 찾을 수 없어요. 오류가 있습니다.');
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
                showLockError('비밀번호가 맞지 않아요.');
            } else {
                showLockError('오류가 발생했어요.');
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
    setBootStatus('2/5 Google API 로드 중...');
    setupGoogleAuth(); // 여기서 로그인 상태 체크 후 부팅 분기
    setupDatePicker();
    await loadBibleData();
}

// ─── Boot Flow 분기 ───
async function checkBootState() {
    hideMainContent(); // 부팅 단계에선 메인 숨김 — 잠금 해제 시점에만 보임

    if (currentUserId === 'anonymous') {
        hideLockScreen();
        hideSetupScreen();
        showGoogleLoginScreen();
        setBootStatus('3/5 Google 로그인 대기 중', 'wait');
        return;
    }

    hideGoogleLoginScreen();
    setBootStatus('4/5 보관함 조회 중...');

    let userData = null;
    try {
        userData = await loadUserVaultData();
    } catch (e) {
        console.error('[boot] vault read failed:', e);
        const msg = e?.code === 'permission-denied'
            ? 'Firestore 접근 거부 — 규칙 확인 필요'
            : `보관함 조회 실패: ${e?.message || e}`;
        setBootStatus(msg, 'error');
        return;
    }

    if (userData) {
        hideSetupScreen();
        showLockScreen();
        setBootStatus('5/5 잠금 해제 대기 — 비밀번호 입력', 'wait');
    } else {
        hideLockScreen();
        showSetupScreen(currentUserId);
        setBootStatus('5/5 비밀번호 설정 대기', 'wait');
    }
}

// ─── Vault ───
export async function loadUserVaultData() {
    if (currentUserId === 'anonymous') return null;
    const snap = await getDoc(doc(db, 'users', currentUserId));
    return snap.exists() ? snap.data() : null;
}

async function onVaultUnlocked(dek) {
    setBootStatus('✅ 열림', 'ok');
    showMainContent();

    // 시드 데이터 확인
    try { await initializeSeedData(dek, currentUserId); }
    catch (e) { console.warn('seed init failed:', e); }

    // 오늘 데이터 로드
    await refreshTodayData();

    // 저녁(18시 이후) 안내 바 트리거
    maybeShowEveningHint();

    // 리포트 자동 생성 체크
    runReportChecks(dek, currentUserId).then(ids => {
        if (ids.length > 0) console.log('Auto-generated reports:', ids);
    });

    // 핀 원칙 띠 로드
    loadPinnedPrinciple(dek);

    showToast('🔓 안전하게 열렸어요');
}

function onVaultLocked() {
    todayDots = [];
    hideMainContent();
    setBootStatus('🔒 잠김 — 비밀번호 입력', 'wait');
}

// ─── 데이터 새로고침 ───
async function refreshTodayData() {
    const dek = getDEK();
    if (!dek) return;
    todayDots = await getDotsByDate(dek, currentUserId, currentDate);
    // 통합 타임라인 컴포넌트는 Chunk 3에서 todayView.js로 이전 — 임시 placeholder
    renderTimelinePlaceholder();
}

function renderTimelinePlaceholder() {
    const body = document.getElementById('utl-body');
    if (!body) return;
    body.innerHTML = `
        <div class="utl-empty-card">
            <h4>처음이신가요? 이렇게 시작해보세요</h4>
            <ol>
                <li>묵상 노트에 떠오른 것을 적어보세요</li>
                <li>오늘의 결단 한 줄을 입력하세요</li>
                <li>결단 카드의 ⋮⋮를 시간축으로 드래그해서 박으세요</li>
                <li>빈 시간을 클릭하면 시계부를 빠르게 기록할 수 있어요</li>
            </ol>
            <p style="margin-top:12px;font-size:11px;color:var(--text-secondary)">
                (통합 타임라인 컴포넌트는 다음 단계에서 활성화됩니다.)
            </p>
        </div>
    `;
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

    // 모바일 메뉴 토글
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            document.getElementById('sidebar')?.classList.toggle('open');
        });
    }
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
    } else if (viewId === 'settings') {
        renderSettingsView(currentUserId, currentUserEmail);
    }

    // 모바일 사이드바 닫기
    document.getElementById('sidebar')?.classList.remove('open');
}

// ─── 핀 원칙 ───
async function loadPinnedPrinciple(dek) {
    const q = query(
        collection(db, 'principles'),
        where('userId', '==', currentUserId),
        where('pinned', '==', true)
    );
    const snap = await getDocs(q);
    const banner = document.getElementById('pinned-principle-text');
    if (snap.docs.length > 0 && banner) {
        try {
            const { readDocument } = await import('../crypto/cryptoService.js');
            const data = await readDocument(dek, snap.docs[0].data());
            banner.textContent = data.title || '';
            document.getElementById('pinned-principle-banner')?.classList.remove('hidden');
        } catch (e) { /* skip */ }
    }
}

// ─── 성경 데이터 (레거시 보존, Chunk 2에서 ui/scripture.js로 분리 예정) ───
async function loadBibleData() {
    try {
        const cached = await loadFromIndexedDB();
        if (cached) { bibleData = cached; renderScripture(); return; }
    } catch (e) { /* continue */ }

    try {
        if (typeof window.BIBLE_DATA_RAW !== 'undefined') {
            bibleData = window.BIBLE_DATA_RAW;
        } else {
            const res = await fetch(REMOTE_URL);
            bibleData = await res.json();
        }
        saveToIndexedDB(bibleData);
        renderScripture();
    } catch (e) {
        console.error('Bible data load failed:', e);
    }
}

function loadFromIndexedDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => {
            const tx = req.result.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const get = store.get('bible');
            get.onsuccess = () => resolve(get.result || null);
            get.onerror = () => reject();
        };
        req.onerror = () => reject();
    });
}

function saveToIndexedDB(data) {
    const req = indexedDB.open(DB_NAME, 1);
    req.onsuccess = () => {
        const tx = req.result.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, 'bible');
    };
}

function renderScripture() {
    const container = document.getElementById('meditation-content');
    if (!container || !bibleData) return;
    container.innerHTML = '<p style="color:var(--text-secondary)">말씀이 로드되었어요.</p>';
    // Full scripture rendering logic preserved from legacy script.js
}

// ─── 날짜 ───
function setupDatePicker() {
    const input = document.getElementById('calendar-input');
    const display = document.getElementById('current-date-display');
    if (input) {
        input.value = currentDate;
        input.addEventListener('change', () => {
            currentDate = input.value;
            refreshTodayData();
            updateDateDisplay();
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
            setBootStatus('Google 토큰 없음 — 로그인 필요', 'wait');
            checkBootState();
            return;
        }

        setBootStatus('3/5 Google 프로필 가져오는 중...');
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token.access_token}` }
        });
        const profile = await res.json();
        currentUserEmail = profile.email;

        // ── Firebase Auth 자격 증명 (Firestore 보안 규칙 매칭에 필수) ──
        setBootStatus('3/5 Firebase 인증 중...');
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
            setBootStatus(`Firebase 인증 실패 (${code}) — 이메일 fallback`, 'error');
            const status = document.getElementById('user-name');
            if (status) status.textContent = '⚠ 보안 인증 실패';
        }

        const nameEl = document.getElementById('user-name');
        if (nameEl && currentUserId !== currentUserEmail) nameEl.textContent = profile.name;
        const avatarEl = document.getElementById('user-avatar');
        if (avatarEl) { avatarEl.src = profile.picture; avatarEl.style.display = 'block'; }

        checkBootState();
    } catch (e) {
        console.error('Profile load error:', e);
        setBootStatus(`프로필 로드 실패: ${e?.message || e}`, 'error');
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
