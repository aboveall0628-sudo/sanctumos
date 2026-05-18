/**
 * notifications.js — 브라우저 알림 (Notification API + Service Worker)
 *
 * (2026-05-18 후속) 사용자 명시 "브라우저 푸시 활성".
 *
 * 1차 진입 (이번 라운드):
 *   - Notification.requestPermission() 자리
 *   - 매일 묵상 알람 시각 도래 시 자동 발화 (setTimeout)
 *   - SW showNotification (PWA 홈 추가 시 OS 알림)
 *   - 사용자가 알람 시각 변경 시 재스케줄
 *
 * 한계 — 1차에선 *앱 또는 PWA가 *열려 있어야* 알림 작동.
 *   진짜 백그라운드 푸시(서버→OS 알림)는 FCM(Firebase Cloud Messaging) 별도 트랙.
 *
 * 참조 자리:
 *   - data/reminderGenerator.js — 인앱 종 자리잡힘 (자리 유지)
 *   - sw.js — push·notificationclick 이벤트 처리
 */

import { db, doc, getDoc } from '../data/firebase.js';

const STORAGE_KEY = 'sanctum.notif.lastFired.v1';   // 'YYYY-MM-DD' 마지막 발화 날짜
let _scheduledTimer = null;                          // setTimeout 핸들

/**
 * 권한 상태 — 'default' | 'granted' | 'denied' | 'unsupported'
 */
export function getNotificationPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
}

/**
 * 권한 요청 — 사용자 클릭 트리거에서만 호출 권유 (브라우저 정책).
 * 반환: 'granted' | 'denied' | 'default' | 'unsupported'
 */
export async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied')  return 'denied';
    try {
        const result = await Notification.requestPermission();
        return result;
    } catch (e) {
        console.warn('[notifications] requestPermission failed:', e);
        return 'default';
    }
}

/**
 * 매일 묵상 알람 시각 도래 시 자동 발화 스케줄링.
 *   - 부팅 시 1회 호출
 *   - 사용자가 시각 변경 시 재호출 (자동으로 옛 타이머 취소)
 *   - 앱이 열려 있는 동안만 작동 (1차 한계)
 *
 * spiritualLock 의 dailyAlarmEnabled + dailyAlarmTime 자리 활용.
 */
export async function scheduleDailyMeditationNotification(userId) {
    cancelScheduled();
    if (!userId || userId === 'anonymous') return;
    if (getNotificationPermission() !== 'granted') return;

    let enabled = false;
    let time = '08:00';
    try {
        const snap = await getDoc(doc(db, 'users', userId, 'settings', 'spiritualLock'));
        if (snap.exists()) {
            const d = snap.data() || {};
            enabled = d.dailyAlarmEnabled !== false;
            time = typeof d.dailyAlarmTime === 'string' && /^\d{2}:\d{2}$/.test(d.dailyAlarmTime)
                ? d.dailyAlarmTime : '08:00';
        }
    } catch (e) {
        console.warn('[notifications] read spiritualLock failed:', e);
        return;
    }
    if (!enabled) return;

    const ms = msUntilNextOccurrence(time);
    if (ms < 0) return;

    _scheduledTimer = setTimeout(async () => {
        // 같은 날 중복 발화 차단
        const today = todayLocalISO();
        try {
            const last = localStorage.getItem(STORAGE_KEY);
            if (last === today) {
                // 다음 날을 위해 24h 후 재스케줄
                scheduleDailyMeditationNotification(userId);
                return;
            }
        } catch (_) {}

        await fireDailyMeditationNotification();

        try { localStorage.setItem(STORAGE_KEY, today); } catch (_) {}

        // 다음 날을 위해 재스케줄
        scheduleDailyMeditationNotification(userId);
    }, ms);
}

/**
 * 인앱·OS 알림 발화. SW 우선(PWA 홈 추가 시 OS 알림 자연), 폴백은 Notification API.
 */
async function fireDailyMeditationNotification() {
    const title = '오늘의 묵상';
    const body  = '잠깐 한 호흡 머무는 자리. 오늘 한 절 같이 만나볼까요?';
    const options = {
        body,
        icon:  './assets/favicon-32.png',
        badge: './assets/favicon-16.png',
        tag:   'daily-meditation',
        renotify: false,
        requireInteraction: false,
        data: { url: '/', kind: 'daily-meditation' },
    };

    // 1) SW 경로 — PWA 홈 추가했으면 OS 알림으로 자연 노출
    try {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
            const reg = await navigator.serviceWorker.ready;
            if (reg && typeof reg.showNotification === 'function') {
                await reg.showNotification(title, options);
                return;
            }
        }
    } catch (e) { console.warn('[notifications] SW showNotification failed:', e); }

    // 2) 폴백 — 직접 Notification 생성 (앱 탭이 백그라운드여도 OS 알림으로 노출)
    try {
        const n = new Notification(title, options);
        n.onclick = () => {
            try { window.focus(); } catch (_) {}
            n.close();
        };
    } catch (e) { console.warn('[notifications] new Notification failed:', e); }
}

function cancelScheduled() {
    if (_scheduledTimer) {
        clearTimeout(_scheduledTimer);
        _scheduledTimer = null;
    }
}

function msUntilNextOccurrence(timeHHMM) {
    const [h, m] = timeHHMM.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return -1;
    const now = new Date();
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= now.getTime()) {
        // 오늘 자리 지났으면 — 같은 날 이미 발화했는지 확인 후 다음 날로
        try {
            const last = localStorage.getItem(STORAGE_KEY);
            const today = todayLocalISO();
            if (last !== today) {
                // 오늘 아직 안 했으면 1분 후 즉시 발화 (지각 알림)
                return 60_000;
            }
        } catch (_) {}
        target.setDate(target.getDate() + 1);
    }
    return target.getTime() - now.getTime();
}

function todayLocalISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
