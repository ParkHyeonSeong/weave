import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Bookmark } from 'lucide-react';
import { useLightbox } from '@/components/common/LightboxProvider';
import { deriveFilename } from '@/library/lightboxImages';
import MarkdownMath from '@/components/common/MarkdownMath';
import { useDateFormat } from '@/hooks/useDateFormat';

export default function AIChatMessage({ message, onTogglePin, isStreaming }) {
  const { formatTimestampTime } = useDateFormat();
  const { open: openLightbox } = useLightbox();
  const isUser = message.role === 'user';
  const isPinned = message.is_pinned;

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return formatTimestampTime(d);
  };

  return (
    <div className={`AIChatMessage AIChatMessage--${message.role}`}>
      <div className="AIChatMessage__Bubble">
        {isUser ? (
          message.content
        ) : (
          <div className="AIChatMessage__Markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              components={{
                img: ({ node, ...props }) => (
                  <img
                    {...props}
                    style={{ cursor: 'zoom-in', maxWidth: '100%' }}
                    onClick={() =>
                      openLightbox([{ src: props.src, alt: props.alt || '', filename: deriveFilename(props.src, props.alt) }], 0)
                    }
                  />
                ),
                pre: ({ node, children, ...props }) => {
                  const childCls = node?.children?.[0]?.properties?.className || [];
                  if (Array.isArray(childCls) && childCls.includes('math-display')) {
                    return <>{children}</>; // 블록 수식은 pre 래핑 제거
                  }
                  return <pre {...props}>{children}</pre>;
                },
                code: ({ node, className, children, ...props }) => {
                  const cls = className || '';
                  if (cls.includes('language-math')) {
                    return <MarkdownMath latex={String(children)} display={cls.includes('math-display')} />;
                  }
                  return <code className={className} {...props}>{children}</code>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {isStreaming && <span className="AIChatMessage__Cursor" />}
      </div>
      <div className="AIChatMessage__Meta">
        {!isUser && message.message_id && (
          <div className={`AIChatMessage__Actions ${isPinned ? 'AIChatMessage__Actions--visible' : ''}`}>
            <button
              className={`AIChatMessage__PinBtn ${isPinned ? 'AIChatMessage__PinBtn--pinned' : ''}`}
              onClick={() => onTogglePin?.(message.message_id)}
              type="button"
            >
              <Bookmark size={13} fill={isPinned ? 'currentColor' : 'none'} />
            </button>
          </div>
        )}
        <span className="AIChatMessage__Time">{formatTime(message.created_at)}</span>
      </div>
    </div>
  );
}
