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

  it('본문 칩 모양 규칙(문서·이슈·태스크 칩, 상태 배지)은 문서·이슈 미리보기 본문 모두에 걸린다', () => {
    const selectors = new Set();
    postcss.parse(compile(resolve(dirname(fileURLToPath(import.meta.url)), '../styles/components/canvas/refPreviewPanel.scss')).css)
      .walkRules((rule) => rule.selectors.forEach((s) => selectors.add(s)));
    for (const chip of ['.doc-ref', '.issue-ref', '.ref-chip__badge', '.task-ref']) {
      expect(selectors, chip).toContain(`.RefPreviewPanel__HtmlContent ${chip}`);
    }
  });

  // 미리보기 태스크 칩은 한 덩어리 상자다 — 좁은 표 셀·줄 끝에서 줄 조각으로 갈리거나 상태 배지만 다음 줄로 떨어지지 않고, 칸보다 긴 제목은
  // 상자 안에서 줄을 바꾼다(칸을 넘지 않음). 아이콘·상태 배지는 칩의 줄 상자를 꽉 채워 위에 맞춰, 위아래 중심이 칩 상자 중심과 같다
  it('미리보기 태스크 칩: 한 덩어리 상자(너비 100%까지)이고 아이콘·상태 배지가 줄 높이를 꽉 채워 위아래 가운데에 맞는다', () => {
    const decl = {};
    postcss.parse(compile(resolve(dirname(fileURLToPath(import.meta.url)), '../styles/components/canvas/refPreviewPanel.scss')).css)
      .walkRules((rule) => rule.selectors.forEach((s) => { // 같은 선택자는 뒤에 나온 선언이 이긴다(같은 특이도)
        decl[s] = { ...decl[s] };
        rule.walkDecls((d) => { decl[s][d.prop] = d.value; });
      }));
    const chip = decl['.RefPreviewPanel__HtmlContent .task-ref'];
    expect(chip.display).toBe('inline-block');
    expect(chip['max-width']).toBe('100%');
    expect(chip['box-sizing']).toBe('border-box');
    const icon = decl['.RefPreviewPanel__HtmlContent .task-ref::before'];
    const badge = decl['.RefPreviewPanel__HtmlContent .task-ref .ref-chip__badge'];
    expect(badge, '태스크 칩 안 상태 배지 규칙').toBeTruthy();
    for (const [name, part, size] of [['아이콘', icon, icon.height], ['상태 배지', badge, badge['line-height']]]) {
      expect(part['vertical-align'], name).toBe('top');
      expect(size, `${name} 높이 = 칩 줄 높이`).toBe(chip['line-height']);
    }
    // 칩 안쪽 너비보다 긴 상태 이름(아주 좁은 칸·모바일 미리보기)은 알약 안에서 줄을 바꾼다 — 글자가 알약·칩 밖으로 넘치지 않게
    expect(badge['white-space'], '상태 배지 글자 줄바꿈').toBe('normal');
    expect(badge['max-width'], '상태 배지는 칩 안쪽 너비까지').toBe('100%');
  });

  // 한 덩어리 상자(inline-block)에는 바깥 <s>·<u>의 선이 이어지지 않는다(CSS 선 전파 규칙) — 글쓴이가 문장에 그은 선이 칩 번호·제목에서만 빠졌다.
  // 칩이 같은 선을 직접 긋는다. 바로 위 태그만 보는 상속(inherit)은 <s><u>·<s><strong>·<s><mark>에서 선을 잃고 삭제된 칩의 자동 취소선을
  // 지운다(Chrome 실측) — 그래서 칩을 감싼 서식이 몇 겹 위에 있어도 맞는지, 삭제 표시와 함께일 때를 계산된 스타일로 본다
  it('미리보기 태스크 칩: 글쓴이의 취소선·밑줄이 칩에도 그어지고(다른 서식 안이어도), 삭제된 칩의 자동 취소선은 남는다', async () => {
    const scss = (file) => compile(resolve(dirname(fileURLToPath(import.meta.url)), file)).css;
    let gone = '';
    postcss.parse(scss('../styles/globals.scss')).walkRules((rule) => {
      if (!rule.selector.includes('.task-ref.ref-chip--unresolved')) return;
      rule.walkDecls('text-decoration', (d) => { d.prop = 'text-decoration-line'; }); // jsdom은 줄임 선언을 낱 속성으로 풀지 않는다
      gone = rule.toString();
    });
    expect(gone, '삭제된 칩 규칙(globals.scss)').toContain('line-through');
    const style = document.createElement('style');
    style.textContent = gone + scss('../styles/components/canvas/refPreviewPanel.scss'); // 앱과 같은 순서(_app.js: globals 먼저)
    document.head.appendChild(style);
    const chip = (id) => `<span data-task-ref="true" data-task-id="${id}" data-branch-id="3" data-display-id="WV-${id}" data-title="실험 결과 확인" class="task-ref">WV-${id} 실험 결과 확인</span>`;
    // [사례, 칩을 감싼 본문(실제 편집기 getHTML 순서·마크다운 ~~**칩**~~ 꼴), 삭제된 칩인가, 칩에 그어질 선]
    const CASES = [
      ['취소선', (c) => `<p><s>이전 계획 ${c} 사용하지 않음</s></p>`, false, 'line-through'],
      ['밑줄', (c) => `<p><u>이전 계획 ${c} 사용하지 않음</u></p>`, false, 'underline'],
      ['취소선+밑줄', (c) => `<p><s><u>${c}</u></s></p>`, false, 'line-through underline'],
      ['밑줄+취소선', (c) => `<p><u><s>${c}</s></u></p>`, false, 'line-through underline'],
      ['굵게+취소선', (c) => `<p><strong><s>${c}</s></strong></p>`, false, 'line-through'],
      ['취소선 안 굵은 칩', (c) => `<p><s>이전 계획 <strong>${c}</strong></s></p>`, false, 'line-through'],
      ['취소선+형광펜', (c) => `<p><s><mark>${c}</mark></s></p>`, false, 'line-through'],
      ['기울임+밑줄', (c) => `<p><em><u>${c}</u></em></p>`, false, 'underline'],
      ['표 셀 취소선', (c) => `<table><tbody><tr><td><p><s>좁은 칸 ${c}</s></p></td></tr></tbody></table>`, false, 'line-through'],
      ['서식 없음', (c) => `<p>${c}</p>`, false, 'none'],
      ['삭제된 칩', (c) => `<p>${c}</p>`, true, 'line-through'],
      ['삭제된 칩+밑줄', (c) => `<p><u>${c}</u></p>`, true, 'line-through underline'],
      ['삭제된 칩+취소선', (c) => `<p><s>${c}</s></p>`, true, 'line-through'],
    ];
    RESPONSES['/canvases/5/pages/79'] = { status: true, page: { title: '서식', content: CASES.map(([, wrap], i) => wrap(chip(100 + i))).join('') } };
    try {
      await render(<RefPreviewPanel refType="doc" refData={{ canvasId: 5, pageId: 79 }} onClose={() => {}} />);
      const got = CASES.map(([name, , deleted], i) => {
        const el = content().querySelector(`[data-task-id="${100 + i}"]`);
        if (deleted) el.classList.add('ref-chip--unresolved'); // 하이드레이션이 지운 대상에 다는 표시(refHydration setUnresolved)
        return [name, getComputedStyle(el).textDecorationLine];
      });
      expect(got).toEqual(CASES.map(([name, , , line]) => [name, line]));
    } finally {
      style.remove();
      delete RESPONSES['/canvases/5/pages/79'];
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
