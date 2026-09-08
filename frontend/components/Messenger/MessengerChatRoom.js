import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pencil, Check, X, File as FileIcon, Download } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useDateFormat } from '@/hooks/useDateFormat';
import Avatar from '@/components/common/Avatar';
import TaskRefCard from './TaskRefCard';
import DocRefCard from './DocRefCard';
import IssueRefCard from './IssueRefCard';
import MessengerComposer from './MessengerComposer';
import { useLightbox } from '@/components/common/LightboxProvider';
import { showToast } from '@/components/Layout/Toast';
import { buildSendMessage, formatFileSize } from '@/library/messengerCompose';

const isImageType = (fileType) => fileType?.startsWith('image/');

export default function MessengerChatRoom({ roomId, wsRef, onBack, hideback, headerLeft, headerRight }) {
  const { t } = useTranslation();
  const { formatMessageTime } = useDateFormat();
  const { open: openLightbox } = useLightbox();
  const [messages, setMessages] = useState([]);
  const [roomName, setRoomName] = useState(() => t('messenger.chatRoom.defaultRoomName'));
  const [roomType, setRoomType] = useState('dm');
  const [members, setMembers] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [myLastReadAt, setMyLastReadAt] = useState(null);
  const [showUnreadDivider, setShowUnreadDivider] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const messagesEndRef = useRef(null);
  const unreadDividerRef = useRef(null);
  const editInputRef = useRef(null);
  const composerRef = useRef(null);
  const isInitialLoadRef = useRef(true);
  const dragCounterRef = useRef(0);

  let myUserId = 0;
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    myUserId = profile.user_id || 0;
  } catch {}

  // 메시지 목록 로드
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await axios.get(`/chat/${roomId}/messages`);
        if (res.data.status) {
          const msgs = res.data.messages.reverse();
          setMessages(msgs);
          setRoomType(res.data.room_type || 'dm');
          setMyLastReadAt(res.data.my_last_read_at || null);
          setShowUnreadDivider(true);
          isInitialLoadRef.current = true;
          if (res.data.members) setMembers(res.data.members);
          if (res.data.room_type === 'dm' && res.data.members?.length) {
            setRoomName(res.data.members[0].username);
          } else if (res.data.room_name) {
            setRoomName(res.data.room_name);
          }
        }
      } catch {}
    };
    fetchMessages();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'mark_read', room_id: roomId }));
      window.dispatchEvent(new CustomEvent('chat:unread_changed'));
    }
  }, [roomId]);

  // WebSocket 메시지 수신
  useEffect(() => {
    const handleWsMessage = (e) => {
      const data = e.detail;
      if (data.type === 'new_message' && data.room_id === roomId) {
        setMessages((prev) => {
          if (prev.some((m) => m.message_id === data.message.message_id)) return prev;
          return [...prev, data.message];
        });
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: 'mark_read', room_id: roomId }));
          window.dispatchEvent(new CustomEvent('chat:unread_changed'));
        }
      }
      if (data.type === 'mark_read' && data.room_id === roomId && data.user_id !== myUserId) {
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === data.user_id ? { ...m, last_read_at: data.last_read_at } : m
          )
        );
      }
    };
    window.addEventListener('chat:ws_message', handleWsMessage);
    return () => window.removeEventListener('chat:ws_message', handleWsMessage);
  }, [roomId, myUserId]);

  // 스크롤
  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      if (unreadDividerRef.current) {
        unreadDividerRef.current.scrollIntoView({ behavior: 'instant', block: 'center' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }
      setTimeout(() => setShowUnreadDivider(false), 1500);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // 드래그앤드롭 (채팅 영역 전체 → 컴포저로 위임)
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes('Files')) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    composerRef.current?.addFiles(e.dataTransfer?.files);
  }, []);

  // -- 메시지 전송 (컴포저 onSubmit) --
  const handleComposerSubmit = async (payload) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      showToast(t('messenger.chatRoom.notConnected'), 'error');
      return false;
    }
    const attachments = payload.attachments.map((a) => ({
      url: a.url, file_name: a.file_name, file_type: a.file_type, file_size: a.file_size,
    }));
    wsRef.current.send(JSON.stringify(buildSendMessage(roomId, payload, attachments)));
    return true;
  };

  // 채팅방 이름 변경
  const handleStartEdit = () => {
    setEditName(roomName);
    setIsEditing(true);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === roomName) {
      setIsEditing(false);
      return;
    }
    try {
      const res = await axios.patch(`/chat/${roomId}/name`, { room_name: trimmed });
      if (res.data.status) {
        setRoomName(res.data.room_name);
        window.dispatchEvent(new CustomEvent('chat:new_message'));
      }
    } catch {}
    setIsEditing(false);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // 메시지 내용 렌더링
  const renderContent = (text) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3).replace(/^\n/, '');
        return <pre key={i} className="MessengerChatRoom__CodeBlock"><code>{code}</code></pre>;
      }
      return <span key={i}>{renderInline(part)}</span>;
    });
  };

  const renderInline = (text) => {
    const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return tokens.map((token, i) => {
      if (token.startsWith('`') && token.endsWith('`')) {
        return <code key={i} className="MessengerChatRoom__InlineCode">{token.slice(1, -1)}</code>;
      }
      if (token.startsWith('**') && token.endsWith('**')) {
        return <strong key={i}>{token.slice(2, -2)}</strong>;
      }
      return token;
    });
  };

  // 첨부파일 렌더링 (메시지 내)
  const renderAttachments = (attachments) => {
    if (!attachments?.length) return null;
    const images = attachments.filter((a) => isImageType(a.file_type));
    const files = attachments.filter((a) => !isImageType(a.file_type));
    const gridClass = images.length === 1 ? 'single' : images.length === 2 ? 'duo' : 'multi';

    return (
      <div className="MessengerChatRoom__Attachments">
        {images.length > 0 && (
          <div className={`MessengerChatRoom__ImageGrid MessengerChatRoom__ImageGrid--${gridClass}`}>
            {images.map((att, i) => (
              <a key={i} href={att.file_url} target="_blank" rel="noopener noreferrer"
                 className="MessengerChatRoom__ImageLink"
                 onClick={(e) => {
                   e.preventDefault();
                   openLightbox(
                     images.map((a) => ({ src: a.file_url, alt: a.file_name, filename: a.file_name })),
                     i
                   );
                 }}>
                <img src={att.file_url} alt={att.file_name} loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {files.map((att, i) => (
          <a key={i} className="MessengerChatRoom__FileCard"
             href={att.file_url} download={att.file_name} target="_blank" rel="noopener noreferrer">
            <FileIcon size={16} />
            <span className="MessengerChatRoom__FileCardName">{att.file_name}</span>
            <span className="MessengerChatRoom__FileCardSize">{formatFileSize(att.file_size)}</span>
            <Download size={14} className="MessengerChatRoom__FileCardDl" />
          </a>
        ))}
      </div>
    );
  };

  const getMinuteKey = (dateStr) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
  };

  const shouldShowTime = (index) => {
    const msg = messages[index];
    const next = messages[index + 1];
    if (!next) return true;
    if (next.sender_id !== msg.sender_id) return true;
    return getMinuteKey(msg.created_at) !== getMinuteKey(next.created_at);
  };

  const getUnreadCount = (msg) => {
    const msgTime = new Date(msg.created_at);
    return members.filter((m) => {
      if (!m.last_read_at) return true;
      return msgTime > new Date(m.last_read_at);
    }).length;
  };

  return (
    <div className="MessengerChatRoom"
         onDragEnter={handleDragEnter}
         onDragLeave={handleDragLeave}
         onDragOver={handleDragOver}
         onDrop={handleDrop}>
      {/* 드래그 오버레이 */}
      {isDragOver && (
        <div className="MessengerChatRoom__DragOverlay">
          <span>{t('messenger.dropFiles')}</span>
        </div>
      )}

      <div className="MessengerChatRoom__Header">
        {headerLeft}
        {!hideback && (
          <button className="MessengerChatRoom__BackBtn" onClick={onBack}>
            <ArrowLeft size={16} />
          </button>
        )}
        {isEditing ? (
          <div className="MessengerChatRoom__TitleEdit">
            <input
              ref={editInputRef}
              className="MessengerChatRoom__TitleInput"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleEditKeyDown}
              maxLength={200}
            />
            <button className="MessengerChatRoom__TitleBtn" onClick={handleSaveEdit}>
              <Check size={14} />
            </button>
            <button className="MessengerChatRoom__TitleBtn" onClick={handleCancelEdit}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="MessengerChatRoom__TitleArea">
            <span className="MessengerChatRoom__Title">{roomName}</span>
            {roomType !== 'dm' && (
              <button className="MessengerChatRoom__TitleBtn" onClick={handleStartEdit}>
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
        {headerRight && <div className="MessengerChatRoom__HeaderRight">{headerRight}</div>}
      </div>

      <div className="MessengerChatRoom__Messages">
        {(() => {
          let firstUnreadIdx = -1;
          if (myLastReadAt) {
            let effectiveReadTime = new Date(myLastReadAt);
            for (const m of messages) {
              if (m.sender_id === myUserId) {
                const sentTime = new Date(m.created_at);
                if (sentTime > effectiveReadTime) effectiveReadTime = sentTime;
              }
            }
            firstUnreadIdx = messages.findIndex(
              (m) => m.sender_id !== myUserId && new Date(m.created_at) > effectiveReadTime
            );
          } else if (messages.length > 0 && messages.some((m) => m.sender_id !== myUserId)) {
            firstUnreadIdx = messages.findIndex((m) => m.sender_id !== myUserId);
          }
          return messages.map((msg, idx) => {
            const showTime = shouldShowTime(idx);
            const isMine = msg.sender_id === myUserId;
            // 보낸 사람이 바뀌는 첫 메시지에만 아바타/이름 노출 (연속 메시지는 여백 정렬)
            const isFirstOfRun = idx === 0 || messages[idx - 1].sender_id !== msg.sender_id;
            return (
              <Fragment key={msg.message_id}>
                {showUnreadDivider && idx === firstUnreadIdx && (
                  <div className="MessengerChatRoom__UnreadDivider" ref={unreadDividerRef}>
                    <span>{t('messenger.chatRoom.newMessages')}</span>
                  </div>
                )}
                <div
                  className={`MessengerChatRoom__Msg ${
                    isMine ? 'MessengerChatRoom__Msg--mine' : ''
                  }`}
                >
              {!isMine && (
                <div className="MessengerChatRoom__MsgAvatar">
                  {isFirstOfRun && (
                    <Avatar
                      user={{
                        name: msg.sender_name,
                        id: msg.sender_id,
                        avatar_url: msg.sender_avatar_url,
                        avatar_color: msg.sender_avatar_color,
                      }}
                      size="sm"
                    />
                  )}
                </div>
              )}
              <div className="MessengerChatRoom__MsgBody">
              {!isMine && isFirstOfRun && (
                <span className="MessengerChatRoom__MsgSender">{msg.sender_name}</span>
              )}
              {msg.task_ref && (
                <div className="MessengerChatRoom__MsgTaskRef">
                  <TaskRefCard taskRef={msg.task_ref} />
                </div>
              )}
              {msg.doc_ref && (
                <div className="MessengerChatRoom__MsgTaskRef">
                  <DocRefCard docRef={msg.doc_ref} />
                </div>
              )}
              {msg.issue_ref && (
                <div className="MessengerChatRoom__MsgTaskRef">
                  <IssueRefCard issueRef={msg.issue_ref} />
                </div>
              )}
              {renderAttachments(msg.attachments)}
              <div className="MessengerChatRoom__MsgRow">
                {isMine && (() => {
                  const unread = getUnreadCount(msg);
                  if (!unread && !showTime) return null;
                  return (
                    <div className="MessengerChatRoom__MsgMeta">
                      {unread > 0 && (
                        <span className="MessengerChatRoom__MsgUnread">{unread}</span>
                      )}
                      {showTime && (
                        <span className="MessengerChatRoom__MsgTime">
                          {formatMessageTime(msg.created_at)}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {msg.content ? (
                  <div className="MessengerChatRoom__MsgBubble">
                    {renderContent(msg.content)}
                  </div>
                ) : null}
                {!isMine && showTime && (
                  <span className="MessengerChatRoom__MsgTime">
                    {formatMessageTime(msg.created_at)}
                  </span>
                )}
              </div>
              </div>
              </div>
            </Fragment>
            );
          });
        })()}
        <div ref={messagesEndRef} />
      </div>

      <MessengerComposer
        ref={composerRef}
        roomId={roomId}
        members={members}
        onSubmit={handleComposerSubmit}
      />
    </div>
  );
}
