import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, FileText, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import NavLink from '@/components/common/NavLink';

export default function TaskPageLinkSection({ branchId, taskId }) {
  const { t } = useTranslation();
  const [links, setLinks] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchLinks = async () => {
    if (!branchId || !taskId) return;
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/pages`);
      if (res.data.status) setLinks(res.data.pages);
    } catch {}
  };

  useEffect(() => {
    fetchLinks();
  }, [branchId, taskId]);

  // 외부 클릭으로 검색 닫기
  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearch(false);
        setSearchQuery('');
        setSearchResults([]);
      }
    };
    if (showSearch) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSearch]);

  // 검색 debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await axios.get(
          `/branches/${branchId}/tasks/${taskId}/pages/search`,
          { params: { q: searchQuery } }
        );
        if (res.data.status) setSearchResults(res.data.pages);
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const handleLink = async (pageId) => {
    try {
      await axios.post(`/branches/${branchId}/tasks/${taskId}/pages`, { page_id: pageId });
      await fetchLinks();
      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch {}
  };

  const handleUnlink = async (e, linkId) => {
    e.stopPropagation();
    try {
      await axios.delete(`/branches/${branchId}/tasks/${taskId}/pages/${linkId}`);
      await fetchLinks();
    } catch {}
  };

  return (
    <div className="TaskPageLinkSection">
      <div className="TaskPageLinkSection__Header">
        <span className="TaskPageLinkSection__Label">{t('branchTasks2.pageLinks.title')}</span>
        <button
          className="TaskPageLinkSection__AddBtn"
          onClick={() => setShowSearch(!showSearch)}
        >
          <Plus size={14} />
        </button>
      </div>

      {showSearch && (
        <div className="TaskPageLinkSection__SearchWrap" ref={searchRef}>
          <input
            className="TaskPageLinkSection__SearchInput"
            type="text"
            placeholder={t('branchTasks2.pageLinks.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {(searchResults.length > 0 || searching) && (
            <div className="TaskPageLinkSection__SearchDropdown">
              {searching && searchResults.length === 0 ? (
                <div className="TaskPageLinkSection__SearchEmpty">{t('branchTasks2.pageLinks.searching')}</div>
              ) : (
                searchResults.map((page) => (
                  <button
                    key={page.page_id}
                    className="TaskPageLinkSection__SearchItem"
                    onClick={() => handleLink(page.page_id)}
                  >
                    <FileText size={14} className="TaskPageLinkSection__Icon" />
                    <span className="TaskPageLinkSection__PageTitle">{page.title || t('branchTasks2.pageLinks.untitled')}</span>
                    <span className="TaskPageLinkSection__CanvasName">{page.canvas_name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {links.length === 0 && !showSearch ? (
        <div className="TaskPageLinkSection__Empty">{t('branchTasks2.pageLinks.empty')}</div>
      ) : (
        <div className="TaskPageLinkSection__List">
          {links.map((link) => (
            <div key={link.link_id} className="TaskPageLinkSection__Item">
              {/* stretched-link 오버레이: unlink 버튼을 <a> 안에 중첩하지 않으려고 행을 덮는 링크로 분리 */}
              <NavLink
                className="TaskPageLinkSection__ItemOverlay"
                href={`/canvas/${link.canvas_id}/${link.page_id}`}
                aria-label={link.title || t('branchTasks2.pageLinks.untitled')}
              />
              <FileText size={14} className="TaskPageLinkSection__Icon" />
              <span className="TaskPageLinkSection__PageTitle">{link.title || t('branchTasks2.pageLinks.untitled')}</span>
              <span className="TaskPageLinkSection__CanvasName">{link.canvas_name}</span>
              <button
                className="TaskPageLinkSection__UnlinkBtn"
                onClick={(e) => handleUnlink(e, link.link_id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
