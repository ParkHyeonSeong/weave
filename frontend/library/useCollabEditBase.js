import { useEffect, useRef, useState } from 'react';
import { axios } from '@/library/_axios';

/**
 * 공동편집기에 넘길 기준본(페이지 content·yjs_state)을 협업 방 동기화가 끝난 뒤에 다시 읽는다 (CV-02).
 *
 * 편집기는 yjs_state가 없고 방 문서가 비었을 때만 content로 문서를 채운다(CanvasCollabEditor·TypstEditor). 편집기 밖
 * (MCP·REST) 본문 쓰기는 편집 중인 방이 없으면 yjs_state를 비우므로, 읽기 화면 때 받은 페이지로 편집기를 열면 그사이의
 * 쓰기를 모른 채 옛 content로 채우거나(yjs_state 없음) 빈 문서를 저장해(yjs_state 있음) 그 쓰기를 덮는다. 방에 들어가
 * 동기화된 뒤에는 외부 본문 쓰기가 거절되므로(PAGE_BEING_EDITED) 그때 읽은 페이지가 방 문서와 어긋나지 않는다. 방 문서도
 * 이미 받아 두었으므로 먼저 들어온 사람이 채운 문서를 또 채우지 않는다.
 *
 * @param {object|null} provider  useCollabProvider의 provider(y-websocket) — 편집 세션마다 새로 만들어진다
 * @param {string|null} url       페이지 상세 GET 경로. 편집 중이 아니면 null
 * @param {(data: object|null) => void} [onFail]  이 세션의 다시 읽기가 실패하면 실패 응답 본문(없으면 null)과 함께 부른다 —
 *   호출부는 편집을 닫는다. 기준본 없이는 편집기를 띄울 수 없어 '연결 중'에 멈추고, 다시 열면 새 세션이 새로 읽는다
 * @returns {object|null} 이 provider로 동기화된 뒤 읽은 페이지. 그 전이거나 읽기가 실패하면 null — 호출부는 편집기를 띄우지 않는다
 */
export default function useCollabEditBase(provider, url, onFail) {
  const [loaded, setLoaded] = useState(null);   // { provider, url, page } — 다른 편집 세션의 기준본을 쓰지 않도록 함께 둔다
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  useEffect(() => {
    if (!provider || !url) return undefined;
    let cancelled = false;
    const load = async (synced) => {
      if (!synced) return;
      provider.off('sync', load);
      let data = null;
      try {
        const res = await axios.get(url);
        if (res.data?.status) {
          if (!cancelled) setLoaded({ provider, url, page: res.data.page });
          return;
        }
        data = res.data ?? null;
      } catch (e) {
        data = e?.response?.data ?? null;
      }
      if (!cancelled) onFailRef.current?.(data);
    };
    if (provider.synced) load(true);
    else provider.on('sync', load);
    return () => {
      cancelled = true;
      provider.off('sync', load);
    };
  }, [provider, url]);

  return loaded && loaded.provider === provider && loaded.url === url ? loaded.page : null;
}
