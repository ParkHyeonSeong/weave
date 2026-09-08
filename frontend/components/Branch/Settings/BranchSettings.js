import { useState } from 'react';
import { Settings, Users, Layers, GitBranch, Github } from 'lucide-react';
import SettingsGeneral from './SettingsGeneral';
import SettingsMembers from './SettingsMembers';
import SettingsTaskTypes from './SettingsTaskTypes';
import SettingsWorkflow from './SettingsWorkflow';
import SettingsGithubIntegration from './SettingsGithubIntegration';
import { useTranslation } from 'react-i18next';

const SUB_TABS = [
  { key: 'general', labelKey: 'branch.settings.tabGeneral', icon: Settings },
  { key: 'members', labelKey: 'branch.settings.tabMembers', icon: Users },
  { key: 'task_types', labelKey: 'branch.settings.tabTaskTypes', icon: Layers },
  { key: 'workflow', labelKey: 'branch.settings.tabWorkflow', icon: GitBranch },
  { key: 'github', label: 'GitHub', icon: Github, adminOnly: true },  // GitHub 설정은 admin만 (고유명사라 번역 안 함)
];

export default function BranchSettings({ branchId, branch, myRole, onBranchUpdated }) {
  const { t } = useTranslation();
  const [activeSubTab, setActiveSubTab] = useState('general');
  const isAdmin = myRole === 'admin';

  return (
    <div className="BranchSettings">
      {/* 서브탭 */}
      <div className="BranchSettings__SubTabs">
        {SUB_TABS.filter((tab) => !tab.adminOnly || isAdmin).map(({ key, label, labelKey, icon: Icon }) => (
          <button
            key={key}
            className={`BranchSettings__SubTab ${activeSubTab === key ? 'BranchSettings__SubTab--active' : ''}`}
            onClick={() => setActiveSubTab(key)}
          >
            <Icon size={14} />
            {labelKey ? t(labelKey) : label}
          </button>
        ))}
      </div>

      {/* 서브탭 콘텐츠 */}
      <div className="BranchSettings__Content">
        {activeSubTab === 'general' && (
          <SettingsGeneral
            key={branchId}
            branchId={branchId}
            branch={branch}
            isAdmin={isAdmin}
            onUpdated={onBranchUpdated}
          />
        )}
        {activeSubTab === 'members' && (
          <SettingsMembers branchId={branchId} isAdmin={isAdmin} />
        )}
        {activeSubTab === 'task_types' && (
          <SettingsTaskTypes branchId={branchId} isAdmin={isAdmin} />
        )}
        {activeSubTab === 'workflow' && (
          <SettingsWorkflow branchId={branchId} isAdmin={isAdmin} />
        )}
        {activeSubTab === 'github' && isAdmin && (
          <SettingsGithubIntegration key={branchId} branchId={branchId} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}
