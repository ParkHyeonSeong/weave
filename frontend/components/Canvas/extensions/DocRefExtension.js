import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import DocRefPopup from './DocRefPopup';
import { createRefSuggestionPlugin } from './refSuggestion';
import { numAttr, strAttr } from './refAttr';
import {
  internalOrigin, escapeLinkText, matchInternalLink, refChipsPaused, withPlainLinkTokens, plainLinkNodes, DOC_PATH,
  encodeMarkdownUrl,
} from './refMarkdown';
import { RAW_AUTO_CHIP } from './rawAutoChip';

export const docRefPluginKey = new PluginKey('docRefSuggestion');

const DocRefNode = Node.create({
  name: 'docRef',
  group: 'inline',
  inline: true,
  atom: true,

  // attr 정의·불변식(per-attr 렌더 억제)은 refAttr.js 참고
  addAttributes() {
    return {
      pageId: numAttr('data-page-id'),
      canvasId: numAttr('data-canvas-id'),
      title: strAttr('data-title'),
      canvasName: strAttr('data-canvas-name'),
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-doc-ref]' }];
  },

  // === raw markdown 코덱 (스펙 §3.2) ===
  renderMarkdown(node) {
    if (node.attrs?.[RAW_AUTO_CHIP]) return node.attrs[RAW_AUTO_CHIP]; // 같은 편집에서 원문이 만든 칩 — 원문에 쓴 그대로(rawAutoChip.js)
    const { canvasId, pageId, title } = node.attrs || {};
    return `[${escapeLinkText(title)}](${encodeMarkdownUrl(`${internalOrigin()}/canvas/${canvasId}/${pageId}`)})`;
  },
  markdownTokenizer: {
    name: 'docRef',
    level: 'inline',
    start: (src) => src.indexOf('['),
    tokenize(src, tokens, helper) {
      const link = !refChipsPaused() && matchInternalLink(src);
      if (!link) return undefined;
      const m = link.pathname.match(DOC_PATH);
      if (!m) return undefined;
      return withPlainLinkTokens({ type: 'docRef', raw: link.raw, canvasId: Number(m[1]), pageId: Number(m[2]), title: link.text }, helper);
    },
  },
  parseMarkdown(token, h) {
    // 원문 모드에서 이 자리가 원래 일반 링크였으면 일반 링크로 (refMarkdown.withRawLinkForms)
    return plainLinkNodes(token, h)
      || h.createNode('docRef', { canvasId: token.canvasId, pageId: token.pageId, title: token.title });
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-doc-ref': 'true',
        'data-page-id': node.attrs.pageId,
        'data-canvas-id': node.attrs.canvasId,
        'data-title': node.attrs.title,
        'data-canvas-name': node.attrs.canvasName,
        class: 'doc-ref',
      }),
      node.attrs.title,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'doc-ref';
      dom.contentEditable = 'false';
      dom.setAttribute('data-doc-ref', 'true');
      dom.setAttribute('data-canvas-id', node.attrs.canvasId);
      dom.setAttribute('data-page-id', node.attrs.pageId);
      dom.textContent = node.attrs.title;
      dom.title = `${node.attrs.canvasName} > ${node.attrs.title}`;

      dom.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('canvas:ref_click', {
          detail: { type: 'doc', data: { canvasId: node.attrs.canvasId, pageId: node.attrs.pageId } },
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
        pluginKey: docRefPluginKey,
        Popup: DocRefPopup,
        buildProps: (st, { close, dismiss, backToMenu, insertRefNode }) => ({
          onClose: close,
          onDismiss: dismiss,
          onBack: backToMenu,
          onSelect: (doc) => insertRefNode('docRef', {
            pageId: doc.page_id,
            canvasId: doc.canvas_id,
            title: doc.title,
            canvasName: doc.canvas_name,
          }),
        }),
      }),
    ];
  },
});

export default DocRefNode;
