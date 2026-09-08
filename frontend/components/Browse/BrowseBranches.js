import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { Search, Users, Globe, GitBranch, FileText } from 'lucide-react';
import EntityIcon from '@/components/common/EntityIcon';
import NavLink from '@/components/common/NavLink';

export default function BrowseBranches() {
  const { t } = useTranslation();
  const [branches, setBranches] = useState([]);
  const [canvases, setCanvases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    fetchResults('');
  }, []);

  const fetchResults = async (q) => {
    setLoading(true);
    try {
      const param = q ? `?q=${encodeURIComponent(q)}` : '';
      const [branchRes, canvasRes] = await Promise.all([
        axios.get(`/branches/public${param}`),
        axios.get(`/canvases/public${param}`),
      ]);
      if (branchRes.data.status) setBranches(branchRes.data.branches);
      if (canvasRes.data.status) setCanvases(canvasRes.data.canvases);
    } catch {}
    setLoading(false);
  };

  const handleSearch = (value) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchResults(value), 300);
  };

  const handleJoinBranch = async (branchId) => {
    try {
      const res = await axios.post(`/branches/${branchId}/join`);
      if (res.data.status) {
        setBranches((prev) =>
          prev.map((b) => b.branch_id === branchId ? { ...b, is_member: true } : b)
        );
        window.dispatchEvent(new Event('branch:created'));
      }
    } catch {}
  };

  const handleJoinCanvas = async (canvasId) => {
    try {
      const res = await axios.post(`/canvases/${canvasId}/join`);
      if (res.data.status) {
        setCanvases((prev) =>
          prev.map((c) => c.canvas_id === canvasId ? { ...c, is_member: true } : c)
        );
        window.dispatchEvent(new Event('canvas:created'));
      }
    } catch {}
  };

  const isEmpty = !loading && branches.length === 0 && canvases.length === 0;

  return (
    <div className="BrowseBranches">
      <div className="BrowseBranches__Header">
        <div className="BrowseBranches__TitleRow">
          <Globe size={20} />
          <h2 className="BrowseBranches__Title">{t('account.browse.title')}</h2>
        </div>
        <p className="BrowseBranches__Desc">
          {t('account.browse.description')}
        </p>
      </div>

      {/* 검색 */}
      <div className="BrowseBranches__SearchWrap">
        <Search size={16} className="BrowseBranches__SearchIcon" />
        <input
          className="BrowseBranches__SearchInput"
          placeholder={t('account.browse.searchPlaceholder')}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {/* 결과 */}
      <div className="BrowseBranches__List">
        {loading && branches.length === 0 && canvases.length === 0 && (
          <div className="BrowseBranches__Empty">{t('common.state.loading')}</div>
        )}
        {isEmpty && (
          <div className="BrowseBranches__Empty">
            {query ? t('account.browse.noResults') : t('account.browse.emptyPublic')}
          </div>
        )}

        {/* Branches 섹션 */}
        {branches.length > 0 && (
          <>
            <div className="BrowseBranches__SectionLabel">
              <GitBranch size={14} />
              <span>{t('account.browse.branches')}</span>
            </div>
            {branches.map((branch) => (
              <div key={branch.branch_id} className="BrowseBranches__Card">
                <div className="BrowseBranches__CardMain">
                  <div className="BrowseBranches__CardHeader">
                    <EntityIcon
                      icon={branch.icon}
                      color={branch.color}
                      size={14}
                      entityType="branch"
                    />
                    <span className="BrowseBranches__CardName">{branch.branch_name}</span>
                    <span className="BrowseBranches__CardKey">{branch.key}</span>
                  </div>
                  {branch.description && (
                    <p className="BrowseBranches__CardDesc">{branch.description}</p>
                  )}
                  <div className="BrowseBranches__CardMeta">
                    <Users size={13} />
                    <span>{t('account.browse.memberCount', { count: branch.member_count || 0 })}</span>
                  </div>
                </div>
                {branch.is_member ? (
                  <NavLink
                    href={`/branch/${branch.branch_id}`}
                    className="BrowseBranches__JoinBtn BrowseBranches__JoinBtn--joined"
                  >
                    {t('spaceMenu.open')}
                  </NavLink>
                ) : (
                  <button
                    className="BrowseBranches__JoinBtn"
                    onClick={() => handleJoinBranch(branch.branch_id)}
                  >
                    {t('account.browse.join')}
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {/* Canvases 섹션 */}
        {canvases.length > 0 && (
          <>
            <div className="BrowseBranches__SectionLabel">
              <FileText size={14} />
              <span>{t('account.browse.canvases')}</span>
            </div>
            {canvases.map((canvas) => (
              <div key={canvas.canvas_id} className="BrowseBranches__Card">
                <div className="BrowseBranches__CardMain">
                  <div className="BrowseBranches__CardHeader">
                    <EntityIcon
                      icon={canvas.icon}
                      color={canvas.color}
                      size={14}
                      entityType="canvas"
                    />
                    <span className="BrowseBranches__CardName">{canvas.canvas_name}</span>
                    <span className="BrowseBranches__CardKey">{canvas.key}</span>
                  </div>
                  {canvas.description && (
                    <p className="BrowseBranches__CardDesc">{canvas.description}</p>
                  )}
                  <div className="BrowseBranches__CardMeta">
                    <Users size={13} />
                    <span>{t('account.browse.memberCount', { count: canvas.member_count || 0 })}</span>
                  </div>
                </div>
                {canvas.is_member ? (
                  <NavLink
                    href={`/canvas/${canvas.canvas_id}`}
                    className="BrowseBranches__JoinBtn BrowseBranches__JoinBtn--joined"
                  >
                    {t('spaceMenu.open')}
                  </NavLink>
                ) : (
                  <button
                    className="BrowseBranches__JoinBtn"
                    onClick={() => handleJoinCanvas(canvas.canvas_id)}
                  >
                    {t('account.browse.join')}
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
