/**
 * llmProxy.ts — Gemini AI 프록시 (Sanctum OS)
 *
 * 클라이언트에서 가명화된 페이로드를 전달받아 Gemini로 분석을 요청한다.
 * API 키는 Firebase Secrets로 관리되어 클라이언트에 절대 노출되지 않는다.
 *
 * 호출 (클라이언트):
 *   const result = await httpsCallable(functions, 'llmProxy')({
 *     task: 'dayReport',
 *     payload: { stats, ... },
 *     model: 'gemini-2.5-flash'
 *   });
 *
 * 응답: { text: string, task: string, model: string }
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

/**
 * 시스템 프롬프트 — task별로 명확한 톤·구조 강제
 *
 * 모든 프롬프트의 공통 원칙:
 *   - 명령형 금지 ("~하세요" X). "~한 패턴이 보여요" 톤
 *   - 인물 라벨링 X (P_001 같은 마스킹 토큰을 그대로 두면 클라이언트가 다시 복원)
 *   - 5섹션 구조 (요약/잘된 것/못한 것/원인 가설/검증할 행동)
 */
const SYSTEM_PROMPTS: Record<string, string> = {
    dayReport: `당신은 사용자의 하루 도트 데이터를 분석하는 영적 동반자입니다.

원칙:
- 명령형 사용 금지. "~하세요" 대신 "~한 패턴이 보여요" 톤으로 가설 제시
- 결단은 사용자가 말씀과 기도 안에서 직접 내림. AI는 단지 거울 역할
- 사람 이름은 P_001, P_002 등 마스킹 토큰으로 들어옵니다. 그 토큰을 그대로 사용하세요
- 따뜻하고 평신도 친화적인 한국어

출력 형식 (5섹션):
①사실 요약 — 오늘 어떤 시간이 있었는지
②잘된 것의 공통 패턴 — 만족도 높은 슬롯의 공통점
③안 된 것의 공통 패턴 — 만족도 낮거나 못한 슬롯의 공통점
④원인 가설 — 왜 그랬을지 2~3가지 가설 (단정 X, "~수도 있어요")
⑤검증할 행동 — 결단이 아니라, 작은 실험 1~2개`,

    weekReport: `당신은 7일치 데이 리포트를 분석하는 영적 동반자입니다. 동일 5섹션 구조. 패턴은 일별이 아니라 주간 단위로 보세요.`,

    monthReport: `당신은 4~5주치 위크 리포트를 분석하는 영적 동반자입니다. 동일 5섹션. 큰 흐름과 계절감을 보세요.`,

    quarterReport: `당신은 3개월치 월간 리포트를 분석하는 영적 동반자입니다. 동일 5섹션. 분기 단위 변화의 결을 보세요.`,

    yearReport: `당신은 1년치 분기 리포트를 분석하는 영적 동반자입니다. 동일 5섹션. 한 해의 큰 줄기를 보세요.`,

    briefing: `당신은 타임박싱(시간 잡기) 직전에 1초 안에 떠오르는 브리핑을 주는 동반자입니다.

출력 형식 (4섹션, 각 1~2줄):
📖 관련 원칙 — 사용자가 핀 해둔 원칙 중 이 작업에 닿는 것
📊 데이터 인사이트 — 비슷한 작업에서 사용자가 보였던 패턴
⚠️ 원칙의 허점 — 사용자가 자주 무너지는 지점
🙏 묵상 점검 — 이 시간이 오늘 말씀과 어떻게 이어지는지 한 줄 질문`,
};

interface LLMRequest {
    task: string;
    payload: unknown;
    model?: string;
}

interface LLMResponse {
    text: string;
    task: string;
    model: string;
}

export const llmProxy = onCall<LLMRequest, Promise<LLMResponse>>(
    {
        secrets: [GEMINI_API_KEY],
        region: "asia-northeast3",
        memory: "256MiB",
        timeoutSeconds: 60,
        cors: true,
    },
    async (req) => {
        // 1) 인증 확인
        if (!req.auth) {
            throw new HttpsError("unauthenticated", "로그인 후 이용해 주세요.");
        }

        const { task, payload, model = "gemini-2.5-flash" } = req.data;

        // 2) task 화이트리스트
        if (!Object.keys(SYSTEM_PROMPTS).includes(task)) {
            throw new HttpsError("invalid-argument", `Unknown task: ${task}`);
        }

        // 3) 모델 화이트리스트
        const allowedModels = ["gemini-2.5-flash", "gemini-2.5-pro"];
        if (!allowedModels.includes(model)) {
            throw new HttpsError("invalid-argument", `Unknown model: ${model}`);
        }

        // 4) Gemini 호출
        try {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY.value());
            const generativeModel = genAI.getGenerativeModel({
                model,
                systemInstruction: SYSTEM_PROMPTS[task],
            });

            const result = await generativeModel.generateContent(JSON.stringify(payload));
            const text = result.response.text();

            return { text, task, model };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[llmProxy] Gemini call failed:", msg);
            throw new HttpsError("internal", `AI 호출에 실패했어요: ${msg}`);
        }
    }
);
