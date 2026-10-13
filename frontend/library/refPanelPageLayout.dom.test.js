// @vitest-environment jsdom
//
// RefPanelPageLayout — 본문 스크롤 영역(__Main)을 스크롤하지 않는 위치 기준(__MainWrap)이 감싸고,
// 자식은 usePageScrollElement()로 __Main 요소를 받는다. 전체 상세의 섹션 바로가기가 이 영역을 스크롤한다
// (Canvas의 기존 `.Layout__Content` 조회는 이 레이아웃 아래에서 스크롤하지 않는 요소다 — 1440×900 실측).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/components/shared/RefPanelHost', () => ({ default: () => null, useRefPreview: () => [null, () => {}] }));

import RefPanelPageLayout, { usePageScrollElement } from '@/components/shared/RefPanelPageLayout';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.body.replaceChildren();
});

function Probe() {
  const el = usePageScrollElement();
  return <span data-probe={el ? el.className : 'none'} />;
}

async function render(children) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<RefPanelPageLayout>{children}</RefPanelPageLayout>); });
}

describe('RefPanelPageLayout — 스크롤 영역과 위치 기준', () => {
  it('__Main은 __MainWrap 안에 있고, 자식은 __Main 요소를 스크롤 영역으로 받는다', async () => {
    await render(<Probe />);
    const main = document.querySelector('.RefPanelPageLayout > .RefPanelPageLayout__MainWrap > .RefPanelPageLayout__Main');
    expect(main).not.toBeNull();
    expect(main.querySelector('[data-probe]').getAttribute('data-probe')).toBe('RefPanelPageLayout__Main');
  });

  it('함수 자식(canvas 라우트)도 같은 스크롤 영역 안에 그린다', async () => {
    await render(() => <Probe />);
    expect(document.querySelector('.RefPanelPageLayout__Main [data-probe]').getAttribute('data-probe'))
      .toBe('RefPanelPageLayout__Main');
  });
});
