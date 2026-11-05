// 전날 할 일 가져오기 — 끝난 항목 빼기 (스펙 §6.4·§8). ProseMirror JSON만 다루는 순수 함수라 DOM이 필요 없다.
import { describe, it, expect } from 'vitest';
import { FINISHED_CATEGORIES, collectTaskIds, stripFinishedItems } from './scrumCarryOver';

// --- JSON 픽스처 빌더 (yXmlFragmentToProsemirrorJSON이 돌려주는 모양) ---
const text = (t) => ({ type: 'text', text: t });
const chip = (id) => ({ type: 'taskRef', attrs: { taskId: id, branchId: 7, displayId: `WV-${id}`, title: `태스크 ${id}` } });
const para = (...inline) => ({ type: 'paragraph', content: inline });
const item = (...children) => ({ type: 'listItem', content: children });
const list = (...items) => ({ type: 'bulletList', content: items });
const check = (checked, ...children) => ({ type: 'taskItem', attrs: { checked }, content: children });
const checklist = (...items) => ({ type: 'taskList', content: items });
const doc = (...blocks) => ({ type: 'doc', content: blocks });
// 태스크 칩 하나만 있는 목록 항목 (+ 하위 목록)
const task = (id, ...subLists) => item(para(chip(id)), ...subLists);

describe('FINISHED_CATEGORIES', () => {
  it('done과 cancelled만 끝난 분류다', () => {
    expect([...FINISHED_CATEGORIES].sort()).toEqual(['cancelled', 'done']);
  });
});

describe('stripFinishedItems', () => {
  it('완료된 하위 항목만 빠지고 부모는 남는다', () => {
    const input = doc(list(task(156, list(task(184)))));
    const { doc: out, removed } = stripFinishedItems(input, { 156: 'in_progress', 184: 'done' });
    expect(removed).toBe(1);
    expect(out).toEqual(doc(list(task(156)))); // 비게 된 하위 목록 노드도 없다
  });

  it('부모가 완료여도 진행 중 하위가 있으면 둘 다 남는다', () => {
    const input = doc(list(task(156, list(task(184)))));
    const { doc: out, removed } = stripFinishedItems(input, { 156: 'done', 184: 'in_progress' });
    expect(removed).toBe(0);
    expect(out).toEqual(input);
  });

  it('부모·하위 모두 완료면 둘 다 빠지고 빈 목록도 사라진다', () => {
    const input = doc(para(text('오늘 할 일')), list(task(156, list(task(184)))));
    const { doc: out, removed } = stripFinishedItems(input, { 156: 'done', 184: 'done' });
    expect(removed).toBe(2);
    expect(out).toEqual(doc(para(text('오늘 할 일'))));
    expect(JSON.stringify(out)).not.toContain('bulletList');
  });

  it('전부 끝난 문서는 내용이 빈 문서가 된다', () => {
    const { doc: out, removed } = stripFinishedItems(doc(list(task(1), task(2))), { 1: 'done', 2: 'cancelled' });
    expect(removed).toBe(2);
    expect(out).toEqual({ type: 'doc', content: [] });
  });

  it('칩 뒤에 글자가 붙은 항목은 완료여도 남긴다', () => {
    const input = doc(list(item(para(chip(1), text(' 끝내고 배포')))));
    const { doc: out, removed } = stripFinishedItems(input, { 1: 'done' });
    expect(removed).toBe(0);
    expect(out).toEqual(input);
  });

  it('칩 앞뒤의 공백뿐인 글자는 칩 하나로 본다', () => {
    const input = doc(list(item(para(text(' '), chip(1), text('  ')))));
    const { removed } = stripFinishedItems(input, { 1: 'done' });
    expect(removed).toBe(1);
  });

  it('칩이 둘이거나 태스크 칩이 아닌 항목은 남긴다', () => {
    const issue = { type: 'issueRef', attrs: { issueId: 9, taskId: 1 } }; // 이슈 칩도 소속 태스크의 taskId를 들고 있다
    const input = doc(list(item(para(chip(1), chip(2))), item(para(issue)), item(para(text('글자만')))));
    const { doc: out, removed } = stripFinishedItems(input, { 1: 'done', 2: 'done' });
    expect(removed).toBe(0);
    expect(out).toEqual(input);
  });

  it('조회 안 된 id는 남긴다', () => {
    const input = doc(list(task(1), task(2)));
    const { doc: out, removed } = stripFinishedItems(input, { 999: 'done' }); // 1·2는 응답에 없음(삭제·권한 밖)
    expect(removed).toBe(0);
    expect(out).toEqual(input);
  });

  it('cancelled도 끝난 항목이다', () => {
    const { doc: out, removed } = stripFinishedItems(doc(list(task(1), task(2))), { 1: 'cancelled', 2: 'todo' });
    expect(removed).toBe(1);
    expect(out).toEqual(doc(list(task(2))));
  });

  it('형제 항목은 각자 판단한다', () => {
    const input = doc(list(task(1), task(2), task(3)));
    const { doc: out, removed } = stripFinishedItems(input, { 1: 'done', 2: 'in_progress', 3: 'done' });
    expect(removed).toBe(2);
    expect(out).toEqual(doc(list(task(2))));
  });

  it('여러 단계 중첩도 아래부터 정리한다', () => {
    // 1(done) > 2(done) > 3(in_progress): 3이 남으니 2도 1도 남는다
    const kept = stripFinishedItems(doc(list(task(1, list(task(2, list(task(3))))))), { 1: 'done', 2: 'done', 3: 'in_progress' });
    expect(kept.removed).toBe(0);
    // 1(in_progress) > 2(done) > 3(done): 2·3이 빠지고 1만 남는다
    const trimmed = stripFinishedItems(doc(list(task(1, list(task(2, list(task(3))))))), { 1: 'in_progress', 2: 'done', 3: 'done' });
    expect(trimmed.removed).toBe(2);
    expect(trimmed.doc).toEqual(doc(list(task(1))));
    // 셋 다 done: 모두 빠진다
    const all = stripFinishedItems(doc(list(task(1, list(task(2, list(task(3))))))), { 1: 'done', 2: 'done', 3: 'done' });
    expect(all.removed).toBe(3);
    expect(all.doc.content).toEqual([]);
  });

  it('번호 목록 안의 하위 목록도 같은 규칙이다', () => {
    const ordered = (...items) => ({ type: 'orderedList', content: items });
    const input = doc(ordered(task(1, ordered(task(2)))));
    const { doc: out, removed } = stripFinishedItems(input, { 1: 'in_progress', 2: 'done' });
    expect(removed).toBe(1);
    expect(out).toEqual(doc(ordered(task(1))));
  });

  it('체크된 taskItem은 빠지고 안 체크된 건 남는다', () => {
    const input = doc(checklist(check(true, para(text('배포'))), check(false, para(text('문서')))));
    const { doc: out, removed } = stripFinishedItems(input, {});
    expect(removed).toBe(1);
    expect(out).toEqual(doc(checklist(check(false, para(text('문서'))))));
  });

  it('모두 체크된 체크리스트는 목록째 사라진다', () => {
    const { doc: out, removed } = stripFinishedItems(doc(checklist(check(true, para(text('a'))), check(true, para(text('b'))))), {});
    expect(removed).toBe(2);
    expect(out.content).toEqual([]);
  });

  it('체크 안 된 taskItem도 첫 문단이 끝난 태스크 칩 하나면 빠진다', () => {
    const input = doc(checklist(check(false, para(chip(1))), check(false, para(chip(2)))));
    const { doc: out, removed } = stripFinishedItems(input, { 1: 'done', 2: 'in_progress' });
    expect(removed).toBe(1);
    expect(out).toEqual(doc(checklist(check(false, para(chip(2))))));
  });

  // 칩 attrs의 statusCategory는 칩을 넣을 때의 스냅숏이다 — 지금 상태(categoryById)로만 판단한다(스펙 §6.4)
  it('칩에 저장된 상태가 아니라 지금 상태로 판단한다', () => {
    const saved = (id, statusCategory) => ({ type: 'taskRef', attrs: { ...chip(id).attrs, statusCategory } });

    const reopened = doc(list(item(para(saved(1, 'done')))));          // 저장 땐 done, 지금은 다시 진행 중 → 남긴다
    expect(stripFinishedItems(reopened, { 1: 'in_progress' })).toEqual({ doc: reopened, removed: 0 });

    const finished = doc(list(item(para(saved(2, 'todo')))));          // 저장 땐 todo, 지금은 done → 뺀다
    const { doc: out, removed } = stripFinishedItems(finished, { 2: 'done' });
    expect(removed).toBe(1);
    expect(out.content).toEqual([]);
  });

  it('칩의 taskId가 문자열 숫자여도 같은 id로 본다', () => {
    const stringId = { type: 'taskRef', attrs: { taskId: '156' } };
    const { removed } = stripFinishedItems(doc(list(item(para(stringId)))), { 156: 'done' });
    expect(removed).toBe(1);
  });

  it('목록 아닌 문단은 그대로이고 입력은 바뀌지 않는다', () => {
    const input = doc(
      para(text('메모 '), chip(1)), // 문단 안의 완료 칩은 건드리지 않는다
      { type: 'paragraph' },        // 내용 없는 문단은 content 키가 없다
      list(task(1, list(task(2))), task(3)),
    );
    const before = structuredClone(input);
    const { doc: out, removed } = stripFinishedItems(input, { 1: 'done', 2: 'done', 3: 'in_progress' });
    expect(input).toEqual(before);
    expect(removed).toBe(2);
    expect(out.content.slice(0, 2)).toEqual(before.content.slice(0, 2));
    expect(out.content[2]).toEqual(list(task(3)));
    // 돌려준 JSON은 입력과 객체를 공유하지 않는다
    expect(out).not.toBe(input);
    expect(out.content[0]).not.toBe(input.content[0]);
    expect(out.content[0].content[1]).not.toBe(input.content[0].content[1]);
  });
});

describe('collectTaskIds', () => {
  it('collectTaskIds는 순서대로 중복 없이', () => {
    const input = doc(
      para(chip(156), text(' 와 '), chip(184)),
      list(task(161, list(task(184)))),
    );
    expect(collectTaskIds(input)).toEqual([156, 184, 161]);
  });

  it('숫자 문자열은 숫자로 받고 0·NaN·없는 id는 버린다', () => {
    const input = doc(para(
      { type: 'taskRef', attrs: { taskId: '42' } },
      { type: 'taskRef', attrs: { taskId: 0 } },
      { type: 'taskRef', attrs: { taskId: 'abc' } },
      { type: 'taskRef', attrs: { taskId: null } },
      { type: 'taskRef' },
      { type: 'issueRef', attrs: { taskId: 7, issueId: 3 } }, // 이슈 칩의 taskId는 세지 않는다
    ));
    expect(collectTaskIds(input)).toEqual([42]);
  });

  it('칩이 없거나 비어 있는 문서는 빈 배열', () => {
    expect(collectTaskIds(doc(para(text('글자만'))))).toEqual([]);
    expect(collectTaskIds({ type: 'doc' })).toEqual([]);
  });
});
