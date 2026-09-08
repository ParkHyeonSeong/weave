import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { ArrowLeft, Archive, RotateCcw, Trash2 } from 'lucide-react';

/**
 * 앱별 보관함 공용 뷰. 아카이브된 공간을 나열하고 복원/영구삭제한다.
 * props:
 *  - title: 헤더 제목
 *  - backHref: 돌아갈 경로
 *  - fetchItems: async () => [{ id, name, sub, color }]
 *  - onRestore: async (id) => boolean
 *  - onPermanentDelete: async (id) => boolean
 */
export default function ArchiveView({ title, backHref, fetchItems, onRestore, onPermanentDelete }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState(null);   // null = 로딩 중
  const [confirmId, setConfirmId] = useState(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchItems()
      .then((data) => { if (alive) setItems(data); })
      .catch(() => { if (alive) setItems([]); });   // 실패 시 무한 로딩 방지
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRestore = async (id) => {
    setBusy(true);
    try {
      if (await onRestore(id)) setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {}
    setBusy(false);
  };

  const handlePermanent = async (item) => {
    if (confirmInput !== item.name || busy) return;
    setBusy(true);
    try {
      if (await onPermanentDelete(item.id)) {
        setItems((prev) => prev.filter((x) => x.id !== item.id));
      }
    } catch {}
    // 성공/실패 무관하게 확인 UI는 닫는다(busy가 멈추지 않도록).
    setConfirmId(null);
    setConfirmInput('');
    setBusy(false);
  };

  return (
    <div className="ArchiveView">
      <header className="ArchiveView__Head">
        <button className="ArchiveView__Back" onClick={() => router.push(backHref)}>
          <ArrowLeft size={16} /> {t('common.actions.back')}
        </button>
        <h2 className="ArchiveView__Title"><Archive size={18} /> {title}</h2>
      </header>

      {items === null ? (
        <div className="ArchiveView__Loading">{t('common.state.loading')}</div>
      ) : items.length === 0 ? (
        <div className="ArchiveView__Empty">
          <Archive size={40} />
          <p>{t('home.archive.empty')}</p>
        </div>
      ) : (
        <ul className="ArchiveView__List">
          {items.map((item) => (
            <li key={item.id} className="ArchiveView__Card">
              <span className="ArchiveView__Dot" style={{ background: item.color || '#94a3b8' }} />
              <div className="ArchiveView__Info">
                <span className="ArchiveView__Name">{item.name}</span>
                {item.sub && <span className="ArchiveView__Sub">{item.sub}</span>}
              </div>
              {confirmId === item.id ? (
                <div className="ArchiveView__Confirm">
                  <span className="ArchiveView__ConfirmText">{t('home.archive.confirmPrefix')} <strong>{item.name}</strong> {t('home.archive.confirmSuffix')}</span>
                  <input
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder={item.name}
                    autoFocus
                  />
                  <button
                    className="ArchiveView__DangerBtn"
                    disabled={confirmInput !== item.name || busy}
                    onClick={() => handlePermanent(item)}
                  >
                    {t('home.archive.permanentDelete')}
                  </button>
                  <button
                    className="ArchiveView__GhostBtn"
                    onClick={() => { setConfirmId(null); setConfirmInput(''); }}
                  >
                    {t('common.actions.cancel')}
                  </button>
                </div>
              ) : (
                <div className="ArchiveView__Actions">
                  <button className="ArchiveView__RestoreBtn" disabled={busy} onClick={() => handleRestore(item.id)}>
                    <RotateCcw size={14} /> {t('home.archive.restore')}
                  </button>
                  <button
                    className="ArchiveView__DeleteBtn"
                    onClick={() => { setConfirmId(item.id); setConfirmInput(''); }}
                  >
                    <Trash2 size={14} /> {t('home.archive.permanentDelete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
