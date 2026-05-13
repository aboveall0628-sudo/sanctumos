/**
 * auth.js — Google 인증 및 마스터 비밀번호(Vault) 온보딩 흐름 제어
 */

import { setupNewVault, recoverWithWords, changePassword } from '../crypto/keyManager.js';
import { db, doc, setDoc, getDoc, serverTimestamp, auth } from '../data/firebase.js';
import { loadUserVaultData } from './app.js'; // to get wrappedDEK_recovery
import { validatePassword, firstError, bindPolicyHint, POLICY_VERSION } from '../crypto/passwordPolicy.js';
import { createEmailSlot, unwrapDEKWithEmailSlot } from '../crypto/emailRecoverySlot.js';
import {
    requestRecoveryCode, verifyRecoveryCode, redeemRecoverySeed, rotateRecoverySeed,
} from '../crypto/emailRecoveryClient.js';

let _onSetupComplete = null;
let _currentUserId = null;

export function initAuth({ onSetupComplete }) {
    _onSetupComplete = onSetupComplete;
    renderSetupScreen();
    bindEvents();
}

export function showSetupScreen(userId) {
    _currentUserId = userId;
    const overlay = document.getElementById('setup-screen-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        // 1단계 화면으로 리셋
        document.getElementById('setup-step-1').classList.remove('hidden');
        document.getElementById('setup-step-2').classList.add('hidden');
        // 정책 힌트 실시간 바인딩
        bindPolicyHint(
            document.getElementById('setup-pwd-1'),
            document.getElementById('setup-pwd-hint')
        );
    }
}

export function hideSetupScreen() {
    const overlay = document.getElementById('setup-screen-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
    }
}

export function showGoogleLoginScreen() {
    const overlay = document.getElementById('google-login-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
    }
}

export function hideGoogleLoginScreen() {
    const overlay = document.getElementById('google-login-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
    }
}

function renderSetupScreen() {
    if (document.getElementById('setup-screen-overlay')) return;

    // 1. 구글 로그인 오버레이
    const loginOverlay = document.createElement('div');
    loginOverlay.id = 'google-login-overlay';
    loginOverlay.className = 'lock-screen-overlay hidden';
    loginOverlay.innerHTML = `
        <div class="lock-screen-box">
            <div class="lock-icon">🕊️</div>
            <h2>Sanctum OS</h2>
            <p class="lock-subtitle">매일의 일상, 매일의 성소, 하나의 시스템</p>
            <button id="auth-main-google-btn" class="primary-btn" style="width:100%; font-size:16px; padding:16px">
                Google 계정으로 시작하기
            </button>
        </div>
    `;
    document.body.appendChild(loginOverlay);

    // 2. 최초 설정 오버레이
    const setupOverlay = document.createElement('div');
    setupOverlay.id = 'setup-screen-overlay';
    setupOverlay.className = 'lock-screen-overlay hidden';
    setupOverlay.innerHTML = `
        <div class="lock-screen-box" style="max-width: 400px;">
            <!-- 단계 1: 비밀번호 설정 -->
            <div id="setup-step-1">
                <div class="lock-icon">🗝️</div>
                <h2>나만의 비밀번호 만들기</h2>
                <p class="lock-subtitle">내 묵상과 기록을 안전하게 지켜줄 열쇠예요.<br><strong style="color:var(--dot-red)">잃어버리면 다시 만들 수 없으니 꼭 기억해 주세요.</strong></p>
                <input type="password" id="setup-pwd-1" class="lock-input" placeholder="비밀번호" />
                <div id="setup-pwd-hint" class="pw-policy-hint"></div>
                <input type="password" id="setup-pwd-2" class="lock-input" placeholder="한 번 더 입력" />
                <div id="setup-error" class="lock-error hidden"></div>
                <button id="setup-next-btn" class="primary-btn" style="width:100%">다음으로</button>
            </div>

            <!-- 단계 2: 복구 코드 -->
            <div id="setup-step-2" class="hidden">
                <div class="lock-icon">📄</div>
                <h2>복구 코드 24단어</h2>
                <p class="lock-subtitle" style="text-align:left; font-size:13px;">비밀번호를 잊었을 때 내 데이터를 다시 열 수 있는 <strong>유일한 열쇠</strong>예요.<br>종이에 적거나 비밀번호 매니저에 꼭 보관해 주세요. 창을 닫으면 다시 볼 수 없어요.</p>
                <div id="recovery-words-box" class="recovery-words-grid"></div>
                <label class="confirm-checkbox">
                    <input type="checkbox" id="setup-confirm-chk" />
                    <span>네, 안전한 곳에 적어뒀어요</span>
                </label>
                <p style="font-size:12px; color:var(--text-secondary); margin-top:12px; text-align:left; line-height:1.6;">
                    💡 24단어를 잃어버리는 비상 상황을 대비해, 가입 후 [설정 → 이메일 복구]에서
                    <strong>두 번째 안전망</strong>을 등록해 둘 수 있어요. (서버측 인증 시스템 도입 후 활성화)
                </p>
                <button id="setup-finish-btn" class="primary-btn" style="width:100%" disabled>다음으로</button>
            </div>

            <!-- 단계 3: 샘플 목표 선택 -->
            <div id="setup-step-3" class="hidden">
                <div class="lock-icon">🎯</div>
                <h2>샘플 목표를 깔아둘까요?</h2>
                <p class="lock-subtitle" style="text-align:left; font-size:13px;">
                    10년 후 모습부터 이번 주 한 걸음까지, 영적 성장을 위한 <strong>예시 목표 4개</strong>를 미리 깔아둘 수 있어요.<br>
                    언제든 [나의 목표]에서 직접 수정하거나 지울 수 있어요.
                </p>
                <div class="setup-sample-preview">
                    <div class="setup-sample-item">🌌 <strong>10년 후</strong> — 하나님과 동행하는 삶의 기반 세우기</div>
                    <div class="setup-sample-item">🎯 <strong>올해</strong> — 매일 한 줄 묵상 이어가기</div>
                    <div class="setup-sample-item">📊 <strong>이번 분기</strong> — 통독 파트1 완독</div>
                    <div class="setup-sample-item">📅 <strong>이번 주</strong> — 묵상 5일 이상</div>
                </div>
                <div style="display:flex; gap:8px; margin-top: var(--sp-4)">
                    <button id="setup-skip-samples-btn" class="text-btn" style="flex:1">빈 상태로 시작</button>
                    <button id="setup-with-samples-btn" class="primary-btn" style="flex:2">샘플과 함께 시작</button>
                </div>
            </div>

            <!-- 단계 4: 환영 -->
            <div id="setup-step-4" class="hidden">
                <div class="lock-icon">🕊️</div>
                <h2>준비됐어요</h2>
                <p class="lock-subtitle" style="text-align:left; font-size:13px;">
                    Sanctum OS는 매일의 일상을 매일의 성소로 잇는 <strong>하나의 시스템</strong>이에요.<br>
                    오늘 하루를 정직하게 마주하고, 한 걸음씩 자라나는 곳이에요.
                </p>
                <ul style="text-align:left; font-size:13px; color:var(--text-secondary); margin: var(--sp-4) 0; line-height: 1.9; padding-left: var(--sp-5)">
                    <li>아침 — 말씀과 함께 한 줄 묵상</li>
                    <li>낮 — 시간표에 결단을 박고 살아내기</li>
                    <li>저녁 — 통합 루프로 오늘 정리하기</li>
                </ul>
                <button id="setup-go-btn" class="primary-btn" style="width:100%">첫 묵상으로 가기</button>
            </div>
        </div>
    `;
    document.body.appendChild(setupOverlay);

    // 3. 복구 화면 오버레이 (방법 선택 → 24단어 / 이메일 분기)
    const recoveryOverlay = document.createElement('div');
    recoveryOverlay.id = 'recovery-screen-overlay';
    recoveryOverlay.className = 'lock-screen-overlay hidden';
    recoveryOverlay.innerHTML = `
        <div class="lock-screen-box" style="max-width: 460px;">
            <!-- 방법 선택 -->
            <div id="recovery-method-select">
                <div class="lock-icon">🔑</div>
                <h2>복구 방법 선택</h2>
                <p class="lock-subtitle" style="text-align:left; font-size:13px;">
                    적어둔 <strong>24단어</strong>가 있거나, 설정에서 <strong>이메일 복구</strong>를 등록해 두셨다면
                    두 방법 중 하나로 다시 들어올 수 있어요.
                </p>
                <div style="display:flex; flex-direction:column; gap:8px; margin: 16px 0;">
                    <button id="recovery-go-words-btn" class="primary-btn" style="width:100%">📄 24단어로 복구</button>
                    <button id="recovery-go-email-btn" class="primary-btn" style="width:100%">📧 이메일로 복구</button>
                </div>
                <button id="recovery-cancel-btn" class="text-btn" style="width:100%">취소</button>
            </div>

            <!-- 24단어 입력 -->
            <div id="recovery-words-form" class="hidden">
                <div class="lock-icon">📄</div>
                <h2>24단어로 열기</h2>
                <p class="lock-subtitle">적어두신 24단어를 띄어쓰기로 구분해서 적어주세요.</p>
                <textarea id="recovery-words-input" class="lock-input" style="height:120px; font-size:14px; text-align:left; resize:none;" placeholder="단어1 단어2 단어3 ..."></textarea>
                <div id="recovery-error" class="lock-error hidden"></div>
                <div style="display:flex; gap:8px;">
                    <button id="recovery-back-from-words-btn" class="text-btn" style="flex:1">뒤로</button>
                    <button id="recovery-submit-btn" class="primary-btn" style="flex:2">열기</button>
                </div>
                <p style="font-size:12px; color:var(--text-secondary); margin-top:16px;">열고 나면 설정에서 새 비밀번호로 꼭 바꿔주세요.</p>
            </div>

            <!-- 이메일 복구 -->
            <div id="recovery-email-form" class="hidden">
                <div class="lock-icon">📧</div>
                <h2>이메일로 복구</h2>
                <p class="lock-subtitle" style="text-align:left; font-size:13px;" id="recovery-email-step-desc">
                    설정에서 등록해 둔 이메일을 입력해 주세요. 6자리 코드를 보내드릴게요.
                </p>
                <input id="recovery-email-input" type="email" class="lock-input" placeholder="등록한 이메일" autocomplete="email" />
                <button id="recovery-email-send-btn" class="primary-btn" style="width:100%">코드 보내기</button>
                <div id="recovery-email-code-row" class="hidden" style="margin-top:12px;">
                    <input id="recovery-email-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" class="lock-input" style="text-align:center;letter-spacing:8px;font-size:20px;" placeholder="6자리 코드" />
                    <button id="recovery-email-verify-btn" class="primary-btn" style="width:100%; margin-top:8px;">확인하고 열기</button>
                </div>
                <div id="recovery-email-error" class="lock-error hidden"></div>
                <div style="display:flex; gap:8px; margin-top:12px;">
                    <button id="recovery-back-from-email-btn" class="text-btn" style="flex:1">뒤로</button>
                </div>
                <p style="font-size:12px; color:var(--text-secondary); margin-top:16px;">코드는 5분 뒤 만료되고, 5회까지 시도할 수 있어요.</p>
            </div>
        </div>
    `;
    document.body.appendChild(recoveryOverlay);

    // 4. 비밀번호 정책 마이그레이션 오버레이 (Phase 1)
    const migrationOverlay = document.createElement('div');
    migrationOverlay.id = 'pw-migration-overlay';
    migrationOverlay.className = 'lock-screen-overlay hidden';
    migrationOverlay.innerHTML = `
        <div class="lock-screen-box" style="max-width: 420px;">
            <div class="lock-icon">🔐</div>
            <h2>보안 강화 안내</h2>
            <p class="lock-subtitle" style="text-align:left; font-size:13px;">
                Sanctum OS의 비밀번호 정책이 더 안전하게 강화됐어요.<br>
                기존 비밀번호로 들어오셨지만, <strong>지금 새 비밀번호로 한 번만 바꿔주시면</strong> 앞으로 더 든든해집니다.
            </p>
            <input type="password" id="pw-mig-new" class="lock-input" placeholder="새 비밀번호" autocomplete="new-password" />
            <div id="pw-mig-hint" class="pw-policy-hint"></div>
            <input type="password" id="pw-mig-new2" class="lock-input" placeholder="한 번 더 입력해 주세요" autocomplete="new-password" />
            <div id="pw-mig-error" class="lock-error hidden"></div>
            <button id="pw-mig-submit-btn" class="primary-btn" style="width:100%">바꾸고 들어가기</button>
            <p style="font-size:12px; color:var(--text-secondary); margin-top:12px;">
                💡 데이터는 그대로 유지돼요. 자물쇠만 새 것으로 바꾸는 거예요.
            </p>
        </div>
    `;
    document.body.appendChild(migrationOverlay);
}

/**
 * 비밀번호 정책 마이그레이션 모달 표시 (Phase 1)
 * 기존 사용자가 v1(4자+) 비밀번호로 unlock 성공했을 때, v2 정책으로 강제 업그레이드.
 *
 * @param {Object} args
 * @param {CryptoKey} args.dek - 이미 unlock된 DEK
 * @param {string} args.userId
 * @param {Function} args.onComplete - 완료 콜백 (dek 그대로 전달)
 */
export function showPasswordMigrationModal({ dek, userId, onComplete }) {
    const overlay = document.getElementById('pw-migration-overlay');
    if (!overlay) {
        console.error('[auth] pw-migration-overlay not rendered');
        return;
    }
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';

    const inputNew = document.getElementById('pw-mig-new');
    const inputNew2 = document.getElementById('pw-mig-new2');
    const hintEl = document.getElementById('pw-mig-hint');
    const errEl = document.getElementById('pw-mig-error');
    const btn = document.getElementById('pw-mig-submit-btn');

    inputNew.value = '';
    inputNew2.value = '';
    errEl.classList.add('hidden');
    bindPolicyHint(inputNew, hintEl);
    inputNew.focus();

    // 동일 모달이 재호출될 수 있으므로 핸들러를 onclick으로 교체 (cloneNode 패턴 회피)
    btn.onclick = async () => {
        const newPw = inputNew.value;
        const newPw2 = inputNew2.value;

        if (!validatePassword(newPw).ok) {
            showErr(errEl, firstError(newPw));
            return;
        }
        if (newPw !== newPw2) {
            showErr(errEl, '두 번 입력한 게 다른 것 같아요.');
            return;
        }

        btn.disabled = true;
        btn.textContent = '바꾸는 중...';

        try {
            const re = await changePassword(dek, newPw);
            await setDoc(doc(db, 'users', userId), {
                masterKeySalt: re.salt,
                wrappedDEK_master: re.wrappedDEK_master,
                wrappedDEK_master_iv: re.wrappedDEK_master_iv,
                kdfParams: re.kdfParams,
                passwordPolicyVersion: POLICY_VERSION,
            }, { merge: true });

            overlay.classList.add('hidden');
            overlay.style.display = 'none';
            if (onComplete) onComplete(dek);
        } catch (error) {
            console.error('[auth] password migration failed:', error);
            showErr(errEl, '잠깐 문제가 있었어요. 다시 한 번 해볼까요?');
            btn.disabled = false;
            btn.textContent = '바꾸고 들어가기';
        }
    };
}

function bindEvents() {
    // 구글 로그인 연동 (app.js의 handleAuthClick 이벤트를 디스패치)
    document.body.addEventListener('click', (e) => {
        if (e.target.id === 'auth-main-google-btn') {
            document.dispatchEvent(new CustomEvent('sanctum:request-google-login'));
        }
    });

    // 단계 1 -> 2
    document.body.addEventListener('click', async (e) => {
        if (e.target.id === 'setup-next-btn') {
            const p1 = document.getElementById('setup-pwd-1').value;
            const p2 = document.getElementById('setup-pwd-2').value;
            const err = document.getElementById('setup-error');

            if (!validatePassword(p1).ok) {
                showErr(err, firstError(p1));
                return;
            }
            if (p1 !== p2) {
                showErr(err, '두 번 입력한 게 다른 것 같아요.');
                return;
            }

            e.target.textContent = '안전한 열쇠 만드는 중...';
            e.target.disabled = true;

            try {
                // 키마스터로 DEK 및 복구코드 생성
                const vaultData = await setupNewVault(p1);

                // Firestore에 키 메타데이터 저장 (dek와 recoveryWords 제외)
                await setDoc(doc(db, 'users', _currentUserId), {
                    masterKeySalt: vaultData.salt,
                    wrappedDEK_master: vaultData.wrappedDEK_master,
                    wrappedDEK_master_iv: vaultData.wrappedDEK_master_iv,
                    wrappedDEK_recovery: vaultData.wrappedDEK_recovery,
                    wrappedDEK_recovery_iv: vaultData.wrappedDEK_recovery_iv,
                    kdfParams: vaultData.kdfParams,
                    passwordPolicyVersion: POLICY_VERSION,
                    createdAt: serverTimestamp()
                });

                // ── 트랙 2 Phase 3: 가입 직후 이메일 복구 자동 등록 (best effort) ──
                // 실패해도 가입 자체는 계속 진행. 사용자가 [설정 → 이메일 복구]에서 다시 등록 가능.
                let _autoSlotKeyRaw = null;
                try {
                    const userEmail = auth.currentUser?.email;
                    if (userEmail) {
                        const slot = await createEmailSlot(vaultData.dek);
                        _autoSlotKeyRaw = slot.emailSlotKeyRaw;
                        const { registerEmailRecovery } = await import('../crypto/emailRecoveryClient.js');
                        await registerEmailRecovery({
                            emailSlotKey: _autoSlotKeyRaw,
                            wrappedDEK_email: slot.wrappedDEK_email,
                            wrappedDEK_email_iv: slot.wrappedDEK_email_iv,
                            recoveryEmail: userEmail,
                        });
                        console.info('[auth] email recovery auto-registered for', userEmail);
                    }
                } catch (regErr) {
                    console.warn('[auth] email recovery auto-register skipped:', regErr?.message);
                } finally {
                    _autoSlotKeyRaw = null; // 메모리 폐기 (GC 의존)
                }

                // 복구 단어 표시
                document.getElementById('setup-step-1').classList.add('hidden');
                document.getElementById('setup-step-2').classList.remove('hidden');
                
                const wordsBox = document.getElementById('recovery-words-box');
                wordsBox.innerHTML = vaultData.recoveryWords.map((w, i) => 
                    `<div class="word-chip"><span class="w-num">${i+1}.</span> ${w}</div>`
                ).join('');

                // 단계 2 → 3 (샘플 목표 선택)
                document.getElementById('setup-finish-btn').onclick = () => {
                    document.getElementById('setup-step-2').classList.add('hidden');
                    document.getElementById('setup-step-3').classList.remove('hidden');
                };

                // 단계 3 → 4 (샘플 포함 / 빈 상태)
                const goWithSamples = () => {
                    document.getElementById('setup-step-3').classList.add('hidden');
                    document.getElementById('setup-step-4').classList.remove('hidden');
                    if (_onSetupComplete) _onSetupComplete(vaultData.dek, { includeSampleGoals: true });
                };
                const goWithoutSamples = () => {
                    document.getElementById('setup-step-3').classList.add('hidden');
                    document.getElementById('setup-step-4').classList.remove('hidden');
                    if (_onSetupComplete) _onSetupComplete(vaultData.dek, { includeSampleGoals: false });
                };
                document.getElementById('setup-with-samples-btn').onclick = goWithSamples;
                document.getElementById('setup-skip-samples-btn').onclick = goWithoutSamples;

                // 단계 4 → 메인 화면
                document.getElementById('setup-go-btn').onclick = () => {
                    hideSetupScreen();
                };

            } catch (error) {
                console.error(error);
                showErr(err, '잠깐 문제가 있었어요. 다시 한 번 해볼까요?');
                e.target.textContent = '다음으로';
                e.target.disabled = false;
            }
        }
    });

    // 체크박스 제어
    document.body.addEventListener('change', (e) => {
        if (e.target.id === 'setup-confirm-chk') {
            document.getElementById('setup-finish-btn').disabled = !e.target.checked;
        }
    });
    // 복구 모드 전환 — 방법 선택 화면부터
    document.addEventListener('sanctum:recovery-requested', () => {
        const overlay = document.getElementById('recovery-screen-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        showRecoveryStep('method');
        // 입력 초기화
        const wi = document.getElementById('recovery-words-input');     if (wi) wi.value = '';
        const ei = document.getElementById('recovery-email-input');    if (ei) ei.value = '';
        const ec = document.getElementById('recovery-email-code');     if (ec) ec.value = '';
        const cr = document.getElementById('recovery-email-code-row'); if (cr) cr.classList.add('hidden');
        hideErr(document.getElementById('recovery-error'));
        hideErr(document.getElementById('recovery-email-error'));
    });

    document.body.addEventListener('click', async (e) => {
        // ── 취소 (방법 선택 화면) ──
        if (e.target.id === 'recovery-cancel-btn') {
            document.getElementById('recovery-screen-overlay').classList.add('hidden');
            document.getElementById('recovery-screen-overlay').style.display = 'none';
        }

        // ── 방법 분기 ──
        if (e.target.id === 'recovery-go-words-btn') showRecoveryStep('words');
        if (e.target.id === 'recovery-go-email-btn') showRecoveryStep('email');
        if (e.target.id === 'recovery-back-from-words-btn' || e.target.id === 'recovery-back-from-email-btn') {
            showRecoveryStep('method');
        }

        // ── 24단어 흐름 (기존) ──
        if (e.target.id === 'recovery-submit-btn') {
            const inputStr = document.getElementById('recovery-words-input').value.trim();
            const err = document.getElementById('recovery-error');
            const words = inputStr.split(/\s+/);

            if (words.length !== 24) {
                showErr(err, `24단어를 모두 적어주세요. 지금은 ${words.length}개예요.`);
                return;
            }

            e.target.textContent = '여는 중...';
            e.target.disabled = true;

            try {
                const userDoc = await getDoc(doc(db, 'users', _currentUserId || window.currentUserId || 'anonymous'));
                if (!userDoc.exists()) throw new Error('계정 정보를 찾을 수 없어요.');
                const userData = userDoc.data();

                const dek = await recoverWithWords(words, userData.wrappedDEK_recovery, userData.wrappedDEK_recovery_iv, userData.kdfParams || null);

                document.getElementById('recovery-screen-overlay').classList.add('hidden');
                document.getElementById('recovery-screen-overlay').style.display = 'none';

                if (_onSetupComplete) _onSetupComplete(dek);

            } catch (error) {
                console.error(error);
                showErr(err, '단어가 맞지 않는 것 같아요. 순서와 철자를 한 번 더 봐주세요.');
            } finally {
                e.target.textContent = '열기';
                e.target.disabled = false;
            }
        }

        // ── 이메일 흐름: 코드 보내기 ──
        if (e.target.id === 'recovery-email-send-btn') {
            const email = (document.getElementById('recovery-email-input').value || '').trim();
            const err = document.getElementById('recovery-email-error');
            if (!email) { showErr(err, '등록한 이메일을 입력해 주세요.'); return; }

            e.target.disabled = true;
            e.target.textContent = '보내는 중...';
            try {
                await requestRecoveryCode(email);
                // 응답은 항상 ok — 등록 안 됐어도 ok로 응답 (열거 공격 방어).
                // UI는 "코드를 보냈어요" 안내만.
                document.getElementById('recovery-email-code-row').classList.remove('hidden');
                const desc = document.getElementById('recovery-email-step-desc');
                if (desc) desc.innerHTML = `등록된 이메일이라면 <strong>${email}</strong> 으로 6자리 코드를 보냈어요. 메일을 확인해 주세요.`;
                hideErr(err);
                document.getElementById('recovery-email-code').focus();
            } catch (error) {
                console.error('[recovery/email] request failed:', error);
                showErr(err, error?.message || '코드 발송에 실패했어요.');
            } finally {
                e.target.disabled = false;
                e.target.textContent = '코드 다시 보내기';
            }
        }

        // ── 이메일 흐름: 코드 검증 + 복원 + 회전 ──
        if (e.target.id === 'recovery-email-verify-btn') {
            const code = (document.getElementById('recovery-email-code').value || '').trim();
            const err = document.getElementById('recovery-email-error');
            if (!/^\d{6}$/.test(code)) {
                showErr(err, '6자리 숫자 코드를 입력해 주세요.');
                return;
            }

            e.target.disabled = true;
            e.target.textContent = '확인 중...';
            try {
                // 1) 코드 검증 → token
                const { token } = await verifyRecoveryCode(code);

                // 2) token → emailSlotKey (60초 단일 사용)
                const { emailSlotKey } = await redeemRecoverySeed(token);

                // 3) users 문서에서 wrappedDEK_email 로드 후 unwrap
                const userDoc = await getDoc(doc(db, 'users', _currentUserId || window.currentUserId || 'anonymous'));
                if (!userDoc.exists()) throw new Error('계정 정보를 찾을 수 없어요.');
                const userData = userDoc.data();
                if (!userData.wrappedDEK_email || !userData.wrappedDEK_email_iv) {
                    throw new Error('이메일 복구가 등록되어 있지 않아요.');
                }
                const dek = await unwrapDEKWithEmailSlot(emailSlotKey, userData.wrappedDEK_email, userData.wrappedDEK_email_iv);

                // 4) 슬롯 키 회전 (방금 노출된 키는 폐기, 새 키로 갈아끼움) — best effort, 실패해도 복구 진행
                try {
                    const newSlot = await createEmailSlot(dek);
                    await rotateRecoverySeed({
                        emailSlotKey: newSlot.emailSlotKeyRaw,
                        wrappedDEK_email: newSlot.wrappedDEK_email,
                        wrappedDEK_email_iv: newSlot.wrappedDEK_email_iv,
                    });
                    // 새 raw 키 메모리 폐기
                    // (newSlot.emailSlotKeyRaw는 함수 스코프에서 GC 처리)
                } catch (rotErr) {
                    console.warn('[recovery/email] rotate failed (non-fatal):', rotErr);
                }

                // 5) 복구 완료
                document.getElementById('recovery-screen-overlay').classList.add('hidden');
                document.getElementById('recovery-screen-overlay').style.display = 'none';
                if (_onSetupComplete) _onSetupComplete(dek);

            } catch (error) {
                console.error('[recovery/email] verify failed:', error);
                showErr(err, error?.message || '복구에 실패했어요.');
            } finally {
                e.target.disabled = false;
                e.target.textContent = '확인하고 열기';
            }
        }
    });
}

/**
 * 복구 화면 내 세 단계 전환: method / words / email
 */
function showRecoveryStep(step) {
    const m = document.getElementById('recovery-method-select');
    const w = document.getElementById('recovery-words-form');
    const e = document.getElementById('recovery-email-form');
    if (!m || !w || !e) return;
    m.classList.toggle('hidden', step !== 'method');
    w.classList.toggle('hidden', step !== 'words');
    e.classList.toggle('hidden', step !== 'email');
}

function hideErr(el) {
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
}

function showErr(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}
