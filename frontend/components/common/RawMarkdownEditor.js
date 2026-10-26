import { useEffect, useRef } from 'react';
import { useTheme } from '@/library/theme';
import { createThemeBinding } from '@/library/editorTheme';

// CodeMirror 동적 로드 (TypstEditor.js:8-21과 동일 패턴 — 번들 분리)
let cmModulesPromise = null;
function loadCmModules() {
  if (cmModulesPromise) return cmModulesPromise;
  cmModulesPromise = Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/lang-markdown'),
    import('@codemirror/theme-one-dark'),
  ]).then(([state, view, commands, markdown, oneDark]) => ({ state, view, commands, markdown, oneDark }));
  return cmModulesPromise;
}

/**
 * raw markdown 소스 편집기 — 비협업 표면 전용(Yjs 없음).
 * value는 마운트 시 초기값으로만 쓰는 uncontrolled. 세션 교체는 부모가 key 리마운트로.
 * 미니멀 셋: 문서형 소스라 lineNumbers/gutter/foldGutter 없음.
 * (bracketMatching은 TypstEditor.js:103-108의 한글 IME 이슈 전례에 따라 여기서도 제외)
 */
export default function RawMarkdownEditor({ value, onChange, onBlur, placeholder }) {
  const hostRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onBlurRef.current = onBlur; }, [onBlur]);
  const initialValueRef = useRef(value);

  // 생성 effect deps는 []로 유지한다(resolved를 넣으면 initialValueRef uncontrolled
  // 설계가 깨져 테마 토글마다 편집 내용이 초기값으로 리셋된다).
  const { resolved } = useTheme();
  const resolvedRef = useRef(resolved);
  const themeBindingRef = useRef(null);
  const viewRef = useRef(null);       // 테마 재구성용

  useEffect(() => {
    let destroyed = false;
    let view = null;
    (async () => {
      const { state, view: cmView, commands, markdown, oneDark } = await loadCmModules();
      if (destroyed || !hostRef.current) return;

      themeBindingRef.current = createThemeBinding({
        Compartment: state.Compartment,
        getResolved: () => resolvedRef.current,
        getOneDark: () => oneDark,
        variant: 'chrome',   // 라이트에 syntaxHighlighting이 없다 → 'full'은 다크만 구문색이 생겨 비대칭
      });
      const extensions = [
        cmView.highlightSpecialChars(),
        cmView.drawSelection(),
        cmView.dropCursor(),
        commands.history(),
        // 주의: defaultKeymap에는 Mod-Enter(빈 줄 삽입)가 있다 — 제출 단축키가 필요한
        // 표면(CommentEditor)은 조상에서 캡처 단계로 가로챈다.
        cmView.keymap.of([...commands.defaultKeymap, ...commands.historyKeymap]),
        markdown.markdown(),
        cmView.EditorView.lineWrapping,
        cmView.placeholder(placeholder || ''),
        cmView.EditorView.updateListener.of((update) => {
          // 글자를 바꾼 거래마다 편집 기록(ChangeSet)·조작 종류(잘라내기·붙여넣기·줄 이동·실행 취소 등)·그 뒤 실행 취소 깊이도
          // 넘긴다 — useRawMode가 진입 때 링크 자리와 CodeMirror 실행 취소 묶음(0.5초 안 이어 한 조작은 한 묶음)을 따라가는 데 쓴다
          // 바뀐 글이 없는 실행 취소(입력했다 바로 지운 묶음)도 실행 취소 한 번이라 넘긴다
          for (const tr of update.transactions) {
            if (!tr.docChanged && !tr.isUserEvent('undo')) continue;
            onChangeRef.current?.(tr.state.doc.toString(), tr.changes, tr.annotation(state.Transaction.userEvent), commands.undoDepth(tr.state));
          }
        }),
        // 복사는 글자를 바꾸지 않지만 조작 종류('copy')만 알린다 — 그 뒤 붙여넣은 글은 잘라 둔 줄이 아니라 복사본이다
        cmView.EditorView.domEventObservers({
          copy: (event, view) => { onChangeRef.current?.(view.state.doc.toString(), null, 'copy'); },
          // 편집기 밖에 선택이 남은 채로 편집기를 누르면 그 선택을 먼저 걷어 낸다 — CodeMirror는 포커스가 없는 동안에도 페이지
          // 선택을 기억하고(selectionchange), 기억한 선택이 편집기 밖이면 이 클릭의 포인터 선택에서 화면 선택을 다시 읽지 않아
          // "포커스 직후 편집기 맨 앞 선택은 브라우저 포커스 부작용" 판단이 남는다. 그러면 클릭 직후 Alt+↓로 빈 줄을 넘길 때 커서가
          // 이전 줄로 돌아간다. 관찰자는 CodeMirror의 mousedown 처리보다 먼저 불려, 그 처리가 시작하며 화면 선택을 다시 읽을 때
          // 기억이 비워진다. 걷어 내는 선택은 이 클릭으로 어차피 편집기 안으로 옮겨질 선택이다(주 버튼, 포커스가 없을 때만).
          mousedown: (event, view) => {
            if (event.button !== 0 || view.hasFocus) return;
            const selection = view.dom.ownerDocument.getSelection();
            if (selection?.rangeCount && !view.dom.contains(selection.anchorNode)) selection.removeAllRanges();
          },
        }),
        cmView.EditorView.domEventHandlers({
          blur: () => { onBlurRef.current?.(); },
        }),
        // 여기서는 extensions 배열이 new EditorView 바로 앞에서 만들어지므로
        // 배열 안에서 initial()을 불러도 안전하다(TypstEditor와 다른 점).
        themeBindingRef.current.initial(),
      ];
      // 페이지에 남은 선택을 걷어 낸다 — CodeMirror는 만들어질 때 페이지 선택을 기억하고, 기억한 선택이 있으면 처음 클릭 때
      // 화면 선택을 다시 읽지 않아 "포커스 직후 편집기 맨 앞 선택은 브라우저 포커스 부작용" 판단이 남는다. 그 상태로 클릭 직후
      // Alt+↓로 줄을 옮기면 커서가 옮긴 줄을 따라가지 못하고 이전 줄로 돌아간다. 걷어 낼 것은 숨겨질 일반 모드 편집기 안의
      // 선택(자동 포커스·먼저 누른 자리)과 편집을 열기 전에 누른 글자의 커서다. 다른 곳에 잡아 둔 범위 선택은 그대로 둔다.
      const selection = hostRef.current.ownerDocument.getSelection();
      const at = selection?.rangeCount ? selection.anchorNode : null;
      const atElement = at?.nodeType === 1 ? at : at?.parentElement;
      if (at && !hostRef.current.contains(at) && (selection.isCollapsed || atElement?.closest('.ProseMirror'))) {
        selection.removeAllRanges();
      }
      view = new cmView.EditorView({
        state: state.EditorState.create({ doc: initialValueRef.current || '', extensions }),
        parent: hostRef.current,
      });
      viewRef.current = view;
    })();
    return () => {
      destroyed = true;
      if (view) view.destroy();
      viewRef.current = null;
      themeBindingRef.current = null;
    };
    // 마운트 1회 — 세션 교체는 부모의 key 리마운트로
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 테마 변경 — 뷰 재생성 없이 확장만 교체한다.
  useEffect(() => {
    resolvedRef.current = resolved;
    const view = viewRef.current;
    const binding = themeBindingRef.current;
    if (!view || !binding) return;
    view.dispatch({ effects: binding.reconfigure() });
  }, [resolved]);

  return <div className="RawMarkdownEditor" ref={hostRef} />;
}
