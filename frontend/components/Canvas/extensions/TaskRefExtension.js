import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import TaskRefPopup from './TaskRefPopup';
import { createRefSuggestionPlugin } from './refSuggestion';
import { TaskRefArrowUp } from './taskRefArrowUp';
import { numAttr, strAttr } from './refAttr';
import { entityTintStyle } from '@/library/entityTint';
import {
  internalOrigin, formatRefLabel, matchInternalLink, splitRefLinkText, ISSUE_PATH, TASK_PATH, encodeMarkdownUrl,
  refChipsPaused, withPlainLinkTokens, plainLinkNodes,
} from './refMarkdown';
import { RAW_AUTO_CHIP } from './rawAutoChip';

export const taskRefPluginKey = new PluginKey('taskRefSuggestion');

// snake_case key를 Title Case로 변환 (fallback용)
const formatStatusKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// 태스크 레퍼런스 인라인 노드
const TaskRefNode = Node.create({
  name: 'taskRef',
  group: 'inline',
  inline: true,
  atom: true,

  // 여러 줄로 접힌 칩 위로 ↑ / Shift+↑ 를 누를 때의 커서 보정 — 이 칩을 쓰는 모든 편집기에 함께 등록된다
  addExtensions() {
    return [TaskRefArrowUp];
  },

  // attr 정의·불변식(per-attr 렌더 억제)은 refAttr.js 참고
  addAttributes() {
    return {
      taskId: numAttr('data-task-id'),
      branchId: numAttr('data-branch-id'),
      displayId: strAttr('data-display-id'),
      title: strAttr('data-title'),
      status: strAttr('data-status', 'todo'),
      priority: strAttr('data-priority', 'medium'),
      statusLabel: strAttr('data-status-label', null),
      statusColor: strAttr('data-status-color', null),
      statusCategory: strAttr('data-status-category', null),
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-task-ref]' }];
  },

  // === raw markdown 코덱 (스펙 §3.2): 칩 ↔ 내부 URL 링크 ===
  renderMarkdown(node) {
    if (node.attrs?.[RAW_AUTO_CHIP]) return node.attrs[RAW_AUTO_CHIP]; // 같은 편집에서 원문이 만든 칩 — 원문에 쓴 그대로(rawAutoChip.js)
    const { branchId, taskId, displayId, title } = node.attrs || {};
    return `[${formatRefLabel(displayId, title)}](${encodeMarkdownUrl(`${internalOrigin()}/branch/${branchId}/task/${taskId}`)})`;
  },
  markdownTokenizer: {
    name: 'taskRef',
    level: 'inline',
    start: (src) => src.indexOf('['),
    tokenize(src, tokens, helper) {
      const link = !refChipsPaused() && matchInternalLink(src);
      if (!link) return undefined;
      // issue 경로가 더 구체적 — issueRef 토크나이저 몫 (스키마에 없으면 일반 링크로 강등)
      if (ISSUE_PATH.test(link.pathname)) return undefined;
      const m = link.pathname.match(TASK_PATH);
      if (!m) return undefined;
      const { displayId, title } = splitRefLinkText(link.text);
      return withPlainLinkTokens({ type: 'taskRef', raw: link.raw, branchId: Number(m[1]), taskId: Number(m[2]), displayId, title }, helper);
    },
  },
  parseMarkdown(token, h) {
    // 원문 모드에서 진입 때 일반 링크였던 자리는 일반 링크 그대로, 새 태스크 링크는 칩(이슈·문서와 같은 규칙 — refMarkdown)
    return plainLinkNodes(token, h) || h.createNode('taskRef', {
      taskId: token.taskId, branchId: token.branchId, displayId: token.displayId, title: token.title,
    });
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.statusLabel || formatStatusKey(node.attrs.status);
    const category = node.attrs.statusCategory || node.attrs.status;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-task-ref': 'true',
        'data-task-id': node.attrs.taskId,
        'data-branch-id': node.attrs.branchId,
        'data-display-id': node.attrs.displayId,
        'data-title': node.attrs.title,
        'data-status': node.attrs.status,
        'data-priority': node.attrs.priority,
        'data-status-label': node.attrs.statusLabel || '',
        'data-status-color': node.attrs.statusColor || '',
        'data-status-category': node.attrs.statusCategory || '',
        class: 'task-ref',
      }),
      `${node.attrs.displayId} ${node.attrs.title}`,
      ['span', {
        class: `ref-chip__badge ref-chip__badge--${category}`,
        'data-ref-badge': 'true',
        ...(node.attrs.statusColor ? { style: `background-color: ${node.attrs.statusColor}20; color: ${node.attrs.statusColor}` } : {}),
      }, label],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'task-ref';
      dom.contentEditable = 'false';
      dom.setAttribute('data-task-ref', 'true');
      dom.setAttribute('data-branch-id', node.attrs.branchId);
      dom.setAttribute('data-task-id', node.attrs.taskId);
      dom.title = `${node.attrs.displayId} - ${node.attrs.title}`;

      dom.appendChild(document.createTextNode(`${node.attrs.displayId} ${node.attrs.title}`));

      const label = node.attrs.statusLabel || formatStatusKey(node.attrs.status);
      const category = node.attrs.statusCategory || node.attrs.status;
      const badge = document.createElement('span');
      badge.className = `ref-chip__badge ref-chip__badge--${category}`;
      badge.textContent = label;
      // ⚠️ 위 renderHTML(:87)은 **저장 직렬화**라 손대지 않는다. 여기는 라이브 노드뷰다.
      // 이 배지의 부모는 문서 표면이 아니라 **칩 자신의 배경**(--color-primary-subtle 합성)이다.
      // 읽기 경로(refHydration.setBadge)와 반드시 같은 프로파일을 써야 두 경로가 같은 색을 낸다.
      const tint = entityTintStyle(node.attrs.statusColor, { alpha: '20', surface: 'task-ref' });
      if (tint) {
        // 커스텀 프로퍼티는 존재하는 것만 내린다. passthrough 객체에는 `--et-*`가 아예 없어
        // 이 루프가 0회 돌고, CSSOM은 커스텀 프로퍼티를 항상 받아주므로 조용한 실패가 없다.
        for (const [k, v] of Object.entries(tint)) {
          if (k.startsWith('--')) badge.style.setProperty(k, v);
        }
        // 일반 선언은 supported·passthrough 둘 다 적용한다.
        badge.style.background = tint.background;   // themed 'var(--et-bg)' / passthrough `<색>20`
        badge.style.color = tint.color;             // themed 'var(--et-fg)' / passthrough 원 색
      }
      // ⛔ `if (tint)` 안에서 무조건 add 하면 passthrough 배지에도 EntityTint가 붙어
      //    다크에서 `var(--et-bg-dark, transparent)`가 이기고 오늘 살아 있던 색이 지워진다.
      //    판정은 --et-on 하나뿐이다(refHydration.js setBadge와 같은 계약).
      badge.classList.toggle('EntityTint', !!tint?.['--et-on']);
      badge.setAttribute('data-ref-badge', 'true');
      dom.appendChild(badge);

      // 클릭 시 미리보기 패널 이벤트 발행
      dom.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('canvas:ref_click', {
          detail: { type: 'task', data: { branchId: node.attrs.branchId, taskId: node.attrs.taskId } },
        }));
      });

      return {
        dom,
        selectNode() { dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
      };
    };
  },

  addProseMirrorPlugins() {
    return [
      createRefSuggestionPlugin({
        editor: this.editor,
        pluginKey: taskRefPluginKey,
        Popup: TaskRefPopup,
        buildProps: (st, { close, dismiss, backToMenu, insertRefNode }) => ({
          mode: st.mode,
          onClose: close,
          onDismiss: dismiss,
          onBack: backToMenu,
          onSelect: (task) => insertRefNode('taskRef', {
            taskId: task.task_id,
            branchId: task.branch_id,
            displayId: task.display_id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            statusLabel: task.status_label || null,
            statusColor: task.status_color || null,
            statusCategory: task.status_category || null,
          }),
        }),
      }),
    ];
  },
});

export default TaskRefNode;
