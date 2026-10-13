import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import DropdownPortal from '@/components/common/DropdownPortal';
import ColorPicker from '@/components/common/ColorPicker';
import { ENTITY_SURFACE_PROFILES, entityBorderStyle, entityTintStyle } from '@/library/entityTint';
import { HEX_RE } from '@/library/entityAppearance';
import { LABEL_NAME_MAX, labelSaveErrorText, validateLabelDraft } from '@/library/labelEdit';

// 미리보기 타일 바탕 = 라벨 칩이 실제로 얹히는 두 테마의 표면(default 프로파일, 토큰의 JS 복제본)
const SURFACES = ENTITY_SURFACE_PROFILES.default;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 미리보기 칩 스타일 — 지금 테마와 무관하게 그 테마의 산출값을 직접 칠한다.
 * EntityTint 클래스를 붙이면 다크 테마에서 라이트 타일까지 다크 값으로 바뀐다(html[data-theme] 전역 규칙).
 * 지원 밖 저장색(passthrough)은 칩과 같은 오늘의 선언을 그대로 쓴다.
 */
function previewChipStyle(color, theme) {
  const tint = entityTintStyle(color, { alpha: '20' });
  const bd = entityBorderStyle(color);
  if (!tint?.['--et-on']) return { ...tint, ...bd };
  const dark = theme === 'dark';
  return {
    background: dark ? tint['--et-bg-dark'] : tint['--et-bg'],
    color: dark ? tint['--et-fg-dark'] : tint['--et-fg'],
    borderColor: dark ? bd['--et-bd-dark'] : bd['--et-bd'],
  };
}

/**
 * 라벨 이름·색 편집창. 입력 중에는 초안만 바뀌고 '적용'에서만 저장한다.
 * onApply(changes) → Promise<{ ok } | { ok:false, code, category, network }> — 실패면 초안을 둔 채 이유를 보인다.
 * onClose(reason) — 'saved' | 'cancel' | 'outside'. 저장 중에는 닫지 않는다(요청을 되돌릴 수 없다).
 */
export default function LabelEditPopover({ label, labels, presets, anchorRef, onApply, onClose }) {
  const { t } = useTranslation();
  const titleId = useId();
  const nameId = useId();
  const popoverRef = useRef(null);
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const [name, setName] = useState(label.label_name);
  const [color, setColor] = useState(label.color);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const aliveRef = useRef(true);       // 닫힌 뒤 도착한 응답은 아무것도 하지 않는다
  const focusRafRef = useRef(0);       // 실패 뒤 예약한 포커스 처리 — 편집창이 사라지면 취소한다

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cancelAnimationFrame(focusRafRef.current);
    };
  }, []);

  const { nameError, changes, canApply } = useMemo(
    () => validateLabelDraft({ name, color }, { original: label, labels }),
    [name, color, label, labels],
  );
  const previewColor = HEX_RE.test(color || '') ? color : label.color;
  const previewName = name.trim() || label.label_name;
  const nameErrorText = {
    required: t('common.labelEdit.nameRequired'),
    tooLong: t('common.labelEdit.nameTooLong', { max: LABEL_NAME_MAX }),
    duplicate: t('common.labelEdit.nameDuplicate'),
  }[nameError];

  // 열리면 이름 칸에 포커스·전체 선택 — DropdownPortal이 첫 프레임에 자리를 잡은 뒤에
  useEffect(() => {
    const id = requestAnimationFrame(() => { nameRef.current?.focus(); nameRef.current?.select(); });
    return () => cancelAnimationFrame(id);
  }, []);

  // 바깥 누름 = 취소(저장 중에는 무시)
  useEffect(() => {
    const onDown = (e) => {
      if (saving || popoverRef.current?.contains(e.target)) return;
      onClose('outside');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [saving, onClose]);

  // 입력을 바꾸면 지난 저장 실패 문구는 지운다(새 초안에는 맞지 않는다)
  const changeName = (value) => { setName(value); setSaveError(''); };
  const changeColor = (value) => { setColor(value); setSaveError(''); };

  const apply = async () => {
    if (!canApply || saving) return;
    setSaving(true);
    setSaveError('');
    // 저장 중에는 입력·버튼이 비활성이라 포커스가 문서로 빠진다 — 편집창 자신에 두어 키 처리가 살아 있게
    dialogRef.current?.focus({ preventScroll: true });
    let result;
    try {
      result = await onApply(changes);
    } catch {
      result = { ok: false, network: true };   // 결과 계약 밖의 예외도 '저장 중'에 갇히지 않게
    }
    if (!aliveRef.current) return;   // 기다리는 사이 편집창이 닫혔다(패널 닫힘 등)
    if (result?.ok) {
      onClose('saved');
      return;
    }
    setSaving(false);
    setSaveError(labelSaveErrorText(result ?? { network: true }, t));
    // 다시 고칠 수 있게 이름 칸으로 돌아온다(다시 활성화된 다음 프레임에). 사용자가 편집창에 머물러 있을 때만 —
    // 포커스가 편집창 안이거나 아무 요소에도 없을 때. 그사이 댓글 입력칸·다른 버튼으로 옮겼다면 그 포커스를 둔다.
    focusRafRef.current = requestAnimationFrame(() => {
      const active = document.activeElement;
      const stayed = !active || active === document.body || !!popoverRef.current?.contains(active);
      if (stayed) nameRef.current?.focus({ preventScroll: true });
    });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!saving) onClose('cancel');
      return;
    }
    if (e.key !== 'Tab') return;
    // 포털이라 문서 순서상 끝에 붙는다 — Tab이 편집창 밖(페이지 끝)으로 새지 않게 안에서 돈다
    const items = [...popoverRef.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    // keepInViewport: 라벨 입력 영역이 스크롤로 화면 밖에 나가거나 실패 문구로 높이가 바뀌어도 편집창은 화면 안에 머문다
    <DropdownPortal anchorRef={anchorRef} open dropdownRef={popoverRef} keepInViewport>
      <div
        ref={dialogRef}
        className="LabelEditPopover"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        // 빈 곳을 눌러도 포커스가 편집창 안에 남아 Esc·Tab 순환이 계속 동작하게
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="LabelEditPopover__Header">
          <h3 id={titleId} className="LabelEditPopover__Title">{t('common.labelEdit.title')}</h3>
          <button
            type="button"
            className="LabelEditPopover__Close"
            onClick={() => onClose('cancel')}
            disabled={saving}
            aria-label={t('common.actions.close')}
          >
            <X size={14} />
          </button>
        </div>

        <label className="LabelEditPopover__Label" htmlFor={nameId}>{t('common.labelEdit.name')}</label>
        <input
          id={nameId}
          ref={nameRef}
          className={`LabelEditPopover__NameInput${nameError ? ' LabelEditPopover__NameInput--error' : ''}`}
          value={name}
          onChange={(e) => changeName(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter는 조합 확정이다 — 적용으로 새지 않게(레포 관례)
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') { e.preventDefault(); apply(); }
          }}
          disabled={saving}
          aria-invalid={nameError ? 'true' : undefined}
          aria-describedby={nameError ? `${nameId}-error` : undefined}
        />
        {nameError && <p id={`${nameId}-error`} className="LabelEditPopover__FieldError">{nameErrorText}</p>}

        <div className="LabelEditPopover__Label">{t('common.labelEdit.color')}</div>
        <ColorPicker value={color} onChange={changeColor} presets={presets} disabled={saving} />

        <div className="LabelEditPopover__Label">{t('common.labelEdit.preview')}</div>
        <div className="LabelEditPopover__Previews">
          {['light', 'dark'].map((theme) => (
            <div key={theme} className="LabelEditPopover__Preview">
              <span className="LabelEditPopover__PreviewCaption">{t(`common.labelEdit.${theme}`)}</span>
              <div className="LabelEditPopover__PreviewSurface" style={{ background: SURFACES[theme] }}>
                <span
                  className="LabelEditPopover__PreviewChip"
                  data-theme-preview={theme}
                  style={previewChipStyle(previewColor, theme)}
                >
                  {previewName}
                </span>
              </div>
            </div>
          ))}
        </div>

        <p className="LabelEditPopover__Note">{t('common.labelEdit.scopeNote')}</p>

        {/* 낮은 화면에서 편집창 안이 스크롤돼도 실패 이유와 적용·취소는 아래에 붙어 보인다 */}
        <div className="LabelEditPopover__Footer">
          {saveError && <p className="LabelEditPopover__SaveError" role="alert">{saveError}</p>}
          <div className="LabelEditPopover__Actions">
            <button type="button" className="LabelEditPopover__Cancel" onClick={() => onClose('cancel')} disabled={saving}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="LabelEditPopover__Apply" onClick={apply} disabled={!canApply || saving}>
              {saving ? t('common.labelEdit.applying') : t('common.labelEdit.apply')}
            </button>
          </div>
        </div>
      </div>
    </DropdownPortal>
  );
}
