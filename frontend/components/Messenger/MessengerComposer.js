import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, File as FileIcon, Send, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { showToast } from '@/components/Layout/Toast';
import { isCodeMode, parseSlashInput, buildAttachmentsPayload, formatFileSize } from '@/library/messengerCompose';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import TaskSearchPopup from './TaskSearchPopup';
import TaskRefCard from './TaskRefCard';
import DocSearchPopup from './DocSearchPopup';
import DocRefCard from './DocRefCard';
import IssueSearchPopup from './IssueSearchPopup';
import IssueRefCard from './IssueRefCard';
import MentionSearchPopup from './MentionSearchPopup';
import SlashCommandMenu from '@/components/Canvas/extensions/SlashCommandMenu';
import { filterSlashCommands } from '@/components/Canvas/extensions/slashCommands';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const FILE_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip'];
const ALLOWED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...FILE_EXTENSIONS];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILES = 10;

// 백엔드 업로드 실패 코드 → 사용자 안내 메시지 (채팅은 이미지+문서 첨부)
function uploadErrorMessage(t, code) {
  switch (code) {
    case 'FILE_TOO_LARGE':
      return t('messenger.composer.fileTooLarge', { size: MAX_FILE_SIZE_MB });
    case 'INVALID_FILE_TYPE':
    case 'INVALID_FILE_CONTENT':
      return t('messenger.composer.unsupportedFileType');
    case 'NOT_A_MEMBER':
      return t('messenger.composer.uploadForbidden');
    case 'NO_FILE':
      return t('messenger.composer.noFile');
    default:
      return t('messenger.composer.uploadFailed');
  }
}

const getFileExtension = (filename) => {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
};

const MessengerComposer = forwardRef(function MessengerComposer(
  { roomId = null, members, disabled = false, onSubmit, selfDrop = false },
  ref
) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [attachedTask, setAttachedTask] = useState(null);
  const [attachedDoc, setAttachedDoc] = useState(null);
  const [attachedIssue, setAttachedIssue] = useState(null);
  const [slashCommand, setSlashCommand] = useState(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuIdx, setSlashMenuIdx] = useState(0);
  const [mentionCommand, setMentionCommand] = useState(null);
  const [mentionedUserIds, setMentionedUserIds] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const justSelectedRef = useRef(false);
  const dragCounterRef = useRef(0);
  const pendingFilesRef = useRef([]);
  useEffect(() => { pendingFilesRef.current = pendingFiles; }, [pendingFiles]);
  useEffect(() => () => {
    pendingFilesRef.current.forEach((f) => { if (f.preview) URL.revokeObjectURL(f.preview); });
  }, []);

  const codeMode = isCodeMode(input);

  // textarea 높이 자동 조절
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  useEffect(() => {
    autoResize();
  }, [input]);

  // -- 파일 업로드 --
  const uploadFile = async (file) => {
    const ext = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      showToast(uploadErrorMessage(t, 'INVALID_FILE_TYPE'), 'error');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showToast(uploadErrorMessage(t, 'FILE_TOO_LARGE'), 'error');
      return;
    }

    const tempId = `${Date.now()}_${Math.random()}`;
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

    if (!roomId) {
      setPendingFiles((prev) => {
        if (prev.length >= MAX_FILES) {
          if (preview) URL.revokeObjectURL(preview);
          return prev;
        }
        return [...prev, {
          id: tempId, file, file_name: file.name, file_type: file.type,
          file_size: file.size, preview, status: 'ready', progress: 0,
        }];
      });
      return;
    }

    setPendingFiles((prev) => {
      if (prev.length >= MAX_FILES) {
        if (preview) URL.revokeObjectURL(preview);
        return prev;
      }
      return [...prev, {
        id: tempId, file, file_name: file.name, file_type: file.type,
        file_size: file.size, preview, status: 'uploading', progress: 0,
      }];
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`/chat/upload?room_id=${roomId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setPendingFiles((prev) => prev.map((f) => f.id === tempId ? { ...f, progress: pct } : f));
          }
        },
      });
      if (res.data.status) {
        setPendingFiles((prev) => prev.map((f) => f.id === tempId ? {
          ...f, status: 'done', progress: 100,
          url: res.data.url, file_name: res.data.file_name,
          file_type: res.data.file_type, file_size: res.data.file_size,
        } : f));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('messenger.composer.uploadFailed');
        showToast(msg, 'error');
        setPendingFiles((prev) => prev.filter((f) => f.id !== tempId));
      }
    } catch {
      showToast(uploadErrorMessage(t), 'error');
      setPendingFiles((prev) => prev.filter((f) => f.id !== tempId));
    }
  };

  const handleFilesSelected = (files) => {
    Array.from(files).forEach((file) => uploadFile(file));
  };

  const removePendingFile = (id) => {
    setPendingFiles((prev) => {
      const item = prev.find((f) => f.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // 클립보드 붙여넣기
  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return; // 텍스트 붙여넣기는 기본 동작
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) uploadFile(file);
  };

  // 드래그앤드롭
  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes('Files')) setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    files.forEach((file) => uploadFile(file));
  };

  // -- 메시지 전송 --
  const submit = async () => {
    if (codeMode || sending) return;
    const isUploading = pendingFiles.some((f) => f.status === 'uploading');
    if (isUploading) return;

    const content = input.trim();
    const attachments = buildAttachmentsPayload(pendingFiles);
    if (!content && !attachedTask && !attachedDoc && !attachedIssue && attachments.length === 0) return;

    const payload = {
      content,
      attachments,
      taskId: attachedTask?.task_id ?? null,
      canvasPageId: attachedDoc?.page_id ?? null,
      issueId: attachedIssue?.issue_id ?? null,
      mentionedUserIds,
    };

    setSending(true);
    let ok = false;
    try { ok = await onSubmit(payload); } catch { ok = false; }
    setSending(false);

    if (ok) {
      setInput('');
      setAttachedTask(null);
      setAttachedDoc(null);
      setAttachedIssue(null);
      setSlashCommand(null);
      setShowSlashMenu(false);
      setSlashMenuIdx(0);
      setMentionedUserIds([]);
      pendingFiles.forEach((f) => { if (f.preview) URL.revokeObjectURL(f.preview); });
      setPendingFiles([]);
    }
  };

  const filteredSlashCommands = filterSlashCommands(input);

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (showSlashMenu && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenuIdx((prev) => Math.min(prev + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenuIdx((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSlashMenuSelect(filteredSlashCommands[slashMenuIdx].cmd);
        return;
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        return;
      }
    }
    if (justSelectedRef.current && e.key === 'Enter') {
      e.preventDefault();
      justSelectedRef.current = false;
      return;
    }
    if (mentionCommand && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    if (mentionCommand && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (slashCommand && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    if (slashCommand && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (codeMode || slashCommand) {
        // 코드모드 또는 검색중
      } else {
        if (!e.shiftKey) {
          e.preventDefault();
          submit();
        }
      }
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);

    const slash = parseSlashInput(val);
    if (slash.kind === 'menu') {
      setShowSlashMenu(true);
      setSlashMenuIdx(0);
      if (slashCommand) setSlashCommand(null);
    } else if (slash.kind === 'command') {
      setSlashCommand({ type: slash.type, mode: slash.mode, keyword: slash.keyword });
      setShowSlashMenu(false);
    } else {
      if (slashCommand) setSlashCommand(null);
      if (showSlashMenu) setShowSlashMenu(false);
    }

    const textarea = textareaRef.current;
    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = val.slice(0, cursorPos);
      const mentionMatch = textBeforeCursor.match(/(^|[\s])@(\S*)$/);
      if (mentionMatch && !slashCommand) setMentionCommand({ keyword: mentionMatch[2] });
      else if (mentionCommand) setMentionCommand(null);
    }
  };

  const handleSlashMenuSelect = (cmd) => {
    setInput(cmd + ' ');
    setShowSlashMenu(false);
    if (cmd === '/t') {
      setSlashCommand({ type: 'task', mode: 'my', keyword: '' });
    } else if (cmd === '/ta') {
      setSlashCommand({ type: 'task', mode: 'all', keyword: '' });
    } else if (cmd === '/d') {
      setSlashCommand({ type: 'doc', keyword: '' });
    } else if (cmd === '/i') {
      setSlashCommand({ type: 'issue', keyword: '' });
    }
    textareaRef.current?.focus();
  };

  const clearInputWithIME = () => {
    if (textareaRef.current) {
      textareaRef.current.blur();
      textareaRef.current.value = '';
    }
    setInput('');
    setSlashCommand(null);
    setTimeout(() => {
      justSelectedRef.current = false;
      textareaRef.current?.focus();
    }, 50);
  };

  const handleTaskSelect = (task) => {
    justSelectedRef.current = true;
    setAttachedTask({
      task_id: task.task_id, branch_id: task.branch_id,
      display_id: task.display_id, title: task.title,
      status: task.status, priority: task.priority,
      assignees: task.assignees || [],
      status_label: task.status_label, status_color: task.status_color,
      status_category: task.status_category,
    });
    clearInputWithIME();
  };

  const handleDocSelect = (doc) => {
    justSelectedRef.current = true;
    setAttachedDoc({
      page_id: doc.page_id, canvas_id: doc.canvas_id,
      title: doc.title, canvas_name: doc.canvas_name,
    });
    clearInputWithIME();
  };

  const handleIssueSelect = (issue) => {
    justSelectedRef.current = true;
    setAttachedIssue({
      issue_id: issue.issue_id, task_id: issue.task_id,
      branch_id: issue.branch_id, display_id: issue.display_id,
      title: issue.title, status: issue.status,
    });
    clearInputWithIME();
  };

  const handleMentionSelect = (user) => {
    justSelectedRef.current = true;
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart || input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/(^|[\s])@(\S*)$/);
    if (mentionMatch) {
      const matchStart = textBeforeCursor.lastIndexOf('@' + mentionMatch[2]);
      const before = input.slice(0, matchStart);
      const after = input.slice(cursorPos);
      const newInput = `${before}@${user.username} ${after}`;
      setInput(newInput);
      setMentionedUserIds((prev) =>
        prev.includes(user.user_id) ? prev : [...prev, user.user_id]
      );
    }
    setMentionCommand(null);
    setTimeout(() => {
      justSelectedRef.current = false;
      textarea?.focus();
    }, 50);
  };

  useImperativeHandle(ref, () => ({
    addFiles: (files) => Array.from(files || []).forEach((f) => uploadFile(f)),
  }));

  const isUploading = pendingFiles.some((f) => f.status === 'uploading');
  const sendDisabled = codeMode || !!slashCommand || isUploading || sending || disabled;

  return (
    <div className="MessengerChatRoom__Input"
         {...(selfDrop ? {
           onDragEnter: handleDragEnter,
           onDragLeave: handleDragLeave,
           onDragOver: handleDragOver,
           onDrop: handleDrop,
         } : {})}>
      {/* 드래그 오버레이 */}
      {selfDrop && isDragOver && (
        <div className="MessengerChatRoom__DragOverlay">
          <span>{t('messenger.dropFiles')}</span>
        </div>
      )}
      {showSlashMenu && filteredSlashCommands.length > 0 && (
        <SlashCommandMenu
          className="SlashCommandMenu--messenger"
          commands={filteredSlashCommands}
          activeIndex={slashMenuIdx}
          onSelect={(c) => handleSlashMenuSelect(c.cmd)}
          onHover={setSlashMenuIdx}
        />
      )}
      {mentionCommand && (
        <MentionSearchPopup
          keyword={mentionCommand.keyword}
          roomId={roomId}
          members={members}
          onSelect={handleMentionSelect}
          onClose={() => setMentionCommand(null)}
        />
      )}
      {slashCommand?.type === 'task' && (
        <TaskSearchPopup
          keyword={slashCommand.keyword}
          mode={slashCommand.mode}
          onSelect={handleTaskSelect}
          onClose={() => setSlashCommand(null)}
        />
      )}
      {slashCommand?.type === 'doc' && (
        <DocSearchPopup
          keyword={slashCommand.keyword}
          onSelect={handleDocSelect}
          onClose={() => setSlashCommand(null)}
        />
      )}
      {slashCommand?.type === 'issue' && (
        <IssueSearchPopup
          keyword={slashCommand.keyword}
          onSelect={handleIssueSelect}
          onClose={() => setSlashCommand(null)}
        />
      )}
      {attachedTask && (
        <div className="MessengerChatRoom__AttachedTask">
          <TaskRefCard taskRef={attachedTask} removable onRemove={() => setAttachedTask(null)} />
        </div>
      )}
      {attachedDoc && (
        <div className="MessengerChatRoom__AttachedTask">
          <DocRefCard docRef={attachedDoc} removable onRemove={() => setAttachedDoc(null)} />
        </div>
      )}
      {attachedIssue && (
        <div className="MessengerChatRoom__AttachedTask">
          <IssueRefCard issueRef={attachedIssue} removable onRemove={() => setAttachedIssue(null)} />
        </div>
      )}
      {/* 파일 프리뷰 영역 */}
      {pendingFiles.length > 0 && (
        <div className="MessengerChatRoom__PendingFiles">
          {pendingFiles.map((pf) => (
            <div key={pf.id} className="MessengerChatRoom__PendingFile">
              {pf.preview ? (
                <img src={pf.preview} alt={pf.file_name} className="MessengerChatRoom__PendingThumb" />
              ) : (
                <div className="MessengerChatRoom__PendingFileIcon">
                  <FileIcon size={20} />
                </div>
              )}
              <div className="MessengerChatRoom__PendingInfo">
                <span className="MessengerChatRoom__PendingName">{pf.file_name}</span>
                <span className="MessengerChatRoom__PendingSize">{formatFileSize(pf.file_size)}</span>
              </div>
              {pf.status === 'uploading' && (
                <div className="MessengerChatRoom__PendingProgress">
                  <div className="MessengerChatRoom__PendingProgressBar"
                       style={{ width: `${pf.progress}%` }} />
                </div>
              )}
              <button className="MessengerChatRoom__PendingRemove"
                      onClick={() => removePendingFile(pf.id)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        accept={ALLOWED_EXTENSIONS.join(',')}
        onChange={(e) => {
          if (e.target.files?.length) handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        className="MessengerChatRoom__AttachBtn"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || sending}
        title={t('messenger.composer.attachFiles')}
      >
        <Paperclip size={16} />
      </button>
      <div className={`MessengerChatRoom__InputWrap ${codeMode ? 'MessengerChatRoom__InputWrap--code' : ''}`}>
        {codeMode && (
          <div className="MessengerChatRoom__CodeLabel">{t('messenger.composer.codeLabel')}</div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder={codeMode ? t('messenger.composer.codePlaceholder') : t('messenger.composer.messagePlaceholder')}
          className={`MessengerChatRoom__InputField ${codeMode ? 'MessengerChatRoom__InputField--code' : ''}`}
          rows={1}
        />
      </div>
      <button
        className={`MessengerChatRoom__SendBtn ${sendDisabled ? 'MessengerChatRoom__SendBtn--disabled' : ''}`}
        onClick={submit}
        disabled={sendDisabled}
      >
        <Send size={14} />
      </button>
    </div>
  );
});

export default MessengerComposer;
