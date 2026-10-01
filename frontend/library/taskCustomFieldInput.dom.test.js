// @vitest-environment jsdom
//
// 태스크 커스텀 필드 입력이 키 입력마다 저장하던 회귀(TD-01).
//
// text/number/url 칸이 서버 값에 묶인 제어 입력이라, 한 글자마다 저장·재조회가 일어나고
// 칸이 원래 값으로 되돌아가 연속 입력이 사실상 불가능했다. 이제 입력 중엔 로컬 초안만
// 바꾸고 칸을 벗어나거나(blur) Enter를 누를 때 한 번 저장한다. checkbox/select는 즉시 저장한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import '@/library/i18n';
import TaskCustomFieldInput from '@/components/Branch/Tasks/TaskCustomFieldInput';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = { custom_field_id: 12, field_name: 'Note', field_type: 'text' };
const NUMBER = { custom_field_id: 13, field_name: 'Points', field_type: 'number' };
const URL_FIELD = { custom_field_id: 14, field_name: 'Link', field_type: 'url' };
const CHECKBOX = { custom_field_id: 15, field_name: 'Done', field_type: 'checkbox' };
const SELECT = { custom_field_id: 16, field_name: 'Size', field_type: 'select', field_options: ['S', 'M'] };

let root;
let container;

function render(field, value, onSave) {
  act(() => {
    root.render(<TaskCustomFieldInput field={field} value={value} onSave={onSave} className="X" />);
  });
}

const input = () => container.querySelector('input');
const focus = (el) => act(() => { el.focus(); });
const blur = (el) => act(() => { el.blur(); });
const pressEnter = (el, init = {}) => act(() => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }));
});
// 사용자가 친 것처럼 값을 바꾼다 — React는 native setter + input 이벤트로 onChange를 낸다.
function typeInto(el, text) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
});

describe('TaskCustomFieldInput — text/number/url는 blur·Enter에 한 번 저장', () => {
  it('글자를 칠 때는 저장하지 않고 친 글자가 칸에 남으며, 칸을 벗어날 때 한 번 저장한다', () => {
    const onSave = vi.fn();
    render(TEXT, 'old', onSave);
    focus(input());
    typeInto(input(), 'olda');
    typeInto(input(), 'oldab');

    expect(onSave).not.toHaveBeenCalled();
    expect(input().value).toBe('oldab');

    blur(input());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('oldab');
  });

  it('Enter는 한 번만 저장하고(숫자는 number로), 이어지는 blur가 다시 저장하지 않는다', () => {
    const onSave = vi.fn();
    render(NUMBER, 5, onSave);
    focus(input());
    typeInto(input(), '4');
    typeInto(input(), '42');
    expect(onSave).not.toHaveBeenCalled();

    pressEnter(input());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(42);

    blur(input());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('한글 조합 중 Enter(isComposing)는 칸을 벗어나지도 저장하지도 않고, 이어지는 Enter 한 번에 완성된 값으로 한 번 저장한다', () => {
    const onSave = vi.fn();
    render(TEXT, null, onSave);
    focus(input());
    typeInto(input(), '안녕');

    // Chrome 한글 IME는 조합 중 Enter를 isComposing=true keydown으로 먼저 보낸다
    pressEnter(input(), { isComposing: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());

    // 조합이 끝난 뒤 이어서 오는 일반 Enter keydown이 한 번 저장한다
    pressEnter(input());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('안녕');
  });

  it('값을 바꾸지 않고 칸을 벗어나면 저장하지 않는다', () => {
    const onSave = vi.fn();
    render(URL_FIELD, 'https://a.test', onSave);
    focus(input());
    blur(input());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('바깥 값이 바뀌면(저장 뒤 되돌리기 등) 칸이 따라가되, 입력 중인 글자는 덮지 않는다', () => {
    const onSave = vi.fn();
    render(TEXT, 'old', onSave);
    focus(input());
    typeInto(input(), 'draft');

    render(TEXT, 'server', onSave); // 입력 중 도착한 재조회 값
    expect(input().value).toBe('draft');

    blur(input());
    expect(onSave).toHaveBeenLastCalledWith('draft');

    render(TEXT, 'draft', onSave); // 부모의 낙관적 반영
    render(TEXT, 'old', onSave); // 저장 거절 → 되돌리기
    expect(input().value).toBe('old');
  });
});

describe('TaskCustomFieldInput — checkbox/select는 고르는 즉시 저장', () => {
  it('checkbox 클릭과 select 변경이 곧바로 한 번씩 저장된다', () => {
    const onSave = vi.fn();
    render(CHECKBOX, false, onSave);
    act(() => { input().click(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(true);

    const onSelect = vi.fn();
    render(SELECT, null, onSelect);
    const select = container.querySelector('select');
    act(() => {
      select.value = 'M';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('M');
  });
});
