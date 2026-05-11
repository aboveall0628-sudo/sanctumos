/**
 * dailyReportFlow.js — 일간 리포트 생성 공용 함수
 *
 * 사용자가 "리포트 받기" 버튼을 누른 시점에 트리거.
 * 저녁 회고('오늘 리포트' 단계)와 오늘 화면('오늘의 리포트' 카드) 양쪽에서 호출.
 *
 * 흐름
 *   1) 이미 AI 응답이 채워져 있으면 기존 리포트 반환 (재생성 X)
 *   2) 도트 0개면 'no-dots' 상태로 반환
 *   3) aggregateDailyStats → callDailyReport → saveDayReport
 */

import { getDotsByDate } from '../data/dotsRepo.js';
import { aggregateDailyStats } from './dailyAggregator.js';
import { getDayReport, saveDayReport } from './dayReportRepo.js';
import { callDailyReport } from '../ui/aiClient.js';

/**
 * 일간 리포트 생성 (또는 기존 반환)
 *
 * @param {CryptoKey} dek
 * @param {string} userId
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {Promise<{
 *   status: 'created'|'existed'|'no-dots',
 *   report: Object|null,
 *   fallback: boolean
 * }>}
 */
export async function generateDailyReport(dek, userId, date) {
    // 1) 이미 차있으면 그대로
    const existing = await getDayReport(dek, userId, date);
    if (existing && existing.aiSummary) {
        return { status: 'existed', report: existing, fallback: false };
    }

    // 2) 도트 0개면 의미 있는 리포트 못 만듦
    const dots = await getDotsByDate(dek, userId, date);
    if (dots.length === 0) {
        return { status: 'no-dots', report: null, fallback: false };
    }

    // 3) 집계 → AI 호출 → 저장
    const stats = await aggregateDailyStats(dek, userId, date);
    const aiResult = await callDailyReport(stats, {
        persons: [], orgs: [], places: [], amounts: [],
    });

    await saveDayReport(dek, userId, date, stats, {
        aiSummary:              aiResult.aiSummary,
        observation:            aiResult.observation,
        questionsForMeditation: aiResult.questionsForMeditation,
    });

    const saved = await getDayReport(dek, userId, date);
    return { status: 'created', report: saved, fallback: aiResult.fallback };
}
