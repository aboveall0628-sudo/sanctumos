/**
 * reminderGenerator.js — 자동 알람 4종 생성기 (Phase E-7/D-2)
 *
 * 호출 시점: 앱 첫 로드 (잠금 해제 직후, dek 준비된 시점)
 *           날짜가 바뀌었거나, 새 dek 으로 진입했을 때 1회.
 *
 * 모든 함수가 idempotent — saveReminderIfAbsent 가 같은 id 면 skip.
 *
 * 4종 자동 알람:
 *   1) weekly-review     — 토요일이고 이번 주 weekReport 가 아직 없으면
 *   2) yesterday-unrated — 어제 도트 중 평가 안 끝난 게 있으면
 *   3) stale-goal        — daily 목표 중 N일+ 미배치 + status='active'
 *   4) principle-unused  — 핀 원칙이 이번 주 도트에 한 번도 안 박혔으면
 */

import { saveReminderIfAbsent, makeReminderId } from './remindersRepo.js';
import { getDotsByDate, getDotsByDateRange } from './dotsRepo.js';
// (B-5 Phase 1.b 2026-05-15) 회복의 자리 자동 트리거 — 약속 어김 패턴 감지
import { detectBrokenPromisePattern, normalizeRecoveryTone } from './recoveryMemosRepo.js';
import { getDailyGoals } from './goalsRepo.js';
import { getPrinciples } from './principlesRepo.js';
import { getAllPersons } from './personRepo.js';
import { getAllOrganizations } from './orgRepo.js';
import { getWeekReport } from '../reports/weekReportRepo.js';
import { db, doc, getDoc } from './firebase.js';
// (#58 후속 2026-05-14) 음력 → 올해 양력 변환 (lazy ESM CDN)
import {
    parseBirthdayMonthDay,
    lunarBirthdayToUpcomingSolar,
    solarBirthdayDaysUntil,
} from '../infra/lunarCalendar.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_GOAL_DAYS_THRESHOLD = 3;   // daily 목표 미배치 N일+ 이면 알람
const EMPTY_CARD_DAYS_THRESHOLD = 3;    // 인물/조직 카드 생성 후 N일+ 미완 시 알람
// (#58 후속) 생일 알람 디폴트 — 7일 전, 3일 전, 당일. 사용자가 설정에서 변경 가능.
const BIRTHDAY_REMINDER_DAYS_DEFAULT = [7, 3, 0];

/**
 * 4종 자동 알람 모두 시도. 각각 try/catch — 하나 실패해도 나머지는 동작.
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} today - 'YYYY-MM-DD'
 * @returns {Promise<{ generated: { weekly:number, yesterday:number, stale:number, principle:number } }>}
 */
export async function generateAllAutoReminders(dek, userId, today) {
    const result = { weekly: 0, yesterday: 0, stale: 0, principle: 0, emptyCard: 0, dailyMed: 0, birthday: 0 };

    try {
        if (await generateWeeklyReviewReminder(dek, userId, today)) result.weekly = 1;
    } catch (e) { console.warn('[reminderGen] weekly-review failed:', e); }

    try {
        if (await generateYesterdayUnratedReminder(dek, userId, today)) result.yesterday = 1;
    } catch (e) { console.warn('[reminderGen] yesterday-unrated failed:', e); }

    // (2026-05-15 베타 1차 선별 — 알람 시스템 재기획 트랙 진입 전 임시 비활성)
    //   stale-goal·principle-unused·empty-card 3종은 1차 베타에서 끄고
    //   2차 베타 전 알람 시스템 전체 재기획에서 다시 살림.
    //   이유: 1차 14일 미션 안에서 목표·핀 원칙·stub 카드 누적이 적어
    //         발화 빈도가 사용자 피로 위험 vs 가치 비교 시 가치 ↓.
    //   함수는 그대로 둠 — 재기획 시 다시 호출.
    //
    // try {
    //     result.stale = await generateStaleGoalReminders(dek, userId, today);
    // } catch (e) { console.warn('[reminderGen] stale-goal failed:', e); }
    //
    // try {
    //     result.principle = await generatePrincipleUnusedReminders(dek, userId, today);
    // } catch (e) { console.warn('[reminderGen] principle-unused failed:', e); }
    //
    // try {
    //     result.emptyCard = await generateEmptyCardReminders(dek, userId, today);
    // } catch (e) { console.warn('[reminderGen] empty-card failed:', e); }

    // (2026-05-13 HC#1 N7) 매일 묵상 알람 — 사용자 설정 시각 이후 1회 발화.
    try {
        if (await generateDailyMeditationReminder(dek, userId, today)) result.dailyMed = 1;
    } catch (e) { console.warn('[reminderGen] daily-meditation failed:', e); }

    // (#58 후속 2026-05-14) 생일 알람 — 7일/3일/당일. innerCircle + 본인.
    try {
        result.birthday = await generateBirthdayReminders(dek, userId, today);
    } catch (e) { console.warn('[reminderGen] birthday failed:', e); }

    // (B-5 Phase 1.b 2026-05-15) 회복의 자리 자동 트리거 — 약속 어김 패턴 감지
    // (2026-05-15 베타 1차 안전 결정 — 자동 발화 임시 OFF)
    //   이유: 트리거 임계(14일×3건+문자열 다름)가 실 사용자에게 정죄로 느껴질지
    //         미지수. 책상 결정 X — 1차 베타 SWAN 인터뷰·14일 종료 인터뷰에서
    //         사용자가 *자발적으로* 회복의 자리 진입하는지 + 그때 어떻게 느끼는지
    //         정성 데이터 모은 후 자동 트리거 부활 여부·기준 결정.
    //   수동 진입(view-today 안 카드·메뉴)은 그대로 유지.
    //   함수는 보존 — 알람 시스템 재기획 Phase R1 진단 후 재활성 결정.
    //
    // try {
    //     if (await generateBrokenPromiseRecoveryReminder(dek, userId, today)) result.recovery = 1;
    //     else result.recovery = 0;
    // } catch (e) { console.warn('[reminderGen] recovery-broken-promise failed:', e); }

    return { generated: result };
}

/**
 * (B-5 Phase 1.b 2026-05-15) 회복의 자리 자동 트리거 — 약속 어김 패턴 감지.
 *
 * 🕊️ 가이드 별:
 *   "양치기 소년 = 정죄 X / 회복 게임 ✓" — 사용자 명시.
 *   "자기 자신만 (마 7:1~5)" — 자동 감지 대상은 본인 도트만.
 *   "무조건 귀여움 + 신뢰·회개는 스스로" — 알람도 부드럽게.
 *
 * 발화 조건 (모두 충족):
 *   1) recoveryTone !== 'off' (사용자가 끄지 않음)
 *   2) 최근 14일 도트에서 약속 어김 N >= 3 감지
 *   3) 같은 주(yearWeek) 안 같은 알람 없음 (idempotent)
 *
 * 빈도 제한 — 주 1회. 같은 패턴으로 매일 시끄럽지 않게.
 *
 * 컨텍스트 ID: yearWeek (한 주에 한 번)
 */
export async function generateBrokenPromiseRecoveryReminder(dek, userId, today) {
    // 1) 사용자 톤 'off' 면 자동 트리거 X (사용자 자율)
    let tone = 'calm';
    try {
        const snap = await getDoc(doc(db, 'users', userId, 'settings', 'spiritualLock'));
        if (snap.exists()) tone = normalizeRecoveryTone(snap.data()?.recoveryTone);
    } catch (e) { /* 설정 없으면 디폴트 calm 으로 진행 */ }
    if (tone === 'off') return false;

    // 2) 최근 14일 도트 가져와서 패턴 감지
    const cutoff = shiftDate(today, -14);
    const dots = await getDotsByDateRange(dek, userId, cutoff, today).catch(() => []);
    if (dots.length === 0) return false;

    const result = detectBrokenPromisePattern(dots, { threshold: 3, lookbackDays: 14 });
    if (!result.detected) return false;

    // 3) 컨텍스트 ID = yearWeek (주 1회)
    const yearWeek = isoYearWeek(today);
    const id = makeReminderId(userId, 'recovery-broken-promise', yearWeek);

    // 4) 톤별 카피
    const isCute = tone === 'cute';
    const title = isCute
        ? '🐣 우리 잠깐 같이 봐볼래요?'
        : '🕊️ 마음에 머무는 패턴이 있어요';
    const body = isCute
        ? '계획한 거랑 실제로 한 게 좀 어긋난 날들이 있어요. 무거우면 안 봐도 돼요.'
        : '계획과 실제 사이에 어긋남이 보여요. 잠깐 같이 머무를래요?';

    const res = await saveReminderIfAbsent(dek, {
        id,
        userId,
        type:         'recovery-broken-promise',
        title,
        body,
        targetView:   'recovery',  // ui/reminders.js navigateToTarget 에서 openRecoveryGate 호출
        // (Phase 1.c 2026-05-15) 패턴 메타 전달 — recoveryGate 모달이 어떤 도트들이었는지 같이 보여줌.
        //   tone 도 같이 전달해서 모달이 알람 시점 톤으로 열림 (사용자가 그 사이 톤 바꿔도 일관).
        targetParams: {
            patternKey:    result.patternKey,
            linkedDotIds:  result.linkedDotIds,
            tone:          tone,
        },
        dueDate:      today,
    });
    return res.created;
}


/**
 * (HC#1 N7) 매일 묵상 알람.
 *
 * 발화 조건:
 *   1) spiritualLock 도큐먼트에 dailyAlarmEnabled === true
 *   2) dailyAlarmTime 이 'HH:MM' 형식
 *   3) 현재 시각 ≥ today + dailyAlarmTime
 *   4) 같은 날짜 컨텍스트에 이미 알람 없음 (idempotent)
 *
 * 컨텍스트 ID: today (하루 한 번).
 */
export async function generateDailyMeditationReminder(dek, userId, today) {
    const snap = await getDoc(doc(db, 'users', userId, 'settings', 'spiritualLock')).catch(() => null);
    if (!snap || !snap.exists()) return false;
    const cfg = snap.data();
    if (cfg.dailyAlarmEnabled !== true) return false;

    const alarmTime = cfg.dailyAlarmTime;
    if (!/^\d{2}:\d{2}$/.test(alarmTime || '')) return false;

    // 알람 시각이 현재 시각보다 미래면 아직 X.
    const now = new Date();
    const [hh, mm] = alarmTime.split(':').map(Number);
    const todayAlarmMs = new Date(today + 'T00:00:00').getTime() + hh * 3600000 + mm * 60000;
    if (now.getTime() < todayAlarmMs) return false;

    const id = makeReminderId(userId, 'daily-meditation', today);
    const res = await saveReminderIfAbsent(dek, {
        id,
        userId,
        type:       'daily-meditation',
        title:      `🌿 ${alarmTime} 묵상 시간이에요`,
        body:       '잠깐 호흡을 고르고 말씀 앞에 앉아 보실래요?',
        targetView: 'today',
        dueDate:    today,
    });
    return res.created;
}

/**
 * ① 토요일이고 이번 주 weekReport 가 아직 없으면 알람 생성.
 * 컨텍스트 ID: yearWeek (같은 주에 한 번)
 */
export async function generateWeeklyReviewReminder(dek, userId, today) {
    const d = new Date(today + 'T00:00:00');
    if (d.getDay() !== 6) return false;   // 토요일(6)만

    const yearWeek = isoYearWeek(today);
    const existingReport = await getWeekReport(dek, userId, yearWeek).catch(() => null);
    if (existingReport && existingReport.aiSummary) return false;   // 이미 만들었으면 알람 X

    const id = makeReminderId(userId, 'weekly-review', yearWeek);
    const res = await saveReminderIfAbsent(dek, {
        id,
        userId,
        type:       'weekly-review',
        title:      '이번 주 회고가 기다리고 있어요',
        body:       '토요일이에요. 한 주의 결을 한 번 그려 보고, 묵상에서 다시 만나 보세요.',
        targetView: 'today',
        dueDate:    today,
    });
    return res.created;
}

/**
 * ② 어제 도트 중 평가 안 끝난 게 있으면 알람.
 * 미평가 = executionSatisfaction 이 null/undefined 인 도트.
 * 컨텍스트 ID: yesterday date (그 어제에 한 번)
 */
export async function generateYesterdayUnratedReminder(dek, userId, today) {
    const yesterday = shiftDate(today, -1);
    const dots = await getDotsByDate(dek, userId, yesterday).catch(() => []);
    if (dots.length === 0) return false;

    const unrated = dots.filter(d => typeof d.executionSatisfaction !== 'number');
    if (unrated.length === 0) return false;

    const id = makeReminderId(userId, 'yesterday-unrated', yesterday);
    const res = await saveReminderIfAbsent(dek, {
        id,
        userId,
        type:       'yesterday-unrated',
        title:      `어제 평가가 ${unrated.length}개 남았어요`,
        body:       '어제의 결을 정리하기 전에 평가가 채워지면 좋아요.',
        targetView: 'today',
        targetParams: { date: yesterday },
        dueDate:    today,
    });
    return res.created;
}

/**
 * ③ stale 목표 — N일+ 묵힌 미배치 daily 목표.
 * 한 목표당 한 알람 (goalId 컨텍스트). 사용자가 알람 [읽음] 처리하면 더는 안 뜸.
 */
export async function generateStaleGoalReminders(dek, userId, today) {
    const goals = await getDailyGoals(dek, userId).catch(() => []);
    const todayMs = new Date(today + 'T00:00:00').getTime();

    let created = 0;
    for (const g of goals) {
        if (g.timeSlot != null) continue;          // 이미 박힌 목표 skip
        if (g.status && g.status !== 'active') continue;

        const createdMs = toMillis(g.createdAt);
        if (createdMs == null) continue;
        const ageDays = Math.floor((todayMs - createdMs) / MS_PER_DAY);
        if (ageDays < STALE_GOAL_DAYS_THRESHOLD) continue;

        const id = makeReminderId(userId, 'stale-goal', g.id);
        const title = (g.title || '(제목 없는 목표)').slice(0, 60);
        const res = await saveReminderIfAbsent(dek, {
            id,
            userId,
            type:       'stale-goal',
            title:      `"${title}" — ${ageDays}일째 시간표에 안 들어갔어요`,
            body:       '오늘 시간표에 옮길지, 아니면 지금은 내려놓을지 한 번 봐 주세요.',
            targetView: 'today',
            targetParams: { goalId: g.id },
            dueDate:    today,
        });
        if (res.created) created++;
    }
    return created;
}

/**
 * ④ 핀 원칙이 이번 주(과거 7일) 도트에 한 번도 안 박혔으면 알람.
 * 컨텍스트 ID: ${principleId}_${yearWeek} (주별·원칙별 한 번)
 */
export async function generatePrincipleUnusedReminders(dek, userId, today) {
    const principles = await getPrinciples(dek, userId).catch(() => []);
    const pinned = principles.filter(p => p.pinned === true);
    if (pinned.length === 0) return 0;

    const weekStart = shiftDate(today, -6);
    const dots = await getDotsByDateRange(dek, userId, weekStart, today).catch(() => []);

    const appliedSet = new Set();
    for (const d of dots) {
        for (const pid of (d.linkedPrincipleIds || [])) appliedSet.add(pid);
    }

    const yearWeek = isoYearWeek(today);
    let created = 0;
    for (const p of pinned) {
        if (appliedSet.has(p.id)) continue;        // 이번 주 한 번이라도 적용됐으면 skip

        const id = makeReminderId(userId, 'principle-unused', `${p.id}_${yearWeek}`);
        const title = (p.title || '(제목 없는 원칙)').slice(0, 60);
        const res = await saveReminderIfAbsent(dek, {
            id,
            userId,
            type:       'principle-unused',
            title:      `핀 원칙 "${title}" — 이번 주 도트에서 한 번도 못 만났어요`,
            body:       '잊고 있었거나, 이번 주에 잘 맞지 않았거나. 묵상에서 한 번 만나 보세요.',
            targetView: 'today',
            targetParams: { principleId: p.id },
            dueDate:    today,
        });
        if (res.created) created++;
    }
    return created;
}

/**
 * ⑤ 인물/조직 카드가 만들어진 지 N일이 지났는데 핵심 필드가 비어있으면 알람.
 *   - 인물: 이름·관계·메모 중 비어있는 게 있으면 (관계는 'unknown'/'acquaintance' 기본도 비어있다고 간주)
 *   - 조직: 이름·종류·메모 중 비어있는 게 있으면
 *   - stub으로 자동 생성된 카드(quickReview에서 inline 추가)는 대개 비어 있으므로 가장 자주 잡힘
 * 컨텍스트 id: 카드 id (한 카드당 한 번만 — 사용자가 채우면 더 이상 안 뜸)
 */
export async function generateEmptyCardReminders(dek, userId, today) {
    let created = 0;
    const todayMs = toMillis(today);

    // ── 인물 ──
    try {
        const persons = await getAllPersons(dek, userId);
        for (const p of (persons || [])) {
            if (p.isFallback) continue;
            const createdMs = toMillis(p.createdAt);
            if (!createdMs) continue;
            const ageDays = Math.floor((todayMs - createdMs) / MS_PER_DAY);
            if (ageDays < EMPTY_CARD_DAYS_THRESHOLD) continue;

            const missing = describeMissingPersonFields(p);
            if (missing.length === 0) continue;

            const id = makeReminderId(userId, 'empty-card-person', p.id);
            const display = (p.name || '').trim() || (Array.isArray(p.nicknames) && p.nicknames[0]) || '이름 없는 인물';
            const res = await saveReminderIfAbsent(dek, {
                id, userId,
                type:       'empty-card-person',
                title:      `${display}님 카드를 마저 채워볼까요?`,
                body:       `${ageDays}일째 빈 곳이 있어요 — ${missing.join(', ')}.`,
                targetView: 'persons',
                targetParams: { personId: p.id },
                dueDate:    today,
            });
            if (res.created) created++;
        }
    } catch (e) { console.warn('[reminderGen] empty-card-person scan failed:', e); }

    // ── 조직 ──
    try {
        const orgs = await getAllOrganizations(dek, userId);
        for (const o of (orgs || [])) {
            const createdMs = toMillis(o.createdAt);
            if (!createdMs) continue;
            const ageDays = Math.floor((todayMs - createdMs) / MS_PER_DAY);
            if (ageDays < EMPTY_CARD_DAYS_THRESHOLD) continue;

            const missing = describeMissingOrgFields(o);
            if (missing.length === 0) continue;

            const id = makeReminderId(userId, 'empty-card-org', o.id);
            const display = (o.name || '').trim() || '이름 없는 조직';
            const res = await saveReminderIfAbsent(dek, {
                id, userId,
                type:       'empty-card-org',
                title:      `${display} 카드를 마저 채워볼까요?`,
                body:       `${ageDays}일째 빈 곳이 있어요 — ${missing.join(', ')}.`,
                targetView: 'organizations',
                targetParams: { orgId: o.id },
                dueDate:    today,
            });
            if (res.created) created++;
        }
    } catch (e) { console.warn('[reminderGen] empty-card-org scan failed:', e); }

    return created;
}

function describeMissingPersonFields(p) {
    const missing = [];
    if (!(p.name || '').trim()) missing.push('이름');
    if (!Array.isArray(p.nicknames) || p.nicknames.length === 0) missing.push('별명');
    // relation은 'acquaintance'(지인) 같은 기본값일 수 있는데, 'unknown'만 진짜 미설정으로 봄
    if (!p.relation || p.relation === 'unknown') missing.push('관계');
    if (!(p.notes || '').trim()) missing.push('메모');
    return missing;
}

function describeMissingOrgFields(o) {
    const missing = [];
    if (!(o.name || '').trim()) missing.push('이름');
    if (!o.type || o.type === 'other') missing.push('종류');
    if (!(o.notes || '').trim()) missing.push('메모');
    return missing;
}

// ─── 헬퍼 ───
function shiftDate(dateStr, deltaDays) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toMillis(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v?.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') {
        const s = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00' : v;
        const ms = Date.parse(s);
        return isNaN(ms) ? null : ms;
    }
    return null;
}

function isoYearWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────
// (#58 후속 2026-05-14) 생일 알람 — 7일 전 + 3일 전 + 당일
//
// 대상: innerCircle=true 인물 카드 + 본인 카드 (isSelf=true)
// 컨텍스트 ID: ${personId}_${today}_${daysOffset}  — 같은 날 같은 알람 한 번만.
// 양력/음력:
//   - birthdayCalendar='solar' 또는 없음 → 양력 단순 계산
//   - birthdayCalendar='lunar' → korean-lunar-calendar 변환 후 양력 매칭
// 라이브러리 실패 시 음력 카드는 조용히 건너뜀 (양력만 처리).
// ─────────────────────────────────────────────────────────────────────
export async function generateBirthdayReminders(dek, userId, today) {
    let created = 0;

    // 1) 설정 읽기 — spiritualLock 도큐먼트의 birthdayAlarmDays (디폴트 [7,3,0])
    let reminderDays = BIRTHDAY_REMINDER_DAYS_DEFAULT;
    try {
        const snap = await getDoc(doc(db, 'users', userId, 'settings', 'spiritualLock'));
        if (snap.exists()) {
            const cfg = snap.data();
            if (Array.isArray(cfg.birthdayAlarmDays)) {
                reminderDays = cfg.birthdayAlarmDays.map(Number).filter(n => Number.isInteger(n) && n >= 0);
            }
        }
    } catch (e) { console.warn('[reminderGen] birthday settings load 실패:', e?.message || e); }
    if (reminderDays.length === 0) return 0;  // 사용자가 모든 옵션 끄면 발화 X

    // 2) 인물 카드 전체 로드
    let all;
    try {
        all = await getAllPersons(dek, userId, { includeSelf: true });
    } catch (e) {
        console.warn('[reminderGen] birthday: getAllPersons 실패', e?.message || e);
        return 0;
    }
    // 3) 대상: 본인 + innerCircle + 명시 birthdayAlertEnabled
    //    "특수하게 케어하는 사람들도 알람 가능하게" (사용자 명시 2026-05-14)
    const targets = all.filter(p => p && (
        p.isSelf === true ||
        p.innerCircle === true ||
        p.birthdayAlertEnabled === true
    ));

    for (const p of targets) {
        if (!p.birthday) continue;
        const md = parseBirthdayMonthDay(p.birthday);
        if (!md) continue;

        // 양력 기준 다가오는 날짜 계산
        let solar; // { year, month, day, daysUntil }
        try {
            if (p.birthdayCalendar === 'lunar') {
                solar = await lunarBirthdayToUpcomingSolar(md.month, md.day, today);
                if (!solar) continue; // 라이브러리 실패 → 조용히 skip
            } else {
                const daysU = solarBirthdayDaysUntil(md.month, md.day, today);
                solar = { month: md.month, day: md.day, daysUntil: daysU };
            }
        } catch (e) {
            console.warn('[reminderGen] birthday 계산 실패:', p.name || p.id, e?.message || e);
            continue;
        }

        if (!reminderDays.includes(solar.daysUntil)) continue;

        const daysOffset = solar.daysUntil;
        const id = makeReminderId(userId, 'birthday', `${p.id}_${today}_${daysOffset}`);
        const isSelf = p.isSelf === true;
        const calLabel = p.birthdayCalendar === 'lunar' ? ' (음력)' : '';

        let title, body;
        const dayLabel = daysOffset === 0 ? '오늘' : `${daysOffset}일 후`;
        if (isSelf) {
            title = `🎂 ${dayLabel} 생신이에요`;
            body  = daysOffset === 0 ? '하루를 곁들여 보세요.'
                  : daysOffset === 1 ? '바로 내일이에요.'
                  : daysOffset === 3 ? '한 호흡 미리.'
                  : '한 주가 다가와요.';
        } else {
            const who = p.name || '한 분';
            title = `🎂 ${who} ${dayLabel} 생신${calLabel}`;
            body  = daysOffset === 0 ? '한 줄 메시지 어떠세요?'
                  : daysOffset === 1 ? '내일이에요. 준비됐어요?'
                  : daysOffset === 3 ? '선물·메시지 준비할 시간이에요.'
                  : '한 주가 다가와요.';
        }

        try {
            const res = await saveReminderIfAbsent(dek, {
                id,
                userId,
                type:         'birthday',
                title,
                body,
                targetView:   isSelf ? 'self-profile' : 'persons',
                targetParams: isSelf ? null : { personId: p.id },
                dueDate:      today,
            });
            if (res.created) created++;
        } catch (e) {
            console.warn('[reminderGen] birthday 알람 저장 실패:', p.name || p.id, e?.message || e);
        }
    }
    return created;
}
