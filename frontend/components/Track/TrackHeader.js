import { useRef, useState } from 'react';
import { Workflow, Calendar, GitBranch, Settings, Share2, Star } from 'lucide-react';
import EntityIcon from '@/components/common/EntityIcon';
import EntityAppearancePopover from '@/components/common/EntityAppearancePopover';
import AvatarStack from '@/components/common/AvatarStack';
import { entityBorderStyle, entityTintStyle } from '@/library/entityTint';
import { useTranslation } from 'react-i18next';

const VIEW_MODES = [
  { key: 'flow', labelKey: 'track.view.flow', icon: Workflow },
  { key: 'timeline', labelKey: 'track.view.timeline', icon: Calendar },
  { key: 'tree', labelKey: 'track.view.tree', icon: GitBranch },
];

export default function TrackHeader({
  track, members, viewMode, onViewModeChange,
  distribution, totalItems, totalLinks,
  participatingBranches, onOpenSettings,
}) {
  const { t } = useTranslation();
  const iconRef = useRef(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const canEditAppearance = track.my_role === 'owner' || track.my_role === 'editor';

  return (
    <header className="TrackHeader">
      <div className="TrackHeader__Top">
        <div className="TrackHeader__TitleBlock">
          <div className="TrackHeader__Eyebrow">
            <span ref={iconRef} style={{ display: 'inline-flex' }}>
              <EntityIcon
                icon={track.icon}
                color={track.color}
                size={24}
                entityType="track"
                onClick={canEditAppearance ? () => setPopoverOpen(true) : undefined}
                title={canEditAppearance ? t('track.header.editAppearance') : undefined}
              />
            </span>
            <EntityAppearancePopover
              anchorRef={iconRef}
              isOpen={popoverOpen}
              onClose={() => setPopoverOpen(false)}
              entityType="track"
              entityId={track.track_id}
              initialIcon={track.icon}
              initialColor={track.color}
            />
            <span className="TrackHeader__EyebrowText">TRACK · {String(track.track_id).padStart(3, '0')}</span>
          </div>
          <h1 className="TrackHeader__Title">{track.track_name}</h1>
          <p className="TrackHeader__Subtitle">{track.description}</p>

          {participatingBranches && participatingBranches.length > 0 && (
            <div className="TrackHeader__Participating">
              <span className="TrackHeader__ParticipatingLabel">{t('track.header.branches')}</span>
              <div className="TrackHeader__ParticipatingChips">
                {participatingBranches.map((b) => {
                  // 헤더 배경은 단색이 아니라 --track-paper → --track-paper-raised 세로 그라데이션이다.
                  // 위쪽 끝만 보면 통과하지만 아래쪽 끝(다크 최악)에서 31색 중 17색이 미달이었다.
                  const bTint = entityTintStyle(b.color, { from: 8, alpha: '14', surface: 'track-header' });
                  const bBd = entityBorderStyle(b.color, { from: 20, alpha: '33' });
                  return (
                    <span
                      key={b.branch_id}
                      className={`TrackHeader__ParticipatingChip${bTint?.['--et-on'] ? ' EntityTint EntityBorder' : ''}`}
                      style={{ ...bTint, ...bBd }}
                      title={b.name}
                    >
                      <EntityIcon
                        icon={b.icon}
                        color={b.color}
                        size={14}
                        entityType="branch"
                      />
                      {b.name}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="TrackHeader__Actions">
          <AvatarStack
            className="TrackHeader__MemberStack"
            users={members}
            max={4}
            size="sm"
          />
          <button className="TrackHeader__IconBtn" title={t('track.header.star')}>
            <Star size={16} />
          </button>
          <button className="TrackHeader__IconBtn" title={t('track.header.share')}>
            <Share2 size={16} />
          </button>
          <button
            className="TrackHeader__IconBtn"
            title={t('spaceMenu.settings')}
            onClick={onOpenSettings}
            disabled={!onOpenSettings}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      <div className="TrackHeader__Meta">
        <div className="TrackHeader__WeaveBlock">
          <div className="TrackHeader__WeaveLabel">
            <span className="TrackHeader__WeaveCaption">{t('track.header.composition')}</span>
            <span className="TrackHeader__WeaveCount">
              {totalItems} <em>{t('track.header.itemsLabel')}</em> · {totalLinks}{' '}
              <em>{t('track.header.linksLabel')}</em>
            </span>
          </div>
          <div className="TrackHeader__WeaveBar" role="img" aria-label={t('track.header.compositionAria')}>
            {distribution.map((b) => (
              <div
                key={b.branch_id}
                className="TrackHeader__WeaveSeg"
                style={{ flexBasis: `${b.ratio * 100}%`, background: b.color }}
                title={t('track.header.segmentTitle', {
                  name: b.name,
                  items: b.count,
                  percent: Math.round(b.ratio * 100),
                })}
              >
                <span className="TrackHeader__WeaveSegLabel">{b.key}</span>
                <span className="TrackHeader__WeaveSegCount">{b.count}</span>
              </div>
            ))}
          </div>
          <div className="TrackHeader__WeaveLegend">
            {distribution.map((b) => (
              <span key={b.branch_id} className="TrackHeader__WeaveLegendItem">
                <span className="TrackHeader__WeaveLegendDot" style={{ background: b.color }} />
                <span className="TrackHeader__WeaveLegendName">{b.name}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="TrackHeader__ViewToggle" role="tablist">
          {VIEW_MODES.map((v) => {
            const Icon = v.icon;
            const active = viewMode === v.key;
            return (
              <button
                key={v.key}
                role="tab"
                aria-selected={active}
                className={`TrackHeader__ViewBtn ${active ? 'TrackHeader__ViewBtn--active' : ''}`}
                onClick={() => onViewModeChange(v.key)}
              >
                <Icon size={14} />
                <span>{t(v.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
