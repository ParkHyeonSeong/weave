import { useState, useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { getWsBaseURL } from '@/library/_axios';
import { attachWsTokenRefresh } from '@/library/wsTokenRefresh';
import { attachCollabDelivery } from '@/library/collabDelivery';
import { userColor as avatarColor } from '@/library/userAvatar';

export default function useScrumWeekCollab(boardId, weekId, user) {
  const [status, setStatus] = useState('connecting');
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [ydoc, setYdoc] = useState(null);
  const [provider, setProvider] = useState(null);
  // 연결 상태(처음 연결 중/연결됨/다시 연결 중)와 서버 적용이 확인되지 않은 편집 — collabDelivery 참고
  const [delivery, setDelivery] = useState({ connection: 'connecting', pending: false });

  // 색상: 공용 아바타 팔레트와 동일 (사용자 지정색 우선)
  const userColor = useMemo(
    () => avatarColor(user?.user_id, user?.avatar_color),
    [user?.user_id, user?.avatar_color],
  );

  useEffect(() => {
    if (!boardId || !weekId || !user) return;
    const doc = new Y.Doc();
    const serverUrl = `${getWsBaseURL()}/api/ws/scrum/${boardId}/weeks`;
    const prov = new WebsocketProvider(serverUrl, String(weekId), doc, { connect: true });
    const detachTokenRefresh = attachWsTokenRefresh(prov);  // 토큰 만료 선제종료 시 refresh 뒤 재연결
    const detachDelivery = attachCollabDelivery(prov, doc, setDelivery);  // 확인 안 된 편집이 있으면 탭 닫기를 막는다
    // 구버전 세션은 profile에 avatar_url이 없을 수 있어 별도 키로 폴백
    const avatarUrl = user.avatar_url ?? sessionStorage.getItem('avatar_url') ?? null;
    prov.awareness.setLocalStateField('user', {
      name: user.username,
      color: userColor,
      userId: user.user_id,
      avatar_url: avatarUrl || null,
      avatar_color: user.avatar_color ?? null,
    });
    prov.on('status', ({ status: s }) => setStatus(s));
    const update = () => {
      const arr = [];
      prov.awareness.getStates().forEach((st, clientId) => { if (st.user) arr.push({ clientId, ...st.user }); });
      setConnectedUsers(arr);
    };
    prov.awareness.on('change', update); update();
    setYdoc(doc); setProvider(prov);
    return () => {
      detachDelivery();
      detachTokenRefresh();
      prov.awareness.off('change', update);
      prov.disconnect(); prov.destroy(); doc.destroy();
      setYdoc(null); setProvider(null);
    };
  }, [boardId, weekId, user?.user_id, user?.avatar_color, user?.avatar_url]);

  return { ydoc, provider, status, connectedUsers, connection: delivery.connection, pending: delivery.pending };
}
