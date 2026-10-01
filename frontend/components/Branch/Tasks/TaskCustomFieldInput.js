import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import DatePicker from '@/components/common/DatePicker';

const toDraft = (value) => (value == null ? '' : String(value));
const parseText = (text) => text || null;
const parseNumber = (text) => (text ? Number(text) : null);

/**
 * 태스크 상세 패널·풀페이지 공용 커스텀 필드 입력.
 *
 * text/number/url은 입력하는 동안 로컬 초안만 바꾸고, 칸을 벗어나거나(blur) Enter를 누를 때
 * 한 번 저장한다. 서버 값에 묶인 제어 입력으로 키마다 저장하면 저장·재조회가 입력을 따라잡지
 * 못해 칸이 원래 값으로 되돌아간다. checkbox/select/date는 고르는 즉시 저장한다.
 *
 * @param {(value: string|number|boolean|null) => void} onSave 이 필드의 새 값(null = 비움)
 */
export default function TaskCustomFieldInput({ field, value, onSave, className }) {
  const { t } = useTranslation();
  switch (field.field_type) {
    case 'text':
      return <DraftInput className={className} type="text" value={value} parse={parseText} onSave={onSave} placeholder={field.field_name} />;
    case 'number':
      return <DraftInput className={className} type="number" value={value} parse={parseNumber} onSave={onSave} />;
    case 'date':
      return <DatePicker size="sm" value={value || null} onChange={onSave} />;
    case 'checkbox':
      return <input type="checkbox" checked={!!value} onChange={(e) => onSave(e.target.checked)} />;
    case 'select':
      return (
        <select className={className} value={value || ''} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">{t('branchTasks.selectPlaceholder')}</option>
          {(field.field_options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case 'url':
      return <DraftInput className={className} type="url" value={value} parse={parseText} onSave={onSave} placeholder="https://..." />;
    default:
      return <DraftInput className={className} type="text" value={value} parse={parseText} onSave={onSave} />;
  }
}

function DraftInput({ value, parse, onSave, ...inputProps }) {
  const [draft, setDraft] = useState(() => toDraft(value));
  // 사용자가 이 칸에서 글자를 바꿨고 아직 저장하지 않았는가.
  const dirty = useRef(false);

  // 저장 뒤 재조회·실패 되돌리기·다른 사람의 변경으로 값이 바뀌면 칸을 맞춘다 —
  // 단 입력 중인 글자는 덮지 않는다.
  useEffect(() => {
    if (!dirty.current) setDraft(toDraft(value));
  }, [value]);

  const commit = () => {
    if (!dirty.current) return; // 바꾸지 않고 벗어나면 저장하지 않는다(그 사이 온 서버 값을 덮지 않게)
    dirty.current = false;
    const next = parse(draft);
    if (next !== (value ?? null)) onSave(next);
  };

  return (
    <input
      {...inputProps}
      value={draft}
      onChange={(e) => { dirty.current = true; setDraft(e.target.value); }}
      onBlur={commit}
      onKeyDown={(e) => {
        // 한글 조합 중 keydown은 무시한다 — 조합 도중 칸을 벗어나지 않게. 조합이 끝난 뒤
        // 이어서 오는 일반 Enter가 완성된 값으로 한 번 저장한다.
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') e.currentTarget.blur(); // blur가 한 번만 저장한다
      }}
    />
  );
}
