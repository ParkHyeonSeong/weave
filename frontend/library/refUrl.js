// ref 칩(task/doc/issue)이 가리키는 전체 페이지 경로의 단일 소스.
// RefPreviewPanel의 새 탭/네비 버튼, 그리고 DOM 칩의 가운데/ctrl·cmd 클릭 새 탭 핸들러가 함께 쓴다.
export function getRefUrl(type, data = {}) {
  const { branchId, taskId, issueId, canvasId, pageId } = data;
  if (type === 'task') return branchId && taskId ? `/branch/${branchId}/task/${taskId}` : null;
  if (type === 'issue') {
    return branchId && taskId && issueId
      ? `/branch/${branchId}/task/${taskId}/issue/${issueId}`
      : null;
  }
  if (type === 'doc') return canvasId && pageId ? `/canvas/${canvasId}/${pageId}` : null;
  return null;
}

// dangerouslySetInnerHTML로 주입된 ref 칩 <span data-*-ref ...> 에서 {type, data} 디스크립터를 읽는다.
// 칩은 실제 <a>가 아니므로(저장된 본문 HTML) 델리게이트 가운데/ctrl클릭 핸들러가 이걸로 URL을 만든다.
export function refFromChipEl(el) {
  if (!el || typeof el.hasAttribute !== 'function') return null;
  if (el.hasAttribute('data-task-ref')) {
    return {
      type: 'task',
      data: { branchId: el.getAttribute('data-branch-id'), taskId: el.getAttribute('data-task-id') },
    };
  }
  if (el.hasAttribute('data-issue-ref')) {
    return {
      type: 'issue',
      data: {
        branchId: el.getAttribute('data-branch-id'),
        taskId: el.getAttribute('data-task-id'),
        issueId: el.getAttribute('data-issue-id'),
      },
    };
  }
  if (el.hasAttribute('data-doc-ref')) {
    return {
      type: 'doc',
      data: { canvasId: el.getAttribute('data-canvas-id'), pageId: el.getAttribute('data-page-id') },
    };
  }
  return null;
}

// 칩 엘리먼트가 가리키는 URL을 바로 반환(없으면 null). 델리게이트 핸들러 편의 함수.
export function refUrlFromChipEl(el) {
  const ref = refFromChipEl(el);
  return ref ? getRefUrl(ref.type, ref.data) : null;
}

const CHIP_SELECTOR = '[data-task-ref],[data-doc-ref],[data-issue-ref]';

// 읽기 화면(저장된 HTML)의 ref 칩 좌클릭 → 편집기 칩 NodeView와 같은 canvas:ref_click(RefPanelHost가 패널을 연다).
// 서버(MCP·API)가 링크를 칩으로 저장하므로, 전에 클릭되던 링크 자리가 읽기 화면에서도 눌려야 한다.
// 처리했으면 true. 수정 키·가운데 클릭은 attachRefChipAuxNav(새 탭)의 몫이라 건드리지 않는다.
export function openRefChipPanel(event, types = ['task', 'issue', 'doc']) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const el = event.target && event.target.closest ? event.target.closest(CHIP_SELECTOR) : null;
  const ref = el ? refFromChipEl(el) : null;
  if (!ref || !types.includes(ref.type)) return false;
  event.stopPropagation();
  window.dispatchEvent(new CustomEvent('canvas:ref_click', { detail: ref }));
  return true;
}

// 본문 루트의 ref 칩(<span data-*-ref>)에 가운데/ctrl·cmd 클릭 → 새 탭 동작을 위임으로 붙인다.
// 칩은 실제 <a>가 아니라 저장된 HTML의 <span>이라 네이티브 새 탭이 안 되기 때문.
// 칩의 기존 좌클릭 핸들러(패널/네비)는 건드리지 않는다: 가운데는 'auxclick'이라 그 핸들러가 안 듣고,
// ctrl/cmd 클릭은 캡처 단계에서 먼저 가로채 stopPropagation으로 차단한다. 반환값은 해제 함수.
export function attachRefChipAuxNav(root) {
  if (!root || typeof root.addEventListener !== 'function') return () => {};

  const openFor = (target, e) => {
    const el = target && target.closest ? target.closest(CHIP_SELECTOR) : null;
    const url = el ? refUrlFromChipEl(el) : null;
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const onAux = (e) => { if (e.button === 1) openFor(e.target, e); };
  const onClick = (e) => { if (e.button === 0 && (e.metaKey || e.ctrlKey)) openFor(e.target, e); };

  root.addEventListener('auxclick', onAux);
  root.addEventListener('click', onClick, true); // 캡처: 칩 자체 click 핸들러보다 먼저 가로챈다
  return () => {
    root.removeEventListener('auxclick', onAux);
    root.removeEventListener('click', onClick, true);
  };
}
