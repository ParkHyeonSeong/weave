import { describe, it, expect } from 'vitest';
import { pickArrowUpTarget } from '@/components/Canvas/extensions/taskRefArrowUp';

// 줄 높이 22px. 칩 조각은 줄 박스 전체(20px), 글자는 그 안쪽(16px)을 차지한다고 둔다.
const chip = (line, left, chipStart) => ({ top: line * 22, bottom: line * 22 + 20, left, chipStart });
const text = (line, left) => ({ top: line * 22 + 2, bottom: line * 22 + 18, left, chipStart: null });
const caretAt = (line, left) => ({ top: line * 22 + 2, bottom: line * 22 + 18, left });

describe('pickArrowUpTarget', () => {
  it('두 줄로 접힌 칩 뒤(둘째 줄)에서는 그 칩 앞을 돌려준다', () => {
    expect(pickArrowUpTarget([chip(0, 0, 5), chip(1, 0, 5)], caretAt(1, 80))).toBe(5);
  });

  it('문단 첫 줄이면 null — 브라우저 기본 이동', () => {
    expect(pickArrowUpTarget([chip(0, 0, 5), chip(1, 0, 5)], caretAt(0, 10))).toBeNull();
  });

  it('윗줄에 글자가 있으면 null — 브라우저 기본 이동', () => {
    expect(pickArrowUpTarget([text(0, 0), chip(0, 30, 7), chip(1, 0, 7)], caretAt(1, 80))).toBeNull();
  });

  it('세 줄 칩의 셋째 줄에서는 가운데 줄을 건너 그 칩 앞을 돌려준다', () => {
    expect(pickArrowUpTarget([chip(0, 0, 9), chip(1, 0, 9), chip(2, 0, 9)], caretAt(2, 60))).toBe(9);
  });

  it('칩 뒤에 글자가 이어진 줄이어도 윗줄이 칩뿐이면 그 칩 앞', () => {
    expect(pickArrowUpTarget([chip(0, 0, 5), chip(1, 0, 5), text(1, 80)], caretAt(1, 110))).toBe(5);
  });

  it('윗줄의 칩 앞 자리 중 커서 가로 위치에 가장 가까운 칩 앞 — 같은 거리면 앞 칩', () => {
    const items = [chip(0, 0, 3), chip(0, 120, 4), chip(1, 0, 4)];
    expect(pickArrowUpTarget(items, caretAt(1, 200))).toBe(4);
    expect(pickArrowUpTarget(items, caretAt(1, 80))).toBe(4); // 앞 칩 조각(0~120) 위여도 다음 칩 앞(120)이 더 가깝다
    expect(pickArrowUpTarget(items, caretAt(1, 60))).toBe(3); // 0과 120에서 같은 거리 — 앞 칩
  });

  it('윗줄이 앞 칩의 끝 조각과 붙은 다음 칩의 첫 조각이면 두 줄 위(앞 칩 앞)로 건너뛰지 않고 다음 칩 앞', () => {
    const items = [chip(0, 0, 3), chip(1, 0, 3), chip(1, 150, 4), chip(2, 0, 4)];
    expect(pickArrowUpTarget(items, caretAt(2, 80))).toBe(4);
  });
});
