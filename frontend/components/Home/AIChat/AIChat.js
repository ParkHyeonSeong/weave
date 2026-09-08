import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { axios, getBaseURL } from '@/library/_axios';
import { MessageSquare, Plus, Bookmark, ChevronDown, Trash2 } from 'lucide-react';
import AIChatMessage from './AIChatMessage';
import AIChatInput from './AIChatInput';

export default function AIChat() {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showPinned, setShowPinned] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);

  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load messages when active conversation changes
  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const loadConversations = async () => {
    try {
      const res = await axios.get('/ai/conversations');
      if (res.data.status) {
        const convs = res.data.conversations || [];
        setConversations(convs);
        if (convs.length > 0) {
          setActiveConversationId(convs[0].conversation_id);
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (convId) => {
    try {
      const res = await axios.get(`/ai/conversations/${convId}/messages`);
      if (res.data.status) {
        setMessages(res.data.messages || []);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  const createConversation = async () => {
    try {
      const res = await axios.post('/ai/conversations', { title: 'New Conversation' });
      if (res.data.status) {
        const newConv = res.data.conversation;
        setConversations(prev => [newConv, ...prev]);
        setActiveConversationId(newConv.conversation_id);
        setMessages([]);
        setShowDropdown(false);
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const deleteConversation = async (e, convId) => {
    e.stopPropagation();
    try {
      const res = await axios.delete(`/ai/conversations/${convId}`);
      if (res.data.status) {
        setConversations(prev => prev.filter(c => c.conversation_id !== convId));
        if (activeConversationId === convId) {
          const remaining = conversations.filter(c => c.conversation_id !== convId);
          setActiveConversationId(remaining.length > 0 ? remaining[0].conversation_id : null);
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const switchConversation = (convId) => {
    setActiveConversationId(convId);
    setShowDropdown(false);
    setShowPinned(false);
  };

  const togglePin = async (messageId) => {
    try {
      const res = await axios.post(`/ai/messages/${messageId}/pin`);
      if (res.data.status) {
        setMessages(prev =>
          prev.map(m =>
            m.message_id === messageId ? { ...m, is_pinned: !m.is_pinned } : m
          )
        );
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const stopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const sendMessage = async (content) => {
    if (!activeConversationId || isStreaming) return;

    const userMsg = { role: 'user', content, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingContent('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${getBaseURL()}/api/ai/conversations/${activeConversationId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              fullText += data.content;
              setStreamingContent(fullText);
            }
            if (data.done) {
              setMessages(prev => [...prev, {
                message_id: data.message_id,
                role: 'assistant',
                content: fullText,
                is_pinned: false,
                created_at: new Date().toISOString(),
              }]);
              setStreamingContent('');

              // Auto-title: rename if still default
              const activeConv = conversations.find(c => c.conversation_id === activeConversationId);
              if (activeConv && activeConv.title === 'New Conversation') {
                const newTitle = content.length > 50 ? content.slice(0, 50) + '...' : content;
                setConversations(prev =>
                  prev.map(c =>
                    c.conversation_id === activeConversationId ? { ...c, title: newTitle } : c
                  )
                );
                // 서버에도 제목 업데이트
                axios.patch(`/ai/conversations/${activeConversationId}`, { title: newTitle }).catch(() => {});
              }
            }
            if (data.error) {
              console.error('Stream error from server:', data.error);
            }
          } catch {
            // ignore JSON parse errors for incomplete chunks
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Stream error:', err);
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      abortRef.current = null;
    }
  };

  const activeConv = conversations.find(c => c.conversation_id === activeConversationId);
  const displayMessages = showPinned ? messages.filter(m => m.is_pinned) : messages;

  if (loading) {
    return (
      <div className="AIChat">
        <div className="AIChat__Loading">
          <span>{t('common.state.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="AIChat">
      <div className="AIChat__Header">
        <div className="AIChat__HeaderLeft" ref={dropdownRef}>
          <button
            className="AIChat__ConvToggle"
            onClick={() => setShowDropdown(!showDropdown)}
            type="button"
          >
            <span className="AIChat__ConversationTitle">
              {activeConv?.title || t('home.aiChat.title')}
            </span>
            <ChevronDown size={14} />
          </button>

          {showDropdown && (
            <div className="AIChat__ConvDropdown">
              {conversations.map(conv => (
                <div
                  key={conv.conversation_id}
                  className={`AIChat__ConvItem ${conv.conversation_id === activeConversationId ? 'AIChat__ConvItem--active' : ''}`}
                  onClick={() => switchConversation(conv.conversation_id)}
                >
                  <span className="AIChat__ConvItemTitle">{conv.title}</span>
                  <button
                    className="AIChat__ConvDelete"
                    onClick={(e) => deleteConversation(e, conv.conversation_id)}
                    type="button"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {conversations.length === 0 && (
                <div className="AIChat__ConvEmpty">{t('home.aiChat.noConversations')}</div>
              )}
            </div>
          )}
        </div>

        <div className="AIChat__HeaderActions">
          <button
            className={`AIChat__HeaderBtn ${showPinned ? 'AIChat__HeaderBtn--active' : ''}`}
            onClick={() => setShowPinned(!showPinned)}
            type="button"
            title={t('home.aiChat.showPinned')}
          >
            <Bookmark size={15} fill={showPinned ? 'currentColor' : 'none'} />
          </button>
          <button
            className="AIChat__HeaderBtn"
            onClick={createConversation}
            type="button"
            title={t('home.aiChat.newConversation')}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div className="AIChat__Messages">
        {displayMessages.length === 0 && !isStreaming ? (
          <div className="AIChat__Welcome">
            <MessageSquare size={32} />
            <span className="AIChat__WelcomeTitle">
              {showPinned ? t('home.aiChat.noPinnedMessages') : t('home.aiChat.title')}
            </span>
            <span className="AIChat__WelcomeText">
              {showPinned
                ? t('home.aiChat.pinnedHint')
                : conversations.length === 0
                  ? t('home.aiChat.startHint')
                  : t('home.aiChat.sendHint')}
            </span>
          </div>
        ) : (
          <>
            {displayMessages.map((msg, i) => (
              <AIChatMessage
                key={msg.message_id || `msg-${i}`}
                message={msg}
                onTogglePin={togglePin}
              />
            ))}
            {isStreaming && streamingContent && (
              <AIChatMessage
                message={{
                  role: 'assistant',
                  content: streamingContent,
                  created_at: new Date().toISOString(),
                }}
                isStreaming
              />
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="AIChat__InputArea">
        <AIChatInput
          onSend={sendMessage}
          disabled={!activeConversationId}
          isStreaming={isStreaming}
          onStop={stopStreaming}
        />
      </div>
    </div>
  );
}
