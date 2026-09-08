import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, ArrowRight } from 'lucide-react';
import { axios } from '@/library/_axios';
import Avatar from '@/components/common/Avatar';
import { useTranslation } from 'react-i18next';
import { useDateFormat } from '@/hooks/useDateFormat';
import { addDaysToDateOnly, dateOnlyInTimeZone, todayInTimeZone } from '@/library/formatDateTime';
import { activitySummary, changeValueText } from '@/library/activitySummary';

/**
 * ActivityTimeline - Task/Canvas 페이지의 활동 이력 타임라인
 *
 * @param {string} apiUrl - activity API 경로 (예: /branches/1/tasks/2/activity)
 * @param {boolean} expanded - 전체 표시 여부 (false면 최근 5개만)
 */
export default function ActivityTimeline({ apiUrl, expanded = false }) {
  const { t } = useTranslation();
  const { timeZone, formatDateOnly } = useDateFormat();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const LIMIT = 20;

  const fetchActivities = useCallback(async (append = false) => {
    if (!apiUrl) return;
    const currentOffset = append ? offsetRef.current : 0;
    try {
      const res = await axios.get(apiUrl, {
        params: { limit: LIMIT, offset: currentOffset },
      });
      if (res.data.status) {
        const items = res.data.activities || [];
        if (append) {
          setActivities((prev) => [...prev, ...items]);
        } else {
          setActivities(items);
        }
        setHasMore(items.length >= LIMIT);
        offsetRef.current = currentOffset + items.length;
      }
    } catch {}
    setLoading(false);
  }, [apiUrl]);

  useEffect(() => {
    setLoading(true);
    offsetRef.current = 0;
    fetchActivities(false);
  }, [fetchActivities]);

  // 외부 이벤트로 갱신
  useEffect(() => {
    const handler = () => {
      offsetRef.current = 0;
      fetchActivities(false);
    };
    window.addEventListener('task:updated', handler);
    window.addEventListener('canvas_page:updated', handler);
    return () => {
      window.removeEventListener('task:updated', handler);
      window.removeEventListener('canvas_page:updated', handler);
    };
  }, [fetchActivities]);

  const displayActivities = expanded ? activities : activities.slice(0, 5);

  // 날짜별 그룹핑
  const grouped = groupByDate(displayActivities, { timeZone, formatDateOnly, t });

  if (loading && activities.length === 0) {
    return (
      <div className="ActivityTimeline">
        <div className="ActivityTimeline__Header">
          <span className="ActivityTimeline__Label">
            <Clock size={13} />
            {t('common.activity.title')}
          </span>
        </div>
        <div className="ActivityTimeline__Empty">{t('common.state.loading')}</div>
      </div>
    );
  }

  return (
    <div className="ActivityTimeline">
      <div className="ActivityTimeline__Header">
        <span className="ActivityTimeline__Label">
          <Clock size={13} />
          {t('common.activity.title')}
          {activities.length > 0 && (
            <span className="ActivityTimeline__Count">{activities.length}</span>
          )}
        </span>
      </div>

      {displayActivities.length === 0 ? (
        <div className="ActivityTimeline__Empty">{t('common.activity.empty')}</div>
      ) : (
        <div className="ActivityTimeline__List">
          {grouped.map(({ label, items }) => (
            <div key={label} className="ActivityTimeline__Group">
              <div className="ActivityTimeline__DateLabel">{label}</div>
              {items.map((activity) => (
                <ActivityItem key={activity.log_id} activity={activity} />
              ))}
            </div>
          ))}
        </div>
      )}

      {expanded && hasMore && (
        <button
          className="ActivityTimeline__More"
          onClick={() => fetchActivities(true)}
        >
          {t('common.actions.loadMore')}
        </button>
      )}
    </div>
  );
}


function ActivityItem({ activity }) {
  const { t } = useTranslation();
  const { formatRelative } = useDateFormat();
  const { formatDateOnly } = useDateFormat();
  const { actor_id, actor_name, actor_avatar, actor_avatar_color, changes, created_at } = activity;
  // 요약은 action·changes에서 **읽는 시점의 언어**로 만든다(저장된 summary는 구버전 행 폴백).
  // 값 포매터(changeValueText)를 아래 ChangeDetail과 공유해 요약과 펼친 상세가 같은 표기를 쓴다.
  const summary = activitySummary(activity, t, { formatDateOnly });

  return (
    <div className="ActivityTimeline__Item">
      <div className="ActivityTimeline__ItemHeader">
        <span className="ActivityTimeline__Actor">
          <Avatar
            name={actor_name}
            userId={actor_id}
            avatarUrl={actor_avatar}
            avatarColor={actor_avatar_color}
            size="xs"
            className="ActivityTimeline__Avatar"
          />
          <span className="ActivityTimeline__Author">{actor_name || t('common.activity.unknownUser')}</span>
        </span>
        <span className="ActivityTimeline__Time">{formatRelative(created_at)}</span>
      </div>
      <div className="ActivityTimeline__Summary">{summary}</div>
      {Array.isArray(changes) && changes.length > 0 && (
        <div className="ActivityTimeline__Changes">
          {changes.map((ch, i) => (
            <ChangeDetail key={i} change={ch} />
          ))}
        </div>
      )}
    </div>
  );
}


function ChangeDetail({ change }) {
  const { t } = useTranslation();
  const { formatDateOnly } = useDateFormat();
  const { field, added, removed, changed } = change;

  // content 변경 (메타데이터만)
  if (changed) {
    return null; // summary에 이미 표시됨
  }

  // 담당자 role 전이 — old/new 쌍이 아니라 요약 한 문장이 전부다(요약에 이미 나온다).
  if (field === 'assignee_role') return null;

  // 집합형 (assignees, labels)
  if (added || removed) {
    // assignees는 user_id를 가지므로 일관성을 위해 작은 아바타 칩으로 표시,
    // labels 등 사람이 아닌 항목은 기존처럼 이름 텍스트로 표시.
    const isPeople = field === 'assignees';
    const addedItems = added || [];
    const removedItems = removed || [];

    if (isPeople) {
      const renderChips = (items, sign, cls) => items.length > 0 && (
        <span className={`${cls} ActivityTimeline__ChangeChips`}>
          {sign}
          {items.map((p) => (
            <span key={p.user_id} className="ActivityTimeline__ChangeChip">
              <Avatar user={p} size="xs" className="ActivityTimeline__Avatar" />
              {p.username || '?'}
            </span>
          ))}
        </span>
      );
      return (
        <div className="ActivityTimeline__ChangeRow">
          {renderChips(addedItems, '+', 'ActivityTimeline__ChangeAdded')}
          {renderChips(removedItems, '-', 'ActivityTimeline__ChangeRemoved')}
        </div>
      );
    }

    const addedNames = addedItems.map((a) => a.username || a.label_name || '?');
    const removedNames = removedItems.map((r) => r.username || r.label_name || '?');
    return (
      <div className="ActivityTimeline__ChangeRow">
        {addedNames.length > 0 && (
          <span className="ActivityTimeline__ChangeAdded">+{addedNames.join(', ')}</span>
        )}
        {removedNames.length > 0 && (
          <span className="ActivityTimeline__ChangeRemoved">-{removedNames.join(', ')}</span>
        )}
      </div>
    );
  }

  // description은 diff가 너무 김 -> 생략
  if (field === 'description') return null;

  // 스칼라 필드 — 요약 문장과 **같은 포매터**를 쓴다(priority 라벨·date-only locale 표기 포함).
  const displayOld = truncate(changeValueText(change, 'old', { t, formatDateOnly }));
  const displayNew = truncate(changeValueText(change, 'new', { t, formatDateOnly }));

  return (
    <div className="ActivityTimeline__ChangeRow">
      <span className="ActivityTimeline__ChangeOld">{displayOld}</span>
      <ArrowRight size={10} className="ActivityTimeline__ChangeArrow" />
      <span className="ActivityTimeline__ChangeNew">{displayNew}</span>
    </div>
  );
}


/** 긴 값은 잘라 한 줄에 맞춘다(표시 전용 — 값 해석은 changeValueText가 한다). */
function truncate(text) {
  const s = String(text ?? '');
  return s.length > 50 ? `${s.slice(0, 50)}...` : s;
}



// 날짜 구분선은 **개인 timezone의 달력 날짜**로 나눈다. created_at은 instant이므로
// 브라우저 기본 timezone으로 나누면 설정을 바꾼 사용자에게 경계가 어긋난다.
function groupByDate(activities, { timeZone, formatDateOnly, t }) {
  const groups = [];
  const today = todayInTimeZone(timeZone);
  const yesterday = addDaysToDateOnly(today, -1);

  let currentLabel = null;
  let currentItems = [];

  for (const act of activities) {
    const day = dateOnlyInTimeZone(act.created_at, timeZone);
    let label;
    if (day === today) {
      label = t('common.time.today');
    } else if (day === yesterday) {
      label = t('common.time.yesterdayLabel');
    } else {
      label = formatDateOnly(day, { month: 'long', day: 'numeric' });
    }

    if (label !== currentLabel) {
      if (currentLabel !== null) {
        groups.push({ label: currentLabel, items: currentItems });
      }
      currentLabel = label;
      currentItems = [act];
    } else {
      currentItems.push(act);
    }
  }
  if (currentLabel !== null) {
    groups.push({ label: currentLabel, items: currentItems });
  }

  return groups;
}
