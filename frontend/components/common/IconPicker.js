import { useState, useMemo, useEffect, useRef } from 'react';
import { X, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import EmojiPicker from 'emoji-picker-react';
import EntityIcon, { LUCIDE_MAP } from './EntityIcon';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import {
  CURATED_LUCIDE_ICONS,
  parseIcon,
  formatIcon,
  DEFAULT_COLORS,
} from '@/library/entityAppearance';
import { useTheme } from '@/library/theme';

const ENTITY_TO_ENDPOINT = {
  branch: 'branches',
  track:  'tracks',
  canvas: 'canvases',
};
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024;
const ACCEPTED_MIME = /^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/;

// 라벨은 render 시 t()로 해석한다(모듈 로드 시점에는 locale이 아직 정해지지 않는다).
const TABS = [
  { key: 'lucide', labelKey: 'common.iconPicker.tabLucide' },
  { key: 'emoji',  labelKey: 'common.iconPicker.tabEmoji' },
  { key: 'upload', labelKey: 'common.iconPicker.tabUpload' },
];

function tabForValue(value) {
  const parsed = parseIcon(value);
  switch (parsed.type) {
    case 'emoji': return 'emoji';
    case 'image': return 'upload';
    default:      return 'lucide';
  }
}

export default function IconPicker({
  isOpen,
  onClose,
  value,
  color,
  entityType,
  entityId,            // unused in this slice; Upload tab (Slice 5) will use it
  onChange,            // (newIconString) => void
}) {
  const { t } = useTranslation();
  const fallbackColor = DEFAULT_COLORS[entityType] || DEFAULT_COLORS.branch;
  const { resolved } = useTheme();

  // 초기값은 첫 렌더 깜빡임 방지용; 모달이 다시 열릴 때는 useEffect가 동기화한다.
  const [tab, setTab] = useState(() => tabForValue(value));
  const [draft, setDraft] = useState(value || null);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  // 모달이 열릴 때마다 부모의 현재 값으로 상태 초기화.
  // 닫혀있는 동안에는 unmount되지 않으므로 (null만 반환), 명시적 리셋이 필요.
  useEffect(() => {
    if (!isOpen) return;
    setTab(tabForValue(value));
    setDraft(value || null);
    setSearch('');
    setUploadError('');
  }, [isOpen, value]);

  const handleFile = async (file) => {
    if (!file) return;
    setUploadError('');
    if (file.size > MAX_UPLOAD_SIZE) {
      setUploadError(t('common.iconPicker.fileTooLarge'));
      return;
    }
    if (!ACCEPTED_MIME.test(file.type)) {
      setUploadError(t('common.iconPicker.unsupportedType'));
      return;
    }
    if (!entityId) {
      setUploadError(t('common.iconPicker.noEntityId'));
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const endpoint = ENTITY_TO_ENDPOINT[entityType];
      const res = await axios.post(`/${endpoint}/${entityId}/icon-upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.status) {
        setDraft(res.data.icon);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('common.iconPicker.uploadFailed');
        setUploadError(msg);
      }
    } catch {
      setUploadError(t('common.iconPicker.uploadFailed'));
    }
    setUploading(false);
  };

  const filteredLucide = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CURATED_LUCIDE_ICONS;
    return CURATED_LUCIDE_ICONS.filter((n) => n.includes(q));
  }, [search]);

  if (!isOpen) return null;

  const handleApply = () => {
    onChange(draft);
    onClose();
  };

  const handleReset = () => {
    setDraft(null);
  };

  return (
    <div className="IconPicker__Backdrop" onClick={onClose}>
      <div className="IconPicker" onClick={(e) => e.stopPropagation()}>
        <div className="IconPicker__Header">
          <h3 className="IconPicker__Title">{t('common.iconPicker.title')}</h3>
          <button className="IconPicker__Close" onClick={onClose} aria-label={t('common.actions.close')}>
            <X size={16} />
          </button>
        </div>

        <div className="IconPicker__Tabs">
          {TABS.map((tabItem) => (
            <button
              key={tabItem.key}
              className={`IconPicker__Tab${tab === tabItem.key ? ' IconPicker__Tab--active' : ''}`}
              onClick={() => setTab(tabItem.key)}
            >
              {t(tabItem.labelKey)}
            </button>
          ))}
        </div>

        <div className="IconPicker__Body">
          {tab === 'lucide' && (
            <>
              <div className="IconPicker__Search">
                <Search size={14} />
                <input
                  type="text"
                  placeholder={t('common.iconPicker.searchIcons')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="IconPicker__Grid">
                {filteredLucide.map((name) => {
                  const Icon = LUCIDE_MAP[name];
                  if (!Icon) return null;
                  const formatted = formatIcon('lucide', name);
                  const isActive = draft === formatted;
                  return (
                    <button
                      key={name}
                      className={`IconPicker__GridCell${isActive ? ' IconPicker__GridCell--active' : ''}`}
                      onClick={() => setDraft(formatted)}
                      title={name}
                    >
                      <Icon size={20} color={color || fallbackColor} strokeWidth={2.2} />
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {tab === 'emoji' && (
            <div className="IconPicker__EmojiWrap">
              <EmojiPicker
                onEmojiClick={(emojiData) => setDraft(formatIcon('emoji', emojiData.emoji))}
                width="100%"
                height={360}
                searchPlaceholder={t('common.iconPicker.searchEmoji')}
                previewConfig={{ showPreview: false }}
                // 문자열 enum이라 resolved를 그대로 넘긴다. AUTO 금지 — OS를 따라가 사용자 선택과 어긋난다.
                theme={resolved}
              />
            </div>
          )}

          {tab === 'upload' && (
            <div className="IconPicker__Upload">
              <p className="IconPicker__UploadHint">
                {t('common.iconPicker.uploadHint')}
              </p>
              <div
                className="IconPicker__DropZone"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFile(file);
                }}
              >
                {uploading ? (
                  <span>{t('common.iconPicker.uploading')}</span>
                ) : (
                  <>
                    <span>{t('common.iconPicker.dropZone')}</span>
                    <button type="button" className="IconPicker__BtnGhost">{t('common.iconPicker.chooseFile')}</button>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </div>
              {uploadError && <p className="IconPicker__UploadError">{uploadError}</p>}
              {parseIcon(draft).type === 'image' && (
                <div className="IconPicker__UploadPreview">
                  <span>{t('common.iconPicker.currentImage')}</span>
                  <EntityIcon icon={draft} color={color} size={44} entityType={entityType} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="IconPicker__Footer">
          <div className="IconPicker__Preview">
            <span>{t('common.iconPicker.previewLabel')}</span>
            <EntityIcon icon={draft} color={color} size={32} entityType={entityType} />
          </div>
          <div className="IconPicker__Actions">
            <button className="IconPicker__BtnGhost" onClick={handleReset}>{t('common.iconPicker.resetToDefault')}</button>
            <button className="IconPicker__BtnGhost" onClick={onClose}>{t('common.actions.cancel')}</button>
            <button className="IconPicker__BtnPrimary" onClick={handleApply}>{t('common.actions.apply')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
