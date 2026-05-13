/**
 * emailRecoveryClient.js — 트랙 2 Phase 3 클라이언트 래퍼
 *
 * Cloud Functions(asia-northeast3) 5개를 호출하는 얇은 래퍼.
 * settings.js / auth.js가 import해서 사용.
 *
 * 모든 함수는 Firebase Functions SDK를 lazy-load한다 (배포 안 됐을 때 graceful).
 */

let _functionsSdk = null;
let _functionsInstance = null;

async function loadFunctions() {
    if (_functionsInstance) return { fn: _functionsSdk, functions: _functionsInstance };
    const fn = await import('https://www.gstatic.com/firebasejs/10.11.1/firebase-functions.js');
    const { auth } = await import('../data/firebase.js');
    const functions = fn.getFunctions(auth.app, 'asia-northeast3');
    _functionsSdk = fn;
    _functionsInstance = functions;
    return { fn, functions };
}

async function callFn(name, payload) {
    const { fn, functions } = await loadFunctions();
    const callable = fn.httpsCallable(functions, name);
    const result = await callable(payload || {});
    return result.data;
}

/**
 * 이메일 복구 슬롯 등록 (또는 재등록)
 * @param {Object} args
 * @param {string} args.emailSlotKey       - base64 (createEmailSlot 결과)
 * @param {string} args.wrappedDEK_email   - base64
 * @param {string} args.wrappedDEK_email_iv - base64
 * @param {string} args.recoveryEmail      - 본인 확인용 이메일
 * @returns {Promise<{ok: true}>}
 */
export async function registerEmailRecovery(args) {
    return callFn('emailRecoveryRegister', args);
}

/**
 * 6자리 코드를 메일로 발송 요청
 * @param {string} recoveryEmail
 * @returns {Promise<{ok: true}>}
 */
export async function requestRecoveryCode(recoveryEmail) {
    return callFn('emailRecoveryRequest', { recoveryEmail });
}

/**
 * 6자리 코드 검증 → 60초 짜리 token 응답
 * @param {string} code
 * @returns {Promise<{token: string, expiresAt: number}>}
 */
export async function verifyRecoveryCode(code) {
    return callFn('emailRecoveryVerify', { code });
}

/**
 * token으로 emailSlotKey 복원 (1회 사용)
 * @param {string} token
 * @returns {Promise<{emailSlotKey: string}>} - base64
 */
export async function redeemRecoverySeed(token) {
    return callFn('emailRecoveryRedeemSeed', { token });
}

/**
 * 새 슬롯 키로 회전 (복구 후 호출)
 * @param {Object} args
 * @param {string} args.emailSlotKey
 * @param {string} args.wrappedDEK_email
 * @param {string} args.wrappedDEK_email_iv
 * @returns {Promise<{ok: true}>}
 */
export async function rotateRecoverySeed(args) {
    return callFn('emailRecoveryRotateSeed', args);
}
