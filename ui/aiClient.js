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

    // 캐시 확인 (opts.bypassCache가 true면 건너뛰고 새로 호출 — 재작성 버튼용)
    const cacheKey = await hashKey(task, masked);
    if (!opts.bypassCache) {
        try {
            const cached = await getCachedLLM(cacheKey);
            if (cached) return { text: depseudonymize(cached, mapping), fallback: false };
        } catch { /* IndexedDB 사용 불가 시 무시 */ }
    }

    // Cloud Function 호출 시도
    const callable = await getCallable();
    if (callable) {
        try {
            const model = opts.deep ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
            // (2026-05-18 후속 v2) Function 540초 자리에 맞춰 클라이언트도 180초(3분) 자리.
            //   주간 리포트는 큰 stats + 긴 Gemini 응답 → 1~3분 자리 자연. 그 이상은 fallback.
            const callPromise = callable({ task, payload: JSON.parse(masked), model });
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout_180s')), 180_000)
            );
            const res = await Promise.race([callPromise, timeoutPromise]);
            const text = res?.data?.text;
            if (text) {
                setCachedLLM(cacheKey, text).catch(() => {});
                return { text: depseudonymize(text, mapping), fallback: false };
            }
            console.warn('[ai] llmProxy returned empty text — fallback used. task:', task);
        } catch (e) {
            console.warn('[ai] llmProxy call failed:', e?.message || e, 'task:', task);
        }
    } else {
        console.warn('[ai] callable not available — fallback used. task:', task);
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
 * "시간표에 넣기" 모달용 브리핑 — 4섹션
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
 * dailyAggregator의 결정론적 stats + 그날의 묵상 노트 본문을 받아
 * 세 섹션을 산문으로 채움:
 *   ## 사실 → aiSummary
 *   ## 관찰 → observation (한 개)
 *   ## 묵상에 가져갈 질문 → questionsForMeditation (1~2개)
 *
 * 묵상 본문 활용 원칙 (시스템 프롬프트 가드레일):
 *   - 동기-행동 연결을 관찰하기 위해 본문 허용
 *   - 묵상의 깊이·질 평가 금지, 영적 코칭 금지
 *
 * 가명화: stats·meditation 안의 인물·금액 등은 context로 전달.
 * 응답의 P_001 토큰은 callLLM의 depseudonymize가 자동 역가명화.
 *
 * @param {Object}  dailyStats - aggregateDailyStats() 출력
 * @param {Object}  context    - { persons, orgs, places, amounts } 배열
 * @param {Object|null} meditation - { content, decisions, prayer } — 그날의 묵상 노트 (있으면)
 * @returns {Promise<{aiSummary, observation, questionsForMeditation, fallback}>}
 */
export async function callDailyReport(dailyStats, context = {}, meditation = null, opts = {}) {
    const plain = {
        stats: dailyStats,
        meditation: meditation || null,    // { content, decisions, prayer } | null
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
        bypassCache: !!opts.force,        // 재작성 버튼 누른 경우 캐시 무시
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
/**
 * Phase E-2: 대시보드용 "이번 주의 결" — 한 단락 산문.
 *
 * quickReview 의 4섹션 brief 와 달리, 대시보드는 묵상의 자리 톤.
 * 한 단락(2~4 문장)으로 이번 주 데이터의 결을 그리되 처방 없이.
 *
 * 입력:
 *   weekStats   — { dotStats, satisfactionDistribution, alignment, ... }
 *                 (대시보드가 computeDotStats 으로 만든 객체)
 *   principles  — 핀 원칙 1개 ({ title, body })
 *   context     — { persons: ['이름', ...], orgs: ['조직', ...] }
 *                 가명화 후 LLM 에 전달, 역가명화로 복원.
 *
 * 출력: { text: string, fallback: boolean }
 */
export async function getDashboardWeeklyBrief(weekStats, principles = [], context = {}) {
    const plain = {
        weekStats,
        principles,
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    };

    const result = await callLLM('weeklyDashboard', plain, {
        deep: false,
        stats: weekStats,
    });

    if (result.fallback) {
        return { text: buildWeeklyDashboardFallback(weekStats, principles, context), fallback: true };
    }
    return { text: result.text.trim(), fallback: false };
}

function buildWeeklyDashboardFallback(stats, principles, context) {
    const ds  = stats?.dotStats || stats || {};
    const sat = stats?.satisfactionDistribution || {};
    const totalDots = ds.totalDots ?? ds.totalSlots ?? 0;
    const done      = ds.doneCount ?? 0;
    const partial   = ds.partialCount ?? 0;
    const avg       = sat.avg ?? ds.avgSatisfaction ?? null;

    const peopleCount = (context?.persons || []).length;
    const orgCount    = (context?.orgs || []).length;
    const pin         = principles?.[0]?.title || null;

    const parts = [];
    if (totalDots > 0) {
        parts.push(
            `이번 주 도트 ${totalDots}개 중 ${done}개 완료${
                partial ? `, ${partial}개 부분 완료` : ''
            }${avg != null ? ', 평균 만족도 ' + avg : ''}.`
        );
    } else {
        parts.push('이번 주는 아직 기록된 도트가 적었습니다.');
    }
    if (peopleCount > 0 || orgCount > 0) {
        const segs = [];
        if (peopleCount > 0) segs.push(`${peopleCount}명`);
        if (orgCount > 0)    segs.push(`조직 ${orgCount}곳`);
        parts.push(`함께한 흔적: ${segs.join(', ')}.`);
    }
    if (pin) {
        parts.push(`핀 원칙 "${pin}"이 곁에 있었습니다.`);
    }
    parts.push('이 결을 묵상 안에서 한 번 더 만나 보세요.');
    return parts.join(' ');
}

// ═══════════════════════════════════════════════════════════════════
//  Reports 모듈 — STEP 1.5 (Phase E-5-B, 2026-05-11)
//  docs/reports-spec.md §3.2 주간 리포트
//  헤더: ## 사실 / ## 가설 / ## 결단의 흐름 / ## 묵상에 가져갈 질문
// ═══════════════════════════════════════════════════════════════════

/**
 * 주간 리포트 AI 호출
 *
 * weeklyAggregator의 결정론적 stats를 받아 네 섹션을 산문/배열로 채움:
 *   ## 사실               → aiSummary
 *   ## 가설               → hypotheses [{ text, repetitionCount }]   (반복 횟수 표기 필수)
 *   ## 결단의 흐름        → decisionFlow (A3 추상화 산문, 라벨·ID 명시 X)
 *   ## 묵상에 가져갈 질문 → questionsForMeditation[3]
 *
 * 가명화: stats 안의 인물 토큰은 호출자(flow)가 personCounts 에서 ID→이름 매핑한 뒤
 * context.persons 로 넣어줌. 응답의 P_001 토큰은 callLLM 의 depseudonymize 가 역가명화.
 *
 * @param {Object}      weekStats     - aggregateWeeklyStats() 출력
 * @param {Object}      context       - { persons, orgs, places, amounts } 배열
 * @param {Array|null}  daySummaries  - (선택) 일간 리포트 7개 요약. 현재는 null 권장 — 주간 stats 만으로도 충분.
 * @param {Object}      opts          - { force?: bool }
 * @returns {Promise<{
 *   aiSummary: string|null,
 *   hypotheses: Array<{text:string, repetitionCount:string|null}>,
 *   decisionFlow: string|null,
 *   questionsForMeditation: string[],
 *   fallback: boolean
 * }>}
 */
export async function callWeeklyReport(weekStats, context = {}, daySummaries = null, opts = {}) {
    const plain = {
        stats:        weekStats,
        daySummaries: daySummaries || null,     // 현재는 null. 추후 합성 모드 대비 자리.
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    };

    const result = await callLLM('weekReport', plain, {
        deep:        false,             // flash 모델 (spec §3.2)
        stats:       weekStats,
        bypassCache: !!opts.force,
    });

    if (result.fallback) {
        return { ...buildWeeklyReportFallback(weekStats), fallback: true };
    }

    const parsed = parseWeeklyReportResponse(result.text);
    return { ...parsed, fallback: false };
}

/**
 * weekReport 응답 파서 — 네 마크다운 헤더를 섹션으로 분리.
 *
 * 가설 라인 규약: `- (N/7) 텍스트` 또는 `- (3/7일에서) 텍스트` 등.
 * 정규식으로 `(N/M)` 패턴을 떼어 repetitionCount 로 분리, 본문은 text.
 *
 * 형식 위반 시 partial fallback — 못 찾은 섹션은 null/[]로 두고,
 * 헤더가 하나도 없으면 전체 텍스트를 aiSummary 로.
 */
function parseWeeklyReportResponse(text) {
    const result = {
        aiSummary:              null,
        hypotheses:             [],
        decisionFlow:           null,
        questionsForMeditation: [],
    };
    const headers = [
        { keys: ['사실'],                          target: 'aiSummary'              },
        { keys: ['가설'],                          target: 'hypotheses'             },
        { keys: ['결단의 흐름', '결단 흐름'],       target: 'decisionFlow'           },
        { keys: ['묵상에 가져갈 질문', '묵상 질문'], target: 'questionsForMeditation' },
    ];

    const lines = String(text).split(/\r?\n/);
    let currentTarget = null;
    let buffer = [];

    const stripBullet = (s) => s.replace(/^[-*•·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();

    const flush = () => {
        if (!currentTarget || buffer.length === 0) return;
        const content = buffer.join('\n').trim();

        if (currentTarget === 'hypotheses') {
            // 각 bullet 한 줄씩. `(N/M)` 패턴을 떼어 repetitionCount, 나머지를 text.
            const bullets = content.split(/\n/).map(stripBullet).filter(l => l.length > 0);
            result.hypotheses = bullets.slice(0, 5).map(line => {
                const m = line.match(/^\(?\s*(\d+\s*\/\s*\d+)(?:\s*일?에?서?)?\s*\)?\s*[-—:]?\s*(.+)$/);
                if (m) {
                    return {
                        text:            m[2].trim(),
                        repetitionCount: m[1].replace(/\s+/g, ''),
                    };
                }
                return { text: line, repetitionCount: null };
            });
        } else if (currentTarget === 'questionsForMeditation') {
            const questions = content.split(/\n/).map(stripBullet).filter(l => l.length > 0);
            result.questionsForMeditation = questions.slice(0, 3);
        } else {
            // aiSummary, decisionFlow — 산문 그대로
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

    // 헤더 하나도 못 찾으면 전체를 aiSummary 로
    const empty = !result.aiSummary
        && result.hypotheses.length === 0
        && !result.decisionFlow
        && result.questionsForMeditation.length === 0;
    if (empty) result.aiSummary = String(text).trim();

    return result;
}

/**
 * llmProxy 미배포·실패 시 fallback — stats 만으로 만들 수 있는 최소 진단.
 *
 * 톤 가이드 준수: 처방·영적 정량화·부재 명시 0건.
 * 가설은 비워둔다 (반복 횟수 없는 가설은 spec 위반이라 차라리 만들지 않음).
 */
function buildWeeklyReportFallback(weekStats) {
    const s          = weekStats || {};
    const totalDots  = s.totalDots ?? 0;
    const tband      = s.timeBandPattern || {};
    const decision   = s.decisionFlow || {};
    const pinned     = (s.pinnedPrincipleApplication?.items) || [];
    const persons    = (s.personCounts?.items) || [];

    const factsParts = [];
    if (totalDots > 0) {
        factsParts.push(`이번 주 도트가 ${totalDots}개 기록되었습니다.`);
    } else {
        factsParts.push('이번 주는 아직 기록된 도트가 적었습니다.');
    }

    // 시간대 4구간 — 가장 만족도 높은 / 낮은 구간 한 줄
    const bandList = Object.values(tband).filter(b => typeof b?.avg === 'number');
    if (bandList.length >= 2) {
        const sorted = [...bandList].sort((a, b) => b.avg - a.avg);
        factsParts.push(
            `시간대 만족도는 "${sorted[0].label}"에서 ${sorted[0].avg}로 가장 높게, ` +
            `"${sorted[sorted.length - 1].label}"에서 ${sorted[sorted.length - 1].avg}로 가장 낮게 관찰되었습니다.`
        );
    }

    // 핀 원칙
    if (pinned.length > 0) {
        const applied = pinned.filter(p => p.appliedCount > 0);
        if (applied.length > 0) {
            const total = applied.reduce((sum, p) => sum + p.appliedCount, 0);
            factsParts.push(`핀 원칙 ${applied.length}개가 이번 주 도트에 ${total}회 함께 등장했습니다.`);
        }
    }

    // 인물 만남
    if (persons.length > 0) {
        const top = persons.slice(0, 3).length;
        factsParts.push(`함께한 사람은 ${persons.length}명, 그중 가장 자주 만난 ${top}명의 흐름이 보였습니다.`);
    }

    // 결단 흐름 — A3 추상화 톤만
    let decisionFlowText;
    if (decision.sampleSize > 0) {
        decisionFlowText =
            `이번 주, 결단에서 실행까지의 평균 거리는 ${decision.avgDistanceDays}일이었습니다. ` +
            `시간표에 옮겨진 결단의 흐름이 ${decision.sampleSize}회 관찰되었습니다.`;
    } else {
        decisionFlowText = '이번 주는 시간표에 옮겨진 결단의 실행 흐름을 관찰하기에 표본이 부족했습니다.';
    }

    return {
        aiSummary:    factsParts.join(' ') || null,
        hypotheses:   [],
        decisionFlow: decisionFlowText,
        questionsForMeditation: [
            '이번 주 가장 잔잔히 머문 시간은 어디였습니까?',
            '결단과 행동 사이의 거리가, 어떻게 느껴졌습니까?',
            '함께한 사람들 안에서 무엇이 보였습니까?',
        ],
    };
}

/**
 * 월간 리포트 호출 (Reports 모듈 STEP 2 — Phase E-9/R-2)
 *
 * 응답 구조 (spec §3.3 / llmProxy monthReport 출력):
 *   {
 *     aiSummary: string|null,                       // ## 사실
 *     hypotheses: Array<{text, repetitionCount}>,   // ## 가설 (2주+ 반복)
 *     patternsObserved: Array<{title, body}>,       // ## 이번 달 자주 관찰된 패턴 (A1)
 *     decisionFlow: string|null,                    // ## 결단의 흐름 (A3 추상화)
 *     questionsForMeditation: string[],             // ## 묵상 질문 (4~5개)
 *     fallback: boolean
 *   }
 */
export async function callMonthlyReport(monthStats, context = {}, weekSummaries = null, opts = {}) {
    const plain = {
        stats:         monthStats,
        weekSummaries: weekSummaries || null,
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    };

    const result = await callLLM('monthReport', plain, {
        deep:        true,                  // pro 모델 (spec §3.3)
        stats:       monthStats,
        bypassCache: !!opts.force,
    });

    if (result.fallback) {
        return { ...buildMonthlyReportFallback(monthStats), fallback: true };
    }

    const parsed = parseMonthlyReportResponse(result.text);
    return { ...parsed, fallback: false };
}

/**
 * monthReport 응답 파서 — 다섯 마크다운 헤더를 섹션으로 분리.
 * 가설 패턴은 weekly와 동일 (`(N/4)` 또는 `(N/주)`).
 * "패턴" 섹션은 sub-bullet 구조이므로 본문을 그대로 보관 (title 추출은 첫 줄).
 */
function parseMonthlyReportResponse(text) {
    const result = {
        aiSummary:              null,
        hypotheses:             [],
        patternsObserved:       [],
        decisionFlow:           null,
        questionsForMeditation: [],
    };
    const headers = [
        { keys: ['사실'],                                     target: 'aiSummary'              },
        { keys: ['가설'],                                     target: 'hypotheses'             },
        { keys: ['이번 달 자주 관찰된 패턴', '관찰된 패턴'],   target: 'patternsObserved'       },
        { keys: ['결단의 흐름', '결단 흐름'],                  target: 'decisionFlow'           },
        { keys: ['묵상에 가져갈 질문', '묵상 질문'],            target: 'questionsForMeditation' },
    ];

    const lines = String(text).split(/\r?\n/);
    let currentTarget = null;
    let buffer = [];

    const stripBullet = (s) => s.replace(/^[-*•·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();

    const flush = () => {
        if (!currentTarget || buffer.length === 0) return;
        const content = buffer.join('\n').trim();

        if (currentTarget === 'hypotheses') {
            const bullets = content.split(/\n/).map(stripBullet).filter(l => l.length > 0);
            result.hypotheses = bullets.slice(0, 7).map(line => {
                const m = line.match(/^\(?\s*(\d+\s*\/\s*\d+)(?:\s*주?에?서?)?\s*\)?\s*[-—:]?\s*(.+)$/);
                if (m) return { text: m[2].trim(), repetitionCount: m[1].replace(/\s+/g, '') };
                return { text: line, repetitionCount: null };
            });
        } else if (currentTarget === 'questionsForMeditation') {
            const questions = content.split(/\n/).map(stripBullet).filter(l => l.length > 0);
            result.questionsForMeditation = questions.slice(0, 5);
        } else if (currentTarget === 'patternsObserved') {
            // 패턴 N개 — "패턴 — 제목" 헤더로 분할. 빈 블록 제거.
            const blocks = content.split(/\n(?=패턴\b|패턴\s*\d|##)/).map(b => b.trim()).filter(Boolean);
            result.patternsObserved = blocks.slice(0, 5).map(block => {
                const firstLine = block.split(/\n/, 1)[0] || '';
                const title = firstLine.replace(/^패턴\s*[\d:.\-—]*\s*/, '').trim() || '관찰된 패턴';
                return { title, body: block };
            });
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

    const empty = !result.aiSummary
        && result.hypotheses.length === 0
        && result.patternsObserved.length === 0
        && !result.decisionFlow
        && result.questionsForMeditation.length === 0;
    if (empty) result.aiSummary = String(text).trim();

    return result;
}

/**
 * 월간 fallback — llmProxy 미배포·실패 시 stats만으로 최소 진단.
 * 가설/패턴은 비워둠 (반복 횟수 없는 가설은 spec 위반).
 */
function buildMonthlyReportFallback(monthStats) {
    const s = monthStats || {};
    const totalDots = s.totalDots ?? 0;
    const wm = s.weeklyMatrix?.weeks || [];
    const cat = s.categorySatisfactionMatrix?.items || [];
    const persons = s.personNetwork?.items || [];
    const decision = s.decisionFlow || {};
    const pinned = s.pinnedPrincipleEffectiveness || {};

    const factsParts = [];
    if (totalDots > 0) {
        factsParts.push(`이번 달 도트가 ${totalDots}개 기록되었습니다.`);
    } else {
        factsParts.push('이번 달은 아직 기록된 도트가 적었습니다.');
    }
    if (wm.length > 0) {
        factsParts.push(`주간 리포트가 ${wm.length}주분 합류되었습니다.`);
    }
    if (cat.length > 0) {
        const top = cat[0];
        const hours = Math.round((top.durationMinutes || 0) / 60 * 10) / 10;
        factsParts.push(`가장 많은 시간이 "${top.category}"에 ${hours}시간 잡혔습니다.`);
    }
    if (persons.length > 0) {
        factsParts.push(`함께한 사람은 ${s.personNetwork.totalUniquePersons || persons.length}명이었습니다.`);
    }
    if (pinned.hasPinned && pinned.applied && pinned.unapplied
        && pinned.applied.avgSatisfaction != null && pinned.unapplied.avgSatisfaction != null) {
        factsParts.push(
            `핀 원칙을 의식한 도트의 만족도 평균은 ${pinned.applied.avgSatisfaction}, ` +
            `의식하지 않은 도트는 ${pinned.unapplied.avgSatisfaction}로 관찰되었습니다.`
        );
    }

    let decisionFlowText;
    if (decision.sampleSize > 0) {
        decisionFlowText =
            `이번 달, 결단에서 실행까지의 평균 거리는 ${decision.avgDistanceDays}일이었습니다. ` +
            `시간표에 옮겨진 결단의 흐름이 ${decision.sampleSize}회 관찰되었습니다.`;
    } else {
        decisionFlowText = '이번 달은 시간표에 옮겨진 결단의 실행 흐름을 관찰하기에 표본이 부족했습니다.';
    }

    return {
        aiSummary:        factsParts.join(' ') || null,
        hypotheses:       [],
        patternsObserved: [],
        decisionFlow:     decisionFlowText,
        questionsForMeditation: [
            '이번 달, 가장 자주 머문 자리는 어디였습니까?',
            '결단과 행동 사이의 거리가 어떻게 변해갔습니까?',
            '함께한 사람들 사이에서 무엇이 보였습니까?',
            '이번 달 시간의 결을 한 단어로 부른다면 무엇입니까?',
        ],
    };
}

/**
 * Phase E-9/R-QA: 리포트 Q&A 호출 (spec §4 — 세 겹 안전장치 중 2세 포함).
 *
 * @param {Object} args
 *   @param {string} args.question        사용자 질문 ("왜 화요일이 낮았어?")
 *   @param {string} args.reportType      'day'|'week'|'month'|'quarter'|'year'
 *   @param {Object} args.stats           해당 리포트의 stats (가명화·deterministic)
 *   @param {Object} [args.context]       persons/orgs/places/amounts (가명화 복원용)
 *
 * @returns {Promise<{
 *   observationFlow: string,       관찰된 흐름 본문 (마지막 두 줄 제외 부분)
 *   returnToMeditation: string,    필수 종결 두 줄
 *   full: string,                  화면 표시용 전체 텍스트 (둘을 한 줄 띄어 합침)
 *   fallback: boolean,
 *   safetyPatched: boolean         AI가 종결 두 줄을 빠뜨려 클라이언트가 보완했는지
 * }>}
 */
export async function callReportQuestion({ question, reportType, stats, context = {} }) {
    const plain = {
        question,
        reportType,
        stats,
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    };

    const result = await callLLM('reportQuestion', plain, {
        deep:        false,    // flash — Q&A 는 가벼움
        stats,
        bypassCache: true,     // 같은 질문도 매번 fresh (질문 텍스트가 키에 안 들어감)
    });

    if (result.fallback) {
        return { ...buildReportQuestionFallback(stats, question), fallback: true, safetyPatched: false };
    }

    const parsed = parseReportQuestionResponse(result.text);
    return { ...parsed, fallback: false };
}

/**
 * Q&A 응답 파서 — spec §4 출력 템플릿 기준.
 *
 * 정상 출력:
 *   관찰된 데이터의 흐름:
 *     ① ...
 *     ② ...
 *
 *   이것은 "왜"의 답이 아닙니다. 데이터가 그린 흐름일 뿐입니다.
 *
 *   이 흐름을 가지고 내일 아침 묵상에서
 *   말씀과 기도 안에서 하나님을 먼저 만나세요.
 *
 * 세 겹 안전장치 2세: 마지막 두 줄("이것은 '왜'의 답이 아닙니다" + "내일 묵상으로")
 *   이 누락되면 클라이언트가 보완해 끼움. safetyPatched=true 로 표시.
 */
function parseReportQuestionResponse(text) {
    const NOT_WHY_LINE   = "이것은 \"왜\"의 답이 아닙니다. 데이터가 그린 흐름일 뿐입니다.";
    const MEDITATION_LINE = "이 흐름을 가지고 내일 아침 묵상에서 말씀과 기도 안에서 하나님을 먼저 만나세요.";

    // STEP A-5: LLM 이 본문에 P_001/O_001 토큰을 그대로 인용한 경우 줄 단위로 제거.
    //   원칙적으로는 enrichStatsAndContext 에서 막아야 하지만, LLM 이 stats 의 다른 자리에서
    //   잔재 ID 를 보고 추출했을 경우의 안전망. 토큰이 들어간 줄은 응답에서 빼고 safetyPatched.
    const TOKEN_PATTERN = /\b[PO]_\d{3,}\b/;
    let sanitized = String(text || '')
        .split(/\r?\n/)
        .filter(line => !TOKEN_PATTERN.test(line))
        .join('\n');
    if (sanitized.length < String(text || '').length * 0.5) {
        // 50% 이상 잘리면 위험 — 원본 유지하고 safetyPatched 신호만
        sanitized = String(text || '');
    }
    const raw = sanitized.trim();
    // 가벼운 정규화 — 따옴표 종류, 공백, 줄바꿈
    const looksLike = (line, candidate) => {
        const norm = (s) => String(s).replace(/['""'']/g, '"').replace(/\s+/g, ' ').trim();
        return norm(candidate).includes(norm(line).slice(0, 18))
            || norm(line).includes(norm(candidate).slice(0, 18));
    };

    const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    let hasNotWhy = lines.some(l => looksLike(l, NOT_WHY_LINE) || (l.includes('왜') && l.includes('답이 아닙니다')));
    let hasMeditation = lines.some(l => looksLike(l, MEDITATION_LINE)
        || (l.includes('내일 아침') && l.includes('묵상')));

    let safetyPatched = false;
    let observationFlow = raw;
    let returnToMeditation = `${NOT_WHY_LINE}\n\n${MEDITATION_LINE}`;

    if (hasNotWhy && hasMeditation) {
        // 정상 — 응답에서 마지막 두 줄을 떼어내 분리
        const lastNotWhyIdx = lines.findLastIndex(l => l.includes('답이 아닙니다'));
        const flowLines = lines.slice(0, Math.max(0, lastNotWhyIdx));
        const tailLines = lines.slice(Math.max(0, lastNotWhyIdx));
        observationFlow = flowLines.join('\n').trim();
        returnToMeditation = tailLines.join('\n').trim();
    } else {
        // 안전장치 2세 — 본문 그대로 두고 종결 두 줄을 클라이언트가 보완
        safetyPatched = true;
    }

    const full = `${observationFlow}\n\n${returnToMeditation}`.trim();
    return { observationFlow, returnToMeditation, full, safetyPatched };
}

function buildReportQuestionFallback(stats, question) {
    const flow = stats && stats.totalDots != null
        ? `이 기간에 ${stats.totalDots}개의 도트가 관찰되었습니다.\n질문 "${String(question || '').slice(0, 60)}"에 대해 AI 흐름을 지금 부를 수 없는 상태예요.`
        : `질문 "${String(question || '').slice(0, 60)}"에 대해 AI 흐름을 지금 부를 수 없는 상태예요.`;
    return {
        observationFlow: flow,
        returnToMeditation: `이것은 "왜"의 답이 아닙니다. 데이터가 그린 흐름일 뿐입니다.\n\n이 흐름을 가지고 내일 아침 묵상에서 말씀과 기도 안에서 하나님을 먼저 만나세요.`,
        full: `${flow}\n\n이것은 "왜"의 답이 아닙니다. 데이터가 그린 흐름일 뿐입니다.\n\n이 흐름을 가지고 내일 아침 묵상에서 말씀과 기도 안에서 하나님을 먼저 만나세요.`,
    };
}

/**
 * 분기 리포트 호출 (Phase E-9/R-3)
 *
 * 응답: { aiSummary, hypotheses, decisionFlow, principleValidation, questionsForMeditation, fallback }
 */
export async function callQuarterlyReport(quarterStats, context = {}, monthSummaries = null, opts = {}) {
    const plain = {
        stats:          quarterStats,
        monthSummaries: monthSummaries || null,
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    };
    const result = await callLLM('quarterReport', plain, {
        deep:        true,           // pro 모델 (spec §3.4)
        stats:       quarterStats,
        bypassCache: !!opts.force,
    });
    if (result.fallback) {
        return { ...buildQuarterlyReportFallback(quarterStats), fallback: true };
    }
    const parsed = parseQuarterlyReportResponse(result.text);
    return { ...parsed, fallback: false };
}

function parseQuarterlyReportResponse(text) {
    const result = {
        aiSummary:              null,
        hypotheses:             [],
        decisionFlow:           null,
        principleValidation:    [],  // 원칙 라이프사이클 미완 — 빈 채로 보관
        questionsForMeditation: [],
    };
    const headers = [
        { keys: ['사실'],                                  target: 'aiSummary' },
        { keys: ['가설'],                                  target: 'hypotheses' },
        { keys: ['결단의 흐름', '결단 흐름'],               target: 'decisionFlow' },
        { keys: ['묵상에 가져갈 질문', '묵상 질문'],         target: 'questionsForMeditation' },
    ];
    const lines = String(text).split(/\r?\n/);
    let currentTarget = null;
    let buffer = [];
    const stripBullet = (s) => s.replace(/^[-*•·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
    const flush = () => {
        if (!currentTarget || buffer.length === 0) return;
        const content = buffer.join('\n').trim();
        if (currentTarget === 'hypotheses') {
            const bullets = content.split(/\n/).map(stripBullet).filter(l => l.length > 0);
            result.hypotheses = bullets.slice(0, 7).map(line => {
                const m = line.match(/^\(?\s*(\d+\s*\/\s*\d+)\s*\)?\s*[-—:]?\s*(.+)$/);
                if (m) return { text: m[2].trim(), repetitionCount: m[1].replace(/\s+/g, '') };
                return { text: line, repetitionCount: null };
            });
        } else if (currentTarget === 'questionsForMeditation') {
            const questions = content.split(/\n/).map(stripBullet).filter(l => l.length > 0);
            result.questionsForMeditation = questions.slice(0, 5);
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
    const empty = !result.aiSummary && result.hypotheses.length === 0
        && !result.decisionFlow && result.questionsForMeditation.length === 0;
    if (empty) result.aiSummary = String(text).trim();
    return result;
}

function buildQuarterlyReportFallback(quarterStats) {
    const s = quarterStats || {};
    const totalDots = s.totalDots ?? 0;
    const monthly = s.monthlyMatrix?.months || [];
    const persons = s.personNetwork?.items || [];
    const decision = s.decisionFlow || {};
    const factsParts = [];
    if (totalDots > 0) factsParts.push(`이번 분기 도트가 ${totalDots}개 기록되었습니다.`);
    else factsParts.push('이번 분기는 아직 기록된 도트가 적었습니다.');
    if (monthly.length > 0) factsParts.push(`월간 리포트가 ${monthly.length}개 합류되었습니다.`);
    if (persons.length > 0) {
        factsParts.push(`함께한 사람은 ${s.personNetwork.totalUniquePersons || persons.length}명이었습니다.`);
    }
    let decisionFlowText;
    if (decision.sampleSize > 0) {
        decisionFlowText =
            `이번 분기, 결단에서 실행까지의 평균 거리는 ${decision.avgDistanceDays}일이었습니다. ` +
            `시간표에 옮겨진 결단의 흐름이 ${decision.sampleSize}회 관찰되었습니다.`;
    } else {
        decisionFlowText = '이번 분기는 시간표에 옮겨진 결단의 실행 흐름을 관찰하기에 표본이 부족했습니다.';
    }
    return {
        aiSummary:           factsParts.join(' ') || null,
        hypotheses:          [],
        decisionFlow:        decisionFlowText,
        principleValidation: [],
        questionsForMeditation: [
            '이번 분기, 가장 자주 머문 자리는 어디였습니까?',
            '결단과 행동 사이의 거리가 어떻게 변해갔습니까?',
            '함께한 사람들 사이에서 무엇이 보였습니까?',
            '이번 분기 시간의 결을 한 문장으로 부른다면?',
        ],
    };
}

/**
 * 연간 리포트 호출 (Phase E-9/R-4)
 *
 * 응답: { aiSummary, hypotheses, decisionFlow, principleValidation, questionsForMeditation, fallback }
 */
export async function callYearlyReport(yearStats, context = {}, quarterSummaries = null, opts = {}) {
    const plain = {
        stats:            yearStats,
        quarterSummaries: quarterSummaries || null,
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    };
    const result = await callLLM('yearReport', plain, {
        deep:        true,    // pro 모델 (spec §3.5)
        stats:       yearStats,
        bypassCache: !!opts.force,
    });
    if (result.fallback) {
        return { ...buildYearlyReportFallback(yearStats), fallback: true };
    }
    const parsed = parseYearlyReportResponse(result.text);
    return { ...parsed, fallback: false };
}

function parseYearlyReportResponse(text) {
    const result = {
        aiSummary:              null,
        hypotheses:             [],
        decisionFlow:           null,
        principleValidation:    [],
        questionsForMeditation: [],
    };
    const headers = [
        { keys: ['사실'],                                  target: 'aiSummary' },
        { keys: ['가설'],                                  target: 'hypotheses' },
        { keys: ['결단의 흐름', '결단 흐름'],               target: 'decisionFlow' },
        { keys: ['묵상에 가져갈 질문', '묵상 질문'],         target: 'questionsForMeditation' },
    ];
    const lines = String(text).split(/\r?\n/);
    let currentTarget = null;
    let buffer = [];
    const stripBullet = (s) => s.replace(/^[-*•·]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
    const flush = () => {
        if (!currentTarget || buffer.length === 0) return;
        const content = buffer.join('\n').trim();
        if (currentTarget === 'hypotheses') {
            const bullets = content.split(/\n/).map(stripBullet).filter(l => l.length > 0);
            result.hypotheses = bullets.slice(0, 10).map(line => {
                const m = line.match(/^\(?\s*(\d+\s*\/\s*\d+)\s*\)?\s*[-—:]?\s*(.+)$/);
                if (m) return { text: m[2].trim(), repetitionCount: m[1].replace(/\s+/g, '') };
                return { text: line, repetitionCount: null };
            });
        } else if (currentTarget === 'questionsForMeditation') {
            const questions = content.split(/\n/).map(stripBullet).filter(l => l.length > 0);
            result.questionsForMeditation = questions.slice(0, 5);
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
    const empty = !result.aiSummary && result.hypotheses.length === 0
        && !result.decisionFlow && result.questionsForMeditation.length === 0;
    if (empty) result.aiSummary = String(text).trim();
    return result;
}

function buildYearlyReportFallback(yearStats) {
    const s = yearStats || {};
    const totalDots = s.totalDots ?? 0;
    const quarters = s.quarterlyMatrix?.quarters || [];
    const personUnique = s.personNetwork?.totalUniquePersons ?? 0;
    const decision = s.decisionFlow || {};
    const med = s.meditationFlow || {};

    const factsParts = [];
    if (totalDots > 0) factsParts.push(`올해 도트가 총 ${totalDots}개 기록되었습니다.`);
    else factsParts.push('올해는 아직 기록된 도트가 적었습니다.');
    if (quarters.length > 0) factsParts.push(`분기 리포트가 ${quarters.length}개 합류되었습니다.`);
    if (personUnique > 0) factsParts.push(`함께한 사람은 ${personUnique}명이었습니다.`);
    if (med.totalMinutes > 0) {
        const h = Math.round(med.totalMinutes / 60 * 10) / 10;
        factsParts.push(`묵상 카테고리에 ${h}시간이 잡혔습니다.`);
    }
    let decisionFlowText;
    if (decision.sampleSize > 0) {
        decisionFlowText =
            `올해, 결단에서 실행까지의 평균 거리는 ${decision.avgDistanceDays}일이었습니다. ` +
            `시간표에 옮겨진 결단의 흐름이 ${decision.sampleSize}회 관찰되었습니다.`;
    } else {
        decisionFlowText = '올해는 시간표에 옮겨진 결단의 실행 흐름을 관찰하기에 표본이 부족했습니다.';
    }
    return {
        aiSummary:           factsParts.join(' ') || null,
        hypotheses:          [],
        decisionFlow:        decisionFlowText,
        principleValidation: [],
        questionsForMeditation: [
            '올해, 가장 자주 머문 자리는 어디였습니까?',
            '결단과 행동 사이의 거리가 한 해를 통해 어떻게 변해갔습니까?',
            '함께한 사람들 사이에서 무엇이 보였습니까?',
            '올해를 한 단어로 부른다면 무엇입니까?',
            '내년 묵상에 가져갈 질문 하나를 고른다면?',
        ],
    };
}

// ═══════════════════════════════════════════════════════════════════
//  B-2 트랙 v2 (2026-05-13) — 분별의 자리 소크라테스 호출 재설계
//  llmProxy.ts task 'socratic' v2 와 1:1 대응.
//
//  v1 → v2 변화 (실사용 피드백):
//   - previousQuestionTypes 누적 — 같은 유형 반복 차단 (반복의 주범 1)
//   - relatedPrayers 페이로드 — 27번 자동 추천 흐름
//   - relatedPersons/Orgs/recentDots — 탓 톤 감지 후 다음 호출에만 채움
//   - 응답 마커 ---META--- TYPE:<유형> NEED:<데이터타입> 파싱
//     → 사용자에게 보일 본문은 마커 제거, 메타는 별도 반환
// ═══════════════════════════════════════════════════════════════════

const SOCRATIC_META_REGEX = /^\s*-{2,}\s*META\s*-{2,}\s*(.+?)\s*$/im;

/**
 * 분별의 자리 소크라테스 흐름 호출.
 *
 * @param {Object} args
 *   @param {'question'|'opinion'|'summary'} args.mode
 *   @param {number}  args.questionNumber           1~5
 *   @param {string[]} args.previousQuestionTypes   이미 던진 질문 유형 ["명료화","근거",...] — 같은 유형 금지
 *   @param {string}  args.situation
 *   @param {Array}   args.principles               [{title, body, strength, category}]
 *   @param {Array}   args.precedents               [{situation, decision, decidedAt, contextNote}]
 *   @param {Array}   args.relatedPrayers           [{date, excerpt}] — 27번 자동 추천. 0~3개
 *   @param {Array}   args.relatedPersons           [{name, stance, relationship, note}] — 탓 톤 후만
 *   @param {Array}   args.relatedOrgs              [{name, stance, note}] — 탓 톤 후만
 *   @param {Array}   args.recentDots               [{date, label, satisfaction, note}] — 탓 톤 후만
 *   @param {Array}   args.history                  [{role:'ai'|'user', text}]
 *   @param {Object?} args.goalContext              null | { title, description }
 *   @param {Object}  args.context                  { persons:[], orgs:[], ... } 가명화 매핑
 *
 * @returns {Promise<{
 *   text: string,                 // 사용자에게 보일 본문 (마커 제거됨)
 *   questionType: string|null,    // AI가 박은 질문 유형 (명료화/전제/근거/관점/결과/본질)
 *   contextNeeded: string[],      // 다음 호출에 추가해야 할 데이터 종류 (persons/orgs/dots/prayers)
 *   fallback: boolean
 * }>}
 */
export async function callDecisionSocratic({
    mode,
    questionNumber,
    previousQuestionTypes = [],
    situation,
    principles = [],
    precedents = [],
    relatedPrayers = [],
    relatedPersons = [],
    relatedOrgs = [],
    recentDots = [],
    history = [],
    goalContext = null,
    context = {},
}) {
    const plain = {
        mode,
        questionNumber,
        previousQuestionTypes,
        situation,
        principles,
        precedents,
        relatedPrayers,
        relatedPersons,
        relatedOrgs,
        recentDots,
        history,
        goalContext,
        context: {
            persons: context.persons || [],
            orgs:    context.orgs    || [],
            places:  context.places  || [],
            amounts: context.amounts || [],
        },
    };

    const result = await callLLM('socratic', plain, {
        deep:        false,
        bypassCache: true,
    });

    if (result.fallback) {
        return { text: '', questionType: null, contextNeeded: [], fallback: true };
    }

    const parsed = _parseSocraticResponse(String(result.text || ''));
    return { ...parsed, fallback: false };
}

/**
 * 응답에서 ---META--- TYPE:<유형> NEED:<list> 라인 떼어내 본문/메타 분리.
 *
 * 정상 응답 예:
 *   일주일 뒤에도 같은 결로 느껴지실까요?
 *   ---META--- TYPE:결과 NEED:none
 *
 * 마커 누락 시 본문 그대로, 메타는 null/[].
 *
 * NEED 값:
 *   none  — 추가 데이터 불필요
 *   persons,orgs,dots,prayers (콤마/공백 구분) — 다음 호출에 추가
 */
function _parseSocraticResponse(raw) {
    const text = raw.trim();
    const m = text.match(SOCRATIC_META_REGEX);

    if (!m) {
        return { text, questionType: null, contextNeeded: [] };
    }

    const metaLine = m[1];
    const cleanText = text.replace(SOCRATIC_META_REGEX, '').trim();

    let questionType = null;
    const typeMatch = metaLine.match(/TYPE\s*:\s*([^\s,]+)/i);
    if (typeMatch) questionType = typeMatch[1].trim();

    let contextNeeded = [];
    const needMatch = metaLine.match(/NEED\s*:\s*([^\n]+)/i);
    if (needMatch) {
        const raw = needMatch[1].trim().toLowerCase();
        if (raw && raw !== 'none') {
            contextNeeded = raw.split(/[\s,]+/).filter(s => s && s !== 'none');
        }
    }

    return { text: cleanText, questionType, contextNeeded };
}

// ═══════════════════════════════════════════════════════════════════
//  53번 본인 프로필 AI 부트스트랩 (2026-05-14)
//  llmProxy.ts task 'profileBootstrap' 과 1:1 대응.
//  두 모드: 'ask'(다음 질문 plain text) | 'extract'(필드 매핑 JSON)
// ═══════════════════════════════════════════════════════════════════

/**
 * 본인 프로필 부트스트랩 호출.
 *
 * @param {Object} args
 *   @param {'ask'|'extract'} args.mode
 *   @param {string} args.currentGroup       'id'|'faith'|'calling'|'selfAwareness'|'strengths'
 *   @param {string} args.groupLabel         "신분증" 등 한국어 라벨
 *   @param {Array}  args.groupFields        [{key, label, type:'text'|'csv', hint}]
 *   @param {number} args.groupQuestionNumber 1~3 (그 묶음 안 차례)
 *   @param {boolean} args.isLastInGroup
 *   @param {Array}  args.previousAnswers    [{q, a}] 이번 묶음 누적
 *   @param {Object} args.currentValues      {field: 기존값} 사용자가 이미 적은 값
 *   @param {string} args.userName           이름 (호명용, 없으면 '')
 *
 * @returns {Promise<{
 *   text?: string,         // mode='ask' 응답
 *   extractions?: Array<{field, value, confidence, evidence}>,   // mode='extract'
 *   fallback: boolean
 * }>}
 */
export async function callProfileBootstrap({
    mode,
    currentGroup,
    groupLabel,
    groupFields,
    groupQuestionNumber = 1,
    isLastInGroup = false,
    previousAnswers = [],
    currentValues = {},
    userName = '',
}) {
    const plain = {
        mode,
        currentGroup,
        groupLabel,
        groupFields,
        groupQuestionNumber,
        isLastInGroup,
        previousAnswers,
        currentValues,
        userName,
        // 본인 정보라 가명화 context 비움 (이미 본인 데이터)
        context: { persons: [], orgs: [], places: [], amounts: [] },
    };

    const result = await callLLM('profileBootstrap', plain, {
        deep:        false,    // flash — 가벼움
        bypassCache: true,     // 대화형
    });

    if (result.fallback) {
        return { fallback: true, text: '', extractions: [] };
    }

    if (mode === 'ask') {
        return { text: String(result.text || '').trim(), fallback: false };
    }

    // mode === 'extract' — JSON 파싱
    const parsed = _parseExtractResponse(result.text);
    return { extractions: parsed.extractions, fallback: false };
}

/**
 * extract 응답 파서 — 시스템 프롬프트가 raw JSON 강제했지만 안전망 필요.
 * 코드블록(```json) 또는 앞뒤 텍스트가 섞여 들어와도 JSON 본체 추출.
 */
function _parseExtractResponse(raw) {
    const text = String(raw || '').trim();
    if (!text) return { extractions: [] };

    // 1) 코드블록 안 JSON 추출 시도
    const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    const candidate = fenced ? fenced[1] : text;

    // 2) { ... } 첫 매치 추출
    const braceStart = candidate.indexOf('{');
    const braceEnd   = candidate.lastIndexOf('}');
    if (braceStart < 0 || braceEnd < 0 || braceEnd < braceStart) {
        console.warn('[profileBootstrap] extract — no JSON braces:', text.slice(0, 100));
        return { extractions: [] };
    }
    const jsonStr = candidate.slice(braceStart, braceEnd + 1);

    try {
        const obj = JSON.parse(jsonStr);
        const arr = Array.isArray(obj?.extractions) ? obj.extractions : [];
        // 정합성 필터 — field 와 value 둘 다 있는 항목만
        const clean = arr
            .filter(e => e && typeof e.field === 'string' && e.value !== undefined && e.value !== null)
            .map(e => ({
                field:      e.field,
                value:      e.value,
                confidence: e.confidence || 'medium',
                evidence:   e.evidence || ''
            }));
        return { extractions: clean };
    } catch (e) {
        console.warn('[profileBootstrap] extract JSON parse failed:', e.message, jsonStr.slice(0, 100));
        return { extractions: [] };
    }
}

// ═══════════════════════════════════════════════════════════════════
//  CS AI 트랙 §9-4 — SWAN 에이전트 호출 (2026-05-15)
//  llmProxy.ts task 'swanAgent' (다중턴) + 'swanSummary' (종료 시 1회) 와 1:1 대응.
//  feedbacksRepo 가 turns/요약을 저장. 여기는 호출 + 파싱·폴백만.
// ═══════════════════════════════════════════════════════════════════

/**
 * SWAN 다음 발화 호출.
 *
 * @param {Object} args
 *   @param {Array}  args.history       [{role:'swan'|'user', text}]
 *   @param {string} args.screenPath
 *   @param {Array}  args.consoleErrors
 *   @param {number} args.turnCount
 *
 * @returns {Promise<{ text: string, fallback: boolean }>}
 */
export async function callSwanAgent({ history = [], screenPath = '', consoleErrors = [], turnCount = 0 }) {
    const plain = {
        history,
        screenPath,
        consoleErrors,
        turnCount,
        context: { persons: [], orgs: [], places: [], amounts: [] },
    };
    const result = await callLLM('swanAgent', plain, {
        deep:        false,
        bypassCache: true,
    });
    if (result.fallback) {
        return { text: '', fallback: true };
    }
    return { text: String(result.text || '').trim(), fallback: false };
}

/**
 * 대화 종료 시 자동 요약·분류 호출.
 *
 * @param {Object} args
 *   @param {Array}  args.turns         [{role:'swan'|'user', text}]
 *   @param {string} args.screenPath
 *   @param {Array}  args.consoleErrors
 *
 * @returns {Promise<{
 *   summary: string,
 *   category: 'error'|'ux_ui'|'feature_request'|'other',
 *   confidence: number,
 *   fallback: boolean
 * }>}
 */
export async function callSwanSummary({ turns = [], screenPath = '', consoleErrors = [] }) {
    const plain = {
        turns,
        screenPath,
        consoleErrors,
        context: { persons: [], orgs: [], places: [], amounts: [] },
    };
    const result = await callLLM('swanSummary', plain, {
        deep:        false,
        bypassCache: true,
    });
    if (result.fallback) {
        return { ...buildSwanSummaryFallback(turns), fallback: true };
    }
    const parsed = parseSwanSummaryResponse(result.text);
    return { ...parsed, fallback: false };
}

function parseSwanSummaryResponse(raw) {
    const text = String(raw || '').trim();
    if (!text) return buildSwanSummaryFallback([]);

    // 코드블록 안 JSON 또는 raw JSON 추출
    const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    const candidate = fenced ? fenced[1] : text;
    const braceStart = candidate.indexOf('{');
    const braceEnd   = candidate.lastIndexOf('}');
    if (braceStart < 0 || braceEnd < 0 || braceEnd < braceStart) {
        console.warn('[swanSummary] no JSON braces:', text.slice(0, 100));
        return buildSwanSummaryFallback([]);
    }
    try {
        const obj = JSON.parse(candidate.slice(braceStart, braceEnd + 1));
        const validCats = ['error', 'ux_ui', 'feature_request', 'other'];
        return {
            summary:    String(obj.summary || '').trim(),
            category:   validCats.includes(obj.category) ? obj.category : 'other',
            confidence: typeof obj.confidence === 'number'
                ? Math.max(0, Math.min(1, obj.confidence))
                : 0.5,
        };
    } catch (e) {
        console.warn('[swanSummary] JSON parse failed:', e.message);
        return buildSwanSummaryFallback([]);
    }
}

// ─── 사전 설문 (1차 베타 검증 시나리오 v1 §1) ──────────────────────

const PRE_SURVEY_META_REGEX = /^\s*-{2,}\s*META\s*-{2,}\s*(.+?)\s*$/im;

/**
 * SWAN 사전 설문 다음 발화 호출.
 *
 * @param {Object} args
 *   @param {Array}  args.history          [{role:'swan'|'user', text}]
 *   @param {string[]} args.askedQuestionIds   이미 던진 핵심 질문 ID (예: ['Q1','Q2'])
 *   @param {number} args.turnCount
 *
 * @returns {Promise<{
 *   text: string,              // 사용자에게 보일 본문 (META 라인 제거됨)
 *   askedNow: string|null,     // 이번 발화에서 핵심으로 던진 질문 ('Q3' 또는 null)
 *   nextQuestion: string|null, // 다음 질문 ID ('Q4', 'done', 또는 null)
 *   done: boolean,             // 마무리 발화 여부
 *   fallback: boolean
 * }>}
 */
export async function callSwanPreSurvey({ history = [], askedQuestionIds = [], turnCount = 0 }) {
    const plain = {
        history,
        askedQuestionIds,
        turnCount,
        context: { persons: [], orgs: [], places: [], amounts: [] },
    };
    const result = await callLLM('swanPreSurvey', plain, {
        deep:        false,
        bypassCache: true,
    });
    if (result.fallback) {
        return { text: '', askedNow: null, nextQuestion: null, done: false, fallback: true };
    }
    return { ..._parsePreSurveyResponse(String(result.text || '')), fallback: false };
}

function _parsePreSurveyResponse(raw) {
    const text = raw.trim();
    const m = text.match(PRE_SURVEY_META_REGEX);
    if (!m) {
        return { text, askedNow: null, nextQuestion: null, done: false };
    }
    const metaLine = m[1];
    const cleanText = text.replace(PRE_SURVEY_META_REGEX, '').trim();

    let askedNow = null;
    const aMatch = metaLine.match(/ASKED\s*:\s*(\S+)/i);
    if (aMatch && aMatch[1].toLowerCase() !== 'none') askedNow = aMatch[1].trim();

    let nextQuestion = null;
    const nMatch = metaLine.match(/NEXT\s*:\s*(\S+)/i);
    if (nMatch) nextQuestion = nMatch[1].trim();

    let done = false;
    const dMatch = metaLine.match(/DONE\s*:\s*(\S+)/i);
    if (dMatch) done = /^true$/i.test(dMatch[1]);

    return { text: cleanText, askedNow, nextQuestion, done };
}

/**
 * 사전 설문 종료 시 구조화 추출 호출.
 *
 * @param {Object} args
 *   @param {Array} args.turns  [{role, text}]
 *
 * @returns {Promise<{ extract: Object|null, fallback: boolean }>}
 */
export async function callSwanPreSurveyExtract({ turns = [] }) {
    const plain = {
        turns,
        context: { persons: [], orgs: [], places: [], amounts: [] },
    };
    const result = await callLLM('swanPreSurveyExtract', plain, {
        deep:        false,
        bypassCache: true,
    });
    if (result.fallback) {
        return { extract: null, fallback: true };
    }
    const extract = _parseExtractJson(result.text);
    return { extract, fallback: false };
}

function _parseExtractJson(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    const candidate = fenced ? fenced[1] : text;
    const braceStart = candidate.indexOf('{');
    const braceEnd   = candidate.lastIndexOf('}');
    if (braceStart < 0 || braceEnd < 0 || braceEnd < braceStart) {
        console.warn('[swanPreSurveyExtract] no JSON braces');
        return null;
    }
    try {
        return JSON.parse(candidate.slice(braceStart, braceEnd + 1));
    } catch (e) {
        console.warn('[swanPreSurveyExtract] JSON parse failed:', e.message);
        return null;
    }
}

/**
 * 사전 설문 폼 v2 Phase 2-1 — 12 질문 일괄 SWAN 톤 가공 호출 (2026-05-18).
 *
 * @param {Object} args
 *   @param {Object} args.userContext  { devotionalLevel?: string|null }
 *   @param {Array}  args.questions    [{ id: 'Q1', originalTitle: '...' }, ...]
 *
 * @returns {Promise<{ questions: Object|null, fallback: boolean }>}
 *   questions = { Q1: '...', Q2: '...', ..., Q12: '...' } 또는 null
 */
export async function callSwanPreSurveyQuestions({ userContext = {}, questions = [] }) {
    const plain = {
        userContext,
        questions,
        context: { persons: [], orgs: [], places: [], amounts: [] },
    };
    const result = await callLLM('swanPreSurveyQuestions', plain, {
        deep:        false,
        bypassCache: true,
    });
    if (result.fallback) {
        return { questions: null, fallback: true };
    }
    const parsed = _parseExtractJson(result.text);
    return { questions: parsed, fallback: false };
}

function buildSwanSummaryFallback(turns) {
    const userTexts = (turns || []).filter(t => t.role === 'user').map(t => t.text);
    const joined = userTexts.join(' ').slice(0, 120);
    return {
        summary:    joined || '자동 요약을 만들지 못했어요. 대화 원본을 참고해 주세요.',
        category:   'other',
        confidence: 0,
    };
}

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
