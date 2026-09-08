import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, FileText } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function DocSearchPopup({ keyword, onSelect, onClose }) {
  const { t } = useTranslation();
  const [docs, setDocs] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  // 디바운스 검색
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get('/chat/doc-search', {
          params: { q: keyword },
        });
        if (res.data.status) {
          setDocs(res.data.docs);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword]);

  // 키보드 네비게이션
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((prev) => Math.min(prev + 1, docs.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (docs[activeIdx]) onSelect(docs[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [docs, activeIdx, onSelect, onClose]);

  return (
    <div className="DocSearchPopup">
      <div className="DocSearchPopup__Header">
        <Search size={12} />
        {t('messenger.search.docHeader')}
      </div>
      <ul className="DocSearchPopup__List">
        {loading && <li className="DocSearchPopup__Empty">{t('messenger.search.searching')}</li>}
        {!loading && docs.length === 0 && (
          <li className="DocSearchPopup__Empty">{t('messenger.search.noDocs')}</li>
        )}
        {!loading && docs.map((doc, idx) => (
          <li
            key={doc.page_id}
            className={`DocSearchPopup__Item ${idx === activeIdx ? 'DocSearchPopup__Item--active' : ''}`}
            onClick={() => onSelect(doc)}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <FileText size={12} className="DocSearchPopup__ItemIcon" />
            <span className="DocSearchPopup__ItemTitle">{doc.title}</span>
            <span className="DocSearchPopup__ItemCanvas">{doc.canvas_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
