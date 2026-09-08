import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';


export default function Alert({ isOpen, onClose, title, contents }) {
  const { t } = useTranslation();
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    // OK 버튼에 포커스 → Enter로 바로 닫을 수 있음
    confirmRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div className="Alert__Backdrop" onClick={handleBackdropClick}>
      <div className="Alert">
        <div className="Alert__Header">
          <h3 className="Alert__Title">{title}</h3>
          <button className="Alert__CloseBtn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="Alert__Body">
          <p className="Alert__Contents">{contents}</p>
        </div>
        <div className="Alert__Footer">
          <button ref={confirmRef} className="Alert__ConfirmBtn" onClick={onClose}>{t('modal.alert.ok')}</button>
        </div>
      </div>
    </div>
  );
}
