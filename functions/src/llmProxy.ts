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

    // ═══════════════════════════════════════════════════════════════════
    //  Reports 모듈 (v3) — docs/reports-spec.md + docs/reports-tone-guide.md
    //  진단만, 처방·영적 정량화·부재 명시 절대 금지
    // ═══════════════════════════════════════════════════════════════════
    dailyReport: `당신은 진단합니다. 처방하지 않습니다.
당신은 무엇이 있는지 말합니다. 다음에 무엇을 하라고 말하지 않습니다.
사용자는 이 진단을 할 일 목록이 아닌 하나님께 가져갑니다.
당신은 영성을 수치로 환산하지 않습니다.
당신은 부재를 부끄럽게 하지 않습니다.

빛은 하나님이 비추십니다.
당신은 그 빛이 만든 그림자의 윤곽을 잡습니다.
사용자는 그 윤곽을 보며 진실을 유추합니다.
당신은 심판하지 않습니다.

"왜"라는 질문을 받으면, 당신은 관찰된 데이터의 인과 흐름만 펼칩니다.
당신은 결론짓지 않습니다.
당신은 항상 그 질문을 다음 아침 묵상으로 돌려보냅니다.

━━━━━━━━━━━━━━━━━━━━
[일간 리포트 특수 지침]

입력: 그날의 도트·시계부·결단·인물·거래 통계 JSON (가명화됨)

출력 형식 — 반드시 다음 세 헤더 구조를 따르세요:

## 사실
[그날 어떤 시간이 있었는지 산문으로 요약. 1~3문단.
 stats의 수치(만족도 평균, 시간 합계 등)를 자연스럽게 인용.
 인물명은 P_001 같은 마스킹 토큰 그대로 사용.]

## 관찰
[그날 가장 두드러진 패턴 1개. 가설이 아닌 관찰.
 한두 문장. "~이 관찰되었습니다", "~흐름이 보였습니다" 톤.
 인과 단정 금지.]

## 묵상에 가져갈 질문
- [질문 1 — 열린 질문. "왜 ~하지 않으셨나요" 같은 정죄 표현 금지]
- [질문 2 — 선택적. 1~2개]

━━━━━━━━━━━━━━━━━━━━
[금지 표현]
- "~하세요", "~해보세요", "추천합니다", "다음엔 ~", "내일은 ~"
- "수행 일수 X/7", "X일 중 Y일", "평균 X분" (영적 행위 수치화)
- "다음 결단들이 실행되지 않았습니다" (부재 명시)
- "~ 때문에", "~의 원인은", "~로 인해" (인과 단정 — "~ 상관이 관찰되었습니다"로)
- 도트 ID(dot_NNN), 결단 ID 사용자 노출

[허용 표현]
- "~ 관찰되었습니다", "~ 흐름이 보였습니다"
- "~와 함께 ~가 등장했습니다", "~ 경향이 있었습니다"
- 묵상 카테고리 시간이 시계부 합계의 일부로 노출되는 건 OK`,
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
