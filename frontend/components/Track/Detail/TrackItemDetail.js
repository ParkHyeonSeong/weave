import { useRef } from 'react';
import { useRouter } from 'next/router';
import { X, CalendarDays, Flag, ExternalLink, Lock, Layers, MessageSquare, GitBranch } from 'lucide-react';
import { sanitizeHtml } from '@/library/sanitize';
import { useRefHydration } from '@/library/refHydration';
import { useMathHydration } from '@/library/mathRender';
import Avatar from '@/components/common/Avatar';
import { PRIORITIES } from '../mockData';
import { entityBorderStyle, entityInkStyle, entitySolidStyle, entityTintStyle } from '@/library/entityTint';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useTranslation } from 'react-i18next';

// due_date는 date-only다 — new Date('YYYY-MM-DD')는 UTC 자정 instant라 음수 offset에서
// 하루 전으로 렌더된다. 하드코딩 영문 월 배열도 locale을 따르지 않았다.
const DUE_LONG_OPTS = { month: 'short', day: 'numeric' };

export default function TrackItemDetail({ item, branch, workflowStatuses, onClose, onRemove }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { formatDateOnly } = useDateFormat();
  const formatDateLong = (date) => (date ? formatDateOnly(date, DUE_LONG_OPTS) : '—');
  // openInBranch는 restricted/empty 분기 이후 렌더되므로 item/branch_id/task_id는 항상 존재
  const openInBranch = () => router.push(`/branch/${item.branch_id}?task=${item.task_id}`);

  // readonly 설명의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  const descRef = useRef(null);
  useRefHydration(descRef, [item?.description]);
  useMathHydration(descRef, [item?.description]);

  if (!item) {
    return (
      <aside className="TrackDetail TrackDetail--empty">
        <div className="TrackDetail__EmptyIcon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="#E5E5E5" strokeWidth="1.2" strokeDasharray="3 4" />
            <circle cx="24" cy="24" r="3" fill="#D1D5DB" />
          </svg>
        </div>
        <div className="TrackDetail__EmptyTitle">{t('track.itemDetail.noSelection')}</div>
        <div className="TrackDetail__EmptyHint">{t('track.itemDetail.noSelectionHint')}</div>
      </aside>
    );
  }

  if (item.restricted) {
    return (
      <aside className="TrackDetail TrackDetail--restricted">
        <button className="TrackDetail__Close" onClick={onClose} aria-label={t('common.actions.close')}><X size={14} /></button>
        <div className="TrackDetail__RestrictedHero">
          <div className="TrackDetail__RestrictedShield">
            <Lock size={20} />
          </div>
          <div className="TrackDetail__RestrictedTitle">{t('track.restricted.title')}</div>
          <div className="TrackDetail__RestrictedBody">
            {t('track.restricted.body')}
          </div>
          {item.restricted_hint && (
            <div className="TrackDetail__RestrictedHint">{item.restricted_hint}</div>
          )}
        </div>
      </aside>
    );
  }

  const ws = workflowStatuses[item.status] || {};
  const prio = PRIORITIES[item.priority] || {};
  // ⚠️ 이 패널의 배지 부모는 --track-card다(TrackTree 행과 같은 표면) — track-card 프로파일을 쓴다.
  //    default로 계산하면 다크에서 31색 중 17색이 BADGE_MIN 미달이다(실측 StatusPill 1.2425).
  const branchTint = entityTintStyle(branch.color, { from: 8, alpha: '14', surface: 'track-card' });
  const wsTint = entityTintStyle(ws.color, { from: 8, alpha: '14', surface: 'track-card' });
  const wsSolid = entitySolidStyle(ws.color);
  // 텍스트는 ink 축, 테두리는 우선순위 색 축 — 같은 값을 쓰면 high가 AA 미달이다.
  const prioInk = entityInkStyle(prio.ink);
  const prioBd = entityBorderStyle(prio.color, { from: 25, alpha: '40' });

  return (
    <aside className="TrackDetail">
      <div className="TrackDetail__Head">
        <div className="TrackDetail__Breadcrumb">
          <span
            className={`TrackDetail__BranchPill${branchTint?.['--et-on'] ? ' EntityTint' : ''}`}
            style={branchTint}
          >
            <GitBranch size={11} />
            {branch.name}
          </span>
          <span className="TrackDetail__BcSep">/</span>
          {item.parent && (
            <>
              <span
                className="TrackDetail__ParentCrumb"
                role="link"
                tabIndex={0}
                title={item.parent.title}
                onClick={() => router.push(`/branch/${item.branch_id}?task=${item.parent.task_id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') router.push(`/branch/${item.branch_id}?task=${item.parent.task_id}`);
                }}
              >
                {item.parent.display_id}
              </span>
              <span className="TrackDetail__BcSep">/</span>
            </>
          )}
          <span className="TrackDetail__DisplayId">{item.display_id}</span>
        </div>
        <button className="TrackDetail__Close" onClick={onClose} aria-label={t('common.actions.close')}><X size={14} /></button>
      </div>

      <h2 className="TrackDetail__Title">{item.title}</h2>

      <div className="TrackDetail__StatusRow">
        <span
          className={`TrackDetail__StatusPill${wsTint?.['--et-on'] ? ' EntityTint' : ''}`}
          style={wsTint}
        >
          <span
            className={`TrackDetail__StatusDot${wsSolid?.['--et-on'] ? ' EntitySolid' : ''}`}
            style={wsSolid}
          />
          {ws.label}
        </span>
        <span
          className={`TrackDetail__PrioPill${prioInk?.['--et-on'] ? ' EntityInk EntityBorder' : ''}`}
          style={{ ...prioInk, ...prioBd }}
        >
          <Flag size={10} />
          {prio.label ? t(`track.priority.${item.priority}`) : null}
        </span>
      </div>

      <dl className="TrackDetail__Meta">
        <div className="TrackDetail__MetaRow">
          <dt>{t('track.fields.assignee')}</dt>
          <dd>
            {item.assignees && item.assignees.length > 0 ? (
              <span className="TrackDetail__Assignee">
                <Avatar user={item.assignees[0]} size={20} />
                <span>{item.assignees[0].username}</span>
              </span>
            ) : <span className="TrackDetail__MetaEmpty">{t('track.itemDetail.unassigned')}</span>}
          </dd>
        </div>
        <div className="TrackDetail__MetaRow">
          <dt>{t('track.fields.due')}</dt>
          <dd>
            <CalendarDays size={12} className="TrackDetail__MetaIcon" />
            {formatDateLong(item.due_date)}
          </dd>
        </div>
        <div className="TrackDetail__MetaRow">
          <dt>{t('track.fields.origin')}</dt>
          <dd>
            <span>{branch.name}</span>
            <button
              type="button"
              className="TrackDetail__OriginLink"
              onClick={openInBranch}
            >
              <ExternalLink size={11} />
              <span>{t('track.itemDetail.open')}</span>
            </button>
          </dd>
        </div>
      </dl>

      <section className="TrackDetail__Section">
        <h3 className="TrackDetail__SectionTitle">
          <MessageSquare size={12} />
          {t('track.fields.description')}
        </h3>
        {item.description ? (
          <div
            ref={descRef}
            className="TrackDetail__Description"
            // eslint-disable-next-line react/no-danger -- sanitizeHtml로 정제, Branch TaskDetailPanel과 동일 패턴
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.description) }}
          />
        ) : (
          <p className="TrackDetail__Description">
            <span className="TrackDetail__MetaEmpty">{t('track.itemDetail.noDescription')}</span>
          </p>
        )}
      </section>

      <section className="TrackDetail__Section">
        <h3 className="TrackDetail__SectionTitle">
          <Layers size={12} />
          {t('track.itemDetail.alsoInTracks')}
        </h3>
        {item.other_tracks && item.other_tracks.length > 0 ? (
          <div className="TrackDetail__TrackChips">
            {item.other_tracks.map((tr) => (
              <a key={tr.track_id} className="TrackDetail__TrackChip" href={`/tracks/${tr.track_id}`}>
                <span className="TrackDetail__TrackChipMark" />
                {tr.track_name}
              </a>
            ))}
          </div>
        ) : (
          <div className="TrackDetail__MetaEmpty">{t('track.itemDetail.onlyThisTrack')}</div>
        )}
      </section>

      <footer className="TrackDetail__Foot">
        <button
          className="TrackDetail__FootBtn TrackDetail__FootBtn--ghost"
          onClick={() => onRemove?.(item.item_id)}
        >
          {t('track.actions.removeFromTrack')}
        </button>
        <button
          className="TrackDetail__FootBtn TrackDetail__FootBtn--primary"
          onClick={openInBranch}
        >
          {t('track.itemDetail.openInBranch')} ↗
        </button>
      </footer>
    </aside>
  );
}
