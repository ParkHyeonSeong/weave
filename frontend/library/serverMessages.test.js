import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import i18next from './i18n';
import en from './i18n/en';
import ko from './i18n/ko';
import { notificationText } from './serverMessages.js';
import { activitySummary, changeValueText } from './activitySummary.js';
import { chatMessagePreview } from './notification.js';
import { formatDateOnly } from './formatDateTime.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// 서버 카탈로그(backend/library/messages.py) ↔ 프런트 카탈로그
// ---------------------------------------------------------------------------
//
// 같은 알림을 Web Push는 서버가, 알림 목록은 프런트가 렌더한다. 키가 어긋나면 언어를 바꾼
// 사용자가 'notifications.messages.xxx' 같은 키 문자열을 보게 된다.

function serverNotificationMessages(locale) {
  const src = readFileSync(resolve(ROOT, 'backend/library/messages.py'), 'utf8');
  const block = src.match(new RegExp(`'${locale}': \\{([\\s\\S]*?)\\n    \\},`));
  expect(block, `messages.py에서 ${locale} 블록을 찾지 못했다`).toBeTruthy();
  const out = {};
  for (const m of block[1].matchAll(/'notifications\.(\w+)': '([^']*)',/g)) out[m[1]] = m[2];
  return out;
}

const placeholders = (value, re) => new Set([...String(value).matchAll(re)].map((m) => m[1]));

describe('서버 알림 카탈로그와 프런트 카탈로그가 1:1이다', () => {
  for (const [locale, catalog] of [['en', en], ['ko', ko]]) {
    it(`${locale}: 키와 보간 이름이 같다`, () => {
      const server = serverNotificationMessages(locale);
      const front = catalog.notifications.messages;
      expect(Object.keys(server).length).toBeGreaterThan(15);
      expect(Object.keys(server).sort()).toEqual(Object.keys(front).sort());
      for (const [key, pyValue] of Object.entries(server)) {
        expect(placeholders(pyValue, /\{(\w+)\}/g), `${locale}.${key}`)
          .toEqual(placeholders(front[key], /\{\{(\w+)\}\}/g));
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 알림 본문 — payload로 현재 언어 렌더, 구버전 행은 저장된 문장 폴백
// ---------------------------------------------------------------------------

describe('notificationText', () => {
  const original = i18next.language;
  afterAll(async () => { await i18next.changeLanguage(original); });

  const t = (key, params) => i18next.t(key, params);

  it('payload가 있으면 현재 언어로 렌더한다 (저장된 title을 쓰지 않는다)', async () => {
    const noti = {
      type: 'task_assigned',
      title: 'Ann님이 WV-1 제목에 회원님을 담당자로 지정했습니다',   // 저장 시점 = 한국어
      actor_name: 'Ann',
      payload: { key: 'taskAssigned', params: { actor: 'Ann', ref: 'WV-1 Title' } },
    };
    await i18next.changeLanguage('en');
    expect(notificationText(noti, t, { withActor: true }))
      .toBe('Ann assigned you to WV-1 Title');
    await i18next.changeLanguage('ko');
    expect(notificationText(noti, t, { withActor: true }))
      .toBe('Ann님이 WV-1 Title에 회원님을 담당자로 지정했습니다');
  });

  it('목록에서는 반복되는 발신자 이름을 뗀다 (두 언어 모두)', async () => {
    const noti = {
      actor_name: 'Ann',
      payload: { key: 'chatMention', params: { actor: 'Ann' } },
    };
    await i18next.changeLanguage('en');
    expect(notificationText(noti, t)).toBe('mentioned you in chat');
    await i18next.changeLanguage('ko');
    expect(notificationText(noti, t)).toBe('채팅에서 회원님을 멘션했습니다');
  });

  it('payload가 없는 구버전 행은 저장된 문장을 그대로 쓴다', async () => {
    await i18next.changeLanguage('en');
    const legacy = { title: 'Ann님이 채팅에서 회원님을 멘션했습니다', actor_name: 'Ann' };
    expect(notificationText(legacy, t, { withActor: true }))
      .toBe('Ann님이 채팅에서 회원님을 멘션했습니다');
    expect(notificationText(legacy, t)).toBe('채팅에서 회원님을 멘션했습니다');
  });

  it('빈 알림에도 예외 없이 빈 문자열을 준다', () => {
    expect(notificationText(null, t)).toBe('');
    expect(notificationText({}, t)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 활동 요약 — action·changes에서 현재 언어로
// ---------------------------------------------------------------------------

describe('activitySummary', () => {
  const original = i18next.language;
  beforeAll(async () => { await i18next.changeLanguage('en'); });
  afterAll(async () => { await i18next.changeLanguage(original); });
  const t = (key, params) => i18next.t(key, params);

  it('생성·삭제·이동을 현재 언어로 만든다', async () => {
    expect(activitySummary({ action: 'created', entity_type: 'task', changes: [] }, t))
      .toBe('Created the Task');
    expect(activitySummary({
      action: 'created', entity_type: 'canvas_page', changes: [{ field: 'title', new: 'Spec' }],
    }, t)).toBe('Created the Page “Spec”');
    expect(activitySummary({ action: 'moved', entity_type: 'canvas_page', changes: [] }, t))
      .toBe('Moved the Page');

    await i18next.changeLanguage('ko');
    expect(activitySummary({ action: 'created', entity_type: 'task', changes: [] }, t))
      .toBe('Task 생성');
    await i18next.changeLanguage('en');
  });

  it('스칼라 변경은 필드 라벨과 값 전이로 낸다', () => {
    const summary = activitySummary({
      action: 'updated',
      entity_type: 'task',
      changes: [{ field: 'status', old_label: 'To Do', new_label: 'Done' }],
    }, t);
    expect(summary).toBe('Status To Do → Done');
  });

  it('집합형·본문·담당자 role 전이를 각각 다르게 표현한다', () => {
    expect(activitySummary({
      action: 'updated', entity_type: 'task',
      changes: [{ field: 'assignees', added: [{ username: 'Ann' }], removed: [] }],
    }, t)).toBe('Assignees +Ann');

    expect(activitySummary({
      action: 'updated', entity_type: 'task', changes: [{ field: 'description', changed: true }],
    }, t)).toBe('Description edited');

    expect(activitySummary({
      action: 'updated', entity_type: 'task',
      changes: [{ field: 'assignee_role', username: 'Ann', role: 'main' }],
    }, t)).toBe('Made Ann the main assignee');
  });

  it('알 수 없는 action(구버전 행)은 저장된 summary로 폴백한다', () => {
    expect(activitySummary({ action: 'legacy_thing', summary: '옛 문장' }, t)).toBe('옛 문장');
  });
});


// ---------------------------------------------------------------------------
// 채팅 알림 본문 — 포그라운드(브라우저 알림·토스트) 폴백
// ---------------------------------------------------------------------------

describe('chatMessagePreview', () => {
  const original = i18next.language;
  afterAll(async () => { await i18next.changeLanguage(original); });
  const t = (key) => i18next.t(key);

  it('사용자가 쓴 내용은 그대로 쓴다 (번역·변형 없음)', async () => {
    await i18next.changeLanguage('en');
    expect(chatMessagePreview({ content: '안녕하세요 deploy 갑니다' }, t))
      .toBe('안녕하세요 deploy 갑니다');
  });

  it('내용이 없으면 무엇이 왔는지 현재 언어로 알려준다 (빈 본문이 되지 않는다)', async () => {
    const cases = [
      [{ task_ref: { task_id: 1 } }, 'Shared a task', '태스크를 공유했습니다'],
      [{ doc_ref: { page_id: 1 } }, 'Shared a document', '문서를 공유했습니다'],
      [{ issue_ref: { issue_id: 1 } }, 'Shared an issue', '이슈를 공유했습니다'],
      [{ attachments: [{ file_name: 'a.png' }] }, 'Sent an attachment', '첨부를 보냈습니다'],
      [{}, 'New Message', '새 메시지'],
    ];
    for (const [message, en, ko] of cases) {
      await i18next.changeLanguage('en');
      expect(chatMessagePreview(message, t), JSON.stringify(message)).toBe(en);
      await i18next.changeLanguage('ko');
      expect(chatMessagePreview(message, t), JSON.stringify(message)).toBe(ko);
      expect(chatMessagePreview(message, t)).not.toBe('');
    }
  });

  it('서버의 오프라인 push 문구와 같은 문장을 쓴다', () => {
    // backend/library/messages.py의 chat.* 와 layout.chatNotification.* 는 같은 화면 문구다.
    const src = readFileSync(resolve(ROOT, 'backend/library/messages.py'), 'utf8');
    const pairs = {
      'chat.sharedTask': 'sharedTask', 'chat.sharedDocument': 'sharedDocument',
      'chat.sharedIssue': 'sharedIssue', 'chat.sharedAttachment': 'sharedAttachment',
    };
    for (const [locale, catalog] of [['en', en], ['ko', ko]]) {
      const block = src.match(new RegExp(`'${locale}': \\{([\\s\\S]*?)\\n    \\},`))[1];
      for (const [serverKey, frontKey] of Object.entries(pairs)) {
        const m = block.match(new RegExp(`'${serverKey}': '([^']*)'`));
        expect(m, `${locale}.${serverKey}`).toBeTruthy();
        expect(m[1], `${locale}.${serverKey}`).toBe(catalog.layout.chatNotification[frontKey]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 활동 이력 값 표시 — 요약과 펼친 상세가 같은 포매터를 쓴다
// ---------------------------------------------------------------------------

describe('활동 변경값 표시', () => {
  const original = i18next.language;
  afterAll(async () => { await i18next.changeLanguage(original); });
  const t = (key, params) => i18next.t(key, params);
  const ctx = (locale) => ({ t, formatDateOnly: (s) => formatDateOnly(s, { locale }) });

  it('priority는 제품 enum이 아니라 사용자 언어 라벨로 보인다', async () => {
    const change = { field: 'priority', old: 'low', new: 'urgent' };
    await i18next.changeLanguage('en');
    expect(changeValueText(change, 'old', ctx('en'))).toBe('Low');
    expect(changeValueText(change, 'new', ctx('en'))).toBe('Urgent');
    await i18next.changeLanguage('ko');
    expect(changeValueText(change, 'old', ctx('ko'))).toBe('낮음');
    expect(changeValueText(change, 'new', ctx('ko'))).toBe('긴급');
  });

  it('date-only는 locale 표기로 보이고 시간대에 따라 날짜가 이동하지 않는다', async () => {
    const change = { field: 'due_date', old: '2026-09-01', new: '2026-12-31' };
    await i18next.changeLanguage('en');
    expect(changeValueText(change, 'old', ctx('en'))).toBe('Sep 1, 2026');
    expect(changeValueText(change, 'new', ctx('en'))).toBe('Dec 31, 2026');
    await i18next.changeLanguage('ko');
    expect(changeValueText(change, 'old', ctx('ko'))).toBe('2026년 9월 1일');
    // 날짜 숫자는 어느 언어에서도 그대로다(변환 없음)
    expect(changeValueText(change, 'new', ctx('ko'))).toContain('12월 31일');
  });

  it('status·task_type은 내부 key가 아니라 기록 당시 라벨을 그대로 보인다', async () => {
    // 워크스페이스가 만든 이름이므로 번역하지 않는다.
    const change = { field: 'status', old: 'todo', new: 'in_progress',
                     old_label: '해야 할 일', new_label: '진행 중' };
    for (const locale of ['en', 'ko']) {
      await i18next.changeLanguage(locale);
      expect(changeValueText(change, 'old', ctx(locale))).toBe('해야 할 일');
      expect(changeValueText(change, 'new', ctx(locale))).toBe('진행 중');
    }
  });

  it('값이 없으면 언어에 맞는 "없음"을 쓴다', async () => {
    await i18next.changeLanguage('en');
    expect(changeValueText({ field: 'due_date', old: null }, 'old', ctx('en'))).toBe('none');
    await i18next.changeLanguage('ko');
    expect(changeValueText({ field: 'due_date', old: null }, 'old', ctx('ko'))).toBe('없음');
  });

  it('삭제된 status·task_type은 raw key만 단독으로 보이지 않는다 (en/ko 폴백)', async () => {
    // 서버는 현재 설정에 없는 key의 라벨을 만들지 않는다(old_label/new_label = null).
    // 읽는 사람의 언어로 의미를 주되 key는 식별 정보로 남긴다.
    const status = { field: 'status', old: 'todo', new: 'archived_long_ago',
                     old_label: '해야 할 일', new_label: null };
    const type = { field: 'task_type', old: 'task', new: 'gone_type',
                   old_label: '업무', new_label: null };

    await i18next.changeLanguage('en');
    expect(changeValueText(status, 'new', ctx('en'))).toBe('Deleted status (archived_long_ago)');
    expect(changeValueText(type, 'new', ctx('en'))).toBe('Deleted type (gone_type)');
    await i18next.changeLanguage('ko');
    expect(changeValueText(status, 'new', ctx('ko'))).toBe('삭제된 상태 (archived_long_ago)');
    expect(changeValueText(type, 'new', ctx('ko'))).toBe('삭제된 유형 (gone_type)');

    // 살아 있는 쪽(보강된 라벨)은 그대로 — 사용자 정의 이름은 번역하지 않는다.
    expect(changeValueText(status, 'old', ctx('ko'))).toBe('해야 할 일');
    // key만 단독으로 보이는 경우는 없다.
    for (const locale of ['en', 'ko']) {
      await i18next.changeLanguage(locale);
      expect(changeValueText(status, 'new', ctx(locale))).not.toBe('archived_long_ago');
      expect(changeValueText(status, 'new', ctx(locale))).toContain('archived_long_ago');
    }
  });

  it('요약 문장이 펼친 상세와 같은 값 표기를 쓴다', async () => {
    await i18next.changeLanguage('ko');
    const activity = {
      action: 'updated', entity_type: 'task',
      changes: [
        { field: 'priority', old: 'low', new: 'urgent' },
        { field: 'due_date', old: '2026-09-01', new: '2026-12-31' },
        { field: 'status', old: 'todo', new: 'archived_long_ago',
          old_label: '해야 할 일', new_label: null },
      ],
    };
    const summary = activitySummary(activity, t, ctx('ko'));
    for (const change of activity.changes) {
      // 상세 행이 쓰는 값이 요약 문장 안에 그대로 있어야 한다.
      expect(summary).toContain(changeValueText(change, 'old', ctx('ko')));
      expect(summary).toContain(changeValueText(change, 'new', ctx('ko')));
    }
    expect(summary).not.toContain('urgent');    // 제품 enum이 새어나오지 않는다
    expect(summary).not.toContain('2026-12-31'); // date-only 원문이 새어나오지 않는다
    // 삭제된 status도 key 단독이 아니라 '삭제된 상태 (key)'로 요약에 들어간다
    expect(summary).toContain('삭제된 상태 (archived_long_ago)');
  });
});
