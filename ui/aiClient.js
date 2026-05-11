/**
 * aiClient.js — Cloud Function `llmProxy` 호출 래퍼 + 로컬 fallback
 *
 * 보안 원칙
 * - 클라이언트는 Gemini API 키를 절대 직접 보지 않음
 * - 모든 호출은 Firebase Cloud Function `llmProxy`를 경유
 * - 호출 직전에 가명화(crypto/pseudonymizer)로 사람·금액·장소 치환
 *
 * 현재 상태
 * - llmProxy 배포 전: 항상 generateLocalFallback 으로 폴백
 * - 배포 후: callLLM이 실제 Gemini 응답 반환, 실패 시도 fallback
 *
 * 캐싱
 * - 같은 task + 같은 가명화 페이로드면 IndexedDB에 결과 캐시 (24h)
 *   → 동일 인사이트 반복 호출로 비용 낭비 방지
 */

import { generateLocalFallback } from '../infra/cloudFunctionProxy.js';
import { pseudonymize, depseudonymize } from '../crypto/cryptoService.js';

const CACHE_DB = 'SanctumAICache';
const CACHE_STORE = 'llm';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

let _functionsInstance = null;

async function getCallable() {
    if (_functionsInstance) return _functionsInstance;
    try {
        // Firebase Functions SDK 동적 로드 (옵션)
        const fn = await import('https://www.gstatic.com/firebasejs/10.11.1/firebase-functions.js');
        const { auth } = await import('../data/firebase.js');
        const functions = fn.getFunctions(auth.app, 'asia-northeast3');
        _functionsInstance = fn.httpsCallable(functions, 'llmProxy');
        return _functionsInstance;
    } catch (e) {
        // Cloud Functions가 배포 안 됐거나 SDK 로드 실패 → fallback 모드
        console.info('[ai] llmProxy unavailable, using local fallback. Reason:', e?.message);
        return null;
    }
}

/**
 * LLM 호출 진입점
 * @param {string} task - 'dayReport' | 'weekReport' | 'monthReport' | 'briefing' | ...
 * @param {Object} plain - 원본 데이터 (가명화 전)
 * @param {Object} opts - { deep: boolean (true=Pro, false=Flash), stats: 폴백용 }
 * @returns {Promise<{text: string, fallback: boolean}>}
 */
export async function callLLM(task, plain, opts = {}) {
    // pseudonymize는 { safeText, mapping } 반환 — 가명화된 텍스트를 masked로 받음
    const { safeText: masked, mapping } = pseudonymize(JSON.stringify(plain), plain.context || {});

    // 캐시 확인
    const cacheKey = await hashKey(task, masked);
    try {
        const cached = await getCachedLLM(cacheKey);
        if (cached) return { text: depseudonymize(cached, mapping), fallback: false };
    } catch { /* IndexedDB 사용 불가 시 무시 */ }

    // Cloud Function 호출 시도
    const callable = await getCallable();
    if (callable) {
        try {
            const model = opts.deep ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
            const res = await callable({ task, payload: JSON.parse(masked), model });
            const text = res?.data?.text;
            if (text) {
                setCachedLLM(cacheKey, text).catch(() => {});
                return { text: depseudonymize(text, mapping), fallback: false };
            }
        } catch (e) {
            console.warn('[ai] llmProxy call failed:', e?.message);
        }
    }

    // 폴백
    const fb = generateLocalFallback(opts.stats || {});
    return { text: fb.aiSummary, fallback: true };
}

// ─── IndexedDB 캐시 ───
function openCache() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(CACHE_DB, 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore(CACHE_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getCachedLLM(key) {
    const db = await openCache();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const get = tx.objectStore(CACHE_STORE).get(key);
        get.onsuccess = () => {
            const v = get.result;
            if (!v) return resolve(null);
            if (Date.now() - v.ts > CACHE_TTL_MS) return resolve(null);
            resolve(v.text);
        };
        get.onerror = () => reject();
    });
}

async function setCachedLLM(key, text) {
    const db = await openCache();
    return new Promise((resolve) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).put({ text, ts: Date.now() }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

async function hashKey(task, masked) {
    const enc = new TextEncoder().encode(task + '|' + masked);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 타임박싱 모달용 브리핑 — 4섹션
 *
 * 4섹션 구조:
 *   📖 관련 원칙 / 📊 지난 패턴 / ⚠️ 주의할 점 / 🙏 묵상 점검
 *
 * @param {string} taskKeywords - 이 시간에 할 일 키워드
 * @param {Array}  principles   - 관련된 사용자 원칙 ({title, body})
 * @param {Object} pastStats    - 폴백/지난 패턴 표시용 통계
 * @param {Object} context      - 가명화에 필요한 식별자
 *                                { persons:string[], orgs:string[], places:string[], amounts:number[] }
 */
export async function getBriefingForTask(taskKeywords, principles = [], pastStats = {}, context = {}) {
    const result = await callLLM('briefing', {
        taskKeywords,
        principles,
        pastStats,
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    }, { stats: pastStats });

    if (result.fallback) {
        return {
            sections: buildFallbackSections(principles, pastStats, context),
            fallback: true,
        };
    }

    // 실제 LLM 응답 — 4섹션 헤더 파싱 시도, 실패 시 한 섹션으로 fallback
    const parsed = parseBriefingResponse(result.text);
    return { sections: parsed, fallback: false };
}

function buildFallbackSections(principles, pastStats, context) {
    const peopleHint = (context?.persons?.length)
        ? `오늘 함께하는 ${context.persons.length}명을 떠올리며.`
        : '';
    const orgHint = (context?.orgs?.length)
        ? ` 조직 흐름도 한 번 점검해 보세요.`
        : '';
    return [
        {
            icon: 'book-open',
            title: '관련 원칙',
            body: principles.length > 0
                ? principles.map(p => `· ${p.title}`).join('\n')
                : '아직 핀 원칙이 없어요. [나의 원칙]에서 한 줄 적어 보세요.',
        },
        {
            icon: 'bar-chart-3',
            title: '지난 패턴',
            body: `완료 ${pastStats.doneCount || 0} · 만족도 ${pastStats.avgSatisfaction || '-'}`,
        },
        {
            icon: 'alert-triangle',
            title: '주의할 점',
            body: `비교는 거울이지 채찍이 아니에요. 한 걸음만 더.${peopleHint ? ' ' + peopleHint : ''}${orgHint}`.trim(),
        },
        {
            icon: 'hand',
            title: '묵상 점검',
            body: '이 시간이 오늘 말씀과 어떻게 이어지나요?',
        },
    ];
}

/**
 * Gemini 응답을 4섹션으로 파싱.
 *
 * 응답 규약(서버 프롬프트가 이렇게 강제):
 *   ## 관련 원칙
 *   ...
 *   ## 지난 패턴
 *   ...
 *   ## 주의할 점
 *   ...
 *   ## 묵상 점검
 *   ...
 *
 * 위 규약을 못 지킨 응답은 한 섹션으로 표시.
 * icon은 Lucide name — quickReview의 briefingHtml에서 `<i data-lucide>`로 렌더됨.
 */
function parseBriefingResponse(text) {
    const sectionMeta = [
        { key: '관련 원칙',  icon: 'book-open' },
        { key: '지난 패턴',  icon: 'bar-chart-3' },
        { key: '주의할 점',  icon: 'alert-triangle' },
        { key: '묵상 점검',  icon: 'hand' },
    ];

    const lines = String(text).split(/\r?\n/);
    const buckets = sectionMeta.map(m => ({ ...m, body: '' }));
    let current = -1;

    for (const line of lines) {
        const m = line.match(/^#{1,3}\s*(.+?)\s*$/);
        if (m) {
            const idx = sectionMeta.findIndex(s => m[1].includes(s.key));
            if (idx >= 0) { current = idx; continue; }
        }
        if (current >= 0) {
            buckets[current].body += (buckets[current].body ? '\n' : '') + line.trim();
        }
    }

    const matched = buckets.filter(b => b.body.trim().length > 0);
    if (matched.length >= 2) {
        return matched.map(b => ({ icon: b.icon, title: b.key, body: b.body.trim() }));
    }
    return [{ icon: 'sparkles', title: 'AI 브리핑', body: text }];
}

// ═══════════════════════════════════════════════════════════════════
//  Reports 모듈 — STEP 1.2 (2026-05-11)
//  docs/reports-spec.md §3.1 일간 리포트 7·8섹션 (관찰 + 묵상 질문)
//  + 1~6섹션을 묶은 ## 사실 산문
// ═══════════════════════════════════════════════════════════════════

/**
 * 일간 리포트 AI 호출
 *
 * dailyAggregator의 결정론적 stats를 받아 세 섹션을 산문으로 채움:
 *   ## 사실 → aiSummary
 *   ## 관찰 → observation (한 개)
 *   ## 묵상에 가져갈 질문 → questionsForMeditation (1~2개)
 *
 * 가명화: stats 안의 인물·금액 등은 context.persons / amounts 등으로 전달.
 * 응답의 P_001 토큰은 callLLM의 depseudonymize가 자동 역가명화.
 *
 * @param {Object} dailyStats - aggregateDailyStats() 출력
 * @param {Object} context    - { persons, orgs, places, amounts } 배열
 * @returns {Promise<{aiSummary, observation, questionsForMeditation, fallback}>}
 */
export async function callDailyReport(dailyStats, context = {}) {
    const plain = {
        stats: dailyStats,
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    };

    const result = await callLLM('dailyReport', plain, {
        deep: false,   // flash 모델 (일간은 가벼움 — spec §3.1)
        stats: dailyStats,
    });

    if (result.fallback) {
        return { ...buildDailyReportFallback(dailyStats), fallback: true };
    }

    const parsed = parseDailyReportResponse(result.text);
    return { ...parsed, fallback: false };
}

/**
 * dailyReport 응답 파서 — 세 마크다운 헤더를 섹션으로 분리
 *
 * 응답 규약(시스템 프롬프트가 강제):
 *   ## 사실
 *   ...
 *   ## 관찰
 *   ...
 *   ## 묵상에 가져갈 질문
 *   - ...
 *   - ...
 *
 * 형식 위반 시 partial fallback — 못 찾은 섹션은 null로 두고,
 * 헤더가 하나도 없으면 전체 텍스트를 aiSummary로.
 */
function parseDailyReportResponse(text) {
    const result = { aiSummary: null, observation: null, questionsForMeditation: [] };
    const headers = [
        { keys: ['사실'],                            target: 'aiSummary' },
        { keys: ['관찰'],                            target: 'observation' },
        { keys: ['묵상에 가져갈 질문', '묵상 질문'],   target: 'questionsForMeditation' },
    ];

    const lines = String(text).split(/\r?\n/);
    let currentTarget = null;
    let buffer = [];

    const flush = () => {
        if (!currentTarget || buffer.length === 0) return;
        const content = buffer.join('\n').trim();
        if (currentTarget === 'questionsForMeditation') {
            const questions = content.split(/\n/)
                .map(l => l.replace(/^[-*•·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
                .filter(l => l.length > 0);
            result.questionsForMeditation = questions.slice(0, 3);
        } else {
            result[currentTarget] = content;
        }
        buffer = [];
    };

    for (const line of lines) {
        const m = line.match(/^#{1,3}\s*(.+?)\s*$/);
        if (m) {
            const headerText = m[1].trim();
            const found = headers.find(h => h.keys.some(k => headerText.includes(k)));
            if (found) {
                flush();
                currentTarget = found.target;
                continue;
            }
        }
        if (currentTarget) buffer.push(line);
    }
    flush();

    // 헤더 하나도 못 찾으면 전체를 aiSummary로
    if (!result.aiSummary && !result.observation && result.questionsForMeditation.length === 0) {
        result.aiSummary = String(text).trim();
    }

    return result;
}

/**
 * llmProxy 미배포·실패 시 fallback — stats만으로 만들 수 있는 최소 진단
 *
 * AI 없을 때도 사용자가 빈 리포트 안 보도록 stats를 산문으로 한 줄씩.
 * 톤 가이드 준수: 처방·영적 정량화·부재 명시 0건.
 */
function buildDailyReportFallback(stats) {
    const ds    = stats.dotStats || {};
    const sat   = stats.satisfactionDistribution || {};
    const align = stats.alignment || {};

    const parts = [];
    if (ds.totalDots > 0) {
        parts.push(
            `오늘 ${ds.totalDots}개의 도트가 있었습니다. ` +
            `완료 ${ds.doneCount}, 부분 ${ds.partialCount}, ` +
            `건너뜀 ${ds.skippedCount}, 대체 ${ds.replacedCount}.`
        );
    }
    if (sat.avg !== null && sat.avg !== undefined) {
        parts.push(`실행 만족도 평균이 ${sat.avg}로 관찰되었습니다.`);
    }
    if (align.decisionExecutionRate !== null) {
        const pct = Math.round(align.decisionExecutionRate * 100);
        parts.push(`결단 실행률은 ${pct}%로 관찰되었습니다.`);
    }

    return {
        aiSummary: parts.join(' ') || '오늘은 기록된 도트가 거의 없었습니다.',
        observation: null,
        questionsForMeditation: ['오늘의 시간이 어떻게 느껴지셨습니까?'],
    };
}
