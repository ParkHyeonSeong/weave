// @vitest-environment jsdom
//
// 라벨 이름·색 편집 — 할당된 칩과 미할당 목록 양쪽에서 같은 편집창이 열리고, 열기는 부착·해제와 분리된다.
// 입력 중에는 초안만 바뀌고 '적용'에서만 저장한다. 저장 중 중복 제출을 막고, 실패하면 초안을 둔 채
// 이유를 보이며 창을 닫지 않는다. Escape·취소는 저장하지 않고 연 버튼으로 포커스를 돌린다.
// 저장을 기다리는 동안 편집 대상은 바뀌지 않고(늦은 응답이 다른 라벨에 섞이지 않는다), 늦은 실패는 사용자가
// 옮긴 포커스를 빼앗지 않으며, 편집창은 트리거가 화면 밖으로 나가거나 높이가 바뀌어도 화면 안에 머문다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from '@/library/i18n';
import LabelTagInput from '@/components/common/LabelTagInput';
import { entityBorderStyle, entityTintStyle } from '@/library/entityTint';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRONTEND = { label_id: 33, label_name: 'Frontend', color: '#5E6AD2' };
const UX = { label_id: 32, label_name: 'UX 개선', color: '#0D9488' };
const REVIEW = { label_id: 34, label_name: '검토 필요', color: '#F59E0B' };
const ALL = [FRONTEND, UX, REVIEW];

let root;
let props;

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function render(overrides = {}) {
  props = {
    assignedLabels: [FRONTEND, UX],
    allLabels: ALL,
    onToggle: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onUpdateLabel: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<LabelTagInput {...props} />); });
}
const frame = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r())); });
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const mouseDown = (el) => {
  const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  return ev;
};
const chipEdit = (name) => document.querySelector(`.LabelTagInput__ChipEdit[aria-label="라벨 편집: ${name}"]`);
const dialog = () => document.querySelector('.LabelEditPopover');
const nameInput = () => dialog().querySelector('.LabelEditPopover__NameInput');
const applyBtn = () => dialog().querySelector('.LabelEditPopover__Apply');
// React 제어 input에 값 넣기
const typeInto = (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(async () => { await i18next.changeLanguage('ko'); });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.body.replaceChildren();
  await i18next.changeLanguage('en');
});

describe('편집 진입 — 부착·해제·삭제와 분리', () => {
  it('할당된 칩 이름을 누르면 그 라벨 편집창이 열리고 해제는 일어나지 않는다', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    expect(dialog()).not.toBeNull();
    expect(nameInput().value).toBe('UX 개선');
    expect(dialog().querySelector('.ColorPicker__HexInput').value).toBe('#0D9488');
    expect(document.activeElement).toBe(nameInput());
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('칩의 ×는 여전히 해제만 한다', async () => {
    await render();
    await click(document.querySelector('.LabelTagInput__ChipRemove[aria-label="라벨 해제: Frontend"]'));
    expect(props.onToggle).toHaveBeenCalledWith(33);
    expect(dialog()).toBeNull();
  });

  it('미할당 목록의 연필은 부착 없이 같은 편집창을 연다', async () => {
    await render();
    await act(async () => { document.querySelector('.LabelTagInput__Input').focus(); });
    const pencil = document.querySelector('.LabelTagInput__OptionEdit');
    const down = mouseDown(pencil);
    expect(down.defaultPrevented).toBe(true);
    expect(props.onToggle).not.toHaveBeenCalled();   // 행의 onMouseDown(부착)으로 번지지 않는다
    await click(pencil);
    await frame();
    expect(nameInput().value).toBe('검토 필요');
    expect(document.querySelector('.LabelTagInput__Dropdown')).toBeNull();   // 목록은 닫힌다
  });
});

describe('기존 부착 흐름 유지', () => {
  it('미할당 행 자체를 누르면 여전히 부착하고 편집창은 열리지 않는다', async () => {
    await render();
    await act(async () => { document.querySelector('.LabelTagInput__Input').focus(); });
    const row = [...document.querySelectorAll('.LabelTagInput__Option')].find((el) => el.textContent.includes('검토 필요'));
    mouseDown(row);
    expect(props.onToggle).toHaveBeenCalledWith(34);
    expect(dialog()).toBeNull();
  });
});

describe('입력 검증 — 서버·DB 규칙과 같다', () => {
  beforeEach(async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
  });
  it('바뀐 것이 없으면 적용 비활성', () => {
    expect(applyBtn().disabled).toBe(true);
  });
  it('공백 이름', async () => {
    await typeInto(nameInput(), '   ');
    expect(dialog().textContent).toContain('이름을 입력해 주세요.');
    expect(applyBtn().disabled).toBe(true);
  });
  it('101자', async () => {
    await typeInto(nameInput(), 'a'.repeat(101));
    expect(dialog().textContent).toContain('이름은 100자까지 입력할 수 있어요.');
    expect(applyBtn().disabled).toBe(true);
  });
  it('같은 브랜치의 다른 라벨과 같은 이름', async () => {
    await typeInto(nameInput(), 'Frontend');
    expect(dialog().textContent).toContain('이 브랜치에 같은 이름의 라벨이 이미 있어요.');
    expect(applyBtn().disabled).toBe(true);
  });
  it('잘못된 HEX', async () => {
    await typeInto(dialog().querySelector('.ColorPicker__HexInput'), '#12');
    expect(dialog().querySelector('.ColorPicker__Error')).not.toBeNull();
    expect(applyBtn().disabled).toBe(true);
  });
});

describe('저장', () => {
  it('이름만 바꾸면 label_name만 보내고, 저장 중에는 다시 누를 수 없다', async () => {
    const save = deferred();
    await render({ onUpdateLabel: vi.fn(() => save.promise) });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());
    await click(applyBtn());
    expect(props.onUpdateLabel).toHaveBeenCalledTimes(1);
    expect(props.onUpdateLabel).toHaveBeenCalledWith(32, { label_name: '사용성 개선' });
    expect(applyBtn().textContent).toBe('적용 중…');
    expect(applyBtn().disabled).toBe(true);
    await act(async () => { save.resolve({ ok: true }); });
    await frame();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(chipEdit('UX 개선'));   // 연 버튼으로 돌아온다
  });

  it('색만 바꾸면 color만 보낸다(팔레트)', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    await click(dialog().querySelector('.ColorPicker__Swatch[aria-label="#DC2626"]'));
    await click(applyBtn());
    expect(props.onUpdateLabel).toHaveBeenCalledWith(32, { color: '#DC2626' });
  });

  it('서버가 거절하면 초안을 두고 이유를 보이며 창을 닫지 않는다', async () => {
    await render({ onUpdateLabel: vi.fn(async () => ({ ok: false, code: 'LABEL_ALREADY_EXISTS', category: 'conflict', network: false })) });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());
    expect(dialog()).not.toBeNull();
    expect(nameInput().value).toBe('사용성 개선');
    expect(dialog().querySelector('[role="alert"]').textContent).toBe('이 브랜치에 같은 이름의 라벨이 이미 있어요.');
    expect(applyBtn().disabled).toBe(false);   // 다시 시도할 수 있다
  });

  it('통신 실패는 재시도 안내', async () => {
    await render({ onUpdateLabel: vi.fn(async () => ({ ok: false, code: null, category: null, network: true })) });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());
    expect(dialog().querySelector('[role="alert"]').textContent).toBe('변경 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  });

  it('Escape는 저장 없이 닫고 연 버튼으로 포커스를 돌린다', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await act(async () => { nameInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await frame();
    expect(dialog()).toBeNull();
    expect(props.onUpdateLabel).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(chipEdit('UX 개선'));
  });

  it('취소도 저장하지 않는다', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(dialog().querySelector('.LabelEditPopover__Cancel'));
    expect(dialog()).toBeNull();
    expect(props.onUpdateLabel).not.toHaveBeenCalled();
  });
});

describe('키보드·포커스 — 막다른 길이 없다', () => {
  it('저장에 실패하면 이름 칸으로 포커스가 돌아오고, 입력을 고치면 실패 문구가 지워진다', async () => {
    await render({ onUpdateLabel: vi.fn(async () => ({ ok: false, code: 'LABEL_ALREADY_EXISTS', category: 'conflict', network: false })) });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());
    await frame();
    expect(document.activeElement).toBe(nameInput());
    expect(dialog().querySelector('[role="alert"]')).not.toBeNull();
    await typeInto(nameInput(), '사용성 개선2');
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
  });

  it('한글 조합 중 Enter는 적용하지 않는다', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성');
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    await act(async () => { nameInput().dispatchEvent(composing); });
    expect(props.onUpdateLabel).not.toHaveBeenCalled();
    await act(async () => { nameInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(props.onUpdateLabel).toHaveBeenCalledWith(32, { label_name: '사용성' });
  });

  it('저장이 예외를 던져도 「저장 중」에 갇히지 않는다(통신 실패로 다룬다)', async () => {
    await render({ onUpdateLabel: vi.fn(async () => { throw new Error('boom'); }) });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());
    expect(dialog().querySelector('[role="alert"]').textContent).toBe('변경 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    expect(applyBtn().disabled).toBe(false);
  });

  it('편집창 빈 곳에 포커스가 있어도 Esc로 닫힌다', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    const root = dialog();
    expect(root.getAttribute('tabindex')).toBe('-1');
    root.focus();
    await act(async () => { root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(dialog()).toBeNull();
  });

  it('저장을 기다리는 사이 다른 곳으로 옮긴 포커스는 저장이 끝나도 빼앗지 않는다', async () => {
    const save = deferred();
    await render({ onUpdateLabel: vi.fn(() => save.promise) });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());
    const elsewhere = document.createElement('textarea');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    await act(async () => { save.resolve({ ok: true }); });
    await frame();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('미리보기 — 지금 테마와 무관하게 라이트·다크 산출값', () => {
  it('라이트 타일은 라이트 값, 다크 타일은 다크 값(초안 색)', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(dialog().querySelector('.ColorPicker__HexInput'), '#2563EB');
    const tint = entityTintStyle('#2563EB', { alpha: '20' });
    const bd = entityBorderStyle('#2563EB');
    const light = dialog().querySelector('[data-theme-preview="light"]');
    const dark = dialog().querySelector('[data-theme-preview="dark"]');
    const probe = document.createElement('span');
    probe.style.background = tint['--et-bg'];
    expect(light.style.background).toBe(probe.style.background);
    probe.style.background = tint['--et-bg-dark'];
    expect(dark.style.background).toBe(probe.style.background);
    probe.style.borderColor = bd['--et-bd-dark'];
    expect(dark.style.borderColor).toBe(probe.style.borderColor);
    expect(light.className).not.toContain('EntityTint');
    expect(light.textContent).toBe('UX 개선');
  });
});

describe('저장 대기 중 편집 대상 — 초안·저장 대상·늦은 응답이 다른 라벨에 섞이지 않는다', () => {
  it('저장 중 같은 입력 영역의 다른 칩을 눌러도 대상이 바뀌지 않고, 늦은 실패 뒤 다시 적용해도 처음 라벨에 그 초안만 보낸다', async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
    await render({ onUpdateLabel: save });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());                     // 응답이 늦다
    mouseDown(chipEdit('Frontend'));             // 저장 중 같은 입력 영역의 Frontend 칩을 누른다
    await click(chipEdit('Frontend'));
    await act(async () => { first.resolve({ ok: false, code: null, category: 'server', network: false }); });
    await frame();
    expect(nameInput().value).toBe('사용성 개선');
    await click(applyBtn());                     // 다시 적용
    expect(save.mock.calls).toEqual([
      [32, { label_name: '사용성 개선' }],
      [32, { label_name: '사용성 개선' }],
    ]);
  });

  it('늦게 온 성공은 처음 연 라벨의 편집창만 닫고 그 칩으로 돌아온다 — 저장 중 누른 칩이 대상을 가로채지 않는다', async () => {
    const first = deferred();
    await render({ onUpdateLabel: vi.fn(() => first.promise) });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());
    mouseDown(chipEdit('Frontend'));
    await click(chipEdit('Frontend'));
    await act(async () => { first.resolve({ ok: true }); });
    await frame();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(chipEdit('UX 개선'));
    await click(chipEdit('Frontend'));           // 저장이 끝난 뒤에는 Frontend를 제 값으로 연다
    await frame();
    expect(nameInput().value).toBe('Frontend');
    expect(dialog().querySelector('.ColorPicker__HexInput').value).toBe('#5E6AD2');
  });

  it('편집창이 열린 채 다른 칩이 눌리면(누름 없이 클릭만 — 보조 기술) 그 라벨의 값으로 다시 시작한다', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(chipEdit('Frontend'));
    await frame();
    expect(nameInput().value).toBe('Frontend');
    await click(applyBtn());                     // 바뀐 것이 없어 비활성 — 아무것도 보내지 않는다
    expect(props.onUpdateLabel).not.toHaveBeenCalled();
  });
});

describe('늦게 온 저장 실패 — 사용자가 옮긴 포커스를 빼앗지 않는다', () => {
  it('저장을 기다리는 사이 댓글 입력칸으로 옮겼다면 실패가 와도 그 포커스를 두고, 초안과 실패 문구는 남는다', async () => {
    const save = deferred();
    await render({ onUpdateLabel: vi.fn(() => save.promise) });
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    await click(applyBtn());
    const comment = document.createElement('textarea');   // 같은 화면의 댓글 입력칸
    document.body.appendChild(comment);
    mouseDown(comment);                                    // 저장 중이라 편집창은 닫히지 않는다
    comment.focus();
    await act(async () => { save.resolve({ ok: false, code: null, category: 'server', network: false }); });
    await frame();
    expect(document.activeElement).toBe(comment);
    expect(nameInput().value).toBe('사용성 개선');
    expect(dialog().querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('편집창 위치 — 트리거가 화면 밖으로 나가거나 높이가 바뀌어도 화면 안', () => {
  let savedInnerHeight;
  let observers;
  beforeEach(() => {
    savedInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    observers = [];
    globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} };
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: savedInnerHeight });
    delete globalThis.ResizeObserver;
  });
  // jsdom에는 배치가 없다 — 라벨 입력 영역(트리거)의 자리와 편집창 크기를 정해 준다
  const place = (anchorTop, height) => {
    document.querySelector('.LabelTagInput').getBoundingClientRect = () => (
      { top: anchorTop, bottom: anchorTop + 30, left: 100, right: 380, width: 280, height: 30 });
    const box = dialog().parentElement;   // DropdownPortal이 자리를 잡는 fixed 요소
    Object.defineProperty(box, 'offsetWidth', { configurable: true, value: 320 });
    Object.defineProperty(box, 'offsetHeight', { configurable: true, value: height });
    return box;
  };
  const scroll = () => act(async () => { window.dispatchEvent(new Event('scroll')); });

  it('본문을 스크롤해 라벨 입력 영역이 화면 위로 나가도 편집창은 화면 위 8px에 머물고 초안은 그대로다', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    await typeInto(nameInput(), '사용성 개선');
    const box = place(-300, 448);
    await scroll();
    expect(box.style.top).toBe('8px');
    expect(nameInput().value).toBe('사용성 개선');
  });

  it('실패 문구 등으로 높이가 늘면 아래가 화면 밖으로 넘치지 않게 다시 맞춘다', async () => {
    await render();
    await click(chipEdit('UX 개선'));
    await frame();
    const box = place(400, 200);
    await scroll();
    expect(box.style.top).toBe('434px');             // 라벨 입력 영역 바로 아래(400 + 30 + 4)
    Object.defineProperty(box, 'offsetHeight', { configurable: true, value: 300 });
    await act(async () => { observers.forEach((o) => o.cb([])); });
    expect(parseFloat(box.style.top) + 300).toBeLessThanOrEqual(700 - 8);
  });
});
