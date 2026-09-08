import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Pencil, Eye, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderMermaid, nextMermaidId } from './mermaidConfig';
import { useTheme } from '@/library/theme';

// Mermaid DSL 블록 노드
// - source: 원본 mermaid DSL 텍스트 (data-source 속성에 저장)
// - 렌더 시점에 mermaid.render()로 SVG 생성 (저장하지 않음)

function MermaidView({ node, updateAttributes, selected, editor }) {
  const { t } = useTranslation();
  const source = node.attrs.source || '';
  const [mode, setMode] = useState('preview'); // 'preview' | 'edit'
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const [draft, setDraft] = useState(source);
  const { resolved } = useTheme();
  const resolvedRef = useRef(resolved);

  // 큐 태스크가 실행 시점에 읽는다. 렌더 effect보다 **먼저** 선언해 같은 커밋에서 먼저 실행되게 한다.
  useEffect(() => { resolvedRef.current = resolved; }, [resolved]);

  // source 또는 테마 변경 시 SVG 재렌더.
  // ⚠️ 취소 플래그는 effect 실행마다 새로 만든다(지역 let). 이전 구현은 useRef 하나를 공유해서,
  //    cleanup이 true로 세운 직후 새 effect가 false로 되돌렸고 — 아직 떠 있던 이전 비동기 렌더가
  //    그 false를 보고 통과해 최신 결과를 덮어썼다. deps에 resolved가 들어가면 이 경로가
  //    테마 토글마다 확정적으로 열린다.
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setError('');

    (async () => {
      try {
        if (!source.trim()) {
          if (cancelled) return;
          setSvg('');
          setRendering(false);
          return;
        }
        // 테마는 값이 아니라 thunk로 넘긴다 — 큐 실행 시점의 최신 테마로 그려야
        // N개 블록이 rapid toggle 후 같은 테마로 수렴한다.
        const res = await renderMermaid(() => resolvedRef.current, nextMermaidId(), source);
        if (cancelled) return;
        if (!res.ok) {
          setError(t('canvasExt.mermaid.invalidSyntax'));
          setSvg('');
          setRendering(false);
          return;
        }
        setSvg(res.svg);
        setRendering(false);
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || String(e));
        setSvg('');
        setRendering(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, resolved]);

  // edit 모드 진입 시 draft를 현재 source로 리셋
  useEffect(() => {
    if (mode === 'edit') setDraft(source);
  }, [mode, source]);

  const isReadonly = !editor?.isEditable;

  const saveAndPreview = useCallback(() => {
    if (draft !== source) {
      updateAttributes({ source: draft });
    }
    setMode('preview');
  }, [draft, source, updateAttributes]);

  const cancelEdit = useCallback(() => {
    setDraft(source);
    setMode('preview');
  }, [source]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveAndPreview();
    }
  };

  return (
    <NodeViewWrapper
      className={`mermaid-block ${selected ? 'mermaid-block--selected' : ''}`}
    >
      <div contentEditable={false}>
        {/* 툴바: 선택되었거나 편집 모드일 때만 노출 */}
        {!isReadonly && (selected || mode === 'edit') && (
          <div className="mermaid-block__toolbar">
            {mode === 'preview' ? (
              <button
                type="button"
                className="mermaid-block__toolbarBtn"
                onClick={() => setMode('edit')}
                title={t('canvasExt.mermaid.editTitle')}
              >
                <Pencil size={12} />
                <span>{t('common.actions.edit')}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="mermaid-block__toolbarBtn"
                  onClick={saveAndPreview}
                  title={t('canvasExt.mermaid.previewTitle')}
                >
                  <Eye size={12} />
                  <span>{t('canvasExt.mermaid.preview')}</span>
                </button>
                <button
                  type="button"
                  className="mermaid-block__toolbarBtn mermaid-block__toolbarBtn--secondary"
                  onClick={cancelEdit}
                  title={t('canvasExt.mermaid.cancelTitle')}
                >
                  {t('common.actions.cancel')}
                </button>
              </>
            )}
          </div>
        )}

        {mode === 'edit' ? (
          <textarea
            className="mermaid-block__editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoFocus
            placeholder="graph TD&#10;  A[Start] --> B[End]"
          />
        ) : error ? (
          <div className="mermaid-block__error">
            <div className="mermaid-block__errorHeader">
              <AlertTriangle size={14} />
              <span>{t('canvasExt.mermaid.renderError')}</span>
            </div>
            <pre className="mermaid-block__errorMsg">{error}</pre>
            <pre className="mermaid-block__errorSource">{source}</pre>
          </div>
        ) : rendering ? (
          <div className="mermaid-block__loading">{t('canvasExt.mermaid.rendering')}</div>
        ) : svg ? (
          <div
            className="mermaid-block__svg"
            // mermaid는 securityLevel:'strict'에서 출력 SVG를 자체 DOMPurify로 정화한다(mermaidConfig).
            // 별도 sanitizeSvg를 덧씌우면 라벨용 foreignObject(HTML)가 제거돼 다이어그램이 깨지므로 적용하지 않는다.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="mermaid-block__empty">{t('canvasExt.mermaid.empty')}</div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

const MermaidExtension = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-source') || '',
        renderHTML: (attrs) => {
          if (!attrs.source) return { 'data-source': '' };
          return { 'data-source': attrs.source };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-mermaid]',
      },
    ];
  },

  // === raw markdown 코덱 (스펙 §3.2): data-source 원문 ↔ ```mermaid 펜스 ===
  renderMarkdown(node) {
    return '```mermaid\n' + (node.attrs?.source || '') + '\n```';
  },
  markdownTokenizer: {
    name: 'mermaid',
    level: 'block',
    start: (src) => src.indexOf('```mermaid'),
    tokenize(src) {
      const m = /^```mermaid[ \t]*\n([\s\S]*?)\n```[ \t]*(?:\n+|$)/.exec(src);
      if (!m) return undefined;
      return { type: 'mermaid', raw: m[0], source: m[1] };
    },
  },
  parseMarkdown(token, h) {
    return h.createNode('mermaid', { source: token.source });
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-mermaid': 'true',
        class: 'mermaid-block',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },

  addCommands() {
    return {
      insertMermaid:
        (source = 'graph TD\n  A[Start] --> B[End]') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { source },
          });
        },
    };
  },
});

export default MermaidExtension;
