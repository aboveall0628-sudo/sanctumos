/**
 * settings.js — 설정 및 보안 뷰 제어
 * - v1 데이터 진단/마이그레이션
 * - 비밀번호 변경
 * - 전체 데이터 백업
 */

import { diagnoseV1Data } from '../scripts/diagnose-v1-data.js';
import { migrateCollection, downloadJsonSnapshot } from '../scripts/migrate-v1-to-v2.js';
import { exportAllData } from '../security/exportBackup.js';
import { getDEK } from './lockScreen.js';
import { changePassword, unlockVault } from '../crypto/keyManager.js';
import { db, doc, setDoc, getDoc, serverTimestamp } from '../data/firebase.js';
import { logAuditAction } from '../security/auditLog.js';
import { validatePassword, firstError, bindPolicyHint, POLICY_VERSION } from '../crypto/passwordPolicy.js';
import { isEmailRecoveryRegistered, createEmailSlot } from '../crypto/emailRecoverySlot.js';
import { registerEmailRecovery } from '../crypto/emailRecoveryClient.js';
import { auth } from '../data/firebase.js';
// Phase B-3: 예전 결단 정리용
import { getAllDecisions, deleteDecision } from '../data/decisionsRepo.js';
import { deleteCalendarEventById } from './app.js';
// 자동 잠금 분 단위 영속화
import { getSavedTimeoutMinutes, saveTimeoutMinutes } from '../security/autoLock.js';
// Phase E-8/A·B-1·B-2·B-3·C·E: 말씀 본문 표시 설정
import {
    getScriptureSettings, getActivePlan, setFontSize, setActivePlanId,
    getPartOverride, setPartOverride, clearPartOverride,
    getUserPlans, addUserPlan, deleteUserPlan, setShowDailyBibleLink,
    setProgressMode, resetManualProgress,
    FONT_SIZES, PRESETS, applyFontSizeToCSS,
} from './scriptureSettings.js';
import { BIBLE_METADATA, resolvePlanParts, seedManualPositionsFromCalendar } from './scripture.js';
// (2026-05-14 #23 후속) 묵상 템플릿 + 마크다운 에디터
import { getMeditationTemplate, setMeditationTemplate, DEFAULT_TEMPLATE } from './meditationTemplate.js';
import { bindMarkdownEditor, getMarkdown, setMarkdown } from './markdownEditor.js';
// (S-D 후속 2026-05-15) 시스템 폰트 + 성경 번역본 옵션
import { SYSTEM_FONT_SIZES, getSystemFontScale, setSystemFontScale } from '../config/systemFont.js';
import { ACCENT_COLORS, getAccentColor, setAccentColor } from '../config/accentColor.js';
// 베타 슬림 v1 (2026-05-18) — tier 토글
import { TIERS, getTier, setTier } from '../config/featureFlags.js';
// (2026-05-18 후속) 브라우저 알림 권한 상태·요청 + 매일 묵상 시각 자동 발화 재스케줄
import { getNotificationPermission, requestNotificationPermission, scheduleDailyMeditationNotification, triggerNow as triggerNotifNow, clearLastFiredToday } from './notifications.js';
import { BIBLE_VERSIONS, DEFAULT_BIBLE_VERSION } from '../config/onboardingDefaults.js';
import { isSwanAdmin } from '../config/adminConfig.js';
import { ensureSelfCard, saveSelfCard } from '../data/personRepo.js';
// (2026-05-18 v73) FAQ 카탈로그 — SWAN 채팅·설정 안내 두 자리 공통 출처
// (v74) getVisibleFaqs — 슬림 모드에서 slimHidden:true 항목 자연 제외 (분별의 자리 등)
import { FAQ_FALLBACK_HINT_SETTINGS, getVisibleFaqs } from '../config/faqCatalog.js';

let _userId = null;
let _userEmail = null;
let _diagnosticData = null;

// ─── (2026-05-13 HC#1 N7) 매일 묵상 알람 설정 read/write ───
// settings 컬렉션의 spiritualLock 도큐먼트. 평문 필드라 baseRepo 거치지 않고 직접 R/W.
// 사용자별 분리는 users/{uid}/settings/spiritualLock 패턴 (다른 settings 도큐먼트와 일관).
function spiritualLockRef() {
    if (!_userId) throw new Error('userId not set');
    return doc(db, 'users', _userId, 'settings', 'spiritualLock');
}
async function loadDailyAlarmSettings() {
    const snap = await getDoc(spiritualLockRef());
    return snap.exists() ? snap.data() : null;
}
async function saveDailyAlarmSettings({ dailyAlarmEnabled, dailyAlarmTime, birthdayAlarmDays }) {
    const payload = {
        dailyAlarmEnabled,
        dailyAlarmTime,
        updatedAt: serverTimestamp(),
    };
    if (Array.isArray(birthdayAlarmDays)) payload.birthdayAlarmDays = birthdayAlarmDays;
    await setDoc(spiritualLockRef(), payload, { merge: true });
}

export function renderSettingsView(userId, userEmail) {
    _userId = userId;
    _userEmail = userEmail || null;
    injectExtraSections();
    bindSettingsNav();
    bindEvents();
    // v1 식별자 입력란에 이메일 기본값 채우기
    const v1Input = document.getElementById('v1-id-input');
    if (v1Input && _userEmail && !v1Input.value) v1Input.value = _userEmail;
    // 비밀번호 정책 힌트 실시간 바인딩
    bindPolicyHint(
        document.getElementById('pw-new'),
        document.getElementById('pw-new-hint')
    );
    // 이메일 복구 카드 상태 갱신 (비동기)
    refreshEmailRecoveryStatus().catch(err => {
        console.warn('[settings] email recovery status refresh failed:', err);
    });
    // (히든 미션 트랙 v1 2026-05-15) 설정 카드 비동기 갱신.
    //   잠금해제 조건 만족 시 활성 카드로 자동 전환.
    refreshHiddenMissionCard().catch(err => {
        console.warn('[settings] hidden mission card refresh failed:', err);
    });
}

/**
 * 이메일 복구 카드의 현재 상태 텍스트를 users 문서 조회 결과로 갱신.
 */
async function refreshEmailRecoveryStatus() {
    const statusEl = document.getElementById('email-recovery-status-text');
    if (!statusEl || !_userId || _userId === 'anonymous') return;

    try {
        const snap = await getDoc(doc(db, 'users', _userId));
        const data = snap.exists() ? snap.data() : null;
        if (isEmailRecoveryRegistered(data)) {
            const email = data.recoveryEmail || _userEmail || '(이메일 정보 없음)';
            statusEl.innerHTML = `✓ <strong style="color:var(--dot-green)">등록됨</strong> — 비상 시 <strong>${email}</strong> 으로 복구할 수 있어요.`;
            // 등록된 경우 버튼 라벨을 "재등록"으로
            const btn = document.getElementById('btn-email-recovery-register');
            if (btn) btn.textContent = '슬롯 키 회전 (재등록)';
        } else {
            statusEl.innerHTML = '○ 아직 등록되지 않았어요.';
            const btn = document.getElementById('btn-email-recovery-register');
            if (btn) btn.textContent = '이메일 복구 등록하기';
        }
    } catch (err) {
        statusEl.textContent = '상태를 확인하지 못했어요.';
    }
}

/**
 * 이메일 복구 등록 핸들러
 * 흐름: getDEK → createEmailSlot → Cloud Function emailRecoveryRegister → 카드 갱신
 *
 * 보안:
 * - 잠금 해제 상태(DEK 있음)에서만 호출 가능
 * - emailSlotKeyRaw는 Cloud Function 전송 후 즉시 변수 폐기
 * - 서버는 그 키를 KMS로 wrap한 후 즉시 폐기 (코드 내 logger도 키는 안 찍음)
 */
async function handleEmailRecoveryRegister() {
    const btn = document.getElementById('btn-email-recovery-register');
    const errEl = document.getElementById('email-recovery-error');
    if (errEl) errEl.textContent = '';

    const dek = getDEK();
    if (!dek) {
        if (errEl) errEl.textContent = '잠금이 풀려 있어야 등록할 수 있어요.';
        return;
    }

    const user = auth.currentUser;
    const recoveryEmail = user?.email;
    if (!recoveryEmail) {
        if (errEl) errEl.textContent = 'Google 로그인 이메일을 확인할 수 없어요.';
        return;
    }

    const originalLabel = btn?.textContent || '이메일 복구 등록하기';
    if (btn) { btn.disabled = true; btn.textContent = '등록 중...'; }

    let emailSlotKeyRaw = null;
    try {
        const slot = await createEmailSlot(dek);
        emailSlotKeyRaw = slot.emailSlotKeyRaw;

        await registerEmailRecovery({
            emailSlotKey: emailSlotKeyRaw,
            wrappedDEK_email: slot.wrappedDEK_email,
            wrappedDEK_email_iv: slot.wrappedDEK_email_iv,
            recoveryEmail,
        });

        // 카드 갱신
        await refreshEmailRecoveryStatus();
        const { showToast } = await import('./quickReview.js');
        showToast('이메일 복구 등록 완료 ✓', 1800);
    } catch (e) {
        console.error('[settings] email recovery register failed:', e);
        const msg = e?.message || '등록에 실패했어요.';
        if (errEl) errEl.textContent = `등록 실패: ${msg}`;
        if (btn) btn.textContent = originalLabel;
    } finally {
        // emailSlotKeyRaw 메모리 폐기 (GC 의존)
        emailSlotKeyRaw = null;
        if (btn) btn.disabled = false;
    }
}

/**
 * index.html에 정의되지 않은 추가 카드(비밀번호 변경, v1 식별자 입력)를 동적 주입
 * 한 번만 주입.
 *
 * (2026-05-18 설정 카드 메뉴 정리 트랙) 옵션 A 카테고리 묶음.
 *   - index.html 의 .settings-group 7 자리(보이는 방식·묵상 자리·보안·복구·모드·진입·정리·더보기·운영)
 *     안의 .settings-group-body 로 카드를 분기해 넣음.
 *   - 그룹이 없으면(테스트·구버전) 컨테이너 끝에 폴백 append.
 *   - 슬림 모드 분기는 그룹 단위 data-slim="hidden" 으로 처리, 개별 카드는 손대지 않음.
 */
function appendToGroup(groupBodyId, card, containerFallback) {
    const body = document.getElementById(groupBodyId);
    if (body) body.appendChild(card);
    else if (containerFallback) containerFallback.appendChild(card);
}

/**
 * (2026-05-18 v69) 사이드바 설정 nav ↔ 우측 그룹 동기화.
 *   - v68 우측 별도 nav 폐기 → 사이드바 자체가 설정 nav 으로 변신 (data-mode="settings").
 *   - 클릭 시 active 토글 + 우측 그룹 active 토글.
 *   - 초기 활성 = 첫 visible nav 항목 (슬림이면 안내까지 4 자리 중 첫).
 *   - 이벤트는 nav 자체에 한 번만 매달리도록 dataset.bound 가드.
 */
function bindSettingsNav() {
    const nav = document.querySelector('.sidebar-settings-nav');
    const pane = document.getElementById('settings-pane');
    if (!nav || !pane) return;

    const isNavItemVisible = (item) => {
        if (item.hidden) return false;
        const slimMode = document.documentElement.dataset.tier === 'slim';
        if (slimMode && item.dataset.slim === 'hidden') return false;
        return true;
    };

    const activate = (targetId) => {
        nav.querySelectorAll('.sidebar-settings-item').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.target === targetId);
        });
        pane.querySelectorAll('.settings-group').forEach((group) => {
            group.classList.toggle('active', group.id === targetId);
        });
    };

    if (!nav.dataset.bound) {
        nav.addEventListener('click', (e) => {
            const btn = e.target.closest('.sidebar-settings-item');
            if (!btn || !nav.contains(btn)) return;
            if (!isNavItemVisible(btn)) return;
            const targetId = btn.dataset.target;
            if (!targetId) return;
            activate(targetId);
        });
        nav.dataset.bound = '1';
    }

    // 초기 활성 — 이미 active 가 자리잡혔으면 유지, 없으면 첫 visible 항목
    const current = nav.querySelector('.sidebar-settings-item.active');
    if (current && isNavItemVisible(current)) {
        activate(current.dataset.target);
    } else {
        const firstVisible = Array.from(nav.querySelectorAll('.sidebar-settings-item'))
            .find(isNavItemVisible);
        if (firstVisible) activate(firstVisible.dataset.target);
    }
}

function injectExtraSections() {
    const container = document.getElementById('settings-container');
    if (!container || document.getElementById('settings-extra-injected')) return;

    // (B-4 본인 프로필 트랙 2026-05-13) "내 프로필" 진입 카드.
    //   v68 윈도우 설정 스타일에서는 nav 첫 항목 = 내 프로필 그룹 안 카드로 합류.
    //   사이드바에도 진입 자리가 있으니 슬림 모드에서는 nav·그룹 자체가 자연 숨김.
    if (!document.getElementById('settings-self-profile-card')) {
        const selfCard = document.createElement('div');
        selfCard.id = 'settings-self-profile-card';
        selfCard.className = 'card-section';
        selfCard.innerHTML = `
            <h3 class="section-title"><i class="section-icon" data-lucide="user-circle"></i> 내 프로필</h3>
            <p class="section-desc">
                "나는 누구인가" 한 자리에 모아두는 카드예요. 5년·10년 회고의 기준점이 됩니다.
                필드별로 공개 두께(🌍 공개 / 🤝 친한 사이 / 🔒 비공개)도 함께 정해두실 수 있어요.
            </p>
            <button id="btn-open-self-profile" class="primary-btn" style="margin-top:8px;">
                <i data-lucide="user-circle" class="btn-icon"></i> 내 프로필 열기
            </button>
        `;
        appendToGroup('settings-group-body-profile', selfCard, container);
    }

    // 진단 카드 안에 v1 식별자 입력 추가
    const diagBox = document.getElementById('migration-status-box');
    if (diagBox && !document.getElementById('v1-id-input')) {
        const idRow = document.createElement('div');
        idRow.style.cssText = 'margin: 12px 0; display: flex; gap: 8px; align-items: center;';
        idRow.innerHTML = `
            <label style="font-size:12px;color:var(--text-secondary);min-width:120px;">v1에서 사용한 식별자</label>
            <input id="v1-id-input" type="text" placeholder="이메일 또는 UID"
                   style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text-primary);font-size:13px;" />
        `;
        diagBox.parentNode.insertBefore(idRow, diagBox.nextSibling);
    }

    // (S-D 후속 2026-05-15) 시스템 글자 크기 카드 — <html data-system-font> 4단계.
    //   온보딩 모달에서 처음 박힘. 설정에서 언제든 다시 조정.
    const systemFontCard = document.createElement('div');
    systemFontCard.id = 'settings-system-font-card';
    systemFontCard.className = 'card-section';
    systemFontCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="type"></i> 시스템 글자 크기</h3>
        <p class="section-desc">
            헤더·카드·라벨 같은 시스템 글자 크기예요. 성경 본문 글자 크기는 따로(아래 "말씀 본문") 정하실 수 있어요.
        </p>
        <div id="settings-system-font-row" class="settings-font-chip-row"></div>
    `;
    appendToGroup('settings-group-body-appearance', systemFontCard, container);

    // (디자인 시스템 v1 2026-05-15) 강조 색 카드 — 3색 (올리브·베이지·라벤더) 사용자 선택.
    //   <html data-accent="..."> + style.css [data-accent] 분기로 라이브 전환.
    //   디폴트 = 올리브 (디자인 시스템 추천). 라이트·다크 둘 다 자연 적응.
    const accentColorCard = document.createElement('div');
    accentColorCard.id = 'settings-accent-color-card';
    accentColorCard.className = 'card-section';
    accentColorCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="palette"></i> 강조 색</h3>
        <p class="section-desc">
            앱 안에서 강조 자리(버튼·링크·활성 메뉴)에 사용되는 한 가지 색이에요. 마음에 머무는 톤으로 고르실 수 있어요.
        </p>
        <div id="settings-accent-color-row" class="settings-font-chip-row"></div>
    `;
    appendToGroup('settings-group-body-appearance', accentColorCard, container);

    // (베타 슬림 v1 2026-05-18) tier 토글 카드 — 6 화면 루프만 보이는 모드.
    //   (v73 2026-05-18) 운영자 카테고리로 이동. 운영자 전용 분기 자리 일관성.
    if (isSwanAdmin(_userId)) {
        const tierCard = document.createElement('div');
        tierCard.id = 'settings-tier-card';
        tierCard.className = 'card-section';
        tierCard.innerHTML = `
            <h3 class="section-title"><i class="section-icon" data-lucide="layers"></i> 베타 / 전체 모드</h3>
            <p class="section-desc">
                베타는 핵심 6 화면(묵상 → 다짐 → 시간표 → 했/안함 → 주간 거울)만, 전체는 도트·인물·가계부·의사결정까지 같이 보여요. 베타 사용자에겐 이 카드 자체가 안 보여요.
            </p>
            <div id="settings-tier-row" class="settings-tier-row"></div>
        `;
        appendToGroup('settings-group-body-admin', tierCard, container);
    }

    // (S-D 후속 2026-05-15) 성경 번역본 안내 카드 — 본문 데이터는 개역개정 단일.
    //   다른 번역본은 자리만 노출 ("준비 중"). 가입 시 selfCard.bibleVersion 박힘.
    const bibleVersionCard = document.createElement('div');
    bibleVersionCard.id = 'settings-bible-version-card';
    bibleVersionCard.className = 'card-section';
    bibleVersionCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="book-open"></i> 성경 번역본</h3>
        <p class="section-desc">
            지금은 개역개정으로 만나실 수 있어요. 다른 번역본도 곧 준비 중이에요. 준비 끝나면 알림으로 알려드릴게요.
        </p>
        <div id="settings-bible-version-list" class="settings-bible-list"></div>
    `;
    appendToGroup('settings-group-body-meditation', bibleVersionCard, container);

    // 말씀 본문 카드 (Phase E-8/A) — 폰트 크기 + 표시할 파트 on/off
    const scriptureCard = document.createElement('div');
    scriptureCard.id = 'settings-scripture-card';
    scriptureCard.className = 'card-section';
    scriptureCard.innerHTML = renderScriptureSettingsHTML();
    appendToGroup('settings-group-body-meditation', scriptureCard, container);

    // (2026-05-14 #23 후속) 묵상 템플릿 카드 — settings/spiritualLock 의 meditationTemplate 필드.
    //   사용자가 자유 markdown 입력. {{scripture}} 마커 위치에 절 본문 삽입.
    //   미설정 시 default '{{scripture}}' = 절 본문만 (현재 동작).
    const templateCard = document.createElement('div');
    templateCard.id = 'settings-meditation-template-card';
    templateCard.className = 'card-section';
    templateCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="layout-template"></i> 묵상 템플릿</h3>
        <p class="section-desc">
            매일 묵상 노트가 처음 열릴 때 자동으로 깔리는 양식이에요. 묵상 노트와 같은 에디터(볼드·H1~3·가로줄·단축키)로 적으실 수 있어요.<br>
            <strong>📖 말씀 본문</strong> 칩 자리에 "오늘의 말씀"에서 골라 붙여넣은 절 본문이 들어가요. 칩이 없으면 본문은 노트 끝에 붙어요.
        </p>
        <div id="meditation-template-input" class="note-editor settings-template-editor"
             contenteditable="true" spellcheck="false"
             data-placeholder='예: 오늘의 호흡 한 줄 / 📖 말씀 본문 칩 넣기 / 묵상 한 단락 / 기도 한 줄'></div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
            <button id="btn-insert-scripture-marker" class="text-btn" type="button">📖 말씀 본문 자리 넣기</button>
            <button id="btn-save-meditation-template" class="primary-btn" type="button">템플릿 저장</button>
            <button id="btn-reset-meditation-template" class="text-btn" type="button">기본값으로</button>
            <span id="meditation-template-status" style="font-size:12px;color:var(--text-secondary);"></span>
        </div>
        <p class="section-desc-foot" style="margin-top:12px;">
            ※ "오늘의 말씀"에서 절 선택 → "묵상 노트에 붙여넣기" 누르시면 <strong>📖 말씀 본문</strong> 칩 자리에 자동 삽입돼요. (칩 없으면 끝에 추가)
        </p>
    `;
    appendToGroup('settings-group-body-meditation', templateCard, container);

    // (2026-05-14 본인 프로필 재기획 S-D 후속) 처음 안내 다시 보기 카드.
    //   가입할 때 한 번만 뜨는 4 step 온보딩 모달(이름·별명·생일·묵상 수준)을
    //   설정에서 언제든 다시 열 수 있는 자리예요.
    //   대부분 안 봐도 괜찮은 자리지만, 친구한테 보여줄 때나 톤·수준을 다시 점검할 때 유용해요.
    const onboardingReplayCard = document.createElement('div');
    onboardingReplayCard.id = 'settings-onboarding-replay-card';
    onboardingReplayCard.className = 'card-section';
    onboardingReplayCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="sparkles"></i> 처음 안내 다시 보기</h3>
        <p class="section-desc">
            가입할 때 한 번 보였던 안내 화면이에요. 이름·별명·생일·묵상 수준을 다시 살펴보거나,
            궁금한 친구분께 흐름을 보여드릴 때 열어보실 수 있어요.
        </p>
        <button id="btn-replay-onboarding" class="primary-btn" type="button" style="margin-top:8px;">
            <i data-lucide="play-circle" class="btn-icon"></i> 다시 보기
        </button>
    `;
    appendToGroup('settings-group-body-modes', onboardingReplayCard, container);

    // (2026-05-18 v73) 자주 묻는 질문 (FAQ) 카드 — 같은 카탈로그가 SWAN 채팅 안에도 노출.
    //   아코디언 형식 — 질문 클릭 시 답 펼침. 답에 없는 질문은 우하단 풍선(SWAN) 으로.
    const faqCard = document.createElement('div');
    faqCard.id = 'settings-faq-card';
    faqCard.className = 'card-section';
    faqCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="help-circle"></i> 자주 묻는 질문</h3>
        <p class="section-desc">
            베타 사용자들이 자주 묻는 질문을 한 자리에 모았어요. 질문을 누르시면 답이 펼쳐져요.
        </p>
        <ul class="settings-faq-list" id="settings-faq-list">
            ${getVisibleFaqs().map(f => `
                <li class="settings-faq-item">
                    <button type="button" class="settings-faq-question" data-faq-id="${escapeHtmlInline(f.id)}" aria-expanded="false">
                        <span class="settings-faq-q-text">${escapeHtmlInline(f.question)}</span>
                        <i class="settings-faq-chevron" data-lucide="chevron-down"></i>
                    </button>
                    <div class="settings-faq-answer" data-faq-answer-for="${escapeHtmlInline(f.id)}" hidden>
                        ${escapeHtmlInline(f.answer)}
                    </div>
                </li>
            `).join('')}
        </ul>
        <p class="section-desc-foot" style="margin-top:12px;">
            ${escapeHtmlInline(FAQ_FALLBACK_HINT_SETTINGS)}
        </p>
    `;
    appendToGroup('settings-group-body-modes', faqCard, container);

    // (2026-05-13 HC#1 N7) 매일 묵상 알람 카드 — 1개 시각, 인앱 종 빨간 점.
    // spiritualLock 도큐먼트의 dailyAlarmEnabled + dailyAlarmTime 사용.
    const dailyAlarmCard = document.createElement('div');
    dailyAlarmCard.id = 'settings-daily-alarm-card';
    dailyAlarmCard.className = 'card-section';
    dailyAlarmCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="bell-ring"></i> 매일 묵상 알람</h3>
        <p class="section-desc">
            매일 정해진 시각에 우측 상단 종에 빨간 점이 켜져요. 묵상하기로 약속한 시간에 시스템이 살짝 알려줘요.
        </p>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="daily-alarm-toggle" />
                <span>매일 알람 켜기</span>
            </label>
            <input type="time" id="daily-alarm-time" value="20:00"
                   style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text-primary);font-size:14px;" />
            <button id="btn-save-daily-alarm" class="text-btn">저장</button>
            <span id="daily-alarm-status" style="font-size:12px;color:var(--text-secondary);"></span>
        </div>
        <!-- (2026-05-18 후속) 브라우저 알림 권한 자리 -->
        <div id="notif-permission-row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line, #e4e0d8);">
            <span style="font-size:13px;color:var(--ink-secondary, #6a6a6a);">
                📣 브라우저 알림 권한:
            </span>
            <span id="notif-permission-status" style="font-size:13px;font-weight:600;">확인 중...</span>
            <button id="btn-enable-notif" class="text-btn" style="display:none;">알림 허용하기</button>
            <button id="btn-test-notif" class="text-btn" style="display:none;">🔔 지금 한 번 테스트</button>
        </div>
        <p style="font-size:12px;color:var(--ink-secondary, #6a6a6a);margin:8px 0 0;line-height:1.55;">
            허용하시면 정한 시각에 OS 알림으로도 보여드려요. PWA(홈 화면에 추가)하시면 더 잘 작동해요.
            <br>※ 1차 베타엔 앱이 열려 있어야 작동해요. 진짜 백그라운드 푸시는 곧 준비할게요.
        </p>
    `;
    appendToGroup('settings-group-body-meditation', dailyAlarmCard, container);

    // (#58 후속 2026-05-14) 생일 알람 카드 — 며칠 전 발화할지 체크박스 4개
    const birthdayAlarmCard = document.createElement('div');
    birthdayAlarmCard.id = 'settings-birthday-alarm-card';
    birthdayAlarmCard.className = 'card-section';
    birthdayAlarmCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="cake"></i> 생일 알람</h3>
        <p class="section-desc">
            내 사람(innerCircle) 인물 카드 + 본인 카드 + "🎂 생일 알람 받기" 켠 인물의 생일이 다가오면 알람이 와요.
            음력 생일은 자동으로 양력 변환돼요. 며칠 전부터 알람을 받을지 고르세요.
        </p>
        <div class="birthday-alarm-day-grid">
            <label class="birthday-alarm-day-chip">
                <input type="checkbox" class="bd-alarm-day" value="7" />
                <span>7일 전</span>
            </label>
            <label class="birthday-alarm-day-chip">
                <input type="checkbox" class="bd-alarm-day" value="3" />
                <span>3일 전</span>
            </label>
            <label class="birthday-alarm-day-chip">
                <input type="checkbox" class="bd-alarm-day" value="1" />
                <span>1일 전</span>
            </label>
            <label class="birthday-alarm-day-chip">
                <input type="checkbox" class="bd-alarm-day" value="0" />
                <span>당일</span>
            </label>
        </div>
        <div style="margin-top:12px;display:flex;gap:12px;align-items:center;">
            <button id="btn-save-birthday-alarm" class="text-btn">저장</button>
            <span id="birthday-alarm-status" style="font-size:12px;color:var(--text-secondary);"></span>
        </div>
    `;
    appendToGroup('settings-group-body-meditation', birthdayAlarmCard, container);

    // 비밀번호 변경 카드
    const pwCard = document.createElement('div');
    pwCard.id = 'settings-extra-injected';
    pwCard.className = 'card-section';
    pwCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="key-round"></i> 비밀번호 바꾸기</h3>
        <p class="section-desc">기존 데이터는 그대로 둔 채로 안전하게 비밀번호만 바꿔요. 다시 로그인할 필요 없어요.</p>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:360px;">
            <input id="pw-old" type="password" placeholder="지금 쓰는 비밀번호" autocomplete="current-password"
                   style="padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text-primary);" />
            <input id="pw-new" type="password" placeholder="새 비밀번호" autocomplete="new-password"
                   style="padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text-primary);" />
            <div id="pw-new-hint" class="pw-policy-hint"></div>
            <input id="pw-new2" type="password" placeholder="한 번 더 입력해 주세요" autocomplete="new-password"
                   style="padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text-primary);" />
            <div id="pw-error" style="color:var(--dot-red);font-size:12px;min-height:16px;"></div>
            <button id="btn-change-pw" class="primary-btn" style="align-self:flex-start;">비밀번호 바꾸기</button>
        </div>
    `;
    appendToGroup('settings-group-body-security', pwCard, container);

    // 이메일 복구 카드 (트랙 2 / Phase 2) — Phase 3 (서버측 인증) 도입 후 활성화
    const emailRecoveryCard = document.createElement('div');
    emailRecoveryCard.id = 'settings-email-recovery-card';
    emailRecoveryCard.className = 'card-section';
    emailRecoveryCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="mail-search"></i> 이메일 복구</h3>
        <p class="section-desc">
            비밀번호도 24단어도 모두 잃어버린 비상 상황을 위한 <strong>두 번째 안전망</strong>이에요.
            본인 Gmail에 들어갈 수만 있으면 일기장을 다시 열 수 있어요. 24단어 복구코드와 병행해서 쓸 수 있어요.
        </p>
        <div id="email-recovery-status-row" class="settings-row" style="margin-top:12px;">
            <div class="settings-row-text">
                <h4 style="margin:0;font-size:14px;font-weight:600;">현재 상태</h4>
                <p class="section-desc" id="email-recovery-status-text" style="margin-top:4px;">확인 중...</p>
            </div>
        </div>
        <div class="settings-row" style="margin-top:8px;">
            <div class="settings-row-text">
                <h4 style="margin:0;font-size:14px;font-weight:600;">복구 이메일</h4>
                <p class="section-desc" style="margin-top:4px;" id="email-recovery-email-display">
                    ${_userEmail ? _userEmail : '(Google 로그인 이메일 자동 사용)'}
                </p>
            </div>
        </div>
        <div id="email-recovery-error" style="color:var(--dot-red);font-size:12px;min-height:16px;margin-top:4px;"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button id="btn-email-recovery-register" class="primary-btn">
                이메일 복구 등록하기
            </button>
        </div>
        <p class="section-desc" style="margin-top:8px;font-size:11px;color:var(--ink-secondary)">
            ※ 등록 시 본인 Gmail 주소가 복구 이메일로 저장돼요. 등록 정보(슬롯 키)는 운영자 금고에 한 번 더 잠겨 보관되며,
            서버는 평문 시드를 절대 갖지 않아요. (E2EE 유지)
        </p>
    `;
    appendToGroup('settings-group-body-security', emailRecoveryCard, container);

    // Phase B-3: 예전 결단 정리 카드 — 새 흐름(daily 목표) 전 데이터 정돈
    const cleanupCard = document.createElement('div');
    cleanupCard.id = 'settings-decisions-cleanup';
    cleanupCard.className = 'card-section';
    cleanupCard.style.borderLeft = '3px solid var(--dot-orange)';
    cleanupCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="broom"></i> 예전 결단 정리하기</h3>
        <p class="section-desc">
            "오늘의 결단"이 이제 "오늘의 목표"로 통합됐어요. 예전에 적어둔 결단과,
            Google 캘린더에 옮겨두었던 결단 일정을 한 번에 정리할 수 있어요.<br>
            <strong style="color:var(--dot-red)">원본 결단 문서와 캘린더 이벤트가 영구 삭제됩니다.</strong>
        </p>
        <div id="decisions-cleanup-status" style="margin: 8px 0; font-size: 13px; color: var(--text-secondary);"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="btn-decisions-scan" class="text-btn">먼저 얼마나 있는지 확인</button>
            <button id="btn-decisions-cleanup" class="primary-btn" style="background:var(--dot-orange)" disabled>예전 결단 정리하기</button>
        </div>
    `;
    appendToGroup('settings-group-body-cleanup', cleanupCard, container);

    // 단축키 설정 카드 (Phase E-9 / Step 1)
    const shortcutCard = document.createElement('div');
    shortcutCard.id = 'settings-shortcuts-card';
    shortcutCard.className = 'card-section';
    shortcutCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="keyboard"></i> 키보드 단축키</h3>
        <p class="section-desc">키보드만으로 거의 모든 동작을 처리할 수 있어요. <kbd class="kbd">Ctrl</kbd>+<kbd class="kbd">/</kbd> 를 누르면 전체 목록이 떠요.</p>
        <div class="settings-row">
            <div class="settings-row-text">
                <h4 style="margin:0;font-size:14px;font-weight:600;">단축키 사용</h4>
                <p class="section-desc" style="margin-top:4px;">끄면 모든 단축키가 비활성화돼요.</p>
            </div>
            <label class="switch" for="shortcuts-enabled-toggle">
                <input type="checkbox" id="shortcuts-enabled-toggle">
                <span class="switch-slider"></span>
            </label>
        </div>
        <div class="settings-row">
            <div class="settings-row-text">
                <h4 style="margin:0;font-size:14px;font-weight:600;">단일 문자 단축키 사용</h4>
                <p class="section-desc" style="margin-top:4px;">접근성을 위해 끌 수 있어요. 단일 키(예: <kbd class="kbd">?</kbd>)는 비활성, <kbd class="kbd">Ctrl</kbd>·<kbd class="kbd">Alt</kbd> 조합은 계속 작동.</p>
            </div>
            <label class="switch" for="shortcuts-single-char-toggle">
                <input type="checkbox" id="shortcuts-single-char-toggle">
                <span class="switch-slider"></span>
            </label>
        </div>
        <button type="button" id="shortcuts-help-open-btn" class="text-btn settings-shortcuts-help-btn">
            <i data-lucide="keyboard" class="btn-icon"></i> 단축키 도움말 열기
        </button>
    `;
    appendToGroup('settings-group-body-more', shortcutCard, container);

    // 경제 임계값 카드 (Phase F)
    const economyCard = document.createElement('div');
    economyCard.id = 'settings-economy-card';
    economyCard.className = 'card-section';
    economyCard.innerHTML = `
        <h3 class="section-title"><i class="section-icon" data-lucide="wallet"></i> 경제 임계값</h3>
        <p class="section-desc">
            거래 금액을 <strong>소액 / 중액 / 고액 / 거액</strong> 네 단계로 분류하는 기준이에요.
            정확한 금액은 자물쇠 안에 안전하게 보관되고, 검색·통계는 이 라벨로 동작해요.
            라이프스타일에 맞게 조정해 주세요.
        </p>
        <div class="econ-thr-presets" id="econ-thr-presets"></div>
        <div class="econ-thr-form">
            <div class="econ-thr-row">
                <label>소액 한계 (이 금액 <em>미만</em>)</label>
                <input id="econ-thr-small" type="number" inputmode="numeric" min="1" /> 원
            </div>
            <div class="econ-thr-row">
                <label>중액 한계 (소액~이 금액)</label>
                <input id="econ-thr-medium" type="number" inputmode="numeric" min="1" /> 원
            </div>
            <div class="econ-thr-row">
                <label>고액 한계 (중액~이 금액)</label>
                <input id="econ-thr-large" type="number" inputmode="numeric" min="1" /> 원
            </div>
            <div class="econ-thr-row econ-thr-huge">
                <label>거액</label>
                <span id="econ-thr-huge-display">고액 한계 이상 (자동)</span>
            </div>
        </div>
        <p class="section-desc" style="margin-top:8px; font-size:11px; color:var(--ink-secondary)">
            ⚠️ 저장하면 정확 금액이 있는 옛 거래의 크기 라벨이 새 기준으로 다시 분류돼요.
        </p>
        <div id="econ-thr-status" style="margin: 8px 0; font-size: 13px; color: var(--ink-secondary);"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="econ-thr-save-btn" class="primary-btn">저장하기</button>
        </div>
    `;
    appendToGroup('settings-group-body-more', economyCard, container);

    // (CS AI 트랙 §9-6, 2026-05-15) Swan 관리자 전용 진입 카드 — 피드백 관리 + 사전 설문 시작.
    //   isSwanAdmin 아닐 때는 카드 자체 안 그림. 사이드바 메뉴와 같은 게이트.
    if (isSwanAdmin(_userId)) {
        const adminCard = document.createElement('div');
        adminCard.className = 'card-section';
        adminCard.innerHTML = `
            <h3 class="section-title"><i class="section-icon" data-lucide="inbox"></i> 피드백 관리 (운영자 전용)</h3>
            <p class="section-desc">베타 사용자 풍선·SWAN 사전·사후 설문 결과를 한 자리에서 봐요.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                <button type="button" id="settings-open-feedback-admin" class="primary-btn">피드백 관리 열기</button>
                <button type="button" id="settings-start-pre-survey" class="secondary-btn">사전 설문 미리 해보기 (채팅 v1)</button>
                <button type="button" id="settings-start-pre-survey-form" class="secondary-btn">사전 설문 폼 v2 시안 (Q1)</button>
            </div>
        `;
        appendToGroup('settings-group-body-admin', adminCard, container);
        const adminGroup = document.getElementById('settings-group-admin');
        if (adminGroup) adminGroup.hidden = false;
        // (v69) 사이드바 설정 nav 운영자 항목도 함께 노출
        const adminNavBtn = document.querySelector('.sidebar-settings-item[data-target="settings-group-admin"]');
        if (adminNavBtn) adminNavBtn.hidden = false;

        adminCard.querySelector('#settings-open-feedback-admin')?.addEventListener('click', () => {
            if (typeof window.__sanctumSwitchView === 'function') {
                window.__sanctumSwitchView('feedback-admin');
            }
        });
        adminCard.querySelector('#settings-start-pre-survey')?.addEventListener('click', () => {
            if (typeof window.__sanctumOpenPreSurvey === 'function') {
                window.__sanctumOpenPreSurvey();
            }
        });
        adminCard.querySelector('#settings-start-pre-survey-form')?.addEventListener('click', () => {
            if (typeof window.__sanctumOpenPreSurveyForm === 'function') {
                window.__sanctumOpenPreSurveyForm();
            }
        });
    }

    // (히든 미션 트랙 v1 2026-05-15) 베타 + 14일 100% 클리어자 전용 진입 자리.
    //   사용자 명시 "설정 많이 안볼테니까 거기에 작은 카드 하나 넣고, 만렙 이후 콘텐츠 하나".
    //   잠금 상태: ✨ 별 + 작은 텍스트만 (이스터에그 톤).
    //   잠금해제 후: ✨ 별 + 활성 미션 카드 (클릭 → 모달).
    //   비동기 데이터 필요 → 초기 렌더는 잠금 상태 가정, refreshHiddenMissionCard 에서 자동 갱신.
    const hiddenMissionCard = document.createElement('div');
    hiddenMissionCard.id = 'settings-hidden-mission-card';
    hiddenMissionCard.className = 'card-section hm-settings-card hm-locked';
    hiddenMissionCard.innerHTML = `
        <div class="hm-card-row">
            <span class="hm-card-sparkle">✨</span>
            <div class="hm-card-body">
                <div class="hm-card-title">히든 미션</div>
                <div class="hm-card-hint">조건부 잠금해제 (조건: 모든 미션 마침)</div>
            </div>
        </div>
    `;
    appendToGroup('settings-group-body-modes', hiddenMissionCard, container);
}

/**
 * (히든 미션 트랙 v1 2026-05-15) 설정 카드 비동기 갱신.
 *   잠금해제 조건(베타 + 100% 클리어 + 사후 설문) 만족 시 활성 카드로 자동 전환.
 */
async function refreshHiddenMissionCard() {
    const card = document.getElementById('settings-hidden-mission-card');
    if (!card || !_userId) return;

    const dek = getDEK();
    if (!dek) return;

    try {
        const repo = await import('../data/hiddenMissionsRepo.js');
        await repo.checkUnlock(dek, _userId);
        const status = await repo.getStatus(dek, _userId);

        if (!status.unlocked) {
            // 잠금 상태 유지 — 초기 렌더 그대로
            return;
        }

        card.classList.remove('hm-locked');
        card.classList.add('hm-unlocked');

        const cleared = status.cleared.length;
        const total = status.totalActive;
        const next = status.nextMission;

        if (!next && cleared >= total) {
            // 모두 클리어
            card.innerHTML = `
                <div class="hm-card-row">
                    <span class="hm-card-sparkle hm-sparkle-celebrate">🎉</span>
                    <div class="hm-card-body">
                        <div class="hm-card-title">히든 미션 모두 완료</div>
                        <div class="hm-card-hint">${cleared}개 미션 함께해주셔서 감사해요</div>
                    </div>
                </div>
            `;
            return;
        }

        if (next) {
            const title = escapeHtmlInline(next.title);
            card.innerHTML = `
                <div class="hm-card-row hm-card-clickable">
                    <span class="hm-card-sparkle hm-sparkle-active">✨</span>
                    <div class="hm-card-body">
                        <div class="hm-card-title">${title}</div>
                        <div class="hm-card-hint">새 히든 미션이 열렸어요 (${cleared + 1}/${total})</div>
                    </div>
                </div>
            `;
            card.style.cursor = 'pointer';
            card.onclick = async () => {
                const ui = await import('./hiddenMission.js');
                await ui.openHiddenMission({
                    userId: _userId,
                    missionId: next.id,
                    onClose: () => refreshHiddenMissionCard(),
                });
            };
        } else {
            // 잠금해제됐지만 다음 미션은 묵상 후 발현 대기
            card.innerHTML = `
                <div class="hm-card-row">
                    <span class="hm-card-sparkle">✨</span>
                    <div class="hm-card-body">
                        <div class="hm-card-title">히든 미션</div>
                        <div class="hm-card-hint">다음 묵상 후 새 자리가 열려요</div>
                    </div>
                </div>
            `;
        }
    } catch (e) {
        console.warn('[hiddenMission] settings card refresh failed:', e);
    }
}

function escapeHtmlInline(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function bindShortcutSettings() {
    const router = await import('../shortcuts/router.js');
    const help = await import('./shortcutHelp.js');

    const enabledToggle = document.getElementById('shortcuts-enabled-toggle');
    const singleToggle = document.getElementById('shortcuts-single-char-toggle');
    const helpBtn = document.getElementById('shortcuts-help-open-btn');

    if (enabledToggle) {
        enabledToggle.checked = router.isShortcutsEnabled();
        enabledToggle.addEventListener('change', () => {
            router.setShortcutsEnabled(enabledToggle.checked);
        });
    }
    if (singleToggle) {
        singleToggle.checked = router.isSingleCharEnabled();
        singleToggle.addEventListener('change', () => {
            router.setSingleCharEnabled(singleToggle.checked);
        });
    }
    if (helpBtn) {
        helpBtn.addEventListener('click', () => help.openShortcutHelp());
    }
}

async function bindEconomyThresholdSettings() {
    const { getBucketSettings, saveBucketSettings, recalcAllTransactionBuckets } =
        await import('../data/economyRepo.js');
    const { BUCKET_PRESETS } = await import('../config/economyBuckets.js');
    const { showToast } = await import('./quickReview.js');

    const dek = getDEK();
    if (!dek) return;

    const inputs = {
        small:  document.getElementById('econ-thr-small'),
        medium: document.getElementById('econ-thr-medium'),
        large:  document.getElementById('econ-thr-large'),
    };
    const presetsWrap = document.getElementById('econ-thr-presets');
    const saveBtn  = document.getElementById('econ-thr-save-btn');
    const statusEl = document.getElementById('econ-thr-status');
    const hugeDisplay = document.getElementById('econ-thr-huge-display');
    if (!inputs.small || !saveBtn) return;

    // 현재 값 prefill
    try {
        const cur = await getBucketSettings(dek, _userId);
        inputs.small.value  = cur.smallMax;
        inputs.medium.value = cur.mediumMax;
        inputs.large.value  = cur.largeMax;
        updateHugeDisplay();
    } catch (e) { console.warn('[economy] threshold prefill failed:', e); }

    // 프리셋 버튼
    if (presetsWrap) {
        presetsWrap.innerHTML = BUCKET_PRESETS.map(p => `
            <button type="button" class="text-btn econ-thr-preset-btn" data-id="${p.id}">
                ${p.label}<br>
                <span style="font-size:11px;color:var(--ink-secondary)">
                    ${Number(p.smallMax).toLocaleString('ko-KR')} / ${Number(p.mediumMax).toLocaleString('ko-KR')} / ${Number(p.largeMax).toLocaleString('ko-KR')}
                </span>
            </button>
        `).join('');
        presetsWrap.querySelectorAll('.econ-thr-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = BUCKET_PRESETS.find(x => x.id === btn.dataset.id);
                if (!p) return;
                inputs.small.value  = p.smallMax;
                inputs.medium.value = p.mediumMax;
                inputs.large.value  = p.largeMax;
                updateHugeDisplay();
            });
        });
    }

    // 입력 변경 시 거액 표시 자동 갱신
    Object.values(inputs).forEach(el => el && el.addEventListener('input', updateHugeDisplay));

    function updateHugeDisplay() {
        if (!hugeDisplay) return;
        const lm = Number(inputs.large.value) || 0;
        hugeDisplay.textContent = lm > 0
            ? `${lm.toLocaleString('ko-KR')} 이상 (자동)`
            : '고액 한계 이상 (자동)';
    }

    // 저장 + 재계산
    saveBtn.addEventListener('click', async () => {
        const sm = Number(inputs.small.value);
        const mm = Number(inputs.medium.value);
        const lm = Number(inputs.large.value);
        // 입력 검증
        if (!(sm > 0 && mm > 0 && lm > 0)) {
            statusEl.innerHTML = '<span style="color:var(--dot-red)">모두 0보다 큰 값을 적어 주세요.</span>';
            return;
        }
        if (!(sm < mm && mm < lm)) {
            statusEl.innerHTML = '<span style="color:var(--dot-red)">소액 &lt; 중액 &lt; 고액 순서로 적어 주세요.</span>';
            return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = '저장하는 중...';
        statusEl.textContent = '';
        try {
            await saveBucketSettings(dek, _userId, { smallMax: sm, mediumMax: mm, largeMax: lm });
            // 옛 거래 재계산
            statusEl.innerHTML = '<span style="color:var(--ink-secondary)">옛 거래 라벨을 다시 분류하는 중...</span>';
            const result = await recalcAllTransactionBuckets(dek, _userId, (done, total) => {
                statusEl.innerHTML = `<span style="color:var(--ink-secondary)">거래 ${done}/${total} 갱신 중...</span>`;
            });
            statusEl.innerHTML = `<span style="color:var(--dot-green)">✅ 저장 완료. 옛 거래 ${result.changed}건 라벨이 새로 분류됐어요 (총 ${result.total}건).</span>`;
            showToast('경제 임계값을 저장했어요');
            // 다른 화면 즉시 동기화
            window.dispatchEvent(new CustomEvent('sanctum:economy-changed', { detail: { type: 'thresholds' }}));
        } catch (e) {
            console.error('[economy] threshold save failed:', e);
            statusEl.innerHTML = `<span style="color:var(--dot-red)">저장이 잠깐 막혔어요: ${escapeHtml(e.message || '알 수 없음')}</span>`;
            showToast('저장이 잠깐 막혔어요.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '저장하기';
        }
    });
}

function bindEvents() {
    // (2026-05-18 v73) FAQ 아코디언 — 질문 클릭 시 답 토글 (한 번에 여러 펼침 OK)
    document.querySelectorAll('.settings-faq-question').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => {
            const faqId = btn.dataset.faqId;
            const answer = document.querySelector(`.settings-faq-answer[data-faq-answer-for="${faqId}"]`);
            if (!answer) return;
            const isOpen = !answer.hidden;
            answer.hidden = isOpen;
            btn.setAttribute('aria-expanded', String(!isOpen));
            btn.classList.toggle('is-open', !isOpen);
        });
    });

    // (B-4 본인 프로필 트랙 2026-05-13) "내 프로필 열기" 버튼 — view-self-profile 로 전환
    const btnOpenSelf = document.getElementById('btn-open-self-profile');
    if (btnOpenSelf) {
        btnOpenSelf.addEventListener('click', () => {
            if (typeof window.__sanctumNav === 'function') window.__sanctumNav('self-profile');
            else if (typeof window.__sanctumSwitchView === 'function') window.__sanctumSwitchView('self-profile');
        });
    }

    // (2026-05-14 본인 프로필 재기획 S-D 후속) "처음 안내 다시 보기" 버튼 — 온보딩 모달 재시연.
    //   dynamic import — 아직 한 번도 안 누른 사용자는 onboarding.js 다운로드 안 함 (lazy).
    //   dek 못 가져오면 조용히 끝. onComplete 는 빈 콜백 — 설정 화면에 그대로 머물러요.
    const btnReplayOnboarding = document.getElementById('btn-replay-onboarding');
    if (btnReplayOnboarding) {
        btnReplayOnboarding.addEventListener('click', async () => {
            if (!_userId || _userId === 'anonymous') return;
            const dek = getDEK();
            if (!dek) return;
            try {
                const { showOnboardingModal } = await import('./onboarding.js');
                await showOnboardingModal({
                    userId: _userId,
                    dek,
                    onComplete: () => {},
                });
            } catch (e) {
                console.warn('[settings] onboarding replay failed:', e);
            }
        });
    }

    // (2026-05-14 #23 후속) 묵상 템플릿 — markdownEditor 부착 + prefill + 저장 + 기본값 + 마커 삽입
    const tmplInput  = document.getElementById('meditation-template-input');
    const tmplSave   = document.getElementById('btn-save-meditation-template');
    const tmplReset  = document.getElementById('btn-reset-meditation-template');
    const tmplInsert = document.getElementById('btn-insert-scripture-marker');
    const tmplStatus = document.getElementById('meditation-template-status');
    if (tmplInput) {
        bindMarkdownEditor(tmplInput, { onChange: () => {} });
        if (_userId && _userId !== 'anonymous') {
            getMeditationTemplate(_userId)
                .then(t => setMarkdown(tmplInput, t || DEFAULT_TEMPLATE))
                .catch(() => setMarkdown(tmplInput, DEFAULT_TEMPLATE));
        } else {
            setMarkdown(tmplInput, DEFAULT_TEMPLATE);
        }
    }
    if (tmplSave) {
        tmplSave.addEventListener('click', async () => {
            if (!_userId || _userId === 'anonymous') return;
            const v = tmplInput ? getMarkdown(tmplInput).trim() : '';
            tmplSave.disabled = true;
            if (tmplStatus) tmplStatus.textContent = '저장 중...';
            try {
                await setMeditationTemplate(_userId, v || DEFAULT_TEMPLATE);
                if (tmplStatus) tmplStatus.textContent = '✓ 저장됐어요';
                setTimeout(() => { if (tmplStatus) tmplStatus.textContent = ''; }, 2500);
            } catch (e) {
                console.warn('template save failed:', e);
                if (tmplStatus) tmplStatus.textContent = '저장 중 잠깐 막혔어요';
            } finally {
                tmplSave.disabled = false;
            }
        });
    }
    if (tmplReset) {
        tmplReset.addEventListener('click', () => {
            if (tmplInput) setMarkdown(tmplInput, DEFAULT_TEMPLATE);
            if (tmplStatus) tmplStatus.textContent = '기본값으로 되돌렸어요. 저장 버튼을 눌러주세요.';
        });
    }
    if (tmplInsert) {
        tmplInsert.addEventListener('click', () => {
            if (!tmplInput) return;
            tmplInput.focus();
            // caret 위치에 마커 칩 삽입 — markdown 으로 가져와 {{scripture}} 추가 후 다시 렌더
            const sel = window.getSelection();
            let inserted = false;
            if (sel && sel.rangeCount && tmplInput.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                // 빠른 경로 — caret 자리에 chip span 직접 삽입
                const range = sel.getRangeAt(0);
                range.deleteContents();
                const chip = document.createElement('span');
                chip.className = 'md-marker-scripture';
                chip.contentEditable = 'false';
                chip.dataset.marker = 'scripture';
                chip.title = '이 자리에 말씀 본문이 들어가요';
                chip.textContent = '📖 말씀 본문';
                range.insertNode(chip);
                // chip 뒤에 빈 텍스트 노드 — caret 이동
                const after = document.createTextNode('​');
                chip.parentNode.insertBefore(after, chip.nextSibling);
                const r2 = document.createRange();
                r2.setStart(after, 1);
                r2.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r2);
                inserted = true;
            }
            if (!inserted) {
                const cur = getMarkdown(tmplInput);
                setMarkdown(tmplInput, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '{{scripture}}');
            }
        });
    }

    const btnDiagnose = document.getElementById('btn-diagnose');
    const btnMigrate = document.getElementById('btn-migrate');
    const btnBackup = document.getElementById('btn-backup');
    const btnExport = document.getElementById('btn-export-backup');
    const statusBox = document.getElementById('migration-status-box');

    // 이메일 복구 등록 버튼 (Phase 3 활성)
    const btnEmailRecovery = document.getElementById('btn-email-recovery-register');
    if (btnEmailRecovery) {
        btnEmailRecovery.addEventListener('click', () => handleEmailRecoveryRegister());
    }

    // (2026-05-13 HC#1 N7) 매일 묵상 알람 — 현재 값 로드 + 저장 버튼.
    const dailyAlarmToggle = document.getElementById('daily-alarm-toggle');
    const dailyAlarmTime = document.getElementById('daily-alarm-time');
    const dailyAlarmStatus = document.getElementById('daily-alarm-status');
    const btnSaveDailyAlarm = document.getElementById('btn-save-daily-alarm');
    if (dailyAlarmToggle && dailyAlarmTime && btnSaveDailyAlarm) {
        // 진입 시 현재 값 prefill
        loadDailyAlarmSettings().then(s => {
            if (s) {
                dailyAlarmToggle.checked = s.dailyAlarmEnabled === true;
                if (s.dailyAlarmTime) dailyAlarmTime.value = s.dailyAlarmTime;
            }
        }).catch(e => console.warn('[settings] daily alarm load failed:', e));

        btnSaveDailyAlarm.addEventListener('click', async () => {
            const enabled = dailyAlarmToggle.checked;
            const time = dailyAlarmTime.value || '20:00';
            if (!/^\d{2}:\d{2}$/.test(time)) {
                if (dailyAlarmStatus) dailyAlarmStatus.textContent = '시각 형식이 어색해요 (예: 20:00).';
                return;
            }
            try {
                await saveDailyAlarmSettings({
                    dailyAlarmEnabled: enabled,
                    dailyAlarmTime: time,
                });
                if (dailyAlarmStatus) {
                    dailyAlarmStatus.textContent = enabled
                        ? `✓ 매일 ${time} 에 알람이 떠요.`
                        : '✓ 알람을 껐어요.';
                }
                // (2026-05-18 후속) 시각 바뀐 즉시 — 오늘 발화 기록 자리 클리어 + 재스케줄
                try { clearLastFiredToday(); } catch (_) {}
                try { scheduleDailyMeditationNotification(_userId); } catch (_) {}
                // (S-D 후속 2026-05-15) "알림 시각 정하기" 미션 자연 발화.
                try {
                    const { markMissionComplete } = await import('../data/personRepo.js');
                    const { getDEK } = await import('./lockScreen.js');
                    await markMissionComplete(getDEK(), _userId, 'notification_setup', { signal: 'saveDailyAlarm' });
                } catch (_) { /* 미션 트리거 실패는 저장 성공을 막지 않음 */ }
            } catch (e) {
                console.error('[settings] daily alarm save failed:', e);
                if (dailyAlarmStatus) dailyAlarmStatus.textContent = '저장이 잠깐 막혔어요.';
            }
        });
    }

    // (2026-05-18 후속) 브라우저 알림 권한 상태 표시 + 허용 버튼 + 지금 테스트
    const notifStatus = document.getElementById('notif-permission-status');
    const btnEnableNotif = document.getElementById('btn-enable-notif');
    const btnTestNotif = document.getElementById('btn-test-notif');
    const updateNotifPermissionRow = () => {
        if (!notifStatus) return;
        const p = getNotificationPermission();
        if (p === 'granted') {
            notifStatus.textContent = '✓ 허용됨';
            notifStatus.style.color = 'var(--accent-strong, #5a6850)';
            if (btnEnableNotif) btnEnableNotif.style.display = 'none';
            if (btnTestNotif) btnTestNotif.style.display = '';
        } else if (p === 'denied') {
            notifStatus.textContent = '✕ 차단됨 (브라우저 설정에서 변경 가능)';
            notifStatus.style.color = 'var(--dot-red, #E5654A)';
            if (btnEnableNotif) btnEnableNotif.style.display = 'none';
            if (btnTestNotif) btnTestNotif.style.display = 'none';
        } else if (p === 'unsupported') {
            notifStatus.textContent = '이 브라우저는 알림 미지원';
            notifStatus.style.color = 'var(--ink-secondary, #6a6a6a)';
            if (btnEnableNotif) btnEnableNotif.style.display = 'none';
            if (btnTestNotif) btnTestNotif.style.display = 'none';
        } else {
            notifStatus.textContent = '아직 허용 안 했어요';
            notifStatus.style.color = 'var(--ink-secondary, #6a6a6a)';
            if (btnEnableNotif) btnEnableNotif.style.display = '';
            if (btnTestNotif) btnTestNotif.style.display = 'none';
        }
    };
    updateNotifPermissionRow();
    if (btnEnableNotif) {
        btnEnableNotif.addEventListener('click', async () => {
            const result = await requestNotificationPermission();
            updateNotifPermissionRow();
            if (result === 'granted') {
                try { scheduleDailyMeditationNotification(_userId); } catch (_) {}
            }
        });
    }
    if (btnTestNotif) {
        btnTestNotif.addEventListener('click', async () => {
            try {
                // 같은 날 중복 차단 자리 비우고 즉시 발화
                try { clearLastFiredToday(); } catch (_) {}
                const r = await triggerNotifNow();
                if (r.ok) {
                    try {
                        const { showToast } = await import('./quickReview.js');
                        showToast('🔔 알림을 보냈어요.');
                    } catch (_) {}
                } else if (r.reason === 'permission_not_granted') {
                    alert('알림 권한이 필요해요. [알림 허용하기] 먼저 눌러주세요.');
                } else {
                    alert('알림 발송 실패: ' + r.reason);
                }
            } catch (e) {
                alert('알림 발송 중 오류: ' + (e?.message || e));
            }
        });
    }

    // (#58 후속 2026-05-14) 생일 알람 일수 — 현재 값 로드 + 저장 버튼.
    const btnSaveBirthdayAlarm = document.getElementById('btn-save-birthday-alarm');
    const birthdayAlarmStatus  = document.getElementById('birthday-alarm-status');
    const birthdayDayChecks    = document.querySelectorAll('.bd-alarm-day');
    if (btnSaveBirthdayAlarm && birthdayDayChecks.length === 4) {
        // 현재 값 prefill — birthdayAlarmDays 배열 (디폴트 [7,3,0])
        loadDailyAlarmSettings().then(s => {
            const days = Array.isArray(s?.birthdayAlarmDays) ? s.birthdayAlarmDays : [7, 3, 0];
            birthdayDayChecks.forEach(cb => {
                cb.checked = days.includes(Number(cb.value));
            });
        }).catch(e => console.warn('[settings] birthday alarm load failed:', e));

        btnSaveBirthdayAlarm.addEventListener('click', async () => {
            const selected = Array.from(birthdayDayChecks)
                .filter(cb => cb.checked)
                .map(cb => Number(cb.value))
                .sort((a, b) => b - a);  // 큰 수부터 [7,3,1,0] 순
            try {
                // 기존 dailyAlarm 값 보존하면서 birthdayAlarmDays 만 갱신
                const cur = await loadDailyAlarmSettings();
                await saveDailyAlarmSettings({
                    dailyAlarmEnabled: cur?.dailyAlarmEnabled === true,
                    dailyAlarmTime: cur?.dailyAlarmTime || '20:00',
                    birthdayAlarmDays: selected,
                });
                if (birthdayAlarmStatus) {
                    birthdayAlarmStatus.textContent = selected.length === 0
                        ? '✓ 생일 알람을 모두 껐어요.'
                        : `✓ ${selected.map(d => d === 0 ? '당일' : `${d}일 전`).join(' · ')} 알람이 와요.`;
                }
            } catch (e) {
                console.error('[settings] birthday alarm save failed:', e);
                if (birthdayAlarmStatus) birthdayAlarmStatus.textContent = '저장이 잠깐 막혔어요.';
            }
        });
    }

    if (btnDiagnose) btnDiagnose.onclick = async () => {
        const v1Id = (document.getElementById('v1-id-input')?.value || '').trim();
        const accepted = [];
        if (_userId) accepted.push(_userId);
        if (_userEmail) accepted.push(_userEmail);
        if (v1Id) accepted.push(v1Id);
        if (accepted.length === 0) {
            statusBox.innerHTML = '<p style="color:var(--dot-red)">v1 식별자를 입력해주세요.</p>';
            return;
        }

        btnDiagnose.disabled = true;
        btnDiagnose.textContent = '진단 중...';
        statusBox.innerHTML = `<p>스캔 중... (식별자: ${accepted.join(', ')})</p>`;

        try {
            _diagnosticData = await diagnoseV1Data(accepted, { includeLegacy: true });

            // v1 평문 / _legacy_ 백업 분리
            const v1Items = [];
            const legacyItems = [];
            let totalCount = 0;
            for (const [col, info] of Object.entries(_diagnosticData)) {
                totalCount += info.count;
                const target = col.startsWith('_legacy_') ? legacyItems : v1Items;
                target.push({ col, info });
            }

            let html = '';
            if (v1Items.length > 0) {
                html += '<p style="font-weight:600;margin-top:8px">📦 옛 빌드에서 만든 데이터</p>';
                html += '<ul style="margin-left:18px">';
                v1Items.forEach(({ col, info }) => {
                    const label = friendlyCollectionName(col);
                    html += `<li><strong>${label}</strong>: ${info.count}개 ${info.ownerless ? '(공동 저장소)' : ''}</li>`;
                });
                html += '</ul>';
            }
            if (legacyItems.length > 0) {
                html += '<p style="font-weight:600;margin-top:12px">🔐 이전 마이그레이션 백업</p>';
                html += '<p style="font-size:12px;color:var(--text-secondary)">암호화 키가 사라졌을 때 여기서 평문을 다시 가져와요.</p>';
                html += '<ul style="margin-left:18px">';
                legacyItems.forEach(({ col, info }) => {
                    const label = friendlyCollectionName(col);
                    html += `<li><strong>${label}</strong>: ${info.count}개</li>`;
                });
                html += '</ul>';
            }

            if (totalCount === 0) {
                html = '<p>옮길 옛 데이터가 없어요. 모두 깔끔한 상태예요.</p>';
                if (btnMigrate) btnMigrate.disabled = true;
                if (btnBackup) btnBackup.disabled = true;
            } else {
                html += `<p style="margin-top:12px;font-weight:600;color:var(--dot-orange)">
                    총 ${totalCount}개를 발견했어요. <br>
                    [데이터 옮기기]를 누르면 안전하게 새 저장소로 이전합니다.
                </p>`;
                if (btnMigrate) btnMigrate.disabled = false;
                if (btnBackup) btnBackup.disabled = false;
            }
            statusBox.innerHTML = html;
        } catch (e) {
            console.error(e);
            statusBox.innerHTML = '<p style="color:var(--dot-red)">진단 중 잠깐 문제가 있었어요. 다시 한 번 해볼까요?</p>';
        }
        btnDiagnose.disabled = false;
        btnDiagnose.textContent = '진단 시작';
    };

    if (btnMigrate) btnMigrate.onclick = async () => {
        const dek = getDEK();
        if (!dek) return alert('잠금을 먼저 풀어 주실래요?');
        if (!_diagnosticData) return alert('[진단 시작]을 먼저 눌러 주실래요?');
        if (!confirm('찾은 데이터를 안전한 새 저장소로 옮겨 볼게요.\n원본은 그대로 남으니까 걱정하지 않으셔도 돼요.\n\n계속해도 괜찮을까요?')) return;

        btnMigrate.disabled = true;
        let total = 0;
        const perCollection = {};

        for (const [col, info] of Object.entries(_diagnosticData)) {
            const friendly = friendlyCollectionName(col);
            statusBox.innerHTML = `<p>${friendly} 옮기는 중... (${info.count}개)</p>`;
            try {
                const ok = await migrateCollection(dek, _userId, col, info.docs, (curr, tot) => {
                    btnMigrate.textContent = `${curr}/${tot}`;
                });
                total += ok;
                perCollection[friendly] = ok;
            } catch (e) {
                console.error(`[${col}] 이전 실패`, e);
            }
        }

        const summary = Object.entries(perCollection)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k} ${n}개`)
            .join(', ');

        statusBox.innerHTML = `
            <p style="color:var(--dot-green);font-weight:600">✅ 모두 옮겼어요!</p>
            <p style="font-size:13px;margin-top:6px">${summary || '옮길 데이터가 없었어요.'}</p>
            <p style="font-size:12px;color:var(--text-secondary);margin-top:8px">
                새로고침하면 오늘 화면과 지난 묵상에 데이터가 다시 보일 거예요.
            </p>
        `;
        btnMigrate.textContent = '데이터 옮기기';
        await logAuditAction(_userId, 'migrate_complete', { count: total });
    };

    /** 컬렉션명 → 사용자 친화 이름 */
    function friendlyCollectionName(col) {
        const map = {
            dots: '도트(시간 기록)',
            timeboxes: '타임박스(옛 이름)',
            memos: '묵상 노트',
            meditations: '묵상 노트',
            notes: '메모',
            principles: '원칙',
            goals: '목표',
            bibleProgress: '통독 진도',
            _legacy_dots: '도트 백업',
            _legacy_memos: '묵상 노트 백업',
            _legacy_meditations: '묵상 노트 백업',
            _legacy_principles: '원칙 백업',
            _legacy_goals: '목표 백업',
            _legacy_timeboxes: '타임박스 백업',
            _legacy_notes: '메모 백업',
            _legacy_bibleProgress: '통독 진도 백업',
        };
        return map[col] || col;
    }

    if (btnBackup) btnBackup.onclick = () => {
        if (!_diagnosticData) return;
        downloadJsonSnapshot(_diagnosticData);
    };

    if (btnExport) btnExport.onclick = async () => {
        const dek = getDEK();
        if (!dek) return alert('잠금을 먼저 풀어 주실래요?');
        btnExport.disabled = true;
        btnExport.textContent = '준비하는 중...';
        try {
            await exportAllData(dek, _userId);
        } catch (e) {
            console.error(e);
            alert('잠깐 막혔어요. 한 번만 더 시도해 주실래요?');
        }
        btnExport.textContent = '📥 전체 데이터 받기';
        btnExport.disabled = false;
    };

    const btnPw = document.getElementById('btn-change-pw');
    if (btnPw) btnPw.onclick = async () => {
        const oldPw = document.getElementById('pw-old').value;
        const newPw = document.getElementById('pw-new').value;
        const newPw2 = document.getElementById('pw-new2').value;
        const err = document.getElementById('pw-error');
        err.textContent = '';

        if (!validatePassword(newPw).ok) { err.textContent = firstError(newPw); return; }
        if (newPw !== newPw2) { err.textContent = '두 번 입력한 새 비밀번호가 다른 것 같아요.'; return; }

        const dek = getDEK();
        if (!dek) { err.textContent = '먼저 잠금을 풀어주세요.'; return; }

        btnPw.disabled = true;
        btnPw.textContent = '바꾸는 중...';

        try {
            // 1) 현재 비밀번호 검증: vault doc의 wrappedDEK_master를 unwrap 시도
            const userSnap = await getDoc(doc(db, 'users', _userId));
            if (!userSnap.exists()) throw new Error('NO_VAULT');
            const v = userSnap.data();
            await unlockVault(oldPw, v.masterKeySalt, v.wrappedDEK_master, v.wrappedDEK_master_iv, v.kdfParams || null);

            // 2) 새 비밀번호로 DEK 다시 wrap
            const re = await changePassword(dek, newPw);

            // 3) 저장
            await setDoc(doc(db, 'users', _userId), {
                masterKeySalt: re.salt,
                wrappedDEK_master: re.wrappedDEK_master,
                wrappedDEK_master_iv: re.wrappedDEK_master_iv,
                kdfParams: re.kdfParams,
                passwordPolicyVersion: POLICY_VERSION,
                pwChangedAt: serverTimestamp(),
            }, { merge: true });

            await logAuditAction(_userId, 'change_password');

            err.style.color = 'var(--dot-green)';
            err.textContent = '✅ 비밀번호를 바꿨어요!';
            document.getElementById('pw-old').value = '';
            document.getElementById('pw-new').value = '';
            document.getElementById('pw-new2').value = '';
            setTimeout(() => { err.textContent = ''; err.style.color = 'var(--dot-red)'; }, 3000);
        } catch (e) {
            console.error(e);
            if (e.message === 'WRONG_PASSWORD') err.textContent = '지금 비밀번호가 다른 것 같아요.';
            else if (e.message === 'NO_VAULT') err.textContent = '계정 정보를 찾을 수 없어요.';
            else err.textContent = '잠깐 문제가 있었어요. 다시 한 번 해볼까요?';
        } finally {
            btnPw.disabled = false;
            btnPw.textContent = '비밀번호 바꾸기';
        }
    };

    // ─── Phase B-3: 예전 결단 정리 ───
    const cleanupStatus = document.getElementById('decisions-cleanup-status');
    const btnScan = document.getElementById('btn-decisions-scan');
    const btnCleanup = document.getElementById('btn-decisions-cleanup');
    let _cleanupDecisionsCache = null;  // scan 결과 캐시 (cleanup 시 재사용)

    if (btnScan) btnScan.onclick = async () => {
        const dek = getDEK();
        if (!dek) { cleanupStatus.innerHTML = '<span style="color:var(--dot-red)">잠겨 있어요. 비밀번호로 먼저 열어주세요.</span>'; return; }
        btnScan.disabled = true;
        btnScan.textContent = '확인 중...';
        try {
            const decisions = await getAllDecisions(dek, _userId);
            _cleanupDecisionsCache = decisions;
            const total = decisions.length;
            const onCalendar = decisions.filter(d => d.gcalEventId).length;
            if (total === 0) {
                cleanupStatus.innerHTML = '<p style="color:var(--dot-green)">예전 결단이 없어요. 이미 깔끔합니다.</p>';
                btnCleanup.disabled = true;
            } else {
                cleanupStatus.innerHTML = `
                    <p style="font-weight:600">발견: 결단 ${total}개, 그중 Google 캘린더에 올라간 일정 ${onCalendar}개</p>
                    <p style="color:var(--text-secondary)">아래 [예전 결단 정리하기]를 누르면 둘 다 영구 삭제돼요. 한 번 더 묻습니다.</p>
                `;
                btnCleanup.disabled = false;
            }
        } catch (e) {
            console.error('decisions scan failed:', e);
            cleanupStatus.innerHTML = '<span style="color:var(--dot-red)">결단 확인 중에 잠깐 막혔어요. 다시 시도해 주실래요?</span>';
        } finally {
            btnScan.disabled = false;
            btnScan.textContent = '먼저 얼마나 있는지 확인';
        }
    };

    if (btnCleanup) btnCleanup.onclick = async () => {
        if (!_cleanupDecisionsCache || _cleanupDecisionsCache.length === 0) {
            cleanupStatus.innerHTML = '<span style="color:var(--dot-orange)">먼저 [확인] 버튼을 눌러 주세요.</span>';
            return;
        }
        if (!confirm(
            `결단 ${_cleanupDecisionsCache.length}개와 그 캘린더 일정을 영구 삭제합니다.\n` +
            `복구할 수 없어요. 계속할까요?`
        )) return;

        btnCleanup.disabled = true;
        btnScan.disabled = true;
        btnCleanup.textContent = '정리 중...';

        const total = _cleanupDecisionsCache.length;
        let calOk = 0, calFail = 0, docOk = 0, docFail = 0;

        // 1) 캘린더 이벤트 먼저 삭제 — 실패해도 결단 문서 삭제는 계속 진행
        const withEvent = _cleanupDecisionsCache.filter(d => d.gcalEventId);
        for (let i = 0; i < withEvent.length; i++) {
            const d = withEvent[i];
            cleanupStatus.innerHTML = `<p>📅 캘린더 일정 삭제 중... (${i + 1}/${withEvent.length})</p>`;
            const r = await deleteCalendarEventById(d.gcalEventId);
            if (r.ok) calOk++;
            else calFail++;
        }

        // 2) Firestore 결단 문서 삭제
        for (let i = 0; i < _cleanupDecisionsCache.length; i++) {
            const d = _cleanupDecisionsCache[i];
            cleanupStatus.innerHTML = `<p>🗑 결단 문서 삭제 중... (${i + 1}/${total})</p>`;
            try {
                await deleteDecision(d.id);
                docOk++;
            } catch (e) {
                console.warn('decision delete failed:', d.id, e);
                docFail++;
            }
        }

        // 3) 결과 표시
        const parts = [
            `캘린더: 지움 ${calOk}` + (calFail ? ` / 실패 ${calFail}` : ''),
            `결단 문서: 지움 ${docOk}` + (docFail ? ` / 실패 ${docFail}` : ''),
        ];
        cleanupStatus.innerHTML = `
            <p style="color:var(--dot-green);font-weight:600">✅ 정리가 끝났어요</p>
            <p style="font-size:13px">${parts.join(' · ')}</p>
            ${(calFail || docFail) ? '<p style="font-size:12px; color:var(--dot-orange)">실패한 항목은 잠시 후 다시 시도해 주실래요?</p>' : ''}
        `;
        _cleanupDecisionsCache = null;
        btnCleanup.disabled = true;
        btnCleanup.textContent = '예전 결단 정리하기';
        btnScan.disabled = false;
        await logAuditAction(_userId, 'decisions_cleanup', { total, calOk, calFail, docOk, docFail });
    };

    // ─── Phase E-8/A: 말씀 본문 설정 (폰트/파트) ───
    bindScriptureSettingsEvents();

    // ─── (S-D 후속 2026-05-15) 시스템 글자 크기 + 성경 번역본 안내 ───
    bindSystemFontSettings();
    bindAccentColorSettings();
    bindTierSettings();
    bindBibleVersionSettings();

    // ─── 자동 잠금 시간(분) ───
    bindAutoLockMinutes();

    // ─── 단축키 설정 카드 (Phase E-9/Step 1) ───
    bindShortcutSettings().catch(e => console.warn('[shortcuts] settings bind failed:', e));

    // ─── 경제 임계값 카드 (Phase F) ───
    bindEconomyThresholdSettings().catch(e => console.warn('[economy] threshold bind failed:', e));
}

function bindAutoLockMinutes() {
    const input = document.getElementById('autolock-minutes-input');
    const btn = document.getElementById('autolock-save-btn');
    const status = document.getElementById('autolock-save-status');
    if (!input || !btn) return;

    input.value = String(getSavedTimeoutMinutes());

    btn.onclick = () => {
        const applied = saveTimeoutMinutes(input.value);
        input.value = String(applied);
        if (status) {
            status.textContent = `✅ ${applied}분으로 저장했어요`;
            status.style.color = 'var(--dot-green)';
            clearTimeout(bindAutoLockMinutes._t);
            bindAutoLockMinutes._t = setTimeout(() => { status.textContent = ''; }, 2500);
        }
    };
}

/**
 * 말씀 본문 카드 HTML — 폰트 크기 라디오 + 4파트 체크박스.
 * 다음 단계(번역본/시작점/자유 선택)도 같은 카드에 점진적으로 들어옴.
 */
function renderScriptureSettingsHTML() {
    const cur = getScriptureSettings();
    const fontOptions = Object.entries(FONT_SIZES).map(([key, cfg]) => `
        <label class="seg-option">
            <input type="radio" name="scripture-font" value="${key}" ${cur.fontSize === key ? 'checked' : ''}>
            <span style="font-size:${cfg.verse}px; line-height:1.2;">가</span>
            <span class="seg-option-label">${cfg.label}</span>
        </label>
    `).join('');

    // 프리셋(묵상 계획) 라디오 카드 — 각 카드는 포함 파트의 이름도 작은 칩으로 보여줌
    const planOptions = PRESETS.map(plan => {
        const partChips = plan.parts.map(pid => {
            const p = BIBLE_METADATA.parts.find(x => x.id === pid);
            return p ? `<span class="plan-chip">${p.name.replace('파트', 'P')}</span>` : '';
        }).join('');
        return `
            <label class="plan-option">
                <input type="radio" name="scripture-plan" value="${plan.id}" ${cur.activePlanId === plan.id ? 'checked' : ''}>
                <span class="plan-body">
                    <span class="plan-title">${plan.name}</span>
                    <span class="plan-desc">${plan.desc}</span>
                    <span class="plan-chips">${partChips}</span>
                </span>
            </label>
        `;
    }).join('');

    // user plan 라디오 (Phase E-8/B-2)
    const userPlans = getUserPlans();
    const userPlanOptions = userPlans.map(plan => {
        const chips = plan.books.slice(0, 4).map(([, full]) =>
            `<span class="plan-chip">${full}</span>`).join('');
        const moreChip = plan.books.length > 4
            ? `<span class="plan-chip">+${plan.books.length - 4}권</span>` : '';
        return `
            <label class="plan-option plan-option--user" data-plan="${plan.id}">
                <input type="radio" name="scripture-plan" value="${plan.id}" ${cur.activePlanId === plan.id ? 'checked' : ''}>
                <span class="plan-body">
                    <span class="plan-title">${escapeAttr(plan.name)}</span>
                    <span class="plan-desc">내가 만든 계획 · ${plan.createdAt || ''}부터</span>
                    <span class="plan-chips">${chips}${moreChip}</span>
                </span>
                <button class="plan-delete-btn" type="button" data-plan="${plan.id}"
                        aria-label="이 계획 삭제" title="삭제">
                    <i data-lucide="x"></i>
                </button>
            </label>
        `;
    }).join('');
    const userPlanSection = `
        <div class="plan-user-header">
            <span class="plan-user-title">내가 만든 계획</span>
            <button id="scripture-plan-add-btn" class="text-btn" type="button">+ 새로 만들기</button>
        </div>
        <div class="plan-list plan-list--user" id="scripture-userplan-list">
            ${userPlans.length === 0
                ? '<p class="setting-hint" style="padding: var(--sp-2) 0;">아직 만든 계획이 없어요. "새로 만들기"로 시작해 보세요.</p>'
                : userPlanOptions}
        </div>
    `;

    return `
        <h3 class="section-title"><i class="section-icon" data-lucide="book-marked"></i> 말씀 본문</h3>
        <p class="section-desc">오늘 화면에 어떤 본문을, 어떤 크기로 보여줄지 골라요. 바꾸면 바로 반영돼요.</p>

        <div class="setting-block">
            <div class="setting-label">글자 크기</div>
            <div class="seg-row" id="scripture-font-row">${fontOptions}</div>
        </div>

        <div class="setting-block" style="margin-top: var(--sp-4);">
            <div class="setting-label">묵상 계획</div>
            <p class="setting-hint">미리 만들어 둔 6종 중에 고르거나, 아래에서 내 계획을 직접 만들어요.</p>
            <div class="plan-list" id="scripture-plan-list">${planOptions}</div>
            ${userPlanSection}
        </div>

        <div class="setting-block" style="margin-top: var(--sp-4);">
            <div class="setting-label">선택한 계획의 시작점</div>
            <p class="setting-hint">"오늘부터 시편 1편" 같이 시작점을 직접 박을 수 있어요. 다음날부터 한 장씩 자동으로 넘어가요.</p>
            <div id="scripture-anchor-panel" class="anchor-panel"></div>
        </div>

        <div class="settings-row" style="margin-top: var(--sp-4);">
            <div class="settings-row-text">
                <h4 style="margin:0;font-size:14px;font-weight:600;">묵상 안 한 날 본문 미루기</h4>
                <p class="section-desc" style="margin-top:4px;">
                    켜면 달력 자동 진행 대신, 각 파트마다 [이 장 다 읽었어요] 버튼을 눌러 "오늘 분량 끝" 도장을 찍어요.
                    다음 장은 <strong>내일</strong> 들어왔을 때 자동으로 떠요. 안 누른 날은 같은 장이 계속 떠 있어요.
                    켜는 순간의 위치는 "오늘 보일 장"으로 자동 시드돼서 진도가 갑자기 줄지 않아요.
                </p>
                <p style="margin-top:6px;">
                    <button id="scripture-reset-progress-btn" type="button" class="text-btn" style="font-size:12px;">
                        ↻ 내 진도 위치 다시 잡기 (오늘 일정 기준)
                    </button>
                </p>
            </div>
            <label class="switch" for="progress-mode-toggle">
                <input type="checkbox" id="progress-mode-toggle" ${cur.progressMode === 'manual' ? 'checked' : ''}>
                <span class="switch-slider"></span>
            </label>
        </div>

        <div class="settings-row" style="margin-top: var(--sp-4);">
            <div class="settings-row-text">
                <h4 style="margin:0;font-size:14px;font-weight:600;">매일성경 링크 보이기</h4>
                <p class="section-desc" style="margin-top:4px;">본문 카드 맨 아래에 "매일성경에서 본문·해설 보기" 한 줄을 띄워요. 누르면 새 창에서 성서유니온 사이트로 이동해요.</p>
            </div>
            <label class="switch" for="daily-bible-link-toggle">
                <input type="checkbox" id="daily-bible-link-toggle" ${cur.showDailyBibleLink ? 'checked' : ''}>
                <span class="switch-slider"></span>
            </label>
        </div>
    `;
}

/**
 * Phase E-8/B-3: 활성 plan의 각 파트별 "시작점" 행 + 인라인 편집 폼.
 * plan이 바뀌면 다시 호출해서 패널을 새로 그림.
 */
function renderAnchorPanel() {
    const panel = document.getElementById('scripture-anchor-panel');
    if (!panel) return;
    const plan = getActivePlan();
    const parts = resolvePlanParts(plan); // PRESET / user plan 정규화
    const today = todayLocalISOForUI();

    const isUserPlan = typeof plan.id === 'string' && plan.id.startsWith('user-');
    const rows = parts.map(part => {
        const partId = part.id;            // number(PRESET) 또는 string(user)
        const override = getPartOverride(plan.id, partId);
        const cur = override
            ? findBookFull(part, override.abbr) + ' ' + override.chapter + '장'
              + ` <span class="anchor-since">(${override.anchorDate}부터)</span>`
            : `<span class="anchor-default">기본값으로 진행 중</span>`;
        const initialAbbr = override?.abbr || part.books[0][0];
        const initialChapter = override?.chapter || 1;
        const bookOptions = part.books.map(([abbr, full]) => `
            <option value="${abbr}" ${abbr === initialAbbr ? 'selected' : ''}>${full}</option>
        `).join('');
        const maxCh = chaptersOf(part, initialAbbr);
        const label = part.name && part.name.includes('파트')
            ? part.name.replace('파트', 'P')
            : '내 계획';

        return `
            <div class="anchor-row" data-part="${partId}">
                <div class="anchor-head">
                    <span class="anchor-part-label">${label}</span>
                    <span class="anchor-current">${cur}</span>
                    <div class="anchor-actions">
                        <button class="text-btn anchor-edit-btn" type="button">변경</button>
                        ${override && !isUserPlan ? '<button class="text-btn anchor-reset-btn" type="button">기본값</button>' : ''}
                    </div>
                </div>
                <div class="anchor-form hidden">
                    <label class="anchor-field">
                        <span>책</span>
                        <select class="anchor-book">${bookOptions}</select>
                    </label>
                    <label class="anchor-field">
                        <span>장</span>
                        <input class="anchor-chapter" type="number" min="1" max="${maxCh}" value="${initialChapter}">
                    </label>
                    <label class="anchor-field">
                        <span>시작일</span>
                        <input class="anchor-date" type="date" value="${override?.anchorDate || today}">
                    </label>
                    <div class="anchor-form-actions">
                        <button class="primary-btn anchor-apply-btn" type="button">적용</button>
                        <button class="text-btn anchor-cancel-btn" type="button">취소</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    panel.innerHTML = rows || '<p class="setting-hint">표시할 파트가 없어요.</p>';
    bindAnchorRowEvents(panel, plan, parts);
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

function findBookFull(part, abbr) {
    const found = part.books.find(b => b[0] === abbr);
    return found ? found[1] : abbr;
}

function chaptersOf(part, abbr) {
    const found = part.books.find(b => b[0] === abbr);
    return found ? found[2] : 1;
}

function todayLocalISOForUI() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function bindAnchorRowEvents(panel, plan, parts) {
    const planId = plan.id;
    panel.querySelectorAll('.anchor-row').forEach(row => {
        // data-part는 number 또는 string. 비교는 String으로 통일.
        const partKey = row.dataset.part;
        const part = parts.find(p => String(p.id) === partKey);
        if (!part) return;
        const partId = part.id;

        const form = row.querySelector('.anchor-form');
        const head = row.querySelector('.anchor-head');
        const editBtn = row.querySelector('.anchor-edit-btn');
        const resetBtn = row.querySelector('.anchor-reset-btn');
        const applyBtn = row.querySelector('.anchor-apply-btn');
        const cancelBtn = row.querySelector('.anchor-cancel-btn');
        const bookSel = row.querySelector('.anchor-book');
        const chapterInp = row.querySelector('.anchor-chapter');
        const dateInp = row.querySelector('.anchor-date');

        editBtn?.addEventListener('click', () => {
            form.classList.toggle('hidden');
            head.classList.toggle('open');
        });
        cancelBtn?.addEventListener('click', () => {
            form.classList.add('hidden');
            head.classList.remove('open');
        });
        // 책이 바뀌면 max chapter 갱신 + 현재값 클램프
        bookSel?.addEventListener('change', () => {
            const max = chaptersOf(part, bookSel.value);
            chapterInp.max = String(max);
            if (parseInt(chapterInp.value, 10) > max) chapterInp.value = String(max);
        });
        applyBtn?.addEventListener('click', () => {
            const abbr = bookSel.value;
            const chapter = parseInt(chapterInp.value, 10);
            const max = chaptersOf(part, abbr);
            if (!chapter || chapter < 1 || chapter > max) {
                chapterInp.focus();
                return;
            }
            setPartOverride(planId, partId, {
                abbr,
                chapter,
                anchorDate: dateInp.value || todayLocalISOForUI(),
            });
            renderAnchorPanel(); // 행을 새로 그려 "현재" 표시 갱신
        });
        resetBtn?.addEventListener('click', () => {
            clearPartOverride(planId, partId);
            renderAnchorPanel();
        });
    });
}

/**
 * (S-D 후속 2026-05-15) 시스템 글자 크기 4단계 칩 — 클릭 즉시 적용 + localStorage 저장.
 */
function bindSystemFontSettings() {
    const row = document.getElementById('settings-system-font-row');
    if (!row) return;
    const current = getSystemFontScale();
    row.innerHTML = Object.entries(SYSTEM_FONT_SIZES).map(([id, cfg]) => `
        <button type="button"
                class="settings-font-chip${current === id ? ' selected' : ''}"
                data-system-font="${id}">
            <span class="settings-font-chip-label">${escapeText(cfg.label)}</span>
            <span class="settings-font-chip-desc">${escapeText(cfg.desc)}</span>
        </button>
    `).join('');
    row.querySelectorAll('.settings-font-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.systemFont;
            if (!SYSTEM_FONT_SIZES[id]) return;
            setSystemFontScale(id);
            row.querySelectorAll('.settings-font-chip').forEach(b => {
                b.classList.toggle('selected', b === btn);
            });
        });
    });
}

/**
 * (디자인 시스템 v1 2026-05-15) 강조 색 카드 — 3색 사용자 선택.
 *   시스템 폰트 카드와 같은 패턴 (chip-row + selected 토글).
 */
function bindAccentColorSettings() {
    const row = document.getElementById('settings-accent-color-row');
    if (!row) return;
    const current = getAccentColor();
    row.innerHTML = Object.entries(ACCENT_COLORS).map(([id, cfg]) => `
        <button type="button"
                class="settings-font-chip${current === id ? ' selected' : ''}"
                data-accent-color="${id}">
            <span class="settings-font-chip-label">${escapeText(cfg.label)}</span>
            <span class="settings-font-chip-desc">${escapeText(cfg.desc)}</span>
        </button>
    `).join('');
    row.querySelectorAll('.settings-font-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.accentColor;
            if (!ACCENT_COLORS[id]) return;
            setAccentColor(id);
            row.querySelectorAll('.settings-font-chip').forEach(b => {
                b.classList.toggle('selected', b === btn);
            });
        });
    });
}

/**
 * (베타 슬림 v1 2026-05-18) tier 토글 칩 — 'full' vs 'slim'.
 *   클릭 즉시 <html data-tier> 적용 + localStorage 저장 + 사이드바 메뉴 자동 분기.
 */
function bindTierSettings() {
    const row = document.getElementById('settings-tier-row');
    if (!row) return;
    const current = getTier();
    row.innerHTML = Object.entries(TIERS).map(([id, cfg]) => `
        <button type="button"
                class="settings-tier-chip"
                role="radio"
                aria-checked="${current === id ? 'true' : 'false'}"
                data-tier="${id}">
            <span class="settings-tier-chip-label">${escapeText(cfg.label)}</span>
            <span class="settings-tier-chip-desc">${escapeText(cfg.desc)}</span>
        </button>
    `).join('');
    row.querySelectorAll('.settings-tier-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.tier;
            if (!TIERS[id]) return;
            setTier(id);
            row.querySelectorAll('.settings-tier-chip').forEach(b => {
                b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
            });
        });
    });
}

/**
 * (S-D 후속 2026-05-15) 성경 번역본 카드 — 개역개정 디폴트 + 다른 번역본 "준비 중".
 *   선택 시 selfCard.bibleVersion 저장 (preparing=true 옵션은 클릭 비활성).
 */
async function bindBibleVersionSettings() {
    const list = document.getElementById('settings-bible-version-list');
    if (!list || !_userId || _userId === 'anonymous') return;
    const dek = getDEK();
    if (!dek) return;
    let currentVersion = DEFAULT_BIBLE_VERSION;
    try {
        const card = await ensureSelfCard(dek, _userId);
        currentVersion = card?.bibleVersion || DEFAULT_BIBLE_VERSION;
    } catch (e) { console.warn('[settings] bibleVersion read failed:', e?.message || e); }

    const render = () => {
        list.innerHTML = BIBLE_VERSIONS.map(v => `
            <button type="button"
                    class="settings-bible-card${currentVersion === v.id ? ' selected' : ''}${v.preparing ? ' disabled' : ''}"
                    data-version="${v.id}"
                    ${v.preparing ? 'aria-disabled="true"' : ''}>
                <span class="settings-bible-name">
                    ${escapeText(v.label)}
                    ${v.preparing ? '<span class="settings-bible-chip">준비 중</span>' : ''}
                </span>
                <span class="settings-bible-desc">${escapeText(v.desc)}</span>
            </button>
        `).join('');
        list.querySelectorAll('.settings-bible-card').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.version;
                const opt = BIBLE_VERSIONS.find(v => v.id === id);
                if (!opt || opt.preparing) return;
                currentVersion = id;
                render();
                try {
                    const card = await ensureSelfCard(dek, _userId);
                    await saveSelfCard(dek, _userId, { ...card, bibleVersion: id });
                } catch (e) { console.warn('[settings] bibleVersion save failed:', e?.message || e); }
            });
        });
    };
    render();
}

function escapeText(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function bindScriptureSettingsEvents() {
    // 폰트 크기 — 라디오 변경 시 즉시 저장 + CSS 변수 갱신
    document.querySelectorAll('input[name="scripture-font"]').forEach(r => {
        r.addEventListener('change', (e) => {
            const v = e.target.value;
            setFontSize(v);
            applyFontSizeToCSS(v);
        });
    });

    // 묵상 계획 라디오 — 즉시 저장 + 시작점 패널 다시 그림.
    document.querySelectorAll('input[name="scripture-plan"]').forEach(r => {
        r.addEventListener('change', (e) => {
            setActivePlanId(e.target.value);
            renderAnchorPanel();
        });
    });

    // Phase E-8/B-2: 새 계획 만들기 버튼
    const addBtn = document.getElementById('scripture-plan-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', openNewPlanModal);
    }

    // user plan 삭제 버튼 — 라벨 클릭과 분리 (stopPropagation)
    document.querySelectorAll('.plan-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const planId = btn.dataset.plan;
            const userPlan = getUserPlans().find(p => p.id === planId);
            if (!userPlan) return;
            if (!confirm(`"${userPlan.name}" 계획을 지울게요. 본문은 그대로지만 이 계획은 사라져요.\n계속할까요?`)) return;
            deleteUserPlan(planId);
            // 전체 말씀 본문 카드를 다시 그려서 라디오/패널 갱신
            refreshScriptureCard();
        });
    });

    // Phase E-8/C: 매일성경 링크 보이기 토글
    const dbLinkToggle = document.getElementById('daily-bible-link-toggle');
    if (dbLinkToggle) {
        dbLinkToggle.addEventListener('change', (e) => {
            setShowDailyBibleLink(e.target.checked);
        });
    }

    // Phase E-8/E: 묵상 안 한 날 본문 미루기 토글 (calendar ↔ manual)
    const progressToggle = document.getElementById('progress-mode-toggle');
    if (progressToggle) {
        progressToggle.addEventListener('change', (e) => {
            const turnOnManual = e.target.checked;
            // manual로 켤 때는 모드 바꾸기 전에 먼저 시드 → 진도가 뚝 떨어지는 걸 막음.
            // (시드 함수는 mode와 무관하게 calendar 결과로 position을 박음)
            if (turnOnManual) seedManualPositionsFromCalendar();
            setProgressMode(turnOnManual ? 'manual' : 'calendar');
        });
    }

    // Phase E-8/E-2: 진도 위치 복구 — 잘못 눌러 앞서간 manual 위치를 오늘 calendar 기준으로 재시드
    const resetBtn = document.getElementById('scripture-reset-progress-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (!confirm('수동 모드에서 박아둔 모든 파트 위치와 "오늘 다 읽었어요" 도장을 비울게요.\n다음 본문은 오늘 일정 기준으로 다시 정해져요. 계속할까요?')) return;
            resetManualProgress();
            // 즉시 본문 다시 그리도록 이벤트 발행 — settings-changed가 scripture.js를 재렌더시킴
            window.dispatchEvent(new CustomEvent('sanctum:scripture-settings-changed'));
            resetBtn.textContent = '✅ 위치를 다시 잡았어요';
            setTimeout(() => { resetBtn.textContent = '↻ 내 진도 위치 다시 잡기 (오늘 일정 기준)'; }, 2500);
        });
    }

    // 시작점 패널 초기 렌더
    renderAnchorPanel();
}

function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/** 말씀 본문 카드를 통째로 다시 그림 (plan 추가/삭제 후 라디오 갱신용). */
function refreshScriptureCard() {
    const card = document.getElementById('settings-scripture-card');
    if (!card) return;
    card.innerHTML = renderScriptureSettingsHTML();
    bindScriptureSettingsEvents();
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

/**
 * Phase E-8/B-2: "새 묵상 계획 만들기" 모달.
 * 이름 입력 + 책 자유 선택(4파트 그룹). 1권 이상 선택 + 이름 있으면 [만들기] 활성.
 * 만들면 그 계획으로 자동 활성화되고 카드 다시 그림.
 */
function openNewPlanModal() {
    // 이미 열려있으면 무시
    if (document.getElementById('new-plan-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'new-plan-modal';
    overlay.className = 'modal-overlay';

    const bookGroups = BIBLE_METADATA.parts.map(part => {
        const items = part.books.map(([abbr, full]) => `
            <label class="newplan-book">
                <input type="checkbox" name="newplan-book" value="${abbr}" data-full="${escapeAttr(full)}" data-chapters="${part.books.find(b => b[0] === abbr)[2]}">
                <span>${full}</span>
            </label>
        `).join('');
        return `
            <div class="newplan-group">
                <div class="newplan-group-title">${part.name.replace('파트', 'P')} <span class="newplan-group-desc">${part.desc}</span></div>
                <div class="newplan-group-books">${items}</div>
            </div>
        `;
    }).join('');

    overlay.innerHTML = `
        <div class="modal-box modal-box--wide" role="dialog" aria-label="새 묵상 계획 만들기">
            <div class="modal-head">
                <h3>새 묵상 계획 만들기</h3>
                <button class="modal-close-btn" type="button" aria-label="닫기">×</button>
            </div>
            <div class="modal-body">
                <label class="newplan-field">
                    <span>이름</span>
                    <input id="newplan-name" type="text" maxlength="40"
                           placeholder="예: 시편만 1년, 복음서 묵상, 욥기·전도서…">
                </label>
                <div class="newplan-field">
                    <span>책 (1권 이상)</span>
                    <p class="setting-hint" style="margin: 4px 0 var(--sp-2);">고른 책을 처음부터 한 장씩, 매일 한 장 진행해요. 시작일은 오늘로 자동 설정돼요. 나중에 "시작점"에서 바꿀 수 있어요.</p>
                    <div id="newplan-books" class="newplan-books">${bookGroups}</div>
                </div>
                <div class="newplan-summary">
                    <span id="newplan-count">0권 선택</span>
                </div>
            </div>
            <div class="modal-foot">
                <button class="text-btn modal-cancel-btn" type="button">취소</button>
                <button id="newplan-create-btn" class="primary-btn" type="button" disabled>만들기</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();

    const nameInp = overlay.querySelector('#newplan-name');
    const countEl = overlay.querySelector('#newplan-count');
    const createBtn = overlay.querySelector('#newplan-create-btn');

    const refreshState = () => {
        const checked = overlay.querySelectorAll('input[name="newplan-book"]:checked');
        countEl.textContent = `${checked.length}권 선택`;
        const ready = checked.length > 0 && nameInp.value.trim().length > 0;
        createBtn.disabled = !ready;
    };
    overlay.addEventListener('change', (e) => {
        if (e.target?.name === 'newplan-book') refreshState();
    });
    nameInp.addEventListener('input', refreshState);

    // 닫기
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close-btn').addEventListener('click', close);
    overlay.querySelector('.modal-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // 만들기 — 체크된 책들을 [abbr, full, chapters] 튜플로 모아 addUserPlan
    createBtn.addEventListener('click', () => {
        const checked = [...overlay.querySelectorAll('input[name="newplan-book"]:checked')];
        if (checked.length === 0) return;
        // 원래 4파트 순서를 유지하려면 BIBLE_METADATA 순서대로 모음
        const checkedSet = new Set(checked.map(c => c.value));
        const books = [];
        BIBLE_METADATA.parts.forEach(part => {
            part.books.forEach(([abbr, full, chapters]) => {
                if (checkedSet.has(abbr)) books.push([abbr, full, chapters]);
            });
        });
        const plan = addUserPlan({ name: nameInp.value, books });
        close();
        if (plan) refreshScriptureCard();
    });

    setTimeout(() => nameInp.focus(), 50);
}

