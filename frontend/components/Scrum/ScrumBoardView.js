import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Users, Settings } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import useScrumWeekCollab from '@/library/useScrumWeekCollab';
import ScrumWeekGrid from './ScrumWeekGrid';
import RetroView from './RetroView';
import ScrumMembersModal from './ScrumMembersModal';
import Avatar from '@/components/common/Avatar';
import DatePicker from '@/components/common/DatePicker';
import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';
import { isoWeekOfDateOnly, weekDates, getISOWeek } from '@/library/isoWeek';
import { useWorkspaceDateFormat } from '@/hooks/useDateFormat';
import { useWorkspaceSettings } from '@/library/workspaceSettings';
import NavLink from '@/components/common/NavLink';

const getProfile = () => {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}'); } catch { return {}; }
};

// 'YYYY-MM-DD' ↔ 로컬 Date (getISOWeek/jumpWeek과 같은 로컬 기준 — UTC off-by-one 방지)
const ymdToDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateToYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftYmd = (s, days) => { const d = ymdToDate(s); d.setDate(d.getDate() + days); return dateToYmd(d); };

export default function ScrumBoardView() {
  const router = useRouter();
  const { t } = useTranslation();
  const boardId = router.isReady ? Number(router.query.boardId) : null;
  const [board, setBoard] = useState(null);
  const [members, setMembers] = useState([]);
  const [weekId, setWeekId] = useState(null);
  const [tab, setTab] = useState(() => (typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('tab') === 'retro') ? 'retro' : 'board');
  const [err, setErr] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  // 공용 기간이므로 workspace timezone을 쓴다 — 개인 시간대가 아니다.
  const { today: workspaceToday, formatDateOnlyRange } = useWorkspaceDateFormat();
  // fail-closed: workspace 설정이 확정(status 'success')되기 전에는 주차/회고 get_or_create를
  // 보내지 않는다. 조회 실패('error')는 로딩이 아니라 오류로 보여주고 사용자가 재시도한다 —
  // 호환 tz로 조용히 진행하면 서울이 아닌 워크스페이스에서 잘못된 공유 주차 행이 생긴다.
  const { status: workspaceStatus, refresh: refreshWorkspace } = useWorkspaceSettings();
  const workspaceReady = workspaceStatus === 'success';
  // 주간보드·회고 공용 기준 날짜: null = 현재(workspace timezone의 오늘). 한 상태로 두 뷰를 동기화한다 —
  // 주간보드는 이 날짜의 ISO 주를, 회고는 이 날짜가 속한 기간을 파생한다.
  // 회고 이동 앵커(prev_date/next_date)는 백엔드가 기간과 함께 내려준다.
  const [anchorDate, setAnchorDate] = useState(null);
  // workspace 오늘을 모르면(null) wk도 null — 아래 효과들이 전부 보류된다.
  const wk = useMemo(
    () => (anchorDate ? getISOWeek(ymdToDate(anchorDate)) : isoWeekOfDateOnly(workspaceToday())),
    [anchorDate, workspaceToday],
  );
  const [retroData, setRetroData] = useState(null);   // { retro, prev_date, next_date, is_current }
  const [retroManual, setRetroManual] = useState(false);
  // 인라인 ref 칩(task/doc) 클릭 → 타입별 패널 오픈 (데일리·회고 탭 공통)
  const [previewRef, setPreviewRef] = useRefPreview();

  // 탭·주·회고기간 전환은 다른 문서로 가는 것 — 열려 있던 참조 패널은 닫는다
  useEffect(() => {
    setPreviewRef(null);
  }, [tab, wk?.isoYear, wk?.isoWeek, retroData?.retro?.retro_id, setPreviewRef]);

  // 보드를 바꾸면 기준 날짜를 현재로 초기화
  useEffect(() => { setAnchorDate(null); }, [boardId]);
  const user = useMemo(() => { const p = getProfile(); return p.user_id ? { user_id: p.user_id, username: p.username, avatar_url: p.avatar_url, avatar_color: p.avatar_color } : null; }, []);

  // 보드 상세 + 멤버
  const refetchBoard = useCallback(async () => {
    if (!boardId) return;
    try {
      const res = await axios.get(`/scrum/${boardId}`);
      if (res.data.status) {
        setBoard(res.data.board);
        const ms = res.data.board.members || [];
        const myId = user?.user_id;
        // 본인을 항상 맨 위로, 나머지는 원래 순서(가입순) 유지
        const ordered = myId
          ? [...ms].sort((a, b) => (b.user_id === myId) - (a.user_id === myId))
          : ms;
        setMembers(ordered);
      } else setErr(errorText(getErrorCode(res.data)) ?? t('scrum.board.accessDenied'));
    } catch { setErr(t('scrum.board.loadFailed')); }
  }, [boardId, user?.user_id, t]);

  useEffect(() => { refetchBoard(); }, [refetchBoard]);

  // 주 get_or_create → week_id
  useEffect(() => {
    if (!boardId || !workspaceReady || !wk) return;
    setWeekId(null);
    (async () => {
      try {
        const res = await axios.get(`/scrum/${boardId}/weeks/${wk.isoYear}/${wk.isoWeek}`);
        if (res.data.status) setWeekId(res.data.week.week_id);
      } catch {}
    })();
  // wk 객체 자체는 deps에 넣지 않는다 — 같은 주 안의 앵커/언어 변경으로 주 요청·Yjs 세션이 다시 열리지 않게.
  }, [boardId, wk?.isoYear, wk?.isoWeek, workspaceReady]);

  // 회고 탭: 기준 날짜가 속한 기간을 get_or_create + 이전/다음 이동 앵커 조회
  useEffect(() => {
    if (!boardId || !workspaceReady || tab !== 'retro') return;
    let alive = true;
    setRetroData(null);
    setRetroManual(false);
    (async () => {
      try {
        const q = anchorDate ? `?date=${anchorDate}` : '';
        const res = await axios.get(`/scrum/${boardId}/retros/period${q}`);
        if (!alive) return;
        if (res.data.status) {
          if (res.data.retro) setRetroData(res.data);
          else setRetroManual(true);   // manual 주기 → 자동 회고 없음
        }
      } catch {}
    })();
    return () => { alive = false; };
  }, [boardId, tab, anchorDate, workspaceReady]);

  const { ydoc, connectedUsers, status } = useScrumWeekCollab(boardId, weekId, user);

  if (err) return <div className="ScrumBoard__Error">{err}</div>;
  if (!board) return <div className="ScrumBoard__Loading">{t('common.state.loading')}</div>;
  // workspace 설정 실패 → 공유 주차를 정할 수 없다. 재시도만 열어 둔다(fail-closed).
  if (workspaceStatus === 'error') {
    return (
      <div className="ScrumBoard__Error" role="alert">
        <p>{t('scrum.workspaceSettingsFailed')}</p>
        <button type="button" className="ScrumBoard__RetryBtn" onClick={refreshWorkspace}>
          {t('common.actions.retry')}
        </button>
      </div>
    );
  }
  if (!workspaceReady || !wk) return <div className="ScrumBoard__Loading">{t('common.state.loading')}</div>;

  const dates = weekDates(wk.isoYear, wk.isoWeek);
  // 주 범위·회고 기간은 공유 date-only다 — 월/일을 손으로 잇지 않고 locale formatter로 낸다.
  const range = formatDateOnlyRange(dates[0].date, dates[4].date);
  const isThisWeek = (() => {
    const c = isoWeekOfDateOnly(workspaceToday());
    return c.isoYear === wk.isoYear && c.isoWeek === wk.isoWeek;
  })();
  const retroRange = retroData
    ? formatDateOnlyRange(retroData.retro.period_start, retroData.retro.period_end)
    : '';
  // 'YYYY-MM-DD' 선택 → 그 날짜를 공용 기준 날짜로 (주간보드·회고 동기화)
  const jumpWeek = (d) => { if (d) setAnchorDate(d); };

  return (
    <div className="ScrumBoard">
      <header className="ScrumBoard__Head">
        <div className="ScrumBoard__Title" style={{ '--accent': board.color }}>{t('scrum.board.title', { name: board.name })}</div>
        <div className="ScrumBoard__Tabs">
          <button className={tab === 'board' ? 'is-on' : ''} onClick={() => setTab('board')}>{t('scrum.board.tabWeek')}</button>
          <button className={tab === 'retro' ? 'is-on' : ''} onClick={() => setTab('retro')}>{t('scrum.board.tabRetro')}</button>
        </div>
        {tab === 'board' && (
          <div className="ScrumBoard__WeekNav">
            <button onClick={() => setAnchorDate((a) => shiftYmd(a ?? workspaceToday(), -7))} aria-label={t('scrum.board.prevWeek')}><ChevronLeft size={16} /></button>
            <DatePicker
              value={null}
              onChange={jumpWeek}
              trigger={<span className="ScrumBoard__WeekLabel">{range}{isThisWeek ? ` · ${t('scrum.board.thisWeek')}` : ''}</span>}
            />
            <button onClick={() => setAnchorDate((a) => shiftYmd(a ?? workspaceToday(), 7))} aria-label={t('scrum.board.nextWeek')}><ChevronRight size={16} /></button>
            {!isThisWeek && (
              <button className="ScrumBoard__TodayBtn" onClick={() => setAnchorDate(null)}>{t('scrum.board.goToday')}</button>
            )}
          </div>
        )}
        {tab === 'retro' && retroData && (
          <div className="ScrumBoard__WeekNav">
            <button onClick={() => setAnchorDate(retroData.prev_date)} aria-label={t('scrum.board.prevRetro')}><ChevronLeft size={16} /></button>
            <DatePicker
              value={retroData.retro.period_start}
              onChange={(d) => { if (d) setAnchorDate(d); }}
              trigger={<span className="ScrumBoard__WeekLabel">{retroRange}{retroData.is_current ? ` · ${t('scrum.board.currentRetro')}` : ''}</span>}
            />
            <button onClick={() => setAnchorDate(retroData.next_date)} aria-label={t('scrum.board.nextRetro')}><ChevronRight size={16} /></button>
            {!retroData.is_current && (
              <button className="ScrumBoard__TodayBtn" onClick={() => setAnchorDate(null)}>{t('scrum.board.goCurrentRetro')}</button>
            )}
          </div>
        )}
        <div className="ScrumBoard__Presence">
          {tab === 'board' && status === 'connected' && connectedUsers.length > 0 && (
            <span className="ScrumBoard__Live">
              {connectedUsers.slice(0, 5).map((u) => (
                <Avatar
                  key={u.clientId}
                  name={u.name}
                  userId={u.userId}
                  avatarUrl={u.avatar_url}
                  avatarColor={u.avatar_color}
                  size="xs"
                />
              ))}
              <span className="ScrumBoard__LiveText">{t('scrum.board.editingCount', { count: connectedUsers.length })}</span>
            </span>
          )}
          <button
            type="button"
            className="ScrumBoard__MembersBtn"
            onClick={() => setShowMembers(true)}
          >
            <Users size={14} />
            {t('scrum.board.memberCount', { count: members.length })}
          </button>
          <NavLink
            href={`/scrum/${boardId}/settings`}
            className="ScrumBoard__SettingsBtn"
            title={t('scrum.board.settings')}
            aria-label={t('scrum.board.settings')}
          >
            <Settings size={15} />
          </NavLink>
        </div>
      </header>
      <div className="ScrumBoard__Body">
        <div className="ScrumBoard__BodyMain">
          {tab === 'board' ? (
            !weekId || !ydoc ? (
              <div className="ScrumBoard__Loading">{t('scrum.board.connecting')}</div>
            ) : members.length === 0 ? (
              <div className="ScrumBoard__Empty">{t('scrum.board.noMembers')}</div>
            ) : (
              <ScrumWeekGrid ydoc={ydoc} members={members} isoYear={wk.isoYear} isoWeek={wk.isoWeek} />
            )
          ) : (
            <RetroView boardId={boardId} members={members} retro={retroData?.retro || null} manual={retroManual} />
          )}
        </div>
        <RefPanelHost
          previewRef={previewRef}
          onClose={() => setPreviewRef(null)}
          onChangeRef={setPreviewRef}
        />
      </div>
      {showMembers && (
        <ScrumMembersModal
          boardId={boardId}
          myRole={board.my_role}
          count={members.length}
          onClose={() => setShowMembers(false)}
          onChanged={refetchBoard}
        />
      )}
    </div>
  );
}
