/**
 * Sanctum OS Cloud Functions — entry
 *
 * 외부에 노출되는 함수:
 *   - llmProxy: 클라이언트 → 가명화된 페이로드를 Gemini에 전달, 응답 반환
 *   - emailRecovery*: 트랙 2 Phase 3 — 이메일 복구 (등록/요청/검증/복원/회전)
 *
 * 배포: firebase deploy --only functions
 * 시크릿 등록:
 *   firebase functions:secrets:set GEMINI_API_KEY
 *   firebase functions:secrets:set GMAIL_USER
 *   firebase functions:secrets:set GMAIL_APP_PASSWORD
 *   firebase functions:secrets:set SLOT_KMS_KEY
 *
 * 보안 원칙
 * - 인증된 사용자만 호출 가능 (request.auth)
 * - 모든 키는 Firebase Secrets에만 보관, 클라이언트는 절대 못 봄
 * - 가명화된 페이로드만 받음 (사람 이름·금액 등은 마스킹된 상태)
 * - 이메일 복구: 서버는 평문 DEK를 절대 갖지 않음 (설계 Y)
 */

export { llmProxy } from "./llmProxy";
export {
    emailRecoveryRegister,
    emailRecoveryRequest,
    emailRecoveryVerify,
    emailRecoveryRedeemSeed,
    emailRecoveryRotateSeed,
} from "./emailRecovery";
