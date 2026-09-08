import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Users, GitBranch, ArrowLeft } from 'lucide-react';
import { axios } from '@/library/_axios';
import SettingsGeneral from './SettingsGeneral';
import SettingsMembers from './SettingsMembers';
import SettingsBranches from './SettingsBranches';
import EntityIcon from '@/components/common/EntityIcon';

const SUB_TABS = [
  { key: 'general', labelKey: 'trackSettings.tabs.general', icon: SettingsIcon },
  { key: 'members', labelKey: 'trackSettings.tabs.members', icon: Users },
  { key: 'branches', labelKey: 'trackSettings.tabs.branches', icon: GitBranch },
];

export default function TrackSettings() {
  const router = useRouter();
  const { t } = useTranslation();
  const trackId = router.isReady ? Number(router.query.id) : null;
  const [track, setTrack] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('general');
  const [notFound, setNotFound] = useState(false);

  const fetchTrack = useCallback(async () => {
    if (!trackId) return;
    try {
      const res = await axios.get(`/tracks/${trackId}`);
      if (res.data.status) setTrack(res.data.track);
      else setNotFound(true);
    } catch {
      setNotFound(true);
    }
  }, [trackId]);

  useEffect(() => { fetchTrack(); }, [fetchTrack]);

  if (notFound) {
    return (
      <div className="TrackSettings TrackSettings--notfound">
        <div className="TrackSettings__NotFoundTitle">{t('trackSettings.notFound')}</div>
        <button className="TrackSettings__BackBtn" onClick={() => router.push('/tracks')}>
          ← {t('trackSettings.backToTracks')}
        </button>
      </div>
    );
  }
  if (!track) return null;

  const isOwner = track.my_role === 'owner';
  const isEditor = track.my_role === 'editor' || isOwner;

  return (
    <div className="TrackSettings">
      <div className="TrackSettings__Header">
        <button
          className="TrackSettings__BackLink"
          onClick={() => router.push(`/tracks/${trackId}`)}
        >
          <ArrowLeft size={14} /> {t('trackSettings.backToTrack')}
        </button>
        <div className="TrackSettings__HeaderTitle">
          <EntityIcon
            icon={track.icon}
            color={track.color}
            size={18}
            entityType="track"
          />
          <h1 className="TrackSettings__Name">{track.track_name}</h1>
        </div>
      </div>

      <div className="TrackSettings__SubTabs">
        {SUB_TABS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            className={`TrackSettings__SubTab ${activeSubTab === key ? 'TrackSettings__SubTab--active' : ''}`}
            onClick={() => setActiveSubTab(key)}
          >
            <Icon size={14} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="TrackSettings__Content">
        {activeSubTab === 'general' && (
          // key는 데이터 id로 (trackId는 router 파생 → fetch 완료 전 먼저 바뀌어 입력값 stale 유발)
          <SettingsGeneral
            key={track.track_id}
            trackId={trackId}
            track={track}
            isOwner={isOwner}
            onUpdated={fetchTrack}
          />
        )}
        {activeSubTab === 'members' && (
          <SettingsMembers
            trackId={trackId}
            isOwner={isOwner}
          />
        )}
        {activeSubTab === 'branches' && (
          <SettingsBranches
            trackId={trackId}
            isEditor={isEditor}
          />
        )}
      </div>
    </div>
  );
}
