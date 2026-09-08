import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renderMathElement, clearMathElement } from '@/library/mathRender';

// 수식 클릭 시 뜨는 LaTeX 편집 팝오버. Cmd/Ctrl+Enter 저장, Esc 취소.
export default function MathEditPopover({ latex, displayMode, onSave, onCancel }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(latex);
  const previewRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!previewRef.current) return;
    if (value.trim()) {
      renderMathElement(previewRef.current, value, { displayMode });
    } else {
      // clearMathElement: 토큰 갱신으로 진행 중인 느린 폴백 렌더를 무효화
      // (textContent = ''만 하면 pending SVG가 빈 미리보기를 다시 덮는다)
      clearMathElement(previewRef.current);
    }
  }, [value, displayMode]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(value); }
  };

  return (
    <div className="MathEditPopover" onKeyDown={handleKeyDown}>
      <textarea
        ref={inputRef}
        className="MathEditPopover__Input"
        value={value}
        rows={displayMode ? 3 : 1}
        placeholder={t('canvasExt.math.placeholder')}
        onChange={(e) => setValue(e.target.value)}
      />
      <div ref={previewRef} className="MathEditPopover__Preview" />
      <div className="MathEditPopover__Actions">
        <button type="button" className="MathEditPopover__Btn" onClick={onCancel}>{t('common.actions.cancel')}</button>
        <button
          type="button"
          className="MathEditPopover__Btn MathEditPopover__Btn--primary"
          onClick={() => onSave(value)}
        >
          {t('common.actions.save')}
        </button>
      </div>
    </div>
  );
}
