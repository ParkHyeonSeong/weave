import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Square } from 'lucide-react';

export default function AIChatInput({ onSend, disabled, isStreaming, onStop }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="AIChatInput">
      <textarea
        ref={textareaRef}
        className="AIChatInput__Textarea"
        placeholder={t('home.aiChat.inputPlaceholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
      />
      {isStreaming ? (
        <button className="AIChatInput__StopBtn" onClick={onStop} type="button">
          <Square size={14} />
        </button>
      ) : (
        <button
          className="AIChatInput__SendBtn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          type="button"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
