import { useState, useRef, useEffect } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Code,
  List, ListOrdered, ListChecks,
  Quote, Minus, CodeSquare,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Undo2, Redo2, Sigma, Workflow,
  AlignLeft, AlignCenter, AlignRight,
  ChevronDown, Highlighter, Palette,
  Info, AlertTriangle, CheckCircle2, XCircle,
  Type, PaintBucket, CodeXml,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
} from 'lucide-react';
import { TextSelection } from '@tiptap/pm/state';
import { useTranslation } from 'react-i18next';
import { promptSetLink } from '@/library/editorLink';
import { mathEditPluginKey } from './extensions/mathExtensions';

// 프리셋 컬러 팔레트
const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999',
  '#DC2626', '#EA580C', '#D97706', '#16A34A',
  '#2563EB', '#7C3AED', '#DB2777', '#0891B2',
];

const HIGHLIGHT_COLORS = [
  { labelKey: 'canvas.editor.highlightColors.yellow', color: '#FEF08A' },
  { labelKey: 'canvas.editor.highlightColors.green', color: '#BBF7D0' },
  { labelKey: 'canvas.editor.highlightColors.blue', color: '#BFDBFE' },
  { labelKey: 'canvas.editor.highlightColors.pink', color: '#FBCFE8' },
  { labelKey: 'canvas.editor.highlightColors.orange', color: '#FED7AA' },
  { labelKey: 'canvas.editor.highlightColors.purple', color: '#DDD6FE' },
];

const CELL_BG_COLORS = [
  '#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8',
  '#FED7AA', '#DDD6FE', '#E0E7FF', '#F1F5F9',
];

const CODE_LANGUAGES = [
  { value: null, labelKey: 'canvas.editor.plainText', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
];

// 수식 삽입 + 편집 팝오버 즉시 오픈 (/m 슬래시와 동일한 첫 삽입 UX — isNew라 취소 시 노드 제거)
// block 노드는 문단 중간/끝 커서에서 replaceSelectionWith 시 문단이 split되어 삽입된 노드의
// 실제 pos가 삽입 전 커서 위치(from)와 어긋난다(실측 확인, 리스트/테이블/블록쿼트처럼 조상을
// 더 거슬러 올라가는 경우도 있어 고정폭 근방 스캔은 못 찾을 수 있음) — 삽입 tr을 먼저
// 디스패치하고, mapping으로 얻은 앵커에 문서 전체에서 가장 가까운 동일 타입 노드를 찾아
// meta는 별도 tr로 디스패치한다.
const insertMathWithPopover = (editor, kind, latex) => {
  const { state, view } = editor;
  const type = kind === 'block' ? state.schema.nodes.blockMath : state.schema.nodes.inlineMath;
  if (!type) return;
  const from = state.selection.from;
  // 기존 툴바 의미론 유지: 선택 영역이 있어도 지우지 않고 from에 삽입한다
  // (replaceSelectionWith를 그대로 쓰면 선택 텍스트가 삭제되고, isNew 취소는
  // 노드만 제거해 선택했던 텍스트가 유실됨) — 삽입 전 selection을 from으로 collapse.
  // NodeSelection(테이블/블록 전체 선택 등)이면 from이 inline 콘텐츠를 갖지 않는
  // 위치일 수 있어 TextSelection.create 대신 TextSelection.near로 가장 가까운
  // 유효 위치를 찾는다(이 파일의 다른 확장인 refSuggestion.js도 동일 패턴 사용).
  let insertTr = state.tr;
  if (!state.selection.empty) {
    insertTr = insertTr.setSelection(TextSelection.near(state.doc.resolve(from)));
  }
  insertTr = insertTr.replaceSelectionWith(type.create({ latex }), false);
  view.dispatch(insertTr);

  const doc = view.state.doc;
  const anchor = insertTr.mapping.map(from, -1);
  let pos = null;
  let bestDist = Infinity;
  doc.descendants((node, nodePos) => {
    if (node.type !== type) return;
    const dist = Math.abs(nodePos - anchor);
    if (dist < bestDist) { bestDist = dist; pos = nodePos; }
  });
  if (pos == null) return; // 삽입된 노드를 못 찾으면 팝오버를 열지 않는다(침묵 오동작 방지)

  view.dispatch(view.state.tr.setMeta(mathEditPluginKey, { active: true, pos, latex, kind, isNew: true }));
  view.focus();
};

export default function CanvasEditorToolbar({ editor, rawModeEnabled = false, rawModeActive = false, onToggleRawMode }) {
  const { t } = useTranslation();
  const [openDropdown, setOpenDropdown] = useState(null);

  if (!editor) return null;

  // 표면별 feature-detection — 이 툴바는 Canvas 외에 task 설명·issue 에디터도
  // 공유하는데(TaskDescriptionEditor.js:113, IssueEditor.js:56) 그 표면들엔
  // TextStyle/Color/TextAlign 확장이 없어 setColor/setTextAlign이 undefined →
  // 클릭 시 TypeError(실측). image/table/mermaid가 쓰던 extensionManager name
  // 체크(기존 관례)를 이 헬퍼로 일반화해 아래 전부(색상/정렬 포함)에 통일 적용한다.
  // 확장을 표면에 추가하는 안은 md-lossy 서식을 md-canonical 표면으로 확대하는
  // 것이라 기각.
  const hasExtension = (name) => editor.extensionManager.extensions.some((e) => e.name === name);
  const canColor = hasExtension('color');       // Color는 TextStyle과 세트 등록(canvasEditorExtensions.js:54-55)
  const canHighlight = hasExtension('highlight');
  const canTextAlign = hasExtension('textAlign');

  const toggleDropdown = (name) => {
    setOpenDropdown((prev) => (prev === name ? null : name));
  };

  const closeDropdown = () => setOpenDropdown(null);

  // 현재 헤딩 레벨 라벨
  const getHeadingLabel = () => {
    for (let i = 1; i <= 3; i++) {
      if (editor.isActive('heading', { level: i })) return `H${i}`;
    }
    return t('canvas.editor.headingText');
  };

  const addLink = () => promptSetLink(editor);

  const addImage = () => {
    const url = window.prompt(t('canvas.editor.imageUrlPrompt'));
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  const [tableSize, setTableSize] = useState({ rows: 0, cols: 0 });
  const [customTableSize, setCustomTableSize] = useState({ rows: '', cols: '' });

  const addTable = (rows, cols) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    closeDropdown();
  };

  const Btn = ({ onClick, active, children, title, className = '' }) => (
    <button
      type="button"
      className={`CanvasEditorToolbar__Btn ${active ? 'CanvasEditorToolbar__Btn--active' : ''} ${className}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );

  const Sep = () => <div className="CanvasEditorToolbar__Sep" />;

  // raw 모드 중엔 서식 명령이 숨겨진 WYSIWYG doc에 적용돼 무의미 — 토글만 노출.
  // 주의: 위의 useState 3개보다 뒤에 있어야 한다 (rawModeActive가 토글돼도 훅 개수 불변).
  if (rawModeEnabled && rawModeActive) {
    return (
      <div className="CanvasEditorToolbar" onMouseDown={(e) => e.preventDefault()}>
        <Btn onClick={onToggleRawMode} active title={t('canvas.editor.switchToRichText')}>
          <CodeXml size={16} />
        </Btn>
        <span className="CanvasEditorToolbar__RawLabel">{t('canvas.editor.rawModeLabel')}</span>
      </div>
    );
  }

  return (
    <div className="CanvasEditorToolbar" onMouseDown={(e) => e.preventDefault()}>
      {/* 헤딩 드롭다운 */}
      <DropdownWrapper
        isOpen={openDropdown === 'heading'}
        onClose={closeDropdown}
      >
        <button
          type="button"
          className="CanvasEditorToolbar__Dropdown"
          onClick={() => toggleDropdown('heading')}
        >
          <Type size={14} />
          <span>{getHeadingLabel()}</span>
          <ChevronDown size={12} />
        </button>
        {openDropdown === 'heading' && (
          <div className="CanvasEditorToolbar__DropdownMenu">
            <button
              className={`CanvasEditorToolbar__DropdownItem ${!editor.isActive('heading') ? 'CanvasEditorToolbar__DropdownItem--active' : ''}`}
              onClick={() => { editor.chain().focus().setParagraph().run(); closeDropdown(); }}
            >
              <span style={{ fontSize: '14px' }}>{t('canvas.editor.normalText')}</span>
            </button>
            {[1, 2, 3].map((level) => (
              <button
                key={level}
                className={`CanvasEditorToolbar__DropdownItem ${editor.isActive('heading', { level }) ? 'CanvasEditorToolbar__DropdownItem--active' : ''}`}
                onClick={() => { editor.chain().focus().toggleHeading({ level }).run(); closeDropdown(); }}
              >
                <span style={{ fontSize: `${20 - level * 2}px`, fontWeight: 700 }}>{t('canvas.editor.heading', { level })}</span>
              </button>
            ))}
          </div>
        )}
      </DropdownWrapper>

      <Sep />

      {/* 텍스트 서식 */}
      <Btn onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')} title={t('canvas.editor.bold')}>
        <Bold size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')} title={t('canvas.editor.italic')}>
        <Italic size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')} title={t('canvas.editor.underline')}>
        <Underline size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')} title={t('canvas.editor.strikethrough')}>
        <Strikethrough size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive('code')} title={t('canvas.editor.inlineCode')}>
        <Code size={16} />
      </Btn>

      {/* 텍스트 컬러/하이라이트 드롭다운 — 스키마에 있는 섹션만 노출 */}
      {(canColor || canHighlight) && (
        <DropdownWrapper isOpen={openDropdown === 'color'} onClose={closeDropdown}>
          <Btn onClick={() => toggleDropdown('color')} title={canColor ? t('canvas.editor.textColor') : t('canvas.editor.highlight')}>
            <Palette size={16} />
          </Btn>
          {openDropdown === 'color' && (
            <div className="CanvasEditorToolbar__DropdownMenu CanvasEditorToolbar__ColorMenu">
              {canColor && (
                <div className="CanvasEditorToolbar__ColorSection">
                  <span className="CanvasEditorToolbar__ColorLabel">{t('canvas.editor.textSection')}</span>
                  <div className="CanvasEditorToolbar__ColorGrid">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c}
                        className="CanvasEditorToolbar__ColorSwatch"
                        style={{ backgroundColor: c }}
                        onClick={() => { editor.chain().focus().setColor(c).run(); closeDropdown(); }}
                      />
                    ))}
                  </div>
                  <button
                    className="CanvasEditorToolbar__ColorReset"
                    onClick={() => { editor.chain().focus().unsetColor().run(); closeDropdown(); }}
                  >
                    {t('canvas.editor.resetColor')}
                  </button>
                </div>
              )}
              {canHighlight && (
                <div className="CanvasEditorToolbar__ColorSection">
                  <span className="CanvasEditorToolbar__ColorLabel">{t('canvas.editor.highlight')}</span>
                  <div className="CanvasEditorToolbar__ColorGrid">
                    {HIGHLIGHT_COLORS.map((h) => (
                      <button
                        key={h.color}
                        className="CanvasEditorToolbar__ColorSwatch CanvasEditorToolbar__ColorSwatch--highlight"
                        style={{ backgroundColor: h.color }}
                        title={t(h.labelKey)}
                        onClick={() => { editor.chain().focus().toggleHighlight({ color: h.color }).run(); closeDropdown(); }}
                      />
                    ))}
                  </div>
                  <button
                    className="CanvasEditorToolbar__ColorReset"
                    onClick={() => { editor.chain().focus().unsetHighlight().run(); closeDropdown(); }}
                  >
                    {t('canvas.editor.removeHighlight')}
                  </button>
                </div>
              )}
            </div>
          )}
        </DropdownWrapper>
      )}

      <Sep />

      {/* 리스트 */}
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')} title={t('canvas.editor.bulletList')}>
        <List size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')} title={t('canvas.editor.orderedList')}>
        <ListOrdered size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive('taskList')} title={t('canvas.editor.checklist')}>
        <ListChecks size={16} />
      </Btn>

      <Sep />

      {canTextAlign && (
        <>
          {/* 정렬 */}
          <Btn onClick={() => editor.chain().focus().setTextAlign('left').run()}
            active={editor.isActive({ textAlign: 'left' })} title={t('canvas.editor.alignLeft')}>
            <AlignLeft size={16} />
          </Btn>
          <Btn onClick={() => editor.chain().focus().setTextAlign('center').run()}
            active={editor.isActive({ textAlign: 'center' })} title={t('canvas.editor.alignCenter')}>
            <AlignCenter size={16} />
          </Btn>
          <Btn onClick={() => editor.chain().focus().setTextAlign('right').run()}
            active={editor.isActive({ textAlign: 'right' })} title={t('canvas.editor.alignRight')}>
            <AlignRight size={16} />
          </Btn>
          <Sep />
        </>
      )}

      {/* 삽입: 인용, 콜아웃, 코드블록, 구분선 */}
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')} title={t('canvas.editor.quote')}>
        <Quote size={16} />
      </Btn>

      {/* 콜아웃 패널 드롭다운 */}
      <DropdownWrapper isOpen={openDropdown === 'callout'} onClose={closeDropdown}>
        <Btn onClick={() => toggleDropdown('callout')} title={t('canvas.editor.infoPanel')}
          active={editor.isActive('callout')}>
          <Info size={16} />
        </Btn>
        {openDropdown === 'callout' && (
          <div className="CanvasEditorToolbar__DropdownMenu">
            <button className="CanvasEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('info').run(); closeDropdown(); }}>
              <Info size={14} style={{ color: 'var(--color-status-in-progress)' }} /> {t('canvas.editor.calloutInfo')}
            </button>
            <button className="CanvasEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('warning').run(); closeDropdown(); }}>
              <AlertTriangle size={14} style={{ color: 'var(--color-warning)' }} /> {t('canvas.editor.calloutWarning')}
            </button>
            <button className="CanvasEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('success').run(); closeDropdown(); }}>
              <CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} /> {t('canvas.editor.calloutSuccess')}
            </button>
            <button className="CanvasEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('error').run(); closeDropdown(); }}>
              <XCircle size={14} style={{ color: 'var(--color-error)' }} /> {t('canvas.editor.calloutError')}
            </button>
          </div>
        )}
      </DropdownWrapper>

      {/* 코드 블록 언어 선택 드롭다운 */}
      <DropdownWrapper isOpen={openDropdown === 'codeblock'} onClose={closeDropdown}>
        <Btn onClick={() => toggleDropdown('codeblock')} title={t('canvas.editor.codeBlock')}
          active={editor.isActive('codeBlock')}>
          <CodeSquare size={16} />
        </Btn>
        {openDropdown === 'codeblock' && (
          <div className="CanvasEditorToolbar__DropdownMenu CanvasEditorToolbar__CodeMenu">
            {CODE_LANGUAGES.map(({ value, label, labelKey }) => (
              <button
                key={label}
                className="CanvasEditorToolbar__DropdownItem"
                onClick={() => {
                  if (value) {
                    editor.chain().focus().setCodeBlock({ language: value }).run();
                  } else {
                    editor.chain().focus().toggleCodeBlock().run();
                  }
                  closeDropdown();
                }}
              >
                {labelKey ? t(labelKey) : label}
              </button>
            ))}
          </div>
        )}
      </DropdownWrapper>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title={t('canvas.editor.divider')}>
        <Minus size={16} />
      </Btn>

      <Sep />

      {/* 링크, 이미지, 테이블 */}
      <Btn onClick={addLink} active={editor.isActive('link')} title={t('canvas.editor.link')}>
        <LinkIcon size={16} />
      </Btn>
      {hasExtension('image') && (
        <Btn onClick={addImage} title={t('canvas.editor.image')}>
          <ImageIcon size={16} />
        </Btn>
      )}
      {hasExtension('table') && (
        <DropdownWrapper isOpen={openDropdown === 'table'} onClose={() => { closeDropdown(); setTableSize({ rows: 0, cols: 0 }); }}>
          <Btn onClick={() => toggleDropdown('table')} title={t('canvas.editor.table')}>
            <TableIcon size={16} />
          </Btn>
          {openDropdown === 'table' && (
            <div className="CanvasEditorToolbar__DropdownMenu CanvasEditorToolbar__TableMenu">
              <div className="CanvasEditorToolbar__TableGrid">
                {Array.from({ length: 8 }, (_, r) =>
                  Array.from({ length: 8 }, (_, c) => (
                    <div
                      key={`${r}-${c}`}
                      className={`CanvasEditorToolbar__TableCell ${r < tableSize.rows && c < tableSize.cols ? 'CanvasEditorToolbar__TableCell--active' : ''}`}
                      onMouseEnter={() => setTableSize({ rows: r + 1, cols: c + 1 })}
                      onClick={() => addTable(r + 1, c + 1)}
                    />
                  ))
                )}
              </div>
              <div className="CanvasEditorToolbar__TableLabel">
                {tableSize.rows > 0 ? `${tableSize.rows} × ${tableSize.cols}` : t('canvas.editor.selectSize')}
              </div>
              {/* 커스텀 크기 입력 */}
              <div className="CanvasEditorToolbar__TableCustom">
                <input
                  type="number"
                  className="CanvasEditorToolbar__TableCustomInput"
                  min={1}
                  max={50}
                  placeholder={t('canvas.editor.rowsPlaceholder')}
                  value={customTableSize.rows}
                  onChange={(e) => setCustomTableSize({ ...customTableSize, rows: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <span className="CanvasEditorToolbar__TableCustomX">×</span>
                <input
                  type="number"
                  className="CanvasEditorToolbar__TableCustomInput"
                  min={1}
                  max={50}
                  placeholder={t('canvas.editor.colsPlaceholder')}
                  value={customTableSize.cols}
                  onChange={(e) => setCustomTableSize({ ...customTableSize, cols: e.target.value })}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <button
                  className="CanvasEditorToolbar__TableCustomBtn"
                  onClick={() => {
                    const r = Math.min(50, Math.max(1, parseInt(customTableSize.rows) || 1));
                    const c = Math.min(50, Math.max(1, parseInt(customTableSize.cols) || 1));
                    addTable(r, c);
                    setCustomTableSize({ rows: '', cols: '' });
                  }}
                >
                  {t('canvas.editor.insert')}
                </button>
              </div>
            </div>
          )}
        </DropdownWrapper>
      )}
      {hasExtension('table') && (
        <DropdownWrapper isOpen={openDropdown === 'cellBg'} onClose={closeDropdown}>
          <Btn onClick={() => toggleDropdown('cellBg')} title={t('canvas.editor.cellBackground')}>
            <PaintBucket size={16} />
          </Btn>
          {openDropdown === 'cellBg' && (
            <div className="CanvasEditorToolbar__DropdownMenu CanvasEditorToolbar__ColorMenu" style={{ minWidth: 160 }}>
              <span className="CanvasEditorToolbar__ColorLabel">{t('canvas.editor.cellBackgroundLabel')}</span>
              <div className="CanvasEditorToolbar__ColorGrid">
                {CELL_BG_COLORS.map((c) => (
                  <button
                    key={c}
                    className="CanvasEditorToolbar__ColorSwatch"
                    style={{ backgroundColor: c }}
                    onClick={() => { editor.chain().focus().setCellAttribute('backgroundColor', c).run(); closeDropdown(); }}
                  />
                ))}
              </div>
              <button
                className="CanvasEditorToolbar__ColorReset"
                onClick={() => { editor.chain().focus().setCellAttribute('backgroundColor', null).run(); closeDropdown(); }}
              >
                {t('canvas.editor.removeColor')}
              </button>
            </div>
          )}
        </DropdownWrapper>
      )}
      {hasExtension('table') && (
        <>
          <Btn onClick={() => editor.chain().focus().setCellAttribute('verticalAlign', 'top').run()}
            title={t('canvas.editor.alignTop')}>
            <AlignStartVertical size={16} />
          </Btn>
          <Btn onClick={() => editor.chain().focus().setCellAttribute('verticalAlign', 'middle').run()}
            title={t('canvas.editor.alignMiddle')}>
            <AlignCenterVertical size={16} />
          </Btn>
          <Btn onClick={() => editor.chain().focus().setCellAttribute('verticalAlign', 'bottom').run()}
            title={t('canvas.editor.alignBottom')}>
            <AlignEndVertical size={16} />
          </Btn>
        </>
      )}
      {!!editor.schema.nodes.inlineMath && (
        <DropdownWrapper isOpen={openDropdown === 'math'} onClose={closeDropdown}>
          <Btn onClick={() => toggleDropdown('math')} title={t('canvas.editor.mathEquation')}>
            <Sigma size={16} />
          </Btn>
          {openDropdown === 'math' && (
            <div className="CanvasEditorToolbar__DropdownMenu">
              <button
                className="CanvasEditorToolbar__DropdownItem"
                onClick={() => { insertMathWithPopover(editor, 'inline', 'E=mc^2'); closeDropdown(); }}
              >
                {t('canvas.editor.inlineEquation')}
              </button>
              <button
                className="CanvasEditorToolbar__DropdownItem"
                onClick={() => { insertMathWithPopover(editor, 'block', '\\int_a^b f(x)\\,dx'); closeDropdown(); }}
              >
                {t('canvas.editor.blockEquation')}
              </button>
            </div>
          )}
        </DropdownWrapper>
      )}
      {hasExtension('mermaid') && (
        <Btn onClick={() => editor.chain().focus().insertMermaid().run()} title={t('canvas.editor.mermaidDiagram')}>
          <Workflow size={16} />
        </Btn>
      )}

      <Sep />

      {/* Undo / Redo */}
      {/* Yjs undo/redo는 포커스가 필요 없다 — blur 상태에서 focus()를 태우면 rAF 지연 selection이
          빈 fragment redo와 겹쳐 문서를 <p></p><p>…</p>로 오염시킨다(WEAVE-37). commands.undo/redo만 호출. */}
      <Btn onClick={() => editor.commands.undo()} title={t('canvas.editor.undo')}>
        <Undo2 size={16} />
      </Btn>
      <Btn onClick={() => editor.commands.redo()} title={t('canvas.editor.redo')}>
        <Redo2 size={16} />
      </Btn>

      {rawModeEnabled && (
        <>
          <Sep />
          <Btn onClick={onToggleRawMode} title={t('canvas.editor.switchToMarkdown')}>
            <CodeXml size={16} />
          </Btn>
        </>
      )}
    </div>
  );
}

// 드롭다운 래퍼: 외부 클릭 시 닫기
function DropdownWrapper({ isOpen, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

  return (
    <div className="CanvasEditorToolbar__DropdownWrap" ref={ref}>
      {children}
    </div>
  );
}
