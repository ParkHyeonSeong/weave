// 서버가 만든 알림을 **읽는 시점의 사용자 언어**로 렌더한다.
//
// 알림 행은 두 가지를 갖는다:
//   payload {key, params}  구조화 데이터 — 있으면 카탈로그(notifications.messages.*)로 렌더한다.
//   title                  수신자 언어로 서버가 완성한 문장 — payload가 없는 **구버전 행**의 폴백.
//
// 이 구조 덕분에 사용자가 언어를 바꾸면 지난 알림도 새 언어로 보인다. 서버가 문장을 굳혀
// 두면 워크스페이스에 다른 언어 사용자가 있을 때 누군가는 읽을 수 없는 문장을 보게 된다.
//
// 키 목록은 backend/library/messages.py의 notifications.* 와 1:1이어야 한다
// (library/serverMessages.test.js가 카탈로그 쪽을 고정한다).

/** 알림 title은 항상 발신자 이름으로 시작하는데, 목록에서 바로 윗줄에 같은 이름이 이미 보인다. */
function stripActorPrefix(title, actorName) {
  if (!title) return '';
  if (!actorName) return title;
  // ko: "홍길동님이 …", en: "Hong ..." — 두 표기 모두 앞의 이름만 떼어 본문을 좁은 폭에 쓴다.
  if (title.startsWith(`${actorName}님이`)) {
    return title.slice(`${actorName}님이`.length).replace(/^\s+/, '');
  }
  if (title.startsWith(`${actorName} `)) {
    return title.slice(actorName.length + 1);
  }
  return title;
}

/**
 * 알림 한 줄의 본문.
 * @param {object} noti  { type, title, payload, actor_name }
 * @param {Function} t   useTranslation의 t
 * @param {{ withActor?: boolean }} opts  withActor=false면 발신자 이름을 뺀다(목록용)
 */
export function notificationText(noti, t, { withActor = false } = {}) {
  const payload = noti?.payload;
  const key = payload?.key;
  if (key) {
    const params = payload.params || {};
    const full = t(`notifications.messages.${key}`, { ...params, actor: params.actor || '' });
    return withActor ? full : stripActorPrefix(full, params.actor || noti.actor_name);
  }
  // 구버전 행 — 서버가 저장한 문장을 그대로 쓴다.
  return withActor ? (noti?.title || '') : stripActorPrefix(noti?.title, noti?.actor_name);
}

export { stripActorPrefix };
