// @vitest-environment jsdom
// useCollabEditBase — 공동편집기 기준본(content·yjs_state)은 그 편집 세션(provider)의 방 동기화 뒤에 읽은 것만 쓴다.
// 화면 흐름(동기화 전 편집기 없음, 동기화 뒤 다시 읽기, 저장 표지)은 canvasExternalWrite.dom.test.js가 본다. 여기서는
// 훅이 일부러 지키는 두 성질을 고정한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn() } }));

import { axios } from '@/library/_axios';
import useCollabEditBase from '@/library/useCollabEditBase';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// y-websocket provider 흉내 — synced와 'sync' 이벤트만 쓴다
function makeProvider(synced) {
  const handlers = new Set();
  const provider = {
    synced,
    on: (event, fn) => { if (event === 'sync') handlers.add(fn); },
    off: (event, fn) => { if (event === 'sync') handlers.delete(fn); },
    emitSync() { provider.synced = true; [...handlers].forEach((fn) => fn(true)); },
  };
  return provider;
}

let root;
let base;
function Probe({ provider, url }) { base = useCollabEditBase(provider, url); return null; }
const render = (props) => act(async () => { root.render(<Probe {...props} />); });
const page = (content, yjsState) => ({ data: { status: true, page: { content, yjs_state: yjsState } } });

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  base = undefined;
});
afterEach(() => { act(() => root.unmount()); });

describe('useCollabEditBase', () => {
  it('새 편집 세션(provider)에는 앞 세션의 기준본을 쓰지 않는다 — 그 세션이 동기화된 뒤 다시 읽은 것만 돌려준다', async () => {
    axios.get.mockResolvedValueOnce(page('<p>first</p>', false));
    const first = makeProvider(true);
    await render({ provider: first, url: '/canvases/3/pages/9' });
    expect(base).toEqual({ content: '<p>first</p>', yjs_state: false });

    // 재연결·프로필 변경 등으로 provider와 ydoc이 새로 만들어졌다. 아직 동기화 전인 빈 문서에 앞 세션의 기준본
    // (yjs_state 없음)을 넘기면 편집기가 옛 content로 채워 방에 이미 있는 문서와 겹친다
    const second = makeProvider(false);
    await render({ provider: second, url: '/canvases/3/pages/9' });
    expect(base).toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(1);              // 동기화 전에는 읽지 않는다

    axios.get.mockResolvedValueOnce(page('<p>second</p>', true));
    await act(async () => { second.emitSync(); });
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(base).toEqual({ content: '<p>second</p>', yjs_state: true });
  });

  it('다시 읽기가 실패하면 null이다 — 호출부는 읽기 화면 때의 옛 페이지로 편집기를 띄우지 않는다', async () => {
    axios.get.mockResolvedValueOnce({ data: { status: false, code: 'PAGE_NOT_FOUND' } });
    await render({ provider: makeProvider(true), url: '/canvases/3/pages/9' });
    expect(base).toBeNull();

    axios.get.mockRejectedValueOnce(new Error('Network Error'));
    await render({ provider: makeProvider(true), url: '/canvases/3/pages/9' });
    expect(base).toBeNull();
  });
});
