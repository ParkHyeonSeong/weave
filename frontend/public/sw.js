// ⚠️ offline.html을 고쳤으면 이 이름을 반드시 갱신한다. 뒤 8자는 offline.html의
// sha256 앞 8자이고, edgeSurfaces.test.js가 파일을 다시 해싱해 대조한다.
// install 핸들러는 브라우저가 /sw.js의 **바이트 변경**을 감지할 때만 발화하고
// 캐시에 쓰는 코드는 install 안에만 있어서, 이 이름을 안 갱신하면 기존 설치자는
// 옛 offline.html을 영원히 본다. 버전 숫자만으로는 단조 래칫이라 그 실수를
// 못 잡는다 — 해시 결속이 그것을 RED로 만든다. 이름 변경은 동시에
// (a) /sw.js 바이트 변경을 보장하고 (b) 아래 activate의 filter가 옛 캐시를 지우게 한다.
const CACHE_NAME = 'weave-offline-v4-de3f9ba2';
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

// 오프라인 페이지의 언어. 서버에 물어볼 수 없고 서비스워커에는 localStorage가 없으므로
// 브라우저 언어(navigator.languages)를 쓴다 — 앱의 감지 규칙과 같은 순서로 첫 지원 언어를 고른다.
function offlineLocale() {
  try {
    const list = (self.navigator.languages && self.navigator.languages.length)
      ? self.navigator.languages
      : [self.navigator.language || ''];
    for (const raw of list) {
      const base = String(raw || '').trim().toLowerCase().split(/[-_]/)[0];
      if (base === 'ko') return 'ko';
      if (base === 'en') return 'en';
    }
  } catch (e) { /* 감지 실패 시 기본값 */ }
  return 'en';
}

// 캐시된 오프라인 HTML의 <html lang>을 브라우저 언어로 바꿔 돌려준다.
// (offline.html은 두 언어를 모두 담고 CSS가 lang에 맞는 쪽만 보여준다.)
async function offlineResponse() {
  const cached = await caches.match(OFFLINE_URL);
  if (!cached) return Response.error();
  const locale = offlineLocale();
  if (locale === 'en') return cached;          // 기본값 그대로 — 치환 불필요
  try {
    const html = (await cached.text()).replace('<html lang="en">', `<html lang="${locale}">`);
    const headers = new Headers(cached.headers);
    return new Response(html, { status: 200, statusText: 'OK', headers });
  } catch (e) {
    return (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

// Fetch: navigation 실패 시 오프라인 페이지 반환
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      // respondWith(undefined)는 네트워크 오류로 취급돼 브라우저 기본 에러
      // 페이지가 뜬다(캐시 미스 시 현행 동작). offlineResponse가 캐시 미스에서
      // Response.error()를 준다.
      fetch(event.request).catch(() => offlineResponse())
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
