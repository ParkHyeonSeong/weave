// ⚠️ offline.html을 고쳤으면 이 이름을 반드시 갱신한다. 뒤 8자는 offline.html의
// sha256 앞 8자이고, edgeSurfaces.test.js가 파일을 다시 해싱해 대조한다.
// install 핸들러는 브라우저가 /sw.js의 **바이트 변경**을 감지할 때만 발화하고
// 캐시에 쓰는 코드는 install 안에만 있어서, 이 이름을 안 갱신하면 기존 설치자는
// 옛 offline.html을 영원히 본다. 버전 숫자만으로는 단조 래칫이라 그 실수를
// 못 잡는다 — 해시 결속이 그것을 RED로 만든다. 이름 변경은 동시에
// (a) /sw.js 바이트 변경을 보장하고 (b) 아래 activate의 filter가 옛 캐시를 지우게 한다.
const CACHE_NAME = 'weave-offline-v3-92f2de73';
const OFFLINE_URL = '/offline.html';

// 설치: 오프라인 페이지 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// 활성화: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: navigation 실패 시 오프라인 페이지 반환
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      // respondWith(undefined)는 네트워크 오류로 취급돼 브라우저 기본 에러
      // 페이지가 뜬다(캐시 미스 시 현행 동작). 명시적으로 Response.error()를 준다.
      fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
    );
  }
});

// Push: 백그라운드 알림 수신
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Weave';
  const options = {
    body: data.body || '',
    icon: '/icons/weave-192.png',
    badge: '/icons/weave-192.png',
    data: { url: data.url || '/' },
    tag: `weave-${Date.now()}`,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 알림 클릭: 해당 페이지로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
