import { useEffect, useState } from 'react';

/**
 * 협업 문서(y-websocket)가 이 provider로 첫 동기화(sync step 2)를 마쳤는지.
 *
 * provider를 만든 직후의 Y.Doc은 비어 있다 — 서버 문서가 오기 전에 칸을 세면 "0명이 썼어요"·"작성 전"을 사실처럼
 * 보이게 되고, 소켓이 끝내 동기화되지 않으면 그 틀린 판단이 그대로 남는다. 호출부는 이 값이 true일 때만 작성 여부
 * 판단을 그린다(편집기는 그대로 둔다). 기다리는 동안의 '연결 중' 안내는 CollabStatusBadge가 맡는다.
 *
 * 한 번 true가 되면 그 provider에서는 계속 true다 — 재연결 때 y-websocket이 synced를 false로 되돌리지만, 이미 받은
 * 문서로 센 값은 그대로 의미가 있고 연결 상태는 CollabStatusBadge가 알린다. 새 provider(다른 주·회고 문서, 다시 만든
 * 세션)는 그 provider가 동기화될 때까지 false다(useCollabEditBase와 같은 모양).
 *
 * @param {object|null} provider  useScrumWeekCollab·useScrumRetroCollab의 provider(y-websocket)
 * @returns {boolean}
 */
export default function useCollabSynced(provider) {
  const [syncedFor, setSyncedFor] = useState(null);   // 동기화를 마친 provider — 다른 provider의 값을 쓰지 않도록 함께 둔다

  useEffect(() => {
    if (!provider) return undefined;
    const onSync = (synced) => {
      if (!synced) return;
      provider.off('sync', onSync);
      setSyncedFor(provider);
    };
    if (provider.synced) onSync(true);
    else provider.on('sync', onSync);
    return () => provider.off('sync', onSync);
  }, [provider]);

  return !!provider && syncedFor === provider;
}
