/**
 * emailRecovery.ts — 트랙 2 Phase 3: 이메일 복구 Cloud Functions
 *
 * 설계 Y (E2EE 유지형):
 *   - 서버는 평문 DEK를 절대 갖지 않는다.
 *   - 클라이언트가 만든 emailSlotKey를 SLOT_KMS_KEY(서버 시크릿)로 한 번 더 wrap해 보관.
 *   - 사용자가 이메일 인증 통과 → 60초 짜리 verification token 발급 →
 *     클라이언트가 토큰으로 emailSlotKey를 한 번만 redeem → 즉시 폐기.
 *
 * 외부 시크릿:
 *   GMAIL_USER         — 발송용 Gmail 주소
 *   GMAIL_APP_PASSWORD — Gmail 앱 비밀번호(16자리)
 *   SLOT_KMS_KEY       — 32바이트 base64 키 (운영자 금고의 마스터 키)
 *
 * 함수 5개:
 *   emailRecoveryRegister   — 등록: emailSlotKey를 KMS로 wrap
 *   emailRecoveryRequest    — 복구 요청: 6자리 코드 메일 발송
 *   emailRecoveryVerify     — 코드 검증: 60초 token 발급
 *   emailRecoveryRedeemSeed — token → emailSlotKey 복원 (1회 사용)
 *   emailRecoveryRotateSeed — 복구 후 새 슬롯 키 발급
 *
 * Rate limit (rate_limits 컬렉션, userId 단일 키 조회):
 *   Request 발행: 1분 3회 / 1시간 10회
 *   Verify 시도: 5분 5회
 *
 * 보조 컬렉션:
 *   emailRecoveryCodes/{userId}        — 활성 코드 1개. expiresAt, codeHash, attempts
 *   emailRecoveryTokens/{tokenId}      — verification token. userId, expiresAt, used
 *   rate_limits/{userId}_{bucket}      — 시간 버킷별 카운트
 */

import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as nodemailer from "nodemailer";

// ─── 시크릿 ──────────────────────────────────────────────────────
const GMAIL_USER = defineSecret("GMAIL_USER");
const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const SLOT_KMS_KEY = defineSecret("SLOT_KMS_KEY");

// ─── Firebase Admin (모듈 로드 시 1회 초기화) ────────────────────
// v2 functions cold start 시 1회만 실행. 이미 다른 함수가 초기화했으면 skip.
if (admin.apps.length === 0) {
    admin.initializeApp();
}

function getDb(): admin.firestore.Firestore {
    return admin.firestore();
}

// ─── 정책 상수 ───────────────────────────────────────────────────
const CODE_LENGTH = 6;
const CODE_TTL_MS = 5 * 60 * 1000;       // 5분
const TOKEN_TTL_MS = 60 * 1000;          // 60초
const VERIFY_MAX_ATTEMPTS = 5;
const RATE_REQUEST_PER_MIN = 3;
const RATE_REQUEST_PER_HOUR = 10;
const RATE_VERIFY_PER_5MIN = 5;

// ─── 헬퍼: 인증 검사 ──────────────────────────────────────────────
function requireAuth(req: CallableRequest): string {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError("unauthenticated", "로그인이 필요해요.");
    }
    return uid;
}

// ─── 헬퍼: AES-256-GCM wrap/unwrap ────────────────────────────────
function getKmsKey(): Buffer {
    const raw = SLOT_KMS_KEY.value();
    if (!raw) throw new HttpsError("failed-precondition", "서버 시크릿이 설정되지 않았어요. (SLOT_KMS_KEY)");
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
        throw new HttpsError("failed-precondition", "SLOT_KMS_KEY 길이가 32바이트가 아니에요.");
    }
    return key;
}

/** emailSlotKey(클라이언트가 만든 32바이트 base64)를 KMS 키로 wrap → base64 페이로드 */
function wrapWithKms(emailSlotKeyB64: string): { wrappedEmailSlotKey: string } {
    const kmsKey = getKmsKey();
    const slotKeyBytes = Buffer.from(emailSlotKeyB64, "base64");
    if (slotKeyBytes.length !== 32) {
        throw new HttpsError("invalid-argument", "emailSlotKey 길이가 32바이트가 아니에요.");
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", kmsKey, iv);
    const ct = Buffer.concat([cipher.update(slotKeyBytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    // 단일 페이로드: iv(12) | tag(16) | ct(32) — 총 60바이트
    const payload = Buffer.concat([iv, tag, ct]).toString("base64");
    return { wrappedEmailSlotKey: payload };
}

function unwrapWithKms(wrappedEmailSlotKey: string): string {
    const kmsKey = getKmsKey();
    const buf = Buffer.from(wrappedEmailSlotKey, "base64");
    if (buf.length !== 60) {
        throw new HttpsError("failed-precondition", "wrappedEmailSlotKey 형식이 잘못되었어요.");
    }
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", kmsKey, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("base64");
}

// ─── 헬퍼: rate limit (composite index 회피 — 단일 doc 카운터) ──
async function checkRateLimit(uid: string, bucket: string, maxCount: number, windowMs: number): Promise<void> {
    const db = getDb();
    const ref = db.collection("rate_limits").doc(`${uid}_${bucket}`);
    const now = Date.now();
    const windowStart = now - windowMs;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? (snap.data() as { timestamps?: number[] }) : {};
        const fresh = (data.timestamps || []).filter((t) => t > windowStart);
        if (fresh.length >= maxCount) {
            throw new HttpsError("resource-exhausted", "너무 자주 시도하셨어요. 잠시 후 다시 시도해 주세요.");
        }
        fresh.push(now);
        tx.set(ref, { timestamps: fresh, updatedAt: now });
    });
}

// ─── 헬퍼: 6자리 코드 + 해시 ─────────────────────────────────────
function generateCode(): string {
    // 000000 ~ 999999, 0 padded
    const n = crypto.randomInt(0, 1_000_000);
    return n.toString().padStart(CODE_LENGTH, "0");
}

function hashCode(code: string, salt: string): string {
    return crypto.createHash("sha256").update(`${salt}|${code}`).digest("hex");
}

// ─── 헬퍼: nodemailer transporter ────────────────────────────────
function createMailTransporter(): nodemailer.Transporter {
    const user = GMAIL_USER.value();
    const pass = GMAIL_APP_PASSWORD.value();
    if (!user || !pass) {
        throw new HttpsError("failed-precondition", "메일 발송 자격이 설정되지 않았어요.");
    }
    return nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass },
    });
}

async function sendRecoveryEmail(toEmail: string, code: string): Promise<void> {
    const transporter = createMailTransporter();
    const from = GMAIL_USER.value();
    const subject = "[Sanctum OS] 복구 코드 안내";
    const text = [
        "Sanctum OS 일기장 복구 요청을 받았습니다.",
        "",
        `복구 코드: ${code}`,
        "",
        `이 코드는 ${CODE_TTL_MS / 60_000}분 뒤 만료됩니다.`,
        "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.",
        "",
        "— Sanctum OS",
    ].join("\n");
    const html = `
        <div style="font-family:Pretendard,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1A1814;">
            <h2 style="margin:0 0 12px;font-size:18px;">Sanctum OS 일기장 복구</h2>
            <p style="margin:0 0 16px;font-size:14px;color:#555;">복구 요청을 받았습니다. 아래 코드를 입력 화면에 적어주세요.</p>
            <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#FAF7F2;border-radius:12px;margin:16px 0;">${code}</div>
            <p style="margin:8px 0;font-size:12px;color:#888;">이 코드는 ${CODE_TTL_MS / 60_000}분 뒤 만료됩니다. 본인이 요청하지 않았다면 무시하셔도 됩니다.</p>
        </div>
    `;
    await transporter.sendMail({ from, to: toEmail, subject, text, html });
}

// ═════════════════════════════════════════════════════════════════
// ① emailRecoveryRegister — 등록: emailSlotKey를 KMS로 wrap
// ═════════════════════════════════════════════════════════════════
/**
 * 클라이언트가 createEmailSlot으로 만든 emailSlotKey(base64)와
 * wrappedDEK_email(base64), wrappedDEK_email_iv(base64),
 * 그리고 recoveryEmail(보통 Google 로그인 이메일)을 전달.
 *
 * 서버는 emailSlotKey를 KMS로 wrap한 wrappedEmailSlotKey를 만들어
 * 응답하고, users 문서에 네 필드(wrappedDEK_email, wrappedDEK_email_iv,
 * wrappedEmailSlotKey, recoveryEmail)를 함께 저장한다.
 *
 * 첫 등록 외에 rotate(재등록)도 같은 함수로 처리 — 멱등하게.
 */
export const emailRecoveryRegister = onCall(
    { secrets: [SLOT_KMS_KEY], region: "asia-northeast3" },
    async (req) => {
        const uid = requireAuth(req);
        const { emailSlotKey, wrappedDEK_email, wrappedDEK_email_iv, recoveryEmail } = req.data || {};

        if (typeof emailSlotKey !== "string" || typeof wrappedDEK_email !== "string" ||
            typeof wrappedDEK_email_iv !== "string" || typeof recoveryEmail !== "string") {
            throw new HttpsError("invalid-argument", "필요한 정보가 빠졌어요.");
        }

        // 이메일 형식 가벼운 검증
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
            throw new HttpsError("invalid-argument", "복구 이메일 형식이 살짝 어긋났어요.");
        }

        const { wrappedEmailSlotKey } = wrapWithKms(emailSlotKey);

        const db = getDb();
        await db.collection("users").doc(uid).set(
            {
                wrappedDEK_email,
                wrappedDEK_email_iv,
                wrappedEmailSlotKey,
                recoveryEmail,
                emailRecoveryRegisteredAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        logger.info("[emailRecovery] registered", { uid });
        return { ok: true };
    }
);

// ═════════════════════════════════════════════════════════════════
// ② emailRecoveryRequest — 복구 요청: 6자리 코드 메일 발송
// ═════════════════════════════════════════════════════════════════
/**
 * 사용자가 복구를 시작. 입력: recoveryEmail (등록 시 저장한 이메일과 일치해야 함).
 * 출력: { ok: true } — 발송 성공 여부만. 발송된 이메일 주소·코드는 응답에 포함 안 함.
 *
 * 보안:
 *  - 인증된 사용자만 호출 가능 (이메일을 잃은 사용자도 anonymous로 Firebase Auth 로그인 후 호출)
 *  - 입력 이메일이 users.recoveryEmail과 일치하지 않으면 ok 응답하되 메일은 발송하지 않음
 *    (열거 공격 방어)
 *  - 5분 안에 새 코드를 요청하면 기존 코드 무효화 + 새 코드 발송
 */
export const emailRecoveryRequest = onCall(
    { secrets: [GMAIL_USER, GMAIL_APP_PASSWORD], region: "asia-northeast3" },
    async (req) => {
        const uid = requireAuth(req);
        const { recoveryEmail } = req.data || {};
        if (typeof recoveryEmail !== "string") {
            throw new HttpsError("invalid-argument", "이메일이 빠졌어요.");
        }

        // Rate limit
        await checkRateLimit(uid, "request_1min", RATE_REQUEST_PER_MIN, 60_000);
        await checkRateLimit(uid, "request_1hour", RATE_REQUEST_PER_HOUR, 60 * 60_000);

        const db = getDb();
        const userSnap = await db.collection("users").doc(uid).get();
        const userData = userSnap.exists ? userSnap.data() : null;
        const registeredEmail = userData?.recoveryEmail;

        // 등록되지 않았거나 이메일 불일치 — 응답은 ok로 통일 (열거 공격 방어)
        if (!registeredEmail || registeredEmail.toLowerCase() !== recoveryEmail.toLowerCase()) {
            logger.warn("[emailRecovery] request mismatch or unregistered", { uid });
            return { ok: true };
        }

        const code = generateCode();
        const salt = crypto.randomBytes(16).toString("hex");
        const codeHash = hashCode(code, salt);
        const expiresAt = Date.now() + CODE_TTL_MS;

        await db.collection("emailRecoveryCodes").doc(uid).set({
            codeHash,
            salt,
            expiresAt,
            attempts: 0,
            createdAt: Date.now(),
        });

        try {
            await sendRecoveryEmail(registeredEmail, code);
        } catch (e: any) {
            logger.error("[emailRecovery] mail send failed", { uid, err: e?.message });
            throw new HttpsError("internal", "메일 발송에 실패했어요. 잠시 후 다시 시도해 주세요.");
        }

        logger.info("[emailRecovery] code sent", { uid });
        return { ok: true };
    }
);

// ═════════════════════════════════════════════════════════════════
// ③ emailRecoveryVerify — 코드 검증: 60초 token 발급
// ═════════════════════════════════════════════════════════════════
/**
 * 입력: { code: string }
 * 출력: { token: string, expiresAt: number } — 60초 단일 사용 토큰
 *
 * 보안:
 *  - 5번 틀리면 코드 폐기 (브루트포스 방어)
 *  - 만료된 코드는 거부
 *  - 사용된 토큰은 재사용 불가 (Redeem이 used:true 마킹)
 */
export const emailRecoveryVerify = onCall({ region: "asia-northeast3" }, async (req) => {
    const uid = requireAuth(req);
    const { code } = req.data || {};
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
        throw new HttpsError("invalid-argument", "코드 형식이 잘못되었어요.");
    }

    await checkRateLimit(uid, "verify_5min", RATE_VERIFY_PER_5MIN, 5 * 60_000);

    const db = getDb();
    const codeRef = db.collection("emailRecoveryCodes").doc(uid);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
        throw new HttpsError("not-found", "복구 코드가 없거나 만료됐어요. 다시 요청해 주세요.");
    }
    const codeData = codeSnap.data() as {
        codeHash: string;
        salt: string;
        expiresAt: number;
        attempts: number;
    };

    if (Date.now() > codeData.expiresAt) {
        await codeRef.delete();
        throw new HttpsError("deadline-exceeded", "코드가 만료됐어요. 다시 요청해 주세요.");
    }

    if (codeData.attempts >= VERIFY_MAX_ATTEMPTS) {
        await codeRef.delete();
        throw new HttpsError("permission-denied", "시도 횟수를 넘었어요. 새 코드를 요청해 주세요.");
    }

    const got = hashCode(code, codeData.salt);
    if (got !== codeData.codeHash) {
        await codeRef.update({ attempts: codeData.attempts + 1 });
        throw new HttpsError("permission-denied", "코드가 일치하지 않아요.");
    }

    // 통과 — 코드 1회용으로 폐기 + 토큰 발급
    await codeRef.delete();
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    await db.collection("emailRecoveryTokens").doc(token).set({
        uid,
        expiresAt,
        used: false,
        createdAt: Date.now(),
    });

    logger.info("[emailRecovery] verified", { uid });
    return { token, expiresAt };
});

// ═════════════════════════════════════════════════════════════════
// ④ emailRecoveryRedeemSeed — token → emailSlotKey 복원 (1회 사용)
// ═════════════════════════════════════════════════════════════════
/**
 * 입력: { token: string }
 * 출력: { emailSlotKey: string } — base64. 클라이언트는 이걸로 wrappedDEK_email을 unwrap한 후 즉시 폐기.
 */
export const emailRecoveryRedeemSeed = onCall(
    { secrets: [SLOT_KMS_KEY], region: "asia-northeast3" },
    async (req) => {
        const uid = requireAuth(req);
        const { token } = req.data || {};
        if (typeof token !== "string" || token.length !== 64) {
            throw new HttpsError("invalid-argument", "토큰 형식이 잘못되었어요.");
        }

        const db = getDb();
        const tokenRef = db.collection("emailRecoveryTokens").doc(token);

        // 단일 사용 보장 — 트랜잭션
        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(tokenRef);
            if (!snap.exists) throw new HttpsError("not-found", "토큰을 찾을 수 없어요.");
            const data = snap.data() as { uid: string; expiresAt: number; used: boolean };

            if (data.uid !== uid) {
                throw new HttpsError("permission-denied", "토큰 소유자가 아니에요.");
            }
            if (data.used) {
                throw new HttpsError("failed-precondition", "이미 사용된 토큰이에요.");
            }
            if (Date.now() > data.expiresAt) {
                throw new HttpsError("deadline-exceeded", "토큰이 만료됐어요.");
            }
            tx.update(tokenRef, { used: true, usedAt: Date.now() });
            return { uid: data.uid };
        });

        // users 문서에서 wrappedEmailSlotKey 가져와 unwrap
        const userSnap = await db.collection("users").doc(result.uid).get();
        if (!userSnap.exists) {
            throw new HttpsError("not-found", "사용자 정보를 찾을 수 없어요.");
        }
        const wrappedEmailSlotKey = userSnap.data()?.wrappedEmailSlotKey;
        if (!wrappedEmailSlotKey) {
            throw new HttpsError("failed-precondition", "이메일 복구가 등록되어 있지 않아요.");
        }

        const emailSlotKey = unwrapWithKms(wrappedEmailSlotKey);
        logger.info("[emailRecovery] redeemed", { uid });
        return { emailSlotKey };
    }
);

// ═════════════════════════════════════════════════════════════════
// ⑤ emailRecoveryRotateSeed — 복구 후 새 슬롯 키 발급
// ═════════════════════════════════════════════════════════════════
/**
 * 복구 직후 슬롯 키가 60초 동안 노출됐으므로, 클라이언트는 새 emailSlotKey를
 * 만들어 다시 등록. 사실상 emailRecoveryRegister와 같지만 의미적으로 분리.
 *
 * 입력: { emailSlotKey, wrappedDEK_email, wrappedDEK_email_iv }
 *       (recoveryEmail은 변경 없음 — 기존 값 유지)
 */
export const emailRecoveryRotateSeed = onCall(
    { secrets: [SLOT_KMS_KEY], region: "asia-northeast3" },
    async (req) => {
        const uid = requireAuth(req);
        const { emailSlotKey, wrappedDEK_email, wrappedDEK_email_iv } = req.data || {};
        if (typeof emailSlotKey !== "string" || typeof wrappedDEK_email !== "string" ||
            typeof wrappedDEK_email_iv !== "string") {
            throw new HttpsError("invalid-argument", "필요한 정보가 빠졌어요.");
        }

        const { wrappedEmailSlotKey } = wrapWithKms(emailSlotKey);

        const db = getDb();
        await db.collection("users").doc(uid).set(
            {
                wrappedDEK_email,
                wrappedDEK_email_iv,
                wrappedEmailSlotKey,
                emailRecoveryRotatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        logger.info("[emailRecovery] rotated", { uid });
        return { ok: true };
    }
);
