import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmLabel, cancelLabel, variant = 'primary' }) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const confirmText = confirmLabel ?? t('common.actions.confirm');
  const cancelText = cancelLabel ?? t('common.actions.cancel');

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div className="ConfirmModal__Backdrop" onClick={handleBackdropClick}>
      <div className="ConfirmModal">
        <div className="ConfirmModal__Header">
          <h3 className="ConfirmModal__Title">{title}</h3>
          <button className="ConfirmModal__CloseBtn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="ConfirmModal__Body">
          <p className="ConfirmModal__Message">{message}</p>
        </div>
        <div className="ConfirmModal__Footer">
          <button className="ConfirmModal__CancelBtn" onClick={onClose}>
            {cancelText}
          </button>
          <button
            className={`ConfirmModal__ConfirmBtn ConfirmModal__ConfirmBtn--${variant}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
