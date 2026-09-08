import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import i18next from './i18n';
import en from './i18n/en';
import ko from './i18n/ko';
import { notificationText } from './serverMessages.js';
import { activitySummary } from './activitySummary.js';

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
