import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { fetchFreshRefStatus } from '@/library/refHydration';

// 붙여넣은(드롭 포함) 태스크·이슈 칩을 서버의 현재 상태로 맞춘다.
// 칩 attrs는 삽입 시점 스냅샷이고 화면의 최신 상태는 refHydration이 DOM만 덧칠한 것이라,
// 복사하면 옛 스냅샷이 클립보드로 간다. 붙여넣은 직후 /ref-status로 다시 물어 문서 attrs를
// 갱신하면 협업자 화면과 저장본에도 최신값이 남는다.
// 갱신 트랜잭션은 undo 이력에서 뺀다 — 응답이 늦어도 Cmd+Z 한 번에 붙여넣기 전체가 취소된다.

const REFRESHERS = {
  taskRef: {
    idAttr: 'taskId',
    kind: 'tasks',
    fields: (info) => ({
      displayId: info.display_id,
      title: info.title,
      status: info.status,
      statusLabel: info.status_label || null,
      statusColor: info.status_color || null,
      statusCategory: info.status_category || null,
    }),
  },
  issueRef: {
    idAttr: 'issueId',
    kind: 'issues',
    fields: (info) => ({ title: info.title, status: info.status }),
  },
};

function collectRefIds(fragment) {
  const ids = { tasks: new Set(), issues: new Set() };
  fragment.descendants((node) => {
    const r = REFRESHERS[node.type.name];
    if (r && node.attrs[r.idAttr]) ids[r.kind].add(node.attrs[r.idAttr]);
  });
  return ids;
}

async function refreshRefs(view, ids) {
  let data;
  try {
    data = await fetchFreshRefStatus({ task_ids: [...ids.tasks], issue_ids: [...ids.issues] });
  } catch {
    return; // 조회 실패 — 스냅샷을 그대로 둔다(다음 마운트 하이드레이션이 화면은 다시 맞춘다)
  }
  if (view.isDestroyed) return;
  const { tr } = view.state;
  view.state.doc.descendants((node, pos) => {
    const r = REFRESHERS[node.type.name];
    const info = r && data[r.kind][node.attrs[r.idAttr]];
    if (!info) return; // 권한 밖·삭제된 참조는 응답에 없다
    const fresh = r.fields(info);
    if (Object.keys(fresh).some((k) => node.attrs[k] !== fresh[k])) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...fresh });
    }
  });
  if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
}

export const RefPasteRefreshExtension = Extension.create({
  name: 'refPasteRefresh',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('refPasteRefresh'),
        props: {
          // 붙여넣기·드롭 조각이 문서에 들어가기 직전에 불린다. 조회는 비동기라 삽입 뒤에 반영된다.
          transformPasted(slice, view) {
            const ids = collectRefIds(slice.content);
            if (ids.tasks.size || ids.issues.size) refreshRefs(view, ids);
            return slice;
          },
        },
      }),
    ];
  },
});
