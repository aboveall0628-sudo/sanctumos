/**
 * Sanctum OS Cloud Functions — entry
 *
 * 외부에 노출되는 함수:
 *   - llmProxy: 클라이언트 → 가명화된 페이로드를 Gemini에 전달, 응답 반환
 *
 * 배포: firebase deploy --only functions:llmProxy
 * 시크릿 등록: firebase functions:secrets:set GEMINI_API_KEY
 *
 * 보안 원칙
 * - 인증된 사용자만 호출 가능 (request.auth)
 * - API 키는 Firebase Secrets에만 보관, 클라이언트는 절대 못 봄
 * - 가명화된 페이로드만 받음 (사람 이름·금액 등은 마스킹된 상태)
 */

export { llmProxy } from "./llmProxy";
