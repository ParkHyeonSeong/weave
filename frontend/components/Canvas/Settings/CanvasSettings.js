import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { Settings, Users } from 'lucide-react';
import { axios } from '@/library/_axios';
import SettingsGeneral from './SettingsGeneral';
import SettingsMembers from './SettingsMembers';
import EntityIcon from '@/components/common/EntityIcon';

const SUB_TABS = [
  { key: 'general', labelKey: 'canvasExt.settings.tabGeneral', icon: Settings },
  { key: 'members', labelKey: 'canvasExt.settings.tabMembers', icon: Users },
];

export default function CanvasSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { canvasId } = router.query;
  const [canvas, setCanvas] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('general');

  useEffect(() => {
    if (!canvasId) return;
    fetchCanvas();
  }, [canvasId]);

  const fetchCanvas = async () => {
    try {
      const res = await axios.get(`/canvases/${canvasId}`);
      if (res.data.status) setCanvas(res.data.canvas);
      else router.replace('/canvas');
    } catch {
      router.replace('/canvas');
    }
  };

  if (!canvas) return null;

  const isAdmin = canvas.my_role === 'admin';

  return (
    <div className="CanvasSettings">
      <div className="CanvasSettings__Header">
        <EntityIcon
          icon={canvas.icon}
          color={canvas.color}
          size={18}
          entityType="canvas"
        />
        <h1 className="CanvasSettings__Name">{canvas.canvas_name}</h1>
      </div>

      <div className="CanvasSettings__SubTabs">
        {SUB_TABS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            className={`CanvasSettings__SubTab ${activeSubTab === key ? 'CanvasSettings__SubTab--active' : ''}`}
            onClick={() => setActiveSubTab(key)}
          >
            <Icon size={14} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="CanvasSettings__Content">
        {activeSubTab === 'general' && (
          // key는 데이터 id로 (canvasId는 router 파생 → fetch 완료 전 먼저 바뀌어 입력값 stale 유발)
          <SettingsGeneral
            key={canvas.canvas_id}
            canvasId={canvasId}
            canvas={canvas}
            isAdmin={isAdmin}
            onUpdated={fetchCanvas}
          />
        )}
        {activeSubTab === 'members' && (
          <SettingsMembers canvasId={canvasId} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}
