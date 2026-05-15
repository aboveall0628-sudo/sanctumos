/**
 * firebase.js — Firebase 초기화 + Firestore/Auth 공통 헬퍼
 *
 * (S-F1 2026-05-15) hostname 분기 — dev.sanctumos.kr 면 sanctum-dev 프로젝트,
 *   아니면 biblealimi(prod). 1차 베타 v6(14명+추천→100명) 결과 격리 자리.
 *   상세 결정: project_staging_admin_track.md
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import {
    getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
    collection, collectionGroup, query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import {
    getAuth, GoogleAuthProvider, signInWithCredential, signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";

// ─── 환경 판단 ───────────────────────────────────────────────
const _hostname = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '';
const _search = (typeof window !== 'undefined' && window.location) ? window.location.search : '';
export const IS_DEV_ENV =
    _hostname === 'dev.sanctumos.kr' ||
    (_hostname === 'localhost' && _search.includes('env=dev'));
export const ENV_LABEL = IS_DEV_ENV ? 'DEV' : 'PROD';

// ─── 환경별 Firebase config ──────────────────────────────────
const PROD_CONFIG = {
    apiKey: "AIzaSyBz_-F3Gp7bK2DvWBGfwjf6jevSnFaHess",
    authDomain: "biblealimi.firebaseapp.com",
    projectId: "biblealimi",
    storageBucket: "biblealimi.firebasestorage.app",
    messagingSenderId: "407329001149",
    appId: "1:407329001149:web:ba286301f3d0ad5d55f1d4",
    measurementId: "G-BG79MS3FZP"
};

// (S-F1) sanctum-dev-447e1 프로젝트 config — 2026-05-15 Swan 이 Firebase Console 신설 완료.
//   원래 sanctum-dev 만들려 했으나 다른 사용자 점유 → Firebase 자동 -447e1 접미사 부여.
//   dev 도메인 셋업·OAuth Authorized Domain 추가 후 dev.sanctumos.kr 에서 동작.
const DEV_CONFIG = {
    apiKey: "AIzaSyD3M8-vN1N6vo6F_Lk7tp1FJFmqdoNt0Is",
    authDomain: "sanctum-dev-447e1.firebaseapp.com",
    projectId: "sanctum-dev-447e1",
    storageBucket: "sanctum-dev-447e1.firebasestorage.app",
    messagingSenderId: "756096089693",
    appId: "1:756096089693:web:2647d5178e2c733d6417b4",
    measurementId: "G-VJKVM8V9TR",
};

const firebaseConfig = IS_DEV_ENV ? DEV_CONFIG : PROD_CONFIG;

// 부팅 시점 환경 표시 (콘솔)
if (typeof console !== 'undefined') {
    console.log(`[firebase] env=${ENV_LABEL} project=${firebaseConfig.projectId}`);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export {
    db, auth,
    doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
    collection, collectionGroup, query, where, orderBy, limit, serverTimestamp,
    GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged
};
