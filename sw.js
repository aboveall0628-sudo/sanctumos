/**
 * sw.js — Sanctum OS service worker (Phase E-9/M-1)
 *
 * 최소 구현: PWA "홈 화면에 추가"를 만족하기 위한 install/activate/fetch 핸들러.
 * 캐싱은 의도적으로 거의 안 함 — 매 push마다 JS 갱신을 막지 않기 위함.
 *
 * 정책:
 *   - 정적 자산(아이콘, 로고)만 가볍게 캐시 (cache-first)
 *   - HTML/JS/CSS는 network-first (오프라인일 때만 캐시 사용)
 *   - Firebase·Google·외부 도메인은 SW 통과 없이 그대로
 *
 * 캐시 이름에 VERSION 박음. 새 버전 deploy 시 이 줄만 올리면 옛 캐시 정리됨.
 */

const VERSION = 'sanctum-v17-2026-05-18-faq-catalog';
const STATIC_CACHE = `sanctum-static-${VERSION}`;

// 사전 캐시할 가벼운 정적 자산
const PRECACHE = [
    './assets/sanctum-mark.svg',
    './assets/favicon-32.png',
    './assets/favicon-16.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(PRECACHE).catch(() => null))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys
                .filter(k => k !== STATIC_CACHE)
                .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// (2026-05-18 후속) 알림 클릭 — 열린 탭 있으면 포커스, 없으면 새 탭으로 앱 열기
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of allClients) {
            if (c.url.includes(url) || c.url.endsWith('/')) {
                try { await c.focus(); return; } catch (_) {}
            }
        }
        if (self.clients.openWindow) await self.clients.openWindow(url);
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // GET만 처리. 다른 메서드는 SW 통과.
    if (req.method !== 'GET') return;

    // 다른 origin(Firebase, gstatic, accounts.google.com, github raw 등)은 그대로 네트워크로
    if (url.origin !== self.location.origin) return;

    // /assets/ 정적 자산 — cache-first
    if (url.pathname.includes('/assets/')) {
        event.respondWith(
            caches.match(req).then(hit => hit || fetch(req).then(resp => {
                if (resp.ok) {
                    const clone = resp.clone();
                    caches.open(STATIC_CACHE).then(c => c.put(req, clone)).catch(() => {});
                }
                return resp;
            }).catch(() => hit))
        );
        return;
    }

    // HTML/JS/CSS — network-first, 오프라인이면 캐시
    event.respondWith(
        fetch(req)
            .then(resp => {
                if (resp.ok && (req.destination === 'document' || req.destination === 'script' || req.destination === 'style')) {
                    const clone = resp.clone();
                    caches.open(STATIC_CACHE).then(c => c.put(req, clone)).catch(() => {});
                }
                return resp;
            })
            .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
});
