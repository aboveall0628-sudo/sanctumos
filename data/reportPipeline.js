/**
 * reportPipeline.js — Bottom-Up 자동 집계 + Top-Down 드릴다운
 *
 * 집계 트리거: 앱 로드 시 onLoad 체크 (Cloud Function cron 대용)
 *   매일 → dayReport, 매주 → weekReport, 매월 → monthReport 등
 *
 * 모든 리포트는 동일 5질문 분석 템플릿:
 *   ① 잘/안된 것 사실 ② 잘된 패턴 ③ 안된 패턴 ④ 원인 가설 ⑤ 검증 행동
 */

import { db, doc, setDoc, getDoc, getDocs, collection, query, where, orderBy, serverTimestamp } from './firebase.js';
import { saveRecord, getRecord, queryRecords } from './baseRepo.js';
import { getDotsByDateRange, computeDotStats } from './dotsRepo.js';

/**
 * 어제의 dayReport가 없으면 자동 생성
 */
export async function checkAndGenerateDayReport(dek, userId) {
    const yesterday = getDateString(-1);
    const reportId = `${userId}_${yesterday}`;
    const existing = await getDoc(doc(db, 'dayReports', reportId));

    if (existing.exists()) return null; // 이미 있음

    const dots = await getDotsByDateRange(dek, userId, yesterday, yesterday);
    if (dots.length === 0) return null; // 도트 없음

    const stats = computeDotStats(dots);
    const dotIds = dots.map(d => d.id);

    const reportData = {
        id: reportId,
        userId,
        period: 'day',
        startDate: yesterday,
        endDate: yesterday,
        stats,
        drillDownChildIds: dotIds,
        createdAt: serverTimestamp(),
        aiSummary: null,
        keyPatterns: [],
        suggestedPrinciples: [],
        userNotes: '',
    };

    return await saveRecord(dek, 'dayReports', reportData, reportId);
}

/**
 * 지난주 weekReport 자동 생성 (일요일 체크)
 */
export async function checkAndGenerateWeekReport(dek, userId) {
    const today = new Date();
    if (today.getDay() !== 0) return null; // 일요일만

    const weekStart = getDateString(-7);
    const weekEnd = getDateString(-1);
    const yearWeek = getYearWeek(new Date(weekEnd));
    const reportId = `${userId}_${yearWeek}`;

    const existing = await getDoc(doc(db, 'weekReports', reportId));
    if (existing.exists()) return null;

    // 하위 dayReport들 수집
    const dayReportIds = [];
    const allStats = { totalSlots: 0, doneCount: 0, partialCount: 0, replacedCount: 0, skippedCount: 0, satSum: 0 };

    for (let i = 7; i >= 1; i--) {
        const date = getDateString(-i);
        const dayId = `${userId}_${date}`;
        const daySnap = await getDoc(doc(db, 'dayReports', dayId));
        if (daySnap.exists()) {
            dayReportIds.push(dayId);
            const s = daySnap.data().stats;
            allStats.totalSlots += s.totalSlots;
            allStats.doneCount += s.doneCount;
            allStats.partialCount += s.partialCount;
            allStats.replacedCount += s.replacedCount;
            allStats.skippedCount += s.skippedCount;
            allStats.satSum += s.avgSatisfaction * s.totalSlots;
        }
    }

    if (dayReportIds.length === 0) return null;

    const stats = {
        ...allStats,
        avgSatisfaction: +(allStats.satSum / allStats.totalSlots).toFixed(1),
        topLabelIds: [],
        matchRate: allStats.totalSlots > 0 ? Math.round((allStats.doneCount / allStats.totalSlots) * 100) : 0,
    };
    delete stats.satSum;

    const reportData = {
        id: reportId, userId, period: 'week',
        startDate: weekStart, endDate: weekEnd,
        stats, drillDownChildIds: dayReportIds,
        createdAt: serverTimestamp(),
        aiSummary: null, keyPatterns: [], suggestedPrinciples: [], userNotes: ''
    };

    return await saveRecord(dek, 'weekReports', reportData, reportId);
}

/**
 * 리포트 조회 (복호화)
 */
export async function getReport(dek, collectionName, reportId) {
    return await getRecord(dek, collectionName, reportId);
}

/**
 * 리포트 목록 조회
 */
export async function getReports(dek, collectionName, userId, limitCount = 10) {
    // Firestore composite index 회피: userId 단일 where + 클라이언트 정렬.
    const q = query(
        collection(db, collectionName),
        where('userId', '==', userId),
    );
    const reports = await queryRecords(dek, q);
    return reports
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
        .slice(0, limitCount);
}

/**
 * 드릴다운: 하위 리포트/도트 목록 조회
 */
export async function drillDown(dek, report) {
    const childIds = report.drillDownChildIds || [];
    if (childIds.length === 0) return [];

    // 기간에 따라 하위 컬렉션 결정
    const childCollection = {
        year: 'quarterReports', quarter: 'monthReports',
        month: 'weekReports', week: 'dayReports', day: 'dots'
    }[report.period];

    const children = [];
    for (const id of childIds) {
        const snap = await getDoc(doc(db, childCollection, id));
        if (snap.exists()) {
            try {
                children.push(await readDocument(dek, snap.data()));
            } catch (e) {
                children.push(snap.data());
            }
        }
    }
    return children;
}

/**
 * 앱 로드 시 호출 — 필요한 리포트 자동 생성
 */
export async function runReportChecks(dek, userId) {
    const results = [];
    try {
        const day = await checkAndGenerateDayReport(dek, userId);
        if (day) results.push(day);
        const week = await checkAndGenerateWeekReport(dek, userId);
        if (week) results.push(week);
    } catch (e) {
        console.error('Report generation error:', e);
    }
    return results;
}

// ───────── 유틸 ─────────

function getDateString(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
}

function getYearWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
