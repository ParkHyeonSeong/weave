// 채팅방 읽음·재연결 보충의 두 판단.
//  · isChatViewing: 방이 그려진 문서(메인 창 또는 PiP 창)가 보이고 그 창에 포커스가 있을 때만 "보는 중"
//  · mergeMissedMessages: 재연결 뒤 다시 받은 최신 페이지를 지금 목록에 합친다(중복 없이, 순서대로)
import { describe, it, expect } from 'vitest';
import { isChatViewing, mergeMissedMessages } from '@/library/chatRoomSync';

const doc = (visibilityState, focused) => ({ visibilityState, hasFocus: () => focused });

describe('isChatViewing', () => {
  it('보이는 탭이고 창에 포커스가 있을 때만 보는 중이다', () => {
    expect(isChatViewing(doc('visible', true))).toBe(true);
  });

  it.each([
    ['탭이 숨었다', doc('hidden', false)],
    ['탭은 보이지만 다른 앱·다른 창에 포커스가 있다', doc('visible', false)],
    ['문서를 모른다(아직 그려지지 않음)', null],
  ])('%s → 보는 중이 아니다', (_label, d) => {
    expect(isChatViewing(d)).toBe(false);
  });
});

const m = (id) => ({ message_id: id, content: `m${id}` });
const ids = (list) => list.map((x) => x.message_id);

describe('mergeMissedMessages', () => {
  it('놓친 메시지가 없으면 지금 목록을 그대로 돌려준다(같은 배열 — 다시 그리지 않는다)', () => {
    const prev = [m(1), m(2), m(3)];
    expect(mergeMissedMessages(prev, [m(1), m(2), m(3)])).toBe(prev);
  });

  it('끊긴 사이 온 메시지를 뒤에 채운다', () => {
    expect(ids(mergeMissedMessages([m(1), m(2)], [m(1), m(2), m(3), m(4)]))).toEqual([1, 2, 3, 4]);
  });

  it('재연결 뒤 실시간으로 먼저 붙은 메시지가 있어도 중복 없이 순서대로 합친다', () => {
    // 5는 재연결 직후 WebSocket으로 먼저 도착했고, 3·4는 끊긴 사이에 온 메시지다
    expect(ids(mergeMissedMessages([m(1), m(2), m(5)], [m(2), m(3), m(4), m(5)]))).toEqual([1, 2, 3, 4, 5]);
  });

  it('받은 페이지가 지금 목록과 한 건도 겹치지 않으면(사이가 비었을 수 있음) 방을 새로 연 것처럼 받은 페이지로 바꾼다', () => {
    expect(ids(mergeMissedMessages([m(1), m(2)], [m(60), m(61)]))).toEqual([60, 61]);
  });

  it('지금 목록이 비어 있으면 받은 페이지를 그대로 쓴다', () => {
    expect(ids(mergeMissedMessages([], [m(1), m(2)]))).toEqual([1, 2]);
  });
});
