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
}
