import { useState, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { getWsBaseURL } from '@/library/_axios';
import { attachWsTokenRefresh } from '@/library/wsTokenRefresh';
import { attachCollabDelivery } from '@/library/collabDelivery';
import { userColor as avatarColor } from '@/library/userAvatar';

/**
 * Yjs collaboration provider 관리 훅
 * @param {number} canvasId
 * @param {number} pageId
 * @param {object} user - { user_id, username, avatar_url?, avatar_color? }
 * @returns {{ ydoc, provider, status, connectedUsers, userColor, connection, pending, deliveryRef }}
 */
export default function useCollabProvider(canvasId, pageId, user) {
  const [status, setStatus] = useState('connecting');
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [ydoc, setYdoc] = useState(null);
  const [provider, setProvider] = useState(null);
  // 연결 상태(처음 연결 중/연결됨/다시 연결 중)와 서버 적용이 확인되지 않은 편집 — collabDelivery 참고
  const [delivery, setDelivery] = useState({ connection: 'connecting', pending: false });
  // 같은 값의 최신본을 추적기가 바꾸는 즉시 담는다(렌더를 기다리지 않는다) — 캔버스 닫기처럼 await 뒤에 판단하는 코드가
  // 렌더 때 받은 pending 대신 읽는다
  const deliveryRef = useRef(delivery);

  // 색상: 공용 아바타 팔레트와 동일 (사용자 지정색 우선, 커서 caret과 아바타 색 일치)
  const userColor = useMemo(
    () => avatarColor(user?.user_id, user?.avatar_color),
    [user?.user_id, user?.avatar_color],
  );

  useEffect(() => {
    if (!canvasId || !pageId || !user) return;

    const doc = new Y.Doc();

    // WebSocket URL 구성: axios base URL 기반
    // y-websocket은 `${serverUrl}/${roomname}` 형태로 연결
    const serverUrl = `${getWsBaseURL()}/api/ws/canvas/${canvasId}/pages`;

    const prov = new WebsocketProvider(
      serverUrl,
      String(pageId),
      doc,
      { connect: true }
    );
    // 토큰 만료 선제종료 시 refresh 완료 뒤 재연결(만료 쿠키 4001 회피)
    const detachTokenRefresh = attachWsTokenRefresh(prov);
    // 확인 안 된 편집이 있으면 탭 닫기를 막는다
    const detachDelivery = attachCollabDelivery(prov, doc, (next) => { deliveryRef.current = next; setDelivery(next); });

    // Awareness에 사용자 정보 설정 (사진은 프레즌스/커서 아바타에서 사용)
    // 구버전 세션은 profile에 avatar_url이 없을 수 있어 별도 키로 폴백
    const avatarUrl = user.avatar_url ?? sessionStorage.getItem('avatar_url') ?? null;
    prov.awareness.setLocalStateField('user', {
      name: user.username,
      color: userColor,
      user_id: user.user_id,
      avatar_url: avatarUrl || null,
    });

    // 연결 상태 이벤트
    prov.on('status', ({ status: s }) => {
      setStatus(s);
    });

    // Awareness 변경 이벤트 (접속자 목록)
    const updateConnectedUsers = () => {
      const states = prov.awareness.getStates();
      const users = [];
      states.forEach((state, clientId) => {
        if (state.user) {
          users.push({ clientId, ...state.user });
        }
      });
      setConnectedUsers(users);
    };

    prov.awareness.on('change', updateConnectedUsers);
    updateConnectedUsers();

    setYdoc(doc);
    setProvider(prov);

    return () => {
      detachDelivery();
      detachTokenRefresh();
      prov.awareness.off('change', updateConnectedUsers);
      prov.disconnect();
      prov.destroy();
      doc.destroy();
      setYdoc(null);
      setProvider(null);
    };
    // 아바타 색/사진 변경 시 awareness를 새 값으로 다시 설정 (재연결 동반 — 변경은 드묾)
  }, [canvasId, pageId, user?.user_id, user?.avatar_color, user?.avatar_url]);

  return {
    ydoc,
    provider,
    status,
    connectedUsers,
    userColor,
    connection: delivery.connection,
    pending: delivery.pending,
    deliveryRef,
  };
}
