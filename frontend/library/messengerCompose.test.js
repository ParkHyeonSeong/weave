import { describe, it, expect } from 'vitest';
import { isCodeMode, parseSlashInput, buildAttachmentsPayload } from './messengerCompose.js';
import { buildSendMessage, formatFileSize } from './messengerCompose.js';
import { roomDraftKey, loadRoomDraft, saveRoomDraft } from './messengerCompose.js';

describe('isCodeMode', () => {
  it('```가 홀수 개면 코드모드', () => {
    expect(isCodeMode('```js')).toBe(true);
    expect(isCodeMode('```js\ncode\n```')).toBe(false);
    expect(isCodeMode('hello')).toBe(false);
    expect(isCodeMode('')).toBe(false);
  });
});

describe('parseSlashInput', () => {
  it('/ 단독 → menu', () => {
    expect(parseSlashInput('/')).toEqual({ kind: 'menu' });
  });
  it('/ta <kw> → task all', () => {
    expect(parseSlashInput('/ta foo')).toEqual({ kind: 'command', type: 'task', mode: 'all', keyword: 'foo' });
  });
  it('/t <kw> → task my', () => {
    expect(parseSlashInput('/t bar')).toEqual({ kind: 'command', type: 'task', mode: 'my', keyword: 'bar' });
  });
  it('/d <kw> → doc, /i <kw> → issue', () => {
    expect(parseSlashInput('/d x')).toEqual({ kind: 'command', type: 'doc', keyword: 'x' });
    expect(parseSlashInput('/i y')).toEqual({ kind: 'command', type: 'issue', keyword: 'y' });
  });
  it('미완성 슬래시(/t, /ta) → menu', () => {
    expect(parseSlashInput('/t')).toEqual({ kind: 'menu' });
    expect(parseSlashInput('/ta')).toEqual({ kind: 'menu' });
  });
  it('일반 텍스트 → none', () => {
    expect(parseSlashInput('hello')).toEqual({ kind: 'none' });
  });
});

describe('buildAttachmentsPayload', () => {
  it('done(url 있음) → uploaded:true, ready(file) → uploaded:false', () => {
    const pending = [
      { status: 'done', url: '/api/uploads/chat/a.png', file_name: 'a.png', file_type: 'image/png', file_size: 10 },
      { status: 'ready', file: { name: 'b.png' }, file_name: 'b.png', file_type: 'image/png', file_size: 20 },
    ];
    expect(buildAttachmentsPayload(pending)).toEqual([
      { uploaded: true, url: '/api/uploads/chat/a.png', file_name: 'a.png', file_type: 'image/png', file_size: 10 },
      { uploaded: false, file: { name: 'b.png' }, file_name: 'b.png', file_type: 'image/png', file_size: 20 },
    ]);
  });
  it('uploading 항목은 제외', () => {
    expect(buildAttachmentsPayload([{ status: 'uploading' }])).toEqual([]);
  });
});

describe('buildSendMessage', () => {
  const base = { content: 'hi', taskId: null, canvasPageId: null, issueId: null, mentionedUserIds: [] };
  it('기본은 action/room_id/content만', () => {
    expect(buildSendMessage(7, base, [])).toEqual({ action: 'send_message', room_id: 7, content: 'hi' });
  });
  it('refs/멘션/첨부를 조건부로 포함', () => {
    const p = { content: 'x', taskId: 1, canvasPageId: 2, issueId: 3, mentionedUserIds: [9] };
    const att = [{ url: '/a.png', file_name: 'a.png', file_type: 'image/png', file_size: 5 }];
    expect(buildSendMessage(7, p, att)).toEqual({
      action: 'send_message', room_id: 7, content: 'x',
      task_id: 1, canvas_page_id: 2, issue_id: 3, mentioned_user_ids: [9], attachments: att,
    });
  });
});

describe('formatFileSize', () => {
  it('B/KB/MB', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('room drafts', () => {
  const blank = { input: '', attachedTask: null, attachedDoc: null, attachedIssue: null, mentionedUserIds: [], pendingFiles: [] };

  it('업로드가 끝난 첨부만 초안에 남긴다', () => {
    const done = { id: 'a', status: 'done', url: '/api/uploads/chat/chat_5_0123456789ab.png', preview: 'blob:a' };
    const uploading = { id: 'b', status: 'uploading', preview: 'blob:b' };
    saveRoomDraft('7:5', { ...blank, input: 'hi', mentionedUserIds: [9], pendingFiles: [done, uploading] });
    expect(loadRoomDraft('7:5')).toEqual({ ...blank, input: 'hi', mentionedUserIds: [9], pendingFiles: [done] });
    expect(loadRoomDraft('7:5').pendingFiles[0]).toBe(done); // 미리보기 해제 판단은 같은 항목인지로 한다
    expect(loadRoomDraft('8:5')).toBeNull();
  });

  it('남길 글·참조·첨부가 없으면(보낸 뒤 포함) 초안을 지운다', () => {
    saveRoomDraft('7:5', { ...blank, input: 'hi' });
    saveRoomDraft('7:5', { ...blank, mentionedUserIds: [9], pendingFiles: [{ id: 'b', status: 'uploading' }] });
    expect(loadRoomDraft('7:5')).toBeNull();
    saveRoomDraft('7:5', { ...blank, attachedTask: { task_id: 1 } });
    expect(loadRoomDraft('7:5')?.attachedTask).toEqual({ task_id: 1 });
  });

  it('초안 자리가 없으면(로그인 정보 없음·새 채팅) 저장도 복원도 하지 않는다', () => {
    saveRoomDraft(null, { ...blank, input: 'hi' });
    expect(loadRoomDraft(null)).toBeNull();
    expect(roomDraftKey(null)).toBeNull();
  });
});
