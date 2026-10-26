// @vitest-environment jsdom
// 문서·이슈 미리보기 패널(RefPreviewPanel) 본문 안의 ref 칩 좌클릭 → canvas:ref_click → 공용 패널(RefPanelHost)이
// 그 대상을 연다. 서버가 링크를 칩으로 저장하면서, 전에는 눌리던 링크 자리가 미리보기에서 안 눌리던 회귀를 막는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import postcss from 'postcss';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), post: vi.fn() }, getBaseURL: () => '' }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// RefPanelHost의 next/dynamic을 실제 모듈 지연 로드로 바꾼다(미리보기 패널은 진짜, 태스크 패널은 아래 스텁)
vi.mock('next/dynamic', async () => {
  const { lazy, Suspense, createElement } = await import('react');
  return {
    default: (load) => {
      const Lazy = lazy(load);
      return (props) => createElement(Suspense, { fallback: null }, createElement(Lazy, props));
    },
  };
});
vi.mock('@/components/Branch/Tasks/TaskDetailPanel', () => ({
  default: ({ branchId, taskSummary }) => <div className="TaskPanelStub" data-branch={branchId} data-task={taskSummary.task_id} />,
}));

import { axios } from '@/library/_axios';
import i18next from '@/library/i18n';
import RefPreviewPanel from '@/components/Canvas/RefPreviewPanel';
import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 서버가 저장하는 칩 꼴(backend build_*_chip) — 태스크·이슈·문서 칩과 일반 링크
const BODY = '<p>'
  + '<span data-task-ref="true" data-task-id="12" data-branch-id="3" data-display-id="WV-12" data-title="t" '
  + 'data-status="todo" data-priority="medium" data-status-label="" data-status-color="" data-status-category="" '
  + 'class="task-ref">WV-12 t<span class="ref-chip__badge ref-chip__badge--todo" data-ref-badge="true">Todo</span></span> '
  + '<span data-issue-ref="true" data-issue-id="7" data-task-id="12" data-branch-id="3" data-display-id="WV-12" '
  + 'data-title="재현" data-status="open" class="issue-ref">WV-12 재현'
  + '<span class="ref-chip__badge ref-chip__badge--open" data-ref-badge="true">Open</span></span> '
  + '<span data-doc-ref="true" data-page-id="78" data-canvas-id="5" data-title="다른 문서" data-canvas-name="제품" '
  + 'class="doc-ref">다른 문서</span> <a href="https://example.com/x">plain</a></p>';

// 이슈 응답은 실제 API(backend get_issue) 꼴 — 본문은 issue.body다(description 필드는 없다)
const issueResponse = (body) => ({
  status: true,
  issue: {
    issue_id: 7, task_id: 12, title: '재현 이슈', body, status: 'open', created_by: 1, author_name: 'Me',
    author_avatar_url: null, author_avatar_color: null, created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z',
  },
  comments: [],
  timeline: [],
});
const RESPONSES = {
  '/canvases/5/pages/77': { status: true, page: { title: '설계', content: BODY } },
  '/canvases/5/pages/78': { status: true, page: { title: '다른 문서', content: '<p>끝</p>' } },
  '/branches/3/tasks/12/issues/7': issueResponse(BODY),
};

let root = null;
let events = [];
const onRef = (e) => events.push(e.detail);

beforeEach(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  events = [];
  window.addEventListener('canvas:ref_click', onRef);
  axios.get.mockImplementation((url) => Promise.resolve({ data: RESPONSES[url] || { status: false } }));
  // 칩 상태 조회 실패 → 칩을 저장된 모습 그대로 둔다(클릭 대상 유지)
  axios.post.mockImplementation(() => Promise.resolve({ data: { status: false } }));
  await i18next.changeLanguage('ko');
});
afterEach(async () => {
  window.removeEventListener('canvas:ref_click', onRef);
  if (root) await act(async () => root.unmount());
  root = null;
  await i18next.changeLanguage('en');
});

async function render(el) {
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(el); });
  await act(async () => {}); // 본문 fetch 완료
}
const click = (el, init = {}) => act(async () => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...init }));
});
const content = () => document.querySelector('.RefPreviewPanel__HtmlContent');

describe('RefPreviewPanel 본문 칩 좌클릭', () => {
  it('문서 미리보기 본문의 태스크·이슈·문서 칩을 누르면 그 대상을 여는 이벤트가 난다', async () => {
    await render(<RefPreviewPanel refType="doc" refData={{ canvasId: 5, pageId: 77 }} onClose={() => {}} />);
    expect(content()).not.toBeNull();
    await click(content().querySelector('[data-task-ref] [data-ref-badge]'));
    await click(content().querySelector('[data-issue-ref]'));
    await click(content().querySelector('[data-doc-ref]'));
    expect(events).toEqual([
      { type: 'task', data: { branchId: '3', taskId: '12' } },
      { type: 'issue', data: { branchId: '3', taskId: '12', issueId: '7' } },
      { type: 'doc', data: { canvasId: '5', pageId: '78' } },
    ]);
  });

  it('이슈 미리보기는 이슈 본문(body)을 보이고, 본문의 칩도 같다', async () => {
    await render(<RefPreviewPanel refType="issue" refData={{ branchId: 3, taskId: 12, issueId: 7 }} onClose={() => {}} />);
    expect(content(), '이슈 본문').not.toBeNull();
    expect(content().textContent).toContain('다른 문서');
    expect(content().querySelectorAll('[data-task-ref],[data-issue-ref],[data-doc-ref]')).toHaveLength(3);
    await click(content().querySelector('[data-doc-ref]'));
    await click(content().querySelector('[data-task-ref]'));
    expect(events).toEqual([
      { type: 'doc', data: { canvasId: '5', pageId: '78' } },
      { type: 'task', data: { branchId: '3', taskId: '12' } },
    ]);
  });

  it('이슈 본문은 이슈 화면처럼 정화해서 보인다(스크립트 제거, 태그 없는 옛 마크다운 본문은 HTML로)', async () => {
    RESPONSES['/branches/3/tasks/12/issues/8'] = issueResponse('<p>본문<img src="x" onerror="alert(1)"><script>alert(2)</script></p>');
    RESPONSES['/branches/3/tasks/12/issues/9'] = issueResponse('**굵게** 쓴 옛 본문\n\n- 항목');
    try {
      await render(<RefPreviewPanel refType="issue" refData={{ branchId: 3, taskId: 12, issueId: 8 }} onClose={() => {}} />);
      expect(content().textContent).toContain('본문');
      expect(content().querySelector('script'), '스크립트').toBeNull();
      expect(content().querySelector('img').getAttribute('onerror'), '이벤트 속성').toBeNull();
      await act(async () => root.unmount());
      await render(<RefPreviewPanel refType="issue" refData={{ branchId: 3, taskId: 12, issueId: 9 }} onClose={() => {}} />);
      expect(content().querySelector('strong')?.textContent).toBe('굵게');
      expect(content().querySelector('li')?.textContent).toBe('항목');
    } finally {
      delete RESPONSES['/branches/3/tasks/12/issues/8'];
      delete RESPONSES['/branches/3/tasks/12/issues/9'];
    }
  });

  it('본문 칩 모양 규칙(문서·이슈 칩, 상태 배지, 태스크 칩 커서)은 문서·이슈 미리보기 본문 모두에 걸린다', () => {
    const selectors = new Set();
    postcss.parse(compile(resolve(dirname(fileURLToPath(import.meta.url)), '../styles/components/canvas/refPreviewPanel.scss')).css)
      .walkRules((rule) => rule.selectors.forEach((s) => selectors.add(s)));
    for (const chip of ['.doc-ref', '.issue-ref', '.ref-chip__badge', '[data-task-ref]']) {
      expect(selectors, chip).toContain(`.RefPreviewPanel__HtmlContent ${chip}`);
    }
  });

  it('수정 키·가운데 클릭과 칩 밖 클릭은 패널을 열지 않는다(새 탭은 기존 위임 핸들러 몫)', async () => {
    await render(<RefPreviewPanel refType="doc" refData={{ canvasId: 5, pageId: 77 }} onClose={() => {}} />);
    const chip = content().querySelector('[data-doc-ref]');
    await click(chip, { shiftKey: true });
    await click(chip, { altKey: true });
    await click(chip, { button: 1 });
    await click(content().querySelector('p'));
    expect(events).toEqual([]);
  });
});

describe('공용 패널 흐름(RefPanelHost)', () => {
  function Host() {
    const [previewRef, setPreviewRef] = useRefPreview();
    return (
      <RefPanelHost
        previewRef={previewRef || { type: 'doc', data: { canvasId: 5, pageId: 77 } }}
        onClose={() => setPreviewRef(null)}
        onChangeRef={setPreviewRef}
      />
    );
  }
  const title = () => document.querySelector('.RefPreviewPanel__Title')?.textContent;

  it('문서 미리보기 안의 칩을 누르면 패널이 그 대상으로 바뀐다(이슈·문서는 미리보기, 태스크는 태스크 패널)', async () => {
    await render(<Host />);
    await act(async () => {}); // 지연 로드된 미리보기 패널
    expect(title()).toBe('설계');

    await click(content().querySelector('[data-issue-ref]'));
    await act(async () => {});
    expect(axios.get).toHaveBeenCalledWith('/branches/3/tasks/12/issues/7');
    expect(title()).toBe('재현 이슈');

    await click(content().querySelector('[data-doc-ref]'));
    await act(async () => {});
    expect(title()).toBe('다른 문서');

    await click(document.querySelector('.RefPreviewPanel__Title')); // 칩이 아닌 곳 — 그대로
    expect(title()).toBe('다른 문서');
  });

  it('태스크 칩을 누르면 태스크 패널이 그 태스크로 열린다', async () => {
    await render(<Host />);
    await act(async () => {});
    await click(content().querySelector('[data-task-ref]'));
    await act(async () => {});
    const panel = document.querySelector('.TaskPanelStub');
    expect(panel?.dataset).toMatchObject({ branch: '3', task: '12' });
  });
});
