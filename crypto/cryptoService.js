/**
 * cryptoService.js — AES-256-GCM 암복호화 + 가명화/역가명화
 *
 * 모든 민감 데이터는 이 모듈을 거쳐 Firestore에 저장/로드됩니다.
 * encVersion 필드로 향후 알고리즘 변경에 대비합니다.
 */

import { toBase64, fromBase64 } from './keyManager.js';

const CURRENT_ENC_VERSION = 1;

/**
 * 평문 객체 → 암호화된 페이로드
 * @param {CryptoKey} dek - Data Encryption Key
 * @param {Object} plainObject - 암호화할 필드 객체
 * @returns {{ encryptedPayload: string, iv: string, encVersion: number }}
 */
export async function encryptPayload(dek, plainObject) {
    const enc = new TextEncoder();
    const plainText = JSON.stringify(plainObject);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        dek,
        enc.encode(plainText)
    );

    return {
        encryptedPayload: toBase64(new Uint8Array(cipherBuffer)),
        iv: toBase64(iv),
        encVersion: CURRENT_ENC_VERSION,
    };
}

/**
 * 암호화된 페이로드 → 평문 객체
 * @param {CryptoKey} dek
 * @param {string} encryptedPayloadBase64
 * @param {string} ivBase64
 * @returns {Object} 복호화된 필드 객체
 */
export async function decryptPayload(dek, encryptedPayloadBase64, ivBase64) {
    const cipherBuf = fromBase64(encryptedPayloadBase64);
    const iv = fromBase64(ivBase64);

    const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        dek,
        cipherBuf
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(plainBuffer));
}

/**
 * Firestore 문서를 "메타(평문) + 암호화 페이로드" 형태로 준비
 * @param {CryptoKey} dek
 * @param {Object} metaFields - 평문으로 저장할 필드 (date, timeSlot, labelIds 등)
 * @param {Object} sensitiveFields - 암호화할 필드 (plannedTask, notes 등)
 * @returns {Object} Firestore에 저장할 완성된 문서
 */
export async function prepareDocument(dek, metaFields, sensitiveFields) {
    const encrypted = await encryptPayload(dek, sensitiveFields);
    return {
        ...metaFields,
        encryptedPayload: encrypted.encryptedPayload,
        iv: encrypted.iv,
        encVersion: encrypted.encVersion,
    };
}

/**
 * Firestore 문서에서 암호화 필드 복호화 후 병합
 * @param {CryptoKey} dek
 * @param {Object} firestoreDoc - Firestore에서 읽은 문서
 * @returns {Object} 평문 필드 + 복호화된 필드 병합
 */
export async function readDocument(dek, firestoreDoc) {
    const { encryptedPayload, iv, encVersion, ...metaFields } = firestoreDoc;

    if (!encryptedPayload || !iv) {
        // 암호화 이전 레거시 데이터 → 그대로 반환
        return firestoreDoc;
    }

    const sensitiveFields = await decryptPayload(dek, encryptedPayload, iv);
    return { ...metaFields, ...sensitiveFields };
}

// ───────── 가명화 (Pseudonymization) ─────────

/**
 * 텍스트 내 민감 정보를 가명으로 치환
 * @param {string} text - 원본 텍스트
 * @param {Object} context - { persons: string[], amounts: number[], places: string[] }
 * @returns {{ safeText: string, mapping: Object }}
 */
export function pseudonymize(text, context = {}) {
    const mapping = {
        persons: {},   // 원래이름 → P_001
        amounts: {},   // 원래금액 → 상/중/하
        places: {},    // 원래장소 → 일반 카테고리
        reverse: {},   // P_001 → 원래이름
    };

    let safeText = text;
    let personCounter = 1;

    // 사람 이름 치환
    if (context.persons) {
        context.persons.forEach(name => {
            if (!name || name.length < 2) return;
            const alias = `P_${String(personCounter).padStart(3, '0')}`;
            mapping.persons[name] = alias;
            mapping.reverse[alias] = name;
            // 전역 치환 (이름이 텍스트에 포함된 경우)
            safeText = safeText.split(name).join(alias);
            personCounter++;
        });
    }

    // 금액 → 상대값
    if (context.amounts) {
        context.amounts.forEach(amount => {
            const bucket = amount > 1000000 ? '고액' : amount > 100000 ? '중액' : '소액';
            const amountStr = String(amount);
            if (safeText.includes(amountStr)) {
                mapping.amounts[amountStr] = bucket;
                safeText = safeText.split(amountStr).join(`[${bucket}]`);
            }
        });
    }

    return { safeText, mapping };
}

/**
 * AI 응답에서 가명을 원래 이름으로 복원
 * @param {string} text - AI 응답 텍스트
 * @param {Object} mapping - pseudonymize에서 반환된 매핑
 * @returns {string}
 */
export function depseudonymize(text, mapping) {
    if (!mapping || !mapping.reverse) return text;

    let result = text;
    Object.entries(mapping.reverse).forEach(([alias, original]) => {
        result = result.split(alias).join(original);
    });
    return result;
}

export { CURRENT_ENC_VERSION };
