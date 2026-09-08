import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { Plus, Trash2, X } from 'lucide-react';
import TaskTypeIcon, { ICON_OPTIONS } from '@/components/common/TaskTypeIcon';
import SettingsCustomFields from './SettingsCustomFields';
import { useTranslation } from 'react-i18next';

const PRESET_COLORS = [
  '#5E6AD2', '#DC2626', '#16A34A', '#2563EB', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6B7280',
];

export default function SettingsTaskTypes({ branchId, isAdmin }) {
  const { t } = useTranslation();
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // 선택된 타입 (오른쪽 패널)
  const [selectedType, setSelectedType] = useState(null);

  // 새 타입 추가 폼
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('CheckSquare');
  const [newColor, setNewColor] = useState('#5E6AD2');

  // 상세 패널 편집
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editColor, setEditColor] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetchTypes();
  }, [branchId]);

  const fetchTypes = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/task-types`);
      if (res.data.status) setTypes(res.data.task_types);
    } catch {}
    setLoading(false);
  };

  // 타입 선택
  const selectType = (type) => {
    setSelectedType(type);
    setEditName(type.type_name);
    setEditIcon(type.icon);
    setEditColor(type.color);
    setDirty(false);
  };

  // 상세 패널에서 저장
  const saveDetail = async () => {
    if (!selectedType) return;
    try {
      const res = await axios.patch(`/branches/${branchId}/task-types/${selectedType.type_id}`, {
        type_name: editName.trim(),
        icon: editIcon,
        color: editColor,
      });
      if (res.data.status) {
        fetchTypes();
        setSelectedType({ ...selectedType, type_name: editName.trim(), icon: editIcon, color: editColor });
        setDirty(false);
        window.dispatchEvent(new Event('tasktype:updated'));
      }
    } catch {}
  };

  // 추가
  const handleAdd = async () => {
    if (!newKey.trim() || !newName.trim()) return;
    try {
      const res = await axios.post(`/branches/${branchId}/task-types`, {
        type_key: newKey.trim().toLowerCase(),
        type_name: newName.trim(),
        icon: newIcon,
        color: newColor,
      });
      if (res.data.status) {
        fetchTypes();
        setShowAdd(false);
        setNewKey('');
        setNewName('');
        setNewIcon('CheckSquare');
        setNewColor('#5E6AD2');
        window.dispatchEvent(new Event('tasktype:updated'));
      }
    } catch {}
  };

  // 삭제
  const handleDelete = async (typeId) => {
    try {
      const res = await axios.delete(`/branches/${branchId}/task-types/${typeId}`);
      if (res.data.status) {
        fetchTypes();
        if (selectedType?.type_id === typeId) setSelectedType(null);
        window.dispatchEvent(new Event('tasktype:updated'));
      }
    } catch {}
  };

  if (loading) return null;

  return (
    <div className="SettingsTaskTypes">
      {/* 왼쪽: 타입 목록 */}
      <div className="SettingsTaskTypes__ListPane">
        <div className="SettingsTaskTypes__List">
          {types.map((type) => (
            <div
              key={type.type_id}
              className={`SettingsTaskTypes__Item ${selectedType?.type_id === type.type_id ? 'SettingsTaskTypes__Item--active' : ''}`}
              onClick={() => selectType(type)}
            >
              <div className="SettingsTaskTypes__Info">
                <TaskTypeIcon name={type.icon} size={16} color={type.color} />
                <span className="SettingsTaskTypes__Name">{type.type_name}</span>
                <span className="SettingsTaskTypes__Key">{type.type_key}</span>
              </div>
            </div>
          ))}
        </div>

        {isAdmin && (
          <>
            {showAdd ? (
              <div className="SettingsTaskTypes__AddForm">
                <div className="SettingsTaskTypes__AddFields">
                  <input
                    className="SettingsTaskTypes__AddInput"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder={t('branch2.taskTypes.typeKeyPlaceholder')}
                  />
                  <input
                    className="SettingsTaskTypes__AddInput"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t('branch2.taskTypes.displayNamePlaceholder')}
                  />
                </div>
                <div className="SettingsTaskTypes__IconPicker">
                  {ICON_OPTIONS.map((opt) => (
                    <button
                      key={opt.name}
                      className={`SettingsTaskTypes__IconBtn ${newIcon === opt.name ? 'SettingsTaskTypes__IconBtn--active' : ''}`}
                      onClick={() => setNewIcon(opt.name)}
                      title={opt.name}
                    >
                      <TaskTypeIcon name={opt.name} size={14} color={newColor} />
                    </button>
                  ))}
                </div>
                <div className="SettingsTaskTypes__ColorPicker">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`SettingsTaskTypes__ColorBtn ${newColor === c ? 'SettingsTaskTypes__ColorBtn--active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setNewColor(c)}
                    />
                  ))}
                </div>
                <div className="SettingsTaskTypes__AddActions">
                  <button className="SettingsTaskTypes__SubmitBtn" onClick={handleAdd}>
                    {t('branch2.taskTypes.addType')}
                  </button>
                  <button className="SettingsTaskTypes__CancelBtn" onClick={() => setShowAdd(false)}>
                    {t('common.actions.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button className="SettingsTaskTypes__AddBtn" onClick={() => setShowAdd(true)}>
                <Plus size={14} />
                {t('branch2.taskTypes.addTaskType')}
              </button>
            )}
          </>
        )}
      </div>

      {/* 오른쪽: 상세 패널 */}
      {selectedType ? (
        <div className="SettingsTaskTypes__DetailPane">
          <div className="SettingsTaskTypes__DetailHeader">
            <div className="SettingsTaskTypes__DetailHeaderLeft">
              <TaskTypeIcon name={editIcon} size={20} color={editColor} />
              <div>
                <div className="SettingsTaskTypes__DetailTitle">{editName || selectedType.type_name}</div>
                <div className="SettingsTaskTypes__DetailKey">{selectedType.type_key}</div>
              </div>
            </div>
            <button className="SettingsTaskTypes__DetailClose" onClick={() => setSelectedType(null)}>
              <X size={16} />
            </button>
          </div>

          {/* Appearance */}
          <div className="SettingsTaskTypes__DetailSection">
            <div className="SettingsTaskTypes__DetailSectionTitle">{t('branch2.taskTypes.appearance')}</div>
            <div className="SettingsTaskTypes__DetailField">
              <label className="SettingsTaskTypes__DetailLabel">{t('auth.name')}</label>
              <input
                className="SettingsTaskTypes__DetailInput"
                value={editName}
                onChange={(e) => { setEditName(e.target.value); setDirty(true); }}
                placeholder={t('branch2.taskTypes.typeNamePlaceholder')}
              />
            </div>
            <div className="SettingsTaskTypes__DetailField">
              <label className="SettingsTaskTypes__DetailLabel">{t('branch2.taskTypes.icon')}</label>
              <div className="SettingsTaskTypes__IconPicker">
                {ICON_OPTIONS.map((opt) => (
                  <button
                    key={opt.name}
                    className={`SettingsTaskTypes__IconBtn ${editIcon === opt.name ? 'SettingsTaskTypes__IconBtn--active' : ''}`}
                    onClick={() => { setEditIcon(opt.name); setDirty(true); }}
                    title={opt.name}
                  >
                    <TaskTypeIcon name={opt.name} size={16} color={editColor} />
                  </button>
                ))}
              </div>
            </div>
            <div className="SettingsTaskTypes__DetailField">
              <label className="SettingsTaskTypes__DetailLabel">{t('branch2.taskTypes.color')}</label>
              <div className="SettingsTaskTypes__ColorPicker">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`SettingsTaskTypes__ColorBtn ${editColor === c ? 'SettingsTaskTypes__ColorBtn--active' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => { setEditColor(c); setDirty(true); }}
                  />
                ))}
              </div>
            </div>
            {dirty && (
              <button className="SettingsTaskTypes__DetailSaveBtn" onClick={saveDetail}>
                {t('branch2.saveChanges')}
              </button>
            )}
          </div>

          {/* Custom Fields */}
          <div className="SettingsTaskTypes__DetailSection">
            <div className="SettingsTaskTypes__DetailSectionTitle">{t('branch2.taskTypes.customFields')}</div>
            <SettingsCustomFields
              branchId={branchId}
              typeId={selectedType.type_id}
              isAdmin={isAdmin}
            />
          </div>

          {/* Delete */}
          {isAdmin && (
            <div className="SettingsTaskTypes__DetailDanger">
              <button
                className="SettingsTaskTypes__DetailDeleteBtn"
                onClick={() => handleDelete(selectedType.type_id)}
              >
                <Trash2 size={13} />
                {t('branch2.taskTypes.deleteThisTaskType')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="SettingsTaskTypes__DetailEmpty">
          {t('branch2.taskTypes.selectToEdit')}
        </div>
      )}
    </div>
  );
}
