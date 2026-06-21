// 일일계획 Service Worker
const CACHE = 'dailyplan-v21';
const FILES = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
    );
});

// 알림 스케줄 (메인 스레드에서 메시지로 전달받음)
const scheduledTimers = new Map();

self.addEventListener('message', e => {
    const { type, id, title, body, delay } = e.data || {};

    if (type === 'SCHEDULE') {
        // 이미 예약된 거 취소 후 재예약
        if (scheduledTimers.has(id)) clearTimeout(scheduledTimers.get(id));
        if (delay <= 0) return;
        const t = setTimeout(() => {
            self.registration.showNotification(title, {
                body,
                icon: './icon.png',
                tag: id,
                renotify: true,
                requireInteraction: false,
                vibrate: [200, 100, 200]
            });
            scheduledTimers.delete(id);
        }, delay);
        scheduledTimers.set(id, t);
    }

    if (type === 'CANCEL') {
        if (scheduledTimers.has(id)) {
            clearTimeout(scheduledTimers.get(id));
            scheduledTimers.delete(id);
        }
    }

    if (type === 'NOTIFY_NOW') {
        self.registration.showNotification(title, {
            body,
            tag: id,
            renotify: true,
            vibrate: [200, 100, 200]
        });
    }
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
            if (clients.length) return clients[0].focus();
            return self.clients.openWindow('./');
        })
    );
});
