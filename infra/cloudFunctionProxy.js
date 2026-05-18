/**
 * cloudFunctionProxy.js — LLM 프록시 클라이언트
 *
 * 모든 LLM 호출은 Cloud Function을 경유합니다.
 * 클라이언트에서 직접 OpenAI/Gemini API 호출 금지.
 * 전송 데이터는 반드시 가명화(pseudonymize) 거친 후 전송.
 */

// Cloud Function URL (배포 후 교체)
const CLOUD_FUNCTION_BASE = 'https://us-central1-biblealimi.cloudfunctions.net';

/**
 * LLM 분석 요청 (리포트 생성용)
 * @param {string} idToken - Firebase Auth ID 토큰
 * @param {Object} payload - 가명화된 데이터 + 프롬프트
 * @returns {Object} AI 응답
 */
export async function requestAnalysis(idToken, payload) {
    const url = `${CLOUD_FUNCTION_BASE}/llmProxy`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({
                type: 'report_analysis',
                data: payload,
            }),
        });

        if (!res.ok) {
            console.warn('LLM proxy returned', res.status);
            return { success: false, fallback: true };
        }
        return await res.json();
    } catch (e) {
        console.warn('LLM proxy unreachable, using fallback:', e.message);
        return { success: false, fallback: true };
    }
}

/**
 * AI 브리핑 요청 ("시간표에 넣기" 모달용)
 */
export async function requestBriefing(idToken, taskKeywords, principles, pastStats) {
    const url = `${CLOUD_FUNCTION_BASE}/llmProxy`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({
                type: 'task_briefing',
                data: { taskKeywords, principles, pastStats },
            }),
        });

        if (!res.ok) return { success: false, fallback: true };
        return await res.json();
    } catch (e) {
        return { success: false, fallback: true };
    }
}

/**
 * LLM 미연동 시 폴백 — 로컬 분석 템플릿
 * 실제 AI 없이 구조화된 요약만 반환
 */
export function generateLocalFallback(stats) {
    const { totalSlots, doneCount, partialCount, skippedCount, avgSatisfaction } = stats;
    const doneRate = totalSlots > 0 ? Math.round((doneCount / totalSlots) * 100) : 0;

    let summary = '';
    if (doneRate >= 80) {
        summary = `전체 ${totalSlots}개 중 ${doneCount}개를 완료하셨어요. 계획한 대로 움직인 하루였네요.`;
    } else if (doneRate >= 50) {
        summary = `${totalSlots}개 중 ${doneCount}개 완료, ${skippedCount}개는 놓쳤어요. 어떤 패턴이 있는지 살펴볼까요?`;
    } else {
        summary = `오늘은 계획과 다르게 흘러간 부분이 많았어요. 괜찮아요, 내일 다시 시작하면 돼요.`;
    }

    if (avgSatisfaction >= 4) {
        summary += ' 만족도가 높은 것이 좋은 신호예요.';
    }

    return {
        success: true,
        fallback: true,
        aiSummary: summary,
        keyPatterns: [],
        suggestedPrinciples: [],
    };
}
