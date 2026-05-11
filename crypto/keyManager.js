/**
 * keyManager.js — 마스터 키 유도 + DEK 관리 + 복구
 * 
 * 키 체계:
 *   마스터 비밀번호 → PBKDF2 → masterKey → wraps DEK
 *   복구 코드 24단어 → PBKDF2 → recoveryKey → wraps DEK (별도 사본)
 *   DEK(Data Encryption Key)만 실제 데이터 암복호화에 사용
 */

const KDF_PARAMS = {
    algo: 'PBKDF2',          // 실제 사용된 KDF가 deriveKey 시점에 갱신됨
    hash: 'SHA-256',
    iterations: 600000,
    argon2: { time: 3, memMB: 64, parallelism: 4 },
};

// Argon2id 모듈은 한 번만 로드 (ESM, CDN)
let _argon2Module = null;
let _argon2LoadAttempted = false;
async function loadArgon2() {
    if (_argon2Module || _argon2LoadAttempted) return _argon2Module;
    _argon2LoadAttempted = true;
    try {
        // hash-wasm는 ESM 빌드를 제공하며 Web Crypto API와 호환됩니다.
        const mod = await import('https://cdn.jsdelivr.net/npm/hash-wasm@4.11.0/dist/index.esm.min.js');
        if (typeof mod.argon2id === 'function') {
            _argon2Module = mod;
        }
    } catch (e) {
        console.warn('hash-wasm Argon2id load failed, will use PBKDF2:', e.message);
    }
    return _argon2Module;
}

const RECOVERY_SALT = new Uint8Array([
    83, 97, 110, 99, 116, 117, 109, 79, 83, 45, 82, 101, 99, 111, 118, 101,
    114, 121, 45, 83, 97, 108, 116, 45, 50, 48, 50, 54, 45, 86, 49, 48
]); // "SanctumOS-Recovery-Salt-2026-V10"

// BIP39-inspired Korean word list (축약, 실제로는 2048단어 필요)
const WORD_LIST = [
    '사랑', '평화', '기쁨', '소망', '믿음', '은혜', '감사', '축복',
    '지혜', '진리', '자유', '빛남', '하늘', '바다', '산길', '꽃밭',
    '새벽', '저녁', '노래', '기도', '말씀', '십자', '부활', '영광',
    '인내', '겸손', '용기', '정직', '친절', '온유', '절제', '충성',
    '거룩', '능력', '치유', '위로', '동행', '인도', '보호', '공급',
    '열매', '씨앗', '뿌리', '가지', '이슬', '샘물', '반석', '기둥',
    '면류', '보좌', '천사', '날개', '무지', '언약', '제단', '향유',
    '포도', '올리', '종려', '백합', '양떼', '목자', '어린', '사자',
    '독수', '비둘', '참새', '까마', '물고', '고래', '낙타', '나귀',
    '석양', '별빛', '달빛', '무궁', '영원', '창조', '시작', '마침',
    '안식', '광야', '요단', '갈릴', '시온', '베들', '나사', '예루',
    '모세', '다윗', '솔로', '엘리', '이사', '바울', '베드', '요한',
    '아담', '노아', '아브', '이삭', '야곱', '요셉', '여호', '삼손',
    '기드', '사무', '느헤', '에스', '다니', '호세', '미가', '하박',
    '스가', '말라', '마태', '마가', '누가', '행전', '로마', '고린',
    '에베', '빌립', '골로', '히브', '야고', '유다', '계시', '아멘',
];

/**
 * 무작위 바이트 생성
 */
function randomBytes(length) {
    const buf = new Uint8Array(length);
    crypto.getRandomValues(buf);
    return buf;
}

/**
 * Uint8Array → base64 문자열
 */
export function toBase64(uint8Array) {
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
}

/**
 * base64 문자열 → Uint8Array
 */
export function fromBase64(base64Str) {
    const binary = atob(base64Str);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        buf[i] = binary.charCodeAt(i);
    }
    return buf;
}

/**
 * 비밀번호 + salt → AES-256 키 유도
 *
 * @param {string} password
 * @param {Uint8Array} salt
 * @param {Object|null} storedParams - vault에 기록된 kdfParams.
 *   존재하면 그 algo로만 시도 (호환성). null이면 Argon2id → PBKDF2 순서.
 */
async function deriveKey(password, salt, storedParams = null) {
    const forced = storedParams?.algo || null;
    let keyMaterialRaw;

    const tryArgon = !forced || forced === 'Argon2id';
    const tryPbkdf = !forced || forced === 'PBKDF2';

    if (tryArgon) {
        const argon2 = await loadArgon2();
        if (argon2) {
            try {
                const p = storedParams?.argon2 || KDF_PARAMS.argon2;
                const hex = await argon2.argon2id({
                    password,
                    salt,
                    parallelism: p.parallelism,
                    iterations: p.time,
                    memorySize: p.memMB * 1024, // KiB
                    hashLength: 32,
                    outputType: 'hex',
                });
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
                keyMaterialRaw = bytes.buffer;
                KDF_PARAMS.algo = 'Argon2id';
            } catch (e) {
                if (forced === 'Argon2id') throw e;
                console.warn('Argon2id derive failed, falling back to PBKDF2:', e.message);
            }
        } else if (forced === 'Argon2id') {
            throw new Error('ARGON2_UNAVAILABLE');
        }
    }

    if (!keyMaterialRaw && tryPbkdf) {
        const enc = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey']
        );
        const iters = storedParams?.iterations || KDF_PARAMS.iterations;
        const hash = storedParams?.hash || KDF_PARAMS.hash;
        keyMaterialRaw = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt, iterations: iters, hash },
            baseKey,
            256
        );
        KDF_PARAMS.algo = 'PBKDF2';
    }

    if (!keyMaterialRaw) throw new Error('KDF_FAILED');

    return crypto.subtle.importKey(
        'raw', keyMaterialRaw, { name: 'AES-GCM' }, false, ['wrapKey', 'unwrapKey']
    );
}

/**
 * DEK 생성 (무작위 256비트 AES 키)
 */
async function generateDEK() {
    return crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // extractable = true (wrap/unwrap용)
        ['encrypt', 'decrypt']
    );
}

/**
 * DEK를 wrapping 키로 감싸기
 */
async function wrapDEK(wrappingKey, dek) {
    const iv = randomBytes(12);
    const wrapped = await crypto.subtle.wrapKey('raw', dek, wrappingKey, {
        name: 'AES-GCM',
        iv: iv,
    });
    return {
        wrappedDEK: toBase64(new Uint8Array(wrapped)),
        iv: toBase64(iv),
    };
}

/**
 * 감싸진 DEK 풀기
 */
async function unwrapDEK(wrappingKey, wrappedDEKBase64, ivBase64) {
    const wrappedBuf = fromBase64(wrappedDEKBase64);
    const iv = fromBase64(ivBase64);
    return crypto.subtle.unwrapKey(
        'raw',
        wrappedBuf,
        wrappingKey,
        { name: 'AES-GCM', iv: iv },
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * 복구 코드 24단어 생성
 */
function generateRecoveryWords() {
    const indices = randomBytes(24);
    return Array.from(indices).map(b => WORD_LIST[b % WORD_LIST.length]);
}

// ───────── 공개 API ─────────

/**
 * 최초 가입: 마스터 비밀번호 → DEK 생성 + wrap + 복구 코드 생성
 * @returns {{ salt, wrappedDEK_master, wrappedDEK_recovery, recoveryWords, dek, kdfParams }}
 */
export async function setupNewVault(masterPassword) {
    // 1. 마스터 키 유도
    const salt = randomBytes(32);
    const masterKey = await deriveKey(masterPassword, salt);

    // 2. DEK 생성
    const dek = await generateDEK();

    // 3. 마스터 키로 DEK wrap
    const masterWrap = await wrapDEK(masterKey, dek);

    // 4. 복구 코드 생성 + 복구 키로 DEK wrap
    const recoveryWords = generateRecoveryWords();
    const recoveryPassword = recoveryWords.join(' ');
    const recoveryKey = await deriveKey(recoveryPassword, RECOVERY_SALT);
    const recoveryWrap = await wrapDEK(recoveryKey, dek);

    return {
        salt: toBase64(salt),
        wrappedDEK_master: masterWrap.wrappedDEK,
        wrappedDEK_master_iv: masterWrap.iv,
        wrappedDEK_recovery: recoveryWrap.wrappedDEK,
        wrappedDEK_recovery_iv: recoveryWrap.iv,
        recoveryWords, // 화면에 1회 표시 후 폐기
        dek,           // 메모리에만 보관
        kdfParams: { ...KDF_PARAMS },
        passwordPolicyVersion: 2,
    };
}

/**
 * 로그인: 마스터 비밀번호 → DEK unwrap
 * @param {Object|null} storedKdfParams - vault doc의 kdfParams. null이면 자동 감지(시도-fallback)
 * @returns {CryptoKey} dek
 * @throws 비밀번호 불일치 시 에러
 */
export async function unlockVault(masterPassword, saltBase64, wrappedDEKBase64, ivBase64, storedKdfParams = null) {
    const salt = fromBase64(saltBase64);

    // 1차: 저장된 algo 그대로 시도
    try {
        const masterKey = await deriveKey(masterPassword, salt, storedKdfParams);
        return await unwrapDEK(masterKey, wrappedDEKBase64, ivBase64);
    } catch (e) {
        // 2차: 저장된 algo가 명시되어 있더라도 옛 vault 호환을 위해 반대 algo로 한 번 더 시도
        if (storedKdfParams?.algo) {
            try {
                const otherAlgo = storedKdfParams.algo === 'Argon2id' ? 'PBKDF2' : 'Argon2id';
                const fallbackParams = { ...storedKdfParams, algo: otherAlgo };
                const masterKey = await deriveKey(masterPassword, salt, fallbackParams);
                return await unwrapDEK(masterKey, wrappedDEKBase64, ivBase64);
            } catch (_) { /* fall through */ }
        }
        throw new Error('WRONG_PASSWORD');
    }
}

/**
 * 복구 코드로 DEK 복원
 * @param {Object|null} storedKdfParams
 * @returns {CryptoKey} dek
 */
export async function recoverWithWords(words, wrappedDEKBase64, ivBase64, storedKdfParams = null) {
    const recoveryPassword = words.join(' ');
    try {
        const recoveryKey = await deriveKey(recoveryPassword, RECOVERY_SALT, storedKdfParams);
        return await unwrapDEK(recoveryKey, wrappedDEKBase64, ivBase64);
    } catch (e) {
        if (storedKdfParams?.algo) {
            try {
                const otherAlgo = storedKdfParams.algo === 'Argon2id' ? 'PBKDF2' : 'Argon2id';
                const recoveryKey = await deriveKey(recoveryPassword, RECOVERY_SALT, { ...storedKdfParams, algo: otherAlgo });
                return await unwrapDEK(recoveryKey, wrappedDEKBase64, ivBase64);
            } catch (_) { /* fall through */ }
        }
        throw new Error('WRONG_RECOVERY_CODE');
    }
}

/**
 * 비밀번호 변경: DEK 재wrap (DEK 자체는 변경 없음 → 데이터 재암호화 불필요)
 * @returns {{ salt, wrappedDEK_master, wrappedDEK_master_iv }}
 */
export async function changePassword(dek, newPassword) {
    const salt = randomBytes(32);
    const newMasterKey = await deriveKey(newPassword, salt);
    const wrap = await wrapDEK(newMasterKey, dek);
    return {
        salt: toBase64(salt),
        wrappedDEK_master: wrap.wrappedDEK,
        wrappedDEK_master_iv: wrap.iv,
        kdfParams: { ...KDF_PARAMS },
        passwordPolicyVersion: 2,
    };
}

/**
 * DEK를 메모리에서 안전하게 폐기 (참조 제거)
 * 주의: JS에서 CryptoKey는 GC 의존, 명시적 zeroing 불가
 */
export function destroyDEK() {
    // 호출자가 dek = null 처리
    // 이 함수는 의도 명시용
    return null;
}

export { KDF_PARAMS };
