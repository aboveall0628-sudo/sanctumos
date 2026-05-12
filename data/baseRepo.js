/**
 * baseRepo.js — 공통 Repository 레이어
 *
 * 모든 Firestore 접근은 이 레이어를 거치며, POLICY에 따라 자동 암/복호화됩니다.
 *
 * v3.0부터 path 기반:
 *   - 루트 컬렉션:        'goals', 'dots' (v2.1 호환)
 *   - 사용자 서브컬렉션:  'users/{uid}/persons', 'users/{uid}/transactions' 등
 *   - 단일 설정 문서:     'users/{uid}/settings' (docId='spiritualLock')
 *
 * path가 어떤 형태든 마지막 컬렉션 이름으로 정책을 lookup합니다.
 * (settings/{docName} 패턴은 docName + 'Settings'로 lookup)
 */

import {
    db, doc, setDoc, getDoc, getDocs, collection, serverTimestamp
} from './firebase.js';
import { prepareDocument, readDocument } from '../crypto/cryptoService.js';
import { POLICY, policyKeyFromPath } from '../config/encryptionPolicy.js';

/**
 * path 문자열을 doc/collection 인자 배열로 분해
 * 예: 'users/abc/persons' → ['users', 'abc', 'persons']
 */
function pathParts(path) {
    return path.split('/').filter(Boolean);
}

/**
 * path 끝에 docId 붙여 doc reference 만들기
 */
function docRef(path, id) {
    return doc(db, ...pathParts(path), id);
}

/**
 * collection reference 만들기
 */
function colRef(path) {
    return collection(db, ...pathParts(path));
}

/**
 * 정책 lookup (없으면 throw)
 */
function getPolicy(path) {
    const key = policyKeyFromPath(path);
    const policy = POLICY[key];
    if (!policy) throw new Error(`No encryption policy for path: ${path} (key: ${key})`);
    return { key, policy };
}

/**
 * 범용 저장 (자동 암호화)
 *
 * @param {CryptoKey} dek
 * @param {string} path - 'goals' 또는 'users/{uid}/persons'
 * @param {Object} data
 * @param {string|null} docId - null이면 자동 생성
 */
export async function saveRecord(dek, path, data, docId = null) {
    const { key, policy } = getPolicy(path);
    const id = docId || data.id || `${key}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const meta = { id, updatedAt: serverTimestamp() };
    const sensitive = {};

    policy.plaintext.forEach(k => {
        if (data[k] !== undefined) meta[k] = data[k];
    });
    if (!meta.createdAt && !data.id) meta.createdAt = serverTimestamp();

    policy.encrypted.forEach(k => {
        if (data[k] !== undefined) sensitive[k] = data[k];
    });

    const document = await prepareDocument(dek, meta, sensitive);
    await setDoc(docRef(path, id), document, { merge: true });
    return id;
}

/**
 * 범용 단건 조회 (자동 복호화)
 */
export async function getRecord(dek, path, docId) {
    const docSnap = await getDoc(docRef(path, docId));
    if (!docSnap.exists()) return null;
    return readDocument(dek, docSnap.data());
}

/**
 * 범용 목록 조회 (자동 복호화)
 *
 * @param {CryptoKey} dek
 * @param {Object} firestoreQuery - query(collection(...), where(...))
 *   또는 path 문자열 (전체 컬렉션 조회)
 */
export async function queryRecords(dek, firestoreQuery) {
    // path 문자열을 받으면 전체 컬렉션 query로 변환
    if (typeof firestoreQuery === 'string') {
        firestoreQuery = colRef(firestoreQuery);
    }
    const snapshot = await getDocs(firestoreQuery);
    const results = [];
    let failed = 0;
    for (const docSnap of snapshot.docs) {
        try {
            results.push(await readDocument(dek, docSnap.data()));
        } catch (e) {
            // Phase E-9/R-FIX2: 부분 실패 흡수.
            // 한 문서가 깨졌다고 전체 list를 막지 않음 — 메뉴가 통째로 비는 사용자 경험을
            // 방지하고, 깨진 문서는 콘솔에 남겨 디버그 가능하게.
            failed += 1;
            console.warn(`[queryRecords] Decrypt failed for ${docSnap.id}, skipping:`, e?.message || e);
        }
    }
    if (failed > 0) {
        console.warn(`[queryRecords] ${failed}건 복호화 실패, ${results.length}건 반환`);
    }
    return results;
}

/**
 * v3 헬퍼: 사용자 서브컬렉션 path 빌더
 *   subPath('abc', 'persons') → 'users/abc/persons'
 *   subPath('abc', 'settings/spiritualLock') → 'users/abc/settings/spiritualLock'
 */
export function subPath(userId, sub) {
    return `users/${userId}/${sub}`;
}

/**
 * v3 헬퍼: 사용자 단일 설정 문서 read
 */
export async function getUserSetting(dek, userId, settingName) {
    const path = subPath(userId, 'settings');
    return getRecord(dek, path, settingName);
}

/**
 * v3 헬퍼: 사용자 단일 설정 문서 save
 */
export async function saveUserSetting(dek, userId, settingName, data) {
    const path = subPath(userId, 'settings');
    return saveRecord(dek, path, { ...data, id: settingName }, settingName);
}

// 컬렉션/문서 ref도 외부에서 쓸 수 있게 export (where/orderBy/limit 조합용)
export { colRef, docRef };
