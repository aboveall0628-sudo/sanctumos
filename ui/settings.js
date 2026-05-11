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
// Phase B-3: 예전 결단 정리용
import { getAllDecisions, deleteDecision } from '../data/decisionsRepo.js';
import { deleteCalendarEventById } from './app.js';
// 자동 잠금 분 단위 영속화
import { getSavedTimeoutMinutes, saveTimeoutMinutes } from '../security/autoLock.js';
// Phase E-8/A·B-1·B-2·B-3: 말씀 본문 표시 설정 (폰트 크기, 계획 프리셋, 시작점, 내 계획)
import {
    getScriptureSettings, getActivePlan, setFontSize, setActivePlanId,
    getPartOverride, setPartOverride, clearPartOverride,
    getUserPlans, addUserPlan, deleteUserPlan,
    FONT_SIZES, PRESETS, applyFontSizeToCSS,
} from './scriptureSettings.js';
import { BIBLE_METADATA, resolvePlanParts } from './scripture.js';

let _userId = null;
let _userEmail = null;
let _diagnosticData = null;

export function renderSettingsView(userId, userEmail) {
    _userId = userId;
    _userEmail = userEmail || null;
    injectExtraSections();
    bindEvents();
    // v1 식별자 입력란에 이메일 기본값 채우기
    const v1Input = document.getElementById('v1-id-input');
    if (v1Input && _userEmail && !v1Input.value) v1Input.value = _userEmail;
    // 비밀번호 정책 힌트 실시간 바인딩
    bindPolicyHint(
        document.getElementById('pw-new'),
        document.getElementById('pw-new-hint')
    );
}

/**
 * index.html에 정의되지 않은 추가 카드(비밀번호 변경, v1 식별자 입력)를 동적 주입
 * 한 번만 주입.
 */
function injectExtraSections() {
    const container = document.getElementById('settings-container');
    if (!container || document.getElementById('settings-extra-injected')) return;

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

    // 말씀 본문 카드 (Phase E-8/A) — 폰트 크기 + 표시할 파트 on/off
    const scriptureCard = document.createElement('div');
    scriptureCard.id = 'settings-scripture-card';
    scriptureCard.className = 'card-section';
    scriptureCard.innerHTML = renderScriptureSettingsHTML();
    container.appendChild(scriptureCard);

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
    container.appendChild(pwCard);

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
    container.appendChild(cleanupCard);
}

function bindEvents() {
    const btnDiagnose = document.getElementById('btn-diagnose');
    const btnMigrate = document.getElementById('btn-migrate');
    const btnBackup = document.getElementById('btn-backup');
    const btnExport = document.getElementById('btn-export-backup');
    const statusBox = document.getElementById('migration-status-box');

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

    // ─── 자동 잠금 시간(분) ───
    bindAutoLockMinutes();
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

