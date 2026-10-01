// @vitest-environment jsdom
//
// 트랙은 태스크 상태를 **그 태스크 브랜치의 실제 워크플로우**로 그려야 한다.
// 예전에는 TrackDetail이 mockData의 가짜 상태표(todo/in_progress/review/done/blocked, 영어 라벨)를
// 네 화면(플로우 카드·타임라인 막대·트리 알약·오른쪽 상세)에 넘겨서, 브랜치 기본 상태 '취소됨'과
// 커스텀 상태('QA')는 빈 알약·키 이름·회색으로, 이름을 바꾼 '진행 중'은 mock의 'In Progress'·주황으로 보였다.
// 서버 items는 이미 status_label/status_color/status_category를 내려준다(backend track_item.find_by_track).
// 이 파일은 실제 컨테이너(TrackDetail)를 API 응답으로 열어 네 화면을 사용자가 보는 그대로 확인한다.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import postcss from 'postcss';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: { id: '7' }, push: () => {} }),
}));
vi.mock('@/library/_axios', () => ({
  getBaseURL: () => '',
  axios: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import i18next from '@/library/i18n';
import TrackDetail from '@/components/Track/TrackDetail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// React Flow는 jsdom에 없는 ResizeObserver로 노드 크기를 잰다(없으면 마운트가 깨진다).
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const TRACK_ID = 7;
const task = (id, title, status, label, color, category) => ({
  item_id: id, source_type: 'task', position_x: id * 320, position_y: 0,
  layer_id: null, virtual_parent_id: null, restricted: false,
  task_id: 100 + id, branch_id: 1, branch_key: 'AL', branch_color: '#2563EB', branch_icon: null,
  branch_name: 'Alpha', display_id: `AL-${id}`, title, description: '', priority: 'medium',
  start_date: '2026-09-01', due_date: '2026-09-10',
  status, status_label: label, status_color: color, status_category: category,
  parent: null, subtask_total: 0, subtask_done: 0, assignees: [], other_tracks: [],
});
// 이름을 바꾼 기본 상태 · 커스텀 상태 · 완료 계열 커스텀 상태 · 브랜치 기본 '취소됨'(mock 표에 없던 키)
const ITEMS = [
  task(1, '결제 API', 'in_progress', '진행 중', '#2563EB', 'in_progress'),
  task(2, '회귀 테스트', 'qa', 'QA', '#7C3AED', 'in_progress'),
  task(3, '스테이징 배포', 'deployed', '배포 완료', '#0D9488', 'done'),
  task(4, '구 결제 모듈', 'cancelled', '취소됨', '#DC2626', 'cancelled'),
];
// 권한 없는 브랜치의 항목 — 서버가 상태·제목을 아예 내려주지 않는다.
const RESTRICTED = {
  item_id: 9, source_type: 'task', position_x: 0, position_y: 400,
  layer_id: null, virtual_parent_id: null, restricted: true, restricted_hint: 'Secret Ops',
};
// 완료·취소 계열(category)만 흐린다 — 상태 키가 아니라 카테고리가 기준이다.
const DIM = { done: 'cat-done', cancelled: 'cat-cancelled' };
const expectedDim = (it, block) => (DIM[it.status_category] ? [`${block}--${DIM[it.status_category]}`] : []);
const expectedLabels = () => ITEMS.map((it) => ({ title: it.title, label: it.status_label, color: it.status_color }));

const RESPONSES = {
  [`/tracks/${TRACK_ID}`]: {
    status: true,
    track: {
      track_id: TRACK_ID, track_name: '결제 출시', description: '', color: '#5E6AD2', icon: null,
      my_role: 'owner',
      participating_branches: [
        { branch_id: 1, display_name: 'Alpha', branch_key: 'AL', color: '#2563EB', icon: null },
      ],
    },
  },
  [`/tracks/${TRACK_ID}/members`]: { status: true, members: [] },
  '/branches': { status: true, branches: [] },
  [`/tracks/${TRACK_ID}/items`]: { status: true, items: [...ITEMS, RESTRICTED] },
  [`/tracks/${TRACK_ID}/links`]: { status: true, links: [] },
};
get.mockImplementation(async (url) => ({ data: RESPONSES[url] ?? { status: false } }));

let root = null;
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
  document.body.innerHTML = '';
  localStorage.clear();
  await i18next.changeLanguage('en');
});

// 사용자가 트랙을 연다 — 마지막으로 본 화면(view)이 복원된 상태로.
async function openTrack(view, lng = 'ko') {
  await i18next.changeLanguage(lng);
  localStorage.setItem(`track:${TRACK_ID}:lastView`, view);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<TrackDetail />); });
  // 초기 로드(Promise.all)와 사이드바 조회가 끝날 때까지 흘려보낸다.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const treeRow = (title) => [...document.querySelectorAll('.TrackTree__Row')]
  .find((r) => r.querySelector('.TrackTree__TaskTitle')?.textContent === title);
const dimClasses = (el, block) => [...el.classList]
  .filter((c) => c === `${block}--cat-done` || c === `${block}--cat-cancelled`);
// 알약(라벨 + EntitySolid 점)이 실제로 그린 값. 점 색은 entitySolidStyle이 싣는 --et-solid다.
const pillOf = (scope, pill, dot) => ({
  label: scope?.querySelector(pill)?.textContent ?? null,
  color: scope?.querySelector(dot)?.style.getPropertyValue('--et-solid') || null,
});

describe('트랙 상태 표시 — 브랜치 실제 워크플로우 (mock 상태표 아님)', () => {
  it('트리 — 상태 알약이 태스크의 실제 라벨·색이다 (이름 바꾼 기본·커스텀·완료 계열·취소됨)', async () => {
    await openTrack('tree');
    const seen = ITEMS.map((it) => ({
      title: it.title,
      ...pillOf(treeRow(it.title), '.TrackTree__StatusPill', '.TrackTree__StatusDot'),
    }));
    expect(seen).toEqual(expectedLabels());
    // 권한 없는 브랜치 행은 그대로 가려진다 — 상태 알약·제목이 없다.
    const restricted = document.querySelector('.TrackTree__Row--restricted');
    expect(restricted.textContent).toContain('Secret Ops');
    expect(restricted.querySelector('.TrackTree__StatusPill')).toBeNull();
    expect(restricted.querySelector('.TrackTree__TaskTitle')).toBeNull();
  });

  it('오른쪽 상세 — 행을 누르면 같은 라벨·색이고, 권한 없는 항목은 가려진 채다', async () => {
    await openTrack('tree');
    const seen = [];
    for (const it of ITEMS) {
      await act(async () => { treeRow(it.title).click(); });
      const panel = document.querySelector('aside.TrackDetail');
      seen.push({
        title: panel.querySelector('.TrackDetail__Title')?.textContent ?? null,
        ...pillOf(panel, '.TrackDetail__StatusPill', '.TrackDetail__StatusDot'),
      });
    }
    expect(seen).toEqual(expectedLabels());
    await act(async () => { document.querySelector('.TrackTree__Row--restricted').click(); });
    const panel = document.querySelector('aside.TrackDetail');
    expect(panel.classList.contains('TrackDetail--restricted')).toBe(true);
    expect(panel.querySelector('.TrackDetail__StatusPill')).toBeNull();
    expect(panel.querySelector('.TrackDetail__Title')).toBeNull();
  });

  it('타임라인 — 막대 상태색이 실제 색이고, 완료·취소 계열 막대만 흐림 클래스가 붙는다', async () => {
    await openTrack('timeline');
    expect(document.querySelectorAll('.TrackTimeline__Bar')).toHaveLength(ITEMS.length);
    const seen = ITEMS.map((it) => {
      const bar = document.querySelector(`.TrackTimeline__Bar[title="${it.title}"]`);
      return {
        title: it.title,
        color: bar?.style.getPropertyValue('--status-color') || null,
        dim: bar ? dimClasses(bar, 'TrackTimeline__Bar') : null,
      };
    });
    expect(seen).toEqual(ITEMS.map((it) => ({
      title: it.title, color: it.status_color, dim: expectedDim(it, 'TrackTimeline__Bar'),
    })));
  });

  it('플로우 — 카드가 실제 라벨·색을 그리고, 완료·취소 계열 카드만 흐림 클래스가 붙는다', async () => {
    await openTrack('flow');
    const cards = [...document.querySelectorAll('.TrackNode:not(.TrackNode--restricted)')];
    expect(cards).toHaveLength(ITEMS.length);
    const seen = ITEMS.map((it) => {
      const card = cards.find((c) => c.querySelector('.TrackNode__Title')?.textContent === it.title);
      return {
        title: it.title,
        label: card?.querySelector('.TrackNode__StatusLabel')?.textContent ?? null,
        color: card?.querySelector('.TrackNode__StatusDot')?.style.background || null,
        dim: card ? dimClasses(card, 'TrackNode') : null,
      };
    });
    expect(seen).toEqual(ITEMS.map((it) => ({
      title: it.title, label: it.status_label, color: hexToRgb(it.status_color),
      dim: expectedDim(it, 'TrackNode'),
    })));
    // 권한 없는 카드는 자물쇠 카드 그대로 — 상태·제목이 없고 흐림 클래스도 없다.
    const locked = document.querySelector('.TrackNode--restricted');
    expect(locked.textContent).toContain('Secret Ops');
    expect(locked.querySelector('.TrackNode__Status')).toBeNull();
    expect(locked.querySelector('.TrackNode__Title')).toBeNull();
    expect(dimClasses(locked, 'TrackNode')).toEqual([]);
  });

  it('영어 UI에서도 브랜치 라벨 그대로다 — 앱 언어로 바꾸거나 mock 영어 라벨로 덮지 않는다', async () => {
    await openTrack('tree', 'en');
    const seen = ITEMS.map((it) => ({
      title: it.title,
      ...pillOf(treeRow(it.title), '.TrackTree__StatusPill', '.TrackTree__StatusDot'),
    }));
    expect(seen).toEqual(expectedLabels());
  });
});

// 흐림은 SCSS가 칠한다 — jsdom은 스타일시트를 적용하지 않으므로 컴파일 결과에서 규칙을 확인한다.
describe('흐림 규칙은 상태 키가 아니라 카테고리 클래스에 걸린다 (track.scss)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const css = compile(resolve(HERE, '../styles/components/track/track.scss')).css;
  const rules = [];
  postcss.parse(css).walkRules((r) => rules.push(r));
  const opacityOf = (sel) => rules
    .filter((r) => r.selectors.includes(sel))
    .flatMap((r) => r.nodes.filter((d) => d.type === 'decl' && d.prop === 'opacity').map((d) => d.value));

  it.each([
    '.TrackTimeline__Bar--cat-done',
    '.TrackTimeline__Bar--cat-cancelled',
    '.TrackNode--cat-done',
    '.TrackNode--cat-cancelled',
  ])('%s는 흐려진다', (sel) => {
    expect(opacityOf(sel)).toEqual(['0.62']);
  });

  it('상태 키 done 막대에 걸린 흐림 규칙은 없다 — 완료 계열 커스텀 상태가 빠지던 원인', () => {
    expect(opacityOf('.TrackTimeline__Bar--done')).toEqual([]);
  });
});
