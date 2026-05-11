/**
 * passwordPolicy.js — 비밀번호 정책 v2
 *
 * 규칙: 8자 이상, 영문 대문자 + 영문 소문자 + 숫자 + 특수기호 모두 포함.
 * 이전 정책 v1(4자+): 기존 사용자가 정책 강화 모달을 거쳐 v2로 업그레이드.
 */

export const POLICY_VERSION = 2;

const SPECIAL_CHARS_REGEX = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/;

export const POLICY_RULES = [
    { id: 'length',  test: pw => pw.length >= 8,        label: '8자 이상' },
    { id: 'upper',   test: pw => /[A-Z]/.test(pw),       label: '영문 대문자 (A-Z)' },
    { id: 'lower',   test: pw => /[a-z]/.test(pw),       label: '영문 소문자 (a-z)' },
    { id: 'digit',   test: pw => /[0-9]/.test(pw),       label: '숫자 (0-9)' },
    { id: 'special', test: pw => SPECIAL_CHARS_REGEX.test(pw), label: '특수기호 (!@#$ 등)' },
];

/**
 * 비밀번호가 v2 정책을 만족하는지 검사
 * @param {string} pw
 * @returns {{ ok: boolean, checks: {id, label, passed}[] }}
 */
export function validatePassword(pw) {
    const checks = POLICY_RULES.map(r => ({
        id: r.id,
        label: r.label,
        passed: r.test(pw || ''),
    }));
    const ok = checks.every(c => c.passed);
    return { ok, checks };
}

/**
 * 검증 실패 시 사용자에게 보여줄 첫 번째 오류 문구
 * @param {string} pw
 * @returns {string|null}
 */
export function firstError(pw) {
    const { ok, checks } = validatePassword(pw);
    if (ok) return null;
    const fail = checks.find(c => !c.passed);
    return `비밀번호에 "${fail.label}" 조건이 빠졌어요.`;
}

/**
 * 정책 힌트 UI 렌더 — 입력 중 실시간으로 통과 여부 표시
 * @param {HTMLElement} container
 * @param {string} pw
 */
export function renderPolicyHint(container, pw) {
    if (!container) return;
    const { checks } = validatePassword(pw || '');
    container.innerHTML = checks.map(c => `
        <div class="pw-policy-item ${c.passed ? 'pw-passed' : 'pw-pending'}">
            <span class="pw-policy-icon">${c.passed ? '✓' : '○'}</span>
            <span class="pw-policy-label">${c.label}</span>
        </div>
    `).join('');
}

/**
 * 입력 필드와 힌트 컨테이너를 묶어서 실시간 갱신 바인딩
 * @param {HTMLInputElement} inputEl
 * @param {HTMLElement} hintEl
 */
export function bindPolicyHint(inputEl, hintEl) {
    if (!inputEl || !hintEl) return;
    const update = () => renderPolicyHint(hintEl, inputEl.value);
    inputEl.addEventListener('input', update);
    update(); // 초기 렌더 (모두 ○)
}
