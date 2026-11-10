// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';

const network = vi.hoisted(() => ({ get: vi.fn(), providers: [] }));
vi.mock('@/library/_axios', () => ({ axios: { get: network.get }, getWsBaseURL: () => 'ws://weave.test' }));
vi.mock('@/library/wsTokenRefresh', () => ({ attachWsTokenRefresh: () => () => {} }));
vi.mock('y-websocket', () => ({ WebsocketProvider: class {
  constructor(url, room, doc, options) {
    Object.assign(this, { url, room, doc, options, handlers: new Map(), closed: false });
    this.awareness = { setLocalState() {} };
    network.providers.push(this);
  }
  on(event, callback) { this.handlers.set(event, callback); }
  off(event) { this.handlers.delete(event); }
  connect() {}
  destroy() { this.closed = true; }
  sync(text) {
    const p = new Y.XmlElement('paragraph');
    this.doc.getXmlFragment('7:4:plan').insert(0, [p]);
    p.insert(0, [new Y.XmlText(text)]);
    this.handlers.get('sync')?.(true);
  }
} }));
import useScrumPreviousFriday, { readPreviousFriday } from './useScrumPreviousFriday';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
let root, node, result;
function Probe(props) { result = useScrumPreviousFriday(props); return null; }
const render = (props = {}) => act(() => root.render(<Probe boardId={1} monday="2026-11-09" userId={7} enabled {...props} />));
beforeEach(() => {
  network.providers.length = 0;
  network.get.mockReset().mockResolvedValue({ data: { status: true, week: { week_id: 53 } } });
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.useRealTimers(); });

it('연초 월요일은 이전 ISO 연도의 금요일을 동기화한 뒤 서식 문서로 읽는다', async () => {
  const reading = readPreviousFriday(1, '2027-01-04', 7, new AbortController().signal);
  await settle();
  expect(network.get.mock.calls[0][0]).toBe('/scrum/1/weeks/2026/53');
  const provider = network.providers[0];
  expect(provider.room).toBe('53');
  provider.sync('금요일 할 일');
  const source = await reading;
  expect(source.date).toBe('2027-01-01');
  expect(source.doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '금요일 할 일' }] }] });
  expect(provider.closed).toBe(true);
});

it('주를 바꾸면 앞 주의 조회를 취소하고 새 주의 금요일만 표시한다', async () => {
  render(); await settle();
  const old = network.providers[0];
  expect(result.status).toBe('loading');
  render({ monday: '2026-11-16' });
  expect(result.status).toBe('loading');
  await settle();
  expect(old.closed).toBe(true);
  act(() => network.providers[1].sync('새로 고른 주의 이전 금요일'));
  await settle();
  expect(result.status).toBe('ready');
  expect(result.date).toBe('2026-11-13');
  expect(JSON.stringify(result.doc)).toContain('새로 고른 주의 이전 금요일');
  render({ enabled: false });
  expect(result.status).toBe('idle');
});

it('읽기 실패는 빈 내용으로 오인하지 않고 재시도로 복구한다', async () => {
  network.get.mockRejectedValueOnce(new Error('offline'));
  render(); await settle();
  expect(result.status).toBe('error');
  act(() => result.retry()); await settle();
  act(() => network.providers[0].sync('금요일'));
  await settle();
  expect(result.status).toBe('ready');
});

it('동기화가 끝나지 않으면 연결을 닫고 재시도 가능한 오류가 된다', async () => {
  vi.useFakeTimers();
  render();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(result.status).toBe('error');
  expect(network.providers[0].closed).toBe(true);
});
