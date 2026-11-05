import { useState, useEffect, useMemo, useCallback, useId } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Users, Settings, LayoutList, Columns3, Rows3, Check } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import useScrumWeekCollab from '@/library/useScrumWeekCollab';
import useCollabSynced from '@/library/useCollabSynced';
import { todayDayIndex, isWeekday, initialSelectedDay } from '@/library/scrumViewModel';
import ScrumWeekGrid from './ScrumWeekGrid';
import ScrumDayView from './ScrumDayView';
import ScrumDaySelector from './ScrumDaySelector';
import RetroView from './RetroView';
import ScrumMembersModal from './ScrumMembersModal';
import Avatar from '@/components/common/Avatar';
import DatePicker from '@/components/common/DatePicker';
import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';
import { isoWeekOfDateOnly, weekDates, getISOWeek } from '@/library/isoWeek';
import { useWorkspaceDateFormat } from '@/hooks/useDateFormat';
import { useWorkspaceSettings } from '@/library/workspaceSettings';
import NavLink from '@/components/common/NavLink';
import CollabStatusBadge from '@/components/shared/CollabStatusBadge';

const getProfile = () => {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}'); } catch { return {}; }
};

// 'YYYY-MM-DD' ↔ 로컬 Date (getISOWeek/jumpWeek과 같은 로컬 기준 — UTC off-by-one 방지)
const ymdToDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateToYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftYmd = (s, days) => { const d = ymdToDate(s); d.setDate(d.getDate() + days); return dateToYmd(d); };
const urlParam = (name) => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get(name) : null);

export default function ScrumBoardView() {
  const router = useRouter();
  const { t } = useTranslation();
  const boardId = router.isReady ? Number(router.query.boardId) : null;
  const [board, setBoard] = useState(null);
  const [members, setMembers] = useState([]);
  const [weekId, setWeekId] = useState(null);
  const [tab, setTab] = useState(() => (urlParam('tab') === 'retro' ? 'retro' : 'board'));
  // 주간 보드 보기 방식: 기본은 하루 보기, ?view=week면 한 주 보기
  const [view, setView] = useState(() => (urlParam('view') === 'week' ? 'week' : 'day'));
  // 하루 보기에서 고른 요일(0~4). null = 아직 안 채움 → 주차·오늘이 정해지면 한 번 채우고,
  // 그 뒤에는 다른 주로 가도 유지한다("오늘로"만 오늘 요일로 되돌린다). 한 주 보기의 넓게 보는 요일도 이 값.
  const [selectedDay, setSelectedDay] = useState(null);
  // 한 주 보기 툴바: 보이는 행(최소 하나는 켜짐)과 전체/나만. 저장하지 않는 화면 안 상태(스펙 §3).
  const [weekRows, setWeekRows] = useState({ plan: true, recap: true });
  const [weekMineOnly, setWeekMineOnly] = useState(false);
  const weekRowsLabelId = useId();
  // 회고 보기 방식('topic' 항목별 | 'person' 사람별, 기본 항목별). 저장하지 않는 화면 안 상태(스펙 §3).
  const [retroView, setRetroView] = useState('topic');
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

  // 보드를 바꾸면 기준 날짜를 현재로, 고른 요일은 다시 채우도록 초기화
  useEffect(() => { setAnchorDate(null); setSelectedDay(null); }, [boardId]);
  useEffect(() => {
    if (selectedDay !== null || !wk) return;
    setSelectedDay(initialSelectedDay(workspaceToday(), wk.isoYear, wk.isoWeek));
  }, [selectedDay, wk, workspaceToday]);
  // 하루 보기·요일 선택은 props가 같으면 다시 그리지 않으므로(memo) 날짜 배열을 주차 값으로 고정한다
  const dates = useMemo(
    () => (wk ? weekDates(wk.isoYear, wk.isoWeek) : null),
    [wk?.isoYear, wk?.isoWeek],
  );
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

  const { ydoc, provider, connectedUsers, status, connection, pending } = useScrumWeekCollab(boardId, weekId, user);
  // 주간 문서의 첫 동기화 — 그 전에는 하루·한 주 보기가 작성 여부(n/N·작성 전·작성함)를 말하지 않는다
  const synced = useCollabSynced(provider);

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

  // 주 범위·회고 기간은 공유 date-only다 — 월/일을 손으로 잇지 않고 locale formatter로 낸다.
  const range = formatDateOnlyRange(dates[0].date, dates[4].date);
  const isThisWeek = (() => {
    const c = isoWeekOfDateOnly(workspaceToday());
    return c.isoYear === wk.isoYear && c.isoWeek === wk.isoWeek;
  })();
  // '오늘' 표시(배지·강조)는 이번 주의 평일에만. 주말에는 금요일을 고르지만(아래 day·goToday) 오늘이라 하지 않는다.
  const todayIdx = isThisWeek && isWeekday(workspaceToday()) ? todayDayIndex(workspaceToday()) : -1;
  // 채우기 효과가 돌기 전 한 번의 렌더도 같은 값을 보게 한다
  const day = selectedDay ?? initialSelectedDay(workspaceToday(), wk.isoYear, wk.isoWeek);
  const weekReady = !!weekId && !!ydoc;
  const retroRange = retroData
    ? formatDateOnlyRange(retroData.retro.period_start, retroData.retro.period_end)
    : '';
  // 'YYYY-MM-DD' 선택 → 그 날짜를 공용 기준 날짜로 (주간보드·회고 동기화)
  const jumpWeek = (d) => { if (d) setAnchorDate(d); };
  // "오늘로"는 이번 주로 돌아가면서 오늘 요일도 다시 고른다(주말이면 금요일)
  const goToday = () => { setAnchorDate(null); setSelectedDay(todayDayIndex(workspaceToday())); };
  // 보드 멤버가 아니면 '나만'은 아무도 안 보이므로 버튼을 숨기고 값도 무시한다(하루 보기와 같은 규칙)
  const iAmMember = members.some((m) => m.user_id === user?.user_id);
  const weekMine = weekMineOnly && iAmMember;
  // 마지막으로 켜진 행은 끌 수 없다 — 버튼은 disabled, 여기서도 한 번 더 막는다
  const toggleWeekRow = (row) => setWeekRows((r) => {
    const next = { ...r, [row]: !r[row] };
    return next.plan || next.recap ? next : r;
  });
  const weekRowToggle = (row, labelKey) => {
    const on = weekRows[row];
    return (
      <button
        type="button"
        className="ScrumBoard__WeekRowBtn"
        aria-pressed={on}
        disabled={on && !(row === 'plan' ? weekRows.recap : weekRows.plan)}
        onClick={() => toggleWeekRow(row)}
      >
        {on && <Check size={13} />}
        {t(labelKey)}
      </button>
    );
  };

  return (
    <div className="ScrumBoard">
      <header className="ScrumBoard__Head">
        <div className="ScrumBoard__Title" style={{ '--accent': board.color }}>
          <span className="ScrumBoard__Mark" aria-hidden="true" />
          <span className="ScrumBoard__Name">{t('scrum.board.title', { name: board.name })}</span>
        </div>
        <div className="ScrumBoard__Tabs">
          <button type="button" aria-pressed={tab === 'board'} onClick={() => setTab('board')}>{t('scrum.board.tabWeek')}</button>
          <button type="button" aria-pressed={tab === 'retro'} onClick={() => setTab('retro')}>{t('scrum.board.tabRetro')}</button>
        </div>
        <div className="ScrumBoard__Presence">
          {/* 주간 문서의 연결·전달 안내 — 끊김·전송 미확인은 편집 중인 사람이 알아야 한다(아바타만으로는 알 수 없다) */}
          {tab === 'board' && ydoc && <CollabStatusBadge connection={connection} pending={pending} />}
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
      {(tab === 'board' || retroData) && (
        <div className="ScrumBoard__Toolbar">
          {tab === 'board' && (
            <>
              <div className="ScrumBoard__WeekNav">
                <button type="button" onClick={() => setAnchorDate((a) => shiftYmd(a ?? workspaceToday(), -7))} aria-label={t('scrum.board.prevWeek')}><ChevronLeft size={16} /></button>
                <DatePicker
                  value={null}
                  onChange={jumpWeek}
                  trigger={<span className="ScrumBoard__WeekLabel">{range}</span>}
                />
                <button type="button" onClick={() => setAnchorDate((a) => shiftYmd(a ?? workspaceToday(), 7))} aria-label={t('scrum.board.nextWeek')}><ChevronRight size={16} /></button>
                {isThisWeek ? (
                  <span className="ScrumBoard__ThisWeek">{t('scrum.board.thisWeek')}</span>
                ) : (
                  <button type="button" className="ScrumBoard__TodayBtn" onClick={goToday}>{t('scrum.board.goToday')}</button>
                )}
              </div>
              {view === 'day' && weekReady && members.length > 0 && (
                <ScrumDaySelector
                  ydoc={ydoc}
                  members={members}
                  dates={dates}
                  selectedDay={day}
                  todayIdx={todayIdx}
                  synced={synced}
                  onSelect={setSelectedDay}
                />
              )}
              {view === 'week' && weekReady && members.length > 0 && (
                <>
                  <div className="ScrumBoard__WeekRows" role="group" aria-labelledby={weekRowsLabelId}>
                    <span className="ScrumBoard__WeekRowsLabel" id={weekRowsLabelId}>{t('scrum.week.rows')}</span>
                    {weekRowToggle('plan', 'scrum.grid.rowPlan')}
                    {weekRowToggle('recap', 'scrum.grid.rowRecap')}
                  </div>
                  {iAmMember && (
                    <div className="ScrumSegment" role="group" aria-label={t('scrum.day.railTitle')}>
                      <button type="button" className="ScrumSegment__Btn" aria-pressed={!weekMine} onClick={() => setWeekMineOnly(false)}>
                        {t('scrum.day.filterAll')}
                      </button>
                      <button type="button" className="ScrumSegment__Btn" aria-pressed={weekMine} onClick={() => setWeekMineOnly(true)}>
                        {t('scrum.day.filterMine')}
                      </button>
                    </div>
                  )}
                </>
              )}
              <div className="ScrumBoard__ViewSwitch ScrumSegment" role="group" aria-label={t('scrum.view.label')}>
                <button type="button" className="ScrumSegment__Btn" aria-pressed={view === 'day'} onClick={() => setView('day')}>
                  <LayoutList size={15} />
                  {t('scrum.view.day')}
                </button>
                <button type="button" className="ScrumSegment__Btn" aria-pressed={view === 'week'} onClick={() => setView('week')}>
                  <Columns3 size={15} />
                  {t('scrum.view.week')}
                </button>
              </div>
            </>
          )}
          {tab === 'retro' && retroData && (
            <>
              <div className="ScrumBoard__WeekNav">
                <button type="button" onClick={() => setAnchorDate(retroData.prev_date)} aria-label={t('scrum.board.prevRetro')}><ChevronLeft size={16} /></button>
                <DatePicker
                  value={retroData.retro.period_start}
                  onChange={(d) => { if (d) setAnchorDate(d); }}
                  trigger={<span className="ScrumBoard__WeekLabel">{retroRange}{retroData.is_current ? ` · ${t('scrum.board.currentRetro')}` : ''}</span>}
                />
                <button type="button" onClick={() => setAnchorDate(retroData.next_date)} aria-label={t('scrum.board.nextRetro')}><ChevronRight size={16} /></button>
                {!retroData.is_current && (
                  <button type="button" className="ScrumBoard__TodayBtn" onClick={() => setAnchorDate(null)}>{t('scrum.board.goCurrentRetro')}</button>
                )}
              </div>
              <div className="ScrumBoard__ViewSwitch ScrumSegment" role="group" aria-label={t('scrum.retro.viewLabel')}>
                <button type="button" className="ScrumSegment__Btn" aria-pressed={retroView === 'topic'} onClick={() => setRetroView('topic')}>
                  <Columns3 size={15} />
                  {t('scrum.retro.viewTopic')}
                </button>
                <button type="button" className="ScrumSegment__Btn" aria-pressed={retroView === 'person'} onClick={() => setRetroView('person')}>
                  <Rows3 size={15} />
                  {t('scrum.retro.viewPerson')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="ScrumBoard__Body">
        <div className="ScrumBoard__BodyMain">
          {tab === 'board' ? (
            !weekReady ? (
              <div className="ScrumBoard__Loading">{t('scrum.board.connecting')}</div>
            ) : members.length === 0 ? (
              <div className="ScrumBoard__Empty">{t('scrum.board.noMembers')}</div>
            ) : view === 'day' ? (
              <ScrumDayView
                ydoc={ydoc}
                members={members}
                meId={user?.user_id}
                selectedDay={day}
                todayIdx={todayIdx}
                dates={dates}
                synced={synced}
              />
            ) : (
              <ScrumWeekGrid
                ydoc={ydoc}
                members={members}
                meId={user?.user_id}
                isoYear={wk.isoYear}
                isoWeek={wk.isoWeek}
                focusDay={day}
                onFocusDay={setSelectedDay}
                showPlan={weekRows.plan}
                showRecap={weekRows.recap}
                mineOnly={weekMine}
                todayIdx={todayIdx}
                synced={synced}
              />
            )
          ) : (
            <RetroView
              boardId={boardId}
              members={members}
              retro={retroData?.retro || null}
              manual={retroManual}
              view={retroView}
              meId={user?.user_id}
              isCurrent={!!retroData?.is_current}
            />
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
