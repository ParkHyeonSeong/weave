// @vitest-environment jsdom
//
// 한 주 보기 칸(ScrumWeekCell)의 두 모양(스펙 §6.3): 넓게 보는 요일 = 편집 칸, 나머지 = 읽기 전용 요약 칸.
// 칸 편집기(ScrumCell)는 가짜로 바꿔 "편집 가능으로 넘겼는가"와 칸 안 클릭이 요일을 넓히는가만 본다.
// 가짜 칸 안에는 요약 칸에서 원래 동작을 지켜야 하는 링크·태스크 칩·문서 칩과, 체크리스트 체크박스(TipTap TaskItem처럼
// label > input + span)를 둔다.
// jsdom에는 배치가 없어 크기가 전부 0이다 — 넘침('더 보기')은 한 테스트에서만 크기를 흉내 내 버튼 배선을 보고,
// 실제 배치에서의 넘침 판정은 브라우저에서 본다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/components/Scrum/ScrumCell', () => ({
  default: function FakeCell({ fragmentKey, editable }) {
    return (
      <div data-cell={fragmentKey} data-editable={String(editable !== false)}>
        <p>
          <span data-part="text">로그인 버그 수정</span>
          <a href="#week-link" data-part="link">회의록</a>
          <span className="task-ref" data-task-ref="true">
            PRO-1 칩<span className="ref-chip__badge" data-part="badge">Done</span>
          </span>
          <span className="doc-ref" data-doc-ref="true" data-part="doc">설계 문서</span>
        </p>
        <ul data-type="taskList">
          <li data-type="taskItem">
            <label>
              <input type="checkbox" data-part="checkbox" />
              <span data-part="checkStyler" />
            </label>
            <div><p>배포 확인</p></div>
          </li>
        </ul>
      </div>
    );
  },
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  // 보간 값도 보이게 — 접근 이름에 요일이 들어갔는지 확인한다
  useTranslation: () => ({ t: (key, o) => (o ? `${key}${JSON.stringify(o)}` : key), i18n: { language: 'ko' } }),
}));

import ScrumWeekCell from '@/components/Scrum/ScrumWeekCell';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = '7:2:plan';
const YDOC = {};        // 가짜 칸으로만 넘어간다
const MEMBERS = [];

let root;
let container;
let onFocus;

function renderCell(props = {}) {
  act(() => {
    root.render(
      <ScrumWeekCell
        ydoc={YDOC}
        fragmentKey={KEY}
        members={MEMBERS}
        focused={false}
        onFocus={onFocus}
        dayName="수요일"
        {...props}
      />,
    );
  });
}

const cell = () => container.querySelector(`[data-cell="${KEY}"]`);
const part = (name) => container.querySelector(`[data-part="${name}"]`);
const moreButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent.includes('scrum.week.more'));
const click = (el) => act(() => { el.click(); });
// 실제 사용자 click처럼 취소 가능한 이벤트를 보내고, 취소됐는지 돌려준다
const cancelableClick = (el) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(event); });
  return event.defaultPrevented;
};
// 이 테스트 안에서만 HTMLElement 크기를 흉내 내고, 되돌리는 함수를 돌려준다
function fakeSizes(sizes) {
  const saved = Object.keys(sizes).map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)]);
  Object.entries(sizes).forEach(([k, v]) => {
    Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
  });
  return () => saved.forEach(([k, d]) => {
    if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    else delete HTMLElement.prototype[k];
  });
}

beforeEach(() => {
  onFocus = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  window.getSelection().removeAllRanges();
  document.body.innerHTML = '';
});

describe('ScrumWeekCell', () => {
  it('넓게 보는 칸은 편집 칸 그대로 — 요약 모양·더 보기 없음, 눌러도 넓히지 않는다', () => {
    renderCell({ focused: true });
    expect(cell().dataset.editable).toBe('true');
    expect(container.querySelector('.ScrumWeekCell--compact')).toBeNull();
    expect(moreButton()).toBeUndefined();
    click(part('text'));
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('요약 칸은 읽기 전용으로 그리고, 넘치지 않으면 더 보기도 없다', () => {
    renderCell();
    expect(cell().dataset.editable).toBe('false');
    expect(container.querySelector('.ScrumWeekCell--compact')).not.toBeNull();
    expect(moreButton()).toBeUndefined();   // jsdom 크기 0 = 넘침 없음
  });

  it('요약 칸의 글자를 누르면 그 요일을 한 번 넓힌다 — 칸 안 글자를 끌어 선택하고 놓은 클릭은 넓히지 않는다', () => {
    renderCell();
    const range = document.createRange();
    range.selectNodeContents(part('text'));
    window.getSelection().addRange(range);
    click(part('text'));
    expect(onFocus).not.toHaveBeenCalled();

    window.getSelection().removeAllRanges();
    click(part('text'));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('요약 칸의 링크·칩을 누르면 넓히지 않는다(링크 열기·참조 패널은 그대로)', () => {
    renderCell();
    click(part('link'));
    click(part('badge'));   // 칩 안쪽(상태 배지)에서 시작한 클릭도 칩 클릭이다
    click(part('doc'));
    expect(onFocus).not.toHaveBeenCalled();
  });

  // 실제 브라우저에선 넓히기로 편집기가 편집 가능해진 뒤에 change가 와서 TipTap이 체크를 문서에 쓴다.
  // click을 취소하면 체크가 되돌려지고 change가 아예 안 온다(키보드 Space도 click이라 같은 길).
  it('요약 칸의 체크박스·그 label을 누르면 click을 취소해 체크는 그대로 두고 요일만 넓힌다', () => {
    renderCell();
    const box = part('checkbox');
    const changes = vi.fn();
    box.addEventListener('change', changes);

    expect(cancelableClick(box)).toBe(true);
    expect(box.checked).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    expect(onFocus).toHaveBeenCalledTimes(1);

    // label 안쪽 — 취소하지 않으면 label이 체크박스에 click을 한 번 더 보내 체크가 바뀐다
    expect(cancelableClick(part('checkStyler'))).toBe(true);
    expect(box.checked).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    expect(onFocus).toHaveBeenCalledTimes(2);
  });

  it('넘치면 더 보기(접근 이름에 요일)가 생기고, 누르면 한 번만 넓힌다', () => {
    const restore = fakeSizes({ scrollHeight: 400, clientHeight: 180 });
    try {
      renderCell();
      const more = moreButton();
      expect(more).toBeDefined();
      expect(container.querySelector('.ScrumWeekCell.is-overflowing')).not.toBeNull();
      expect(more.getAttribute('aria-label')).toBe('scrum.week.more · scrum.week.widen{"day":"수요일"}');
      click(more);
      expect(onFocus).toHaveBeenCalledTimes(1);   // 칸 클릭 핸들러로 한 번 더 가지 않는다
    } finally {
      restore();
    }
  });

  it('넓게 보는 요일이 바뀌어도 칸 편집기를 다시 만들지 않는다', () => {
    renderCell({ focused: true });
    const before = cell();
    renderCell({ focused: false });
    expect(cell()).toBe(before);
    expect(cell().dataset.editable).toBe('false');
    renderCell({ focused: true });
    expect(cell()).toBe(before);
    expect(cell().dataset.editable).toBe('true');
  });
});
