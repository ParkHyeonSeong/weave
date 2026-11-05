// @vitest-environment jsdom
//
// 하루 보기·한 주 보기가 같이 쓰는 작성 여부 — 사람마다 월~금 할 일(plan)·리캡(gap).
// 문서가 바뀌면 다음 프레임에 다시 세고, synced(첫 동기화)가 바뀐 렌더에서는 문서 변경 신호를 기다리지 않고 바로 센다.
import { it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import useWeekWritten from '@/library/useWeekWritten';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS = [{ user_id: 7 }, { user_id: 8 }];
const NONE = [false, false, false, false, false];

let root;
let container;
let doc;
let seen;

function Probe({ synced }) {
  seen = useWeekWritten(doc, MEMBERS, synced);
  return null;
}

// 연결되지 않은 Y 타입은 읽을 수 없으므로, 부모에 먼저 붙인 뒤 자식을 채운다.
function write(key, text) {
  const fragment = doc.getXmlFragment(key);
  const p = new Y.XmlElement('paragraph');
  fragment.insert(fragment.length, [p]);
  p.insert(0, [new Y.XmlText(text)]);
}
const nextFrame = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r())); });

beforeEach(() => {
  doc = new Y.Doc();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  doc.destroy();
});

it('사람마다 월~금 할 일·리캡을 썼는지 세고, 문서가 바뀌면 다음 프레임에 다시 센다', async () => {
  write('7:1:plan', '화요일 할 일');
  act(() => { root.render(<Probe synced />); });
  expect(seen.get(7)).toEqual({ plan: [false, true, false, false, false], gap: NONE });
  expect(seen.get(8)).toEqual({ plan: NONE, gap: NONE });

  write('8:3:gap', '목요일 리캡');
  await nextFrame();
  expect(seen.get(8)).toEqual({ plan: NONE, gap: [false, false, false, true, false] });
});

it('첫 동기화로 내용이 들어온 렌더에서 바로 센다 — 동기화 전에 센 빈 값을 한 프레임 보이지 않는다', async () => {
  act(() => { root.render(<Probe synced={false} />); });
  expect(seen.get(7).plan[0]).toBe(false);

  // 동기화가 내용을 넣고 synced가 켜져 다시 그린다 — 문서 변경 신호(다음 프레임)보다 먼저다
  write('7:0:plan', '월요일 할 일');
  act(() => { root.render(<Probe synced />); });
  expect(seen.get(7).plan[0]).toBe(true);
  await nextFrame();   // 기다리던 프레임을 act 안에서 흘려보낸다
});
