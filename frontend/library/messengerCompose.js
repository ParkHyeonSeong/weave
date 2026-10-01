// ```(트리플 백틱) 짝이 안 맞으면(홀수) 코드 작성 중
export function isCodeMode(text) {
  return ((text || '').match(/```/g) || []).length % 2 === 1;
}

// 작성부 입력에서 슬래시 명령 상태 파싱
// returns { kind:'menu' } | { kind:'command', type, mode?, keyword } | { kind:'none' }
export function parseSlashInput(val) {
  if (val === '/') return { kind: 'menu' };
  if (val.match(/^\/ta\s/)) return { kind: 'command', type: 'task', mode: 'all', keyword: val.slice(4) };
  if (val.match(/^\/t\s/)) return { kind: 'command', type: 'task', mode: 'my', keyword: val.slice(3) };
  if (val.match(/^\/d\s/)) return { kind: 'command', type: 'doc', keyword: val.slice(3) };
  if (val.match(/^\/i\s/)) return { kind: 'command', type: 'issue', keyword: val.slice(3) };
  if (val.match(/^\/[tdia]?$/) || val.match(/^\/ta?$/)) return { kind: 'menu' };
  return { kind: 'none' };
}

// pendingFiles → onSubmit attachments. done(url)→uploaded:true, ready(file)→uploaded:false. uploading 제외.
export function buildAttachmentsPayload(pendingFiles) {
  return pendingFiles
    .filter((f) => f.status === 'done' || f.status === 'ready')
    .map((f) =>
      f.status === 'done'
        ? { uploaded: true, url: f.url, file_name: f.file_name, file_type: f.file_type, file_size: f.file_size }
        : { uploaded: false, file: f.file, file_name: f.file_name, file_type: f.file_type, file_size: f.file_size }
    );
}

// composer payload + 최종 첨부(업로드된 url 배열)로 WS send_message 객체 구성
export function buildSendMessage(roomId, payload, attachments) {
  const ws = { action: 'send_message', room_id: roomId, content: payload.content };
  if (payload.taskId) ws.task_id = payload.taskId;
  if (payload.canvasPageId) ws.canvas_page_id = payload.canvasPageId;
  if (payload.issueId) ws.issue_id = payload.issueId;
  if (payload.mentionedUserIds.length > 0) ws.mentioned_user_ids = payload.mentionedUserIds;
  if (attachments.length > 0) ws.attachments = attachments;
  return ws;
}

// 방별 작성 중 초안 { input, attachedTask, attachedDoc, attachedIssue, mentionedUserIds, pendingFiles }.
// 세션 메모리에만 둔다(새로고침하면 사라진다). 방을 바꾸거나 목록으로 나갔다 와도 그 방에서 쓰던 것만
// 그 방에 돌아온다 — 첨부 파일명은 올린 방에 묶여 있어 다른 방으로 보내면 안 된다.
const roomDrafts = new Map();

// 초안 자리 = 계정 + 방. 로그아웃은 새로고침 없이 로그인 화면으로 라우팅만 해서 이 메모리가 남으므로,
// 같은 탭에서 다음에 로그인한 계정에게 앞 계정의 초안이 보이면 안 된다. 로그인 정보가 없으면 null.
export function roomDraftKey(roomId) {
  if (!roomId) return null;
  try {
    const userId = JSON.parse(sessionStorage.getItem('profile') || '{}').user_id;
    return userId ? `${userId}:${roomId}` : null;
  } catch {
    return null;
  }
}

export function loadRoomDraft(key) {
  return (key && roomDrafts.get(key)) || null;
}

// 업로드가 끝난 첨부만 남긴다(업로드 중이던 파일은 떠나는 작성부와 함께 버려진다).
// 남길 글·참조·첨부가 없으면(보낸 뒤 포함) 초안을 지운다.
export function saveRoomDraft(key, draft) {
  if (!key) return;
  const pendingFiles = draft.pendingFiles.filter((f) => f.status === 'done');
  const empty = !draft.input && !draft.attachedTask && !draft.attachedDoc && !draft.attachedIssue
    && pendingFiles.length === 0;
  if (empty) roomDrafts.delete(key);
  else roomDrafts.set(key, { ...draft, pendingFiles });
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
