import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import ScrumCell from './ScrumCell';

// 요약 칸 안에서도 원래 동작을 지키는 요소 — 링크는 열리고 칩은 참조 패널을 연다. 여기서 시작한 클릭은 요일을 넓히지 않는다.
const OWN_CLICK = 'a[href], [data-task-ref], [data-doc-ref], [data-issue-ref]';
// 체크리스트 체크박스와 그것을 감싼 label. 브라우저는 click을 보내기 전에 체크를 먼저 뒤집고, click이 끝난 뒤에 change를 쏜다.
// 그 사이 넓히기로 편집기가 편집 가능해지면 TipTap(TaskItem)이 change를 받아 체크 변경을 공유 문서에 쓴다 — 그래서 click을 취소한다.
const CHECKBOX = 'input[type="checkbox"], label';

// 한 주 보기의 칸 하나(스펙 §6.3). 넓게 보는 요일이면 보통 편집 칸, 아니면 요약 칸:
// 같은 ScrumCell을 읽기 전용으로 두고 모양만 CSS로 줄인다(한 줄 말줄임·상태 배지 숨김·상태 모양 아이콘·9줄 + 흐림).
// 두 모양이 같은 트리라 넓게 보는 요일이 바뀌어도 편집기는 다시 만들어지지 않는다(editable만 바뀐다).
// memo: 그리드는 문서가 바뀔 때마다 다시 그려진다 — props(전부 안정값·문자열)가 같으면 칸·편집기까지 내려가지 않는다.
// dayName: 이 칸 요일의 긴 이름 — '더 보기' 버튼의 접근 이름에 넣는다.
function ScrumWeekCell({ ydoc, fragmentKey, members, focused, onFocus, dayName }) {
  const { t } = useTranslation();
  const clipRef = useRef(null);
  const contentRef = useRef(null);
  const editorRef = useRef(null);
  const focusAfterWiden = useRef(false);
  const [overflowing, setOverflowing] = useState(false);
  const compact = !focused;

  const onEditor = useCallback((editor) => { editorRef.current = editor; }, []);

  // 요약 칸이 정해진 높이(9줄)를 넘는지. 내용·폭이 바뀌면 안쪽 크기가 바뀌므로 ResizeObserver로 다시 잰다.
  // 페인트 전에 한 번 재서, 넓게 보던 칸이 요약으로 바뀌는 순간에도 '더 보기'가 늦게 붙지 않게 한다.
  useLayoutEffect(() => {
    if (!compact) {
      setOverflowing(false);
      return undefined;
    }
    const clip = clipRef.current;
    const measure = () => setOverflowing(clip.scrollHeight > clip.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [compact]);

  // '더 보기'는 누르면 사라진다 — 포커스가 문서 맨 앞으로 빠지지 않게 넓어진 칸의 편집기로 넘긴다.
  // (자식 ScrumCell의 효과가 먼저 돌아 편집기는 이미 편집 가능하다.)
  useEffect(() => {
    if (compact || !focusAfterWiden.current) return;
    focusAfterWiden.current = false;
    const editor = editorRef.current;
    if (editor && !editor.isDestroyed) editor.commands.focus('start');
  }, [compact]);

  const widenFromCell = (e) => {
    const { target } = e;
    if (target.closest?.(OWN_CLICK)) return;
    if (target.closest?.(CHECKBOX)) {
      // 취소된 click은 체크를 되돌리고 change를 보내지 않는다. 키보드 Space도 체크박스에 click을 보내므로 같이 막힌다.
      e.preventDefault();
    } else {
      // 칸 안에서 글자를 끌어 선택하고 놓은 클릭은 읽는 중이다 — 넓히지 않는다
      const selection = window.getSelection?.();
      if (selection && !selection.isCollapsed && e.currentTarget.contains(selection.focusNode)) return;
    }
    onFocus();
  };
  const widenFromMore = (e) => {
    e.stopPropagation();   // 칸 클릭으로 한 번 더 넓히지 않게
    focusAfterWiden.current = true;
    onFocus();
  };

  return (
    <div
      className={`ScrumWeekCell${compact ? ' ScrumWeekCell--compact' : ''}${compact && overflowing ? ' is-overflowing' : ''}`}
      onClick={compact ? widenFromCell : undefined}
    >
      <div className="ScrumWeekCell__Clip" ref={clipRef}>
        <div className="ScrumWeekCell__Content" ref={contentRef}>
          <ScrumCell ydoc={ydoc} fragmentKey={fragmentKey} placeholder="" members={members} editable={focused} onEditor={onEditor} />
        </div>
      </div>
      {/* 접근 이름 = 보이는 글자 + 요일. 보이는 '더 보기'로 시작해야 음성 명령으로도 누를 수 있다(WCAG 2.5.3). */}
      {compact && overflowing && (
        <button
          type="button"
          className="ScrumWeekCell__More"
          aria-label={`${t('scrum.week.more')} · ${t('scrum.week.widen', { day: dayName })}`}
          onClick={widenFromMore}
        >
          <ChevronDown size={13} />
          {t('scrum.week.more')}
        </button>
      )}
    </div>
  );
}

export default memo(ScrumWeekCell);
