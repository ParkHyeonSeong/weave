import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { Plus, Trash2, Pencil, Check, X, Star, ChevronUp, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PRESET_COLORS = [
  '#9CA3AF', '#2563EB', '#16A34A', '#DC2626', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6B7280',
];

const CATEGORIES = [
  { value: 'todo', labelKey: 'branch.statusCategory.todo' },
  { value: 'in_progress', labelKey: 'branch.statusCategory.inProgress' },
  { value: 'done', labelKey: 'branch.statusCategory.done' },
  { value: 'cancelled', labelKey: 'branch.statusCategory.cancelled' },
];

export default function SettingsWorkflow({ branchId, isAdmin }) {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);

  // 새 상태 추가
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#9CA3AF');
  const [newCategory, setNewCategory] = useState('todo');

  // 인라인 편집
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editCategory, setEditCategory] = useState('');

  useEffect(() => {
    fetchStatuses();
  }, [branchId]);

  const fetchStatuses = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/workflow-statuses`);
      if (res.data.status) setStatuses(res.data.statuses);
    } catch {}
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newLabel.trim()) return;
    try {
      const res = await axios.post(`/branches/${branchId}/workflow-statuses`, {
        key: newKey.trim().toLowerCase().replace(/\s+/g, '_'),
        label: newLabel.trim(),
        color: newColor,
        category: newCategory,
      });
      if (res.data.status) {
        fetchStatuses();
        window.dispatchEvent(new Event('workflow:updated'));
        setShowAdd(false);
        setNewKey('');
        setNewLabel('');
        setNewColor('#9CA3AF');
        setNewCategory('todo');
      }
    } catch {}
  };

  const startEdit = (s) => {
    setEditingId(s.workflow_status_id);
    setEditLabel(s.label);
    setEditColor(s.color);
    setEditCategory(s.category);
  };

  const saveEdit = async (statusId) => {
    try {
      const res = await axios.patch(`/branches/${branchId}/workflow-statuses/${statusId}`, {
        label: editLabel.trim(),
        color: editColor,
        category: editCategory,
      });
      if (res.data.status) {
        fetchStatuses();
        window.dispatchEvent(new Event('workflow:updated'));
        setEditingId(null);
      }
    } catch {}
  };

  const handleDelete = async (statusId) => {
    try {
      const res = await axios.delete(`/branches/${branchId}/workflow-statuses/${statusId}`);
      if (res.data.status) {
        fetchStatuses();
        window.dispatchEvent(new Event('workflow:updated'));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('branch.workflow.statusInUse');
        alert(msg);
      }
    } catch {}
  };

  const handleSetDefault = async (statusId) => {
    try {
      const res = await axios.patch(`/branches/${branchId}/workflow-statuses/${statusId}`, {
        is_default: true,
      });
      if (res.data.status) {
        fetchStatuses();
        window.dispatchEvent(new Event('workflow:updated'));
      }
    } catch {}
  };

  const handleMove = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= statuses.length) return;

    const newStatuses = [...statuses];
    [newStatuses[index], newStatuses[targetIndex]] = [newStatuses[targetIndex], newStatuses[index]];

    const items = newStatuses.map((s, i) => ({ id: s.workflow_status_id, sort_order: i }));

    // 낙관적 업데이트
    setStatuses(newStatuses);

    try {
      const res = await axios.post(`/branches/${branchId}/workflow-statuses/reorder`, { items });
      if (res.data.status) {
        window.dispatchEvent(new Event('workflow:updated'));
      } else {
        fetchStatuses();
      }
    } catch {
      fetchStatuses();
    }
  };

  const getCategoryBadge = (category) => {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat ? t(cat.labelKey) : category;
  };

  if (loading) return null;

  return (
    <div className="SettingsWorkflow">
      <p className="SettingsWorkflow__Desc">
        {t('branch.workflow.desc')}
      </p>

      <div className="SettingsWorkflow__List">
        {statuses.map((s, index) => (
          <div key={s.workflow_status_id} className="SettingsWorkflow__Item">
            {editingId === s.workflow_status_id ? (
              <div className="SettingsWorkflow__EditRow">
                <div className="SettingsWorkflow__EditFields">
                  <input
                    className="SettingsWorkflow__EditInput"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    placeholder={t('branch.workflow.statusNamePlaceholder')}
                  />
                  <select
                    className="SettingsWorkflow__Select"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
                    ))}
                  </select>
                  <div className="SettingsWorkflow__ColorPicker">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`SettingsWorkflow__ColorBtn ${editColor === c ? 'SettingsWorkflow__ColorBtn--active' : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setEditColor(c)}
                      />
                    ))}
                  </div>
                </div>
                <div className="SettingsWorkflow__EditActions">
                  <button className="SettingsWorkflow__SaveBtn" onClick={() => saveEdit(s.workflow_status_id)}>
                    <Check size={14} />
                  </button>
                  <button className="SettingsWorkflow__CancelBtn" onClick={() => setEditingId(null)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="SettingsWorkflow__DisplayRow">
                <div className="SettingsWorkflow__Info">
                  <span
                    className="SettingsWorkflow__ColorDot"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="SettingsWorkflow__Label">{s.label}</span>
                  <span className="SettingsWorkflow__Key">{s.key}</span>
                  <span className={`SettingsWorkflow__Category SettingsWorkflow__Category--${s.category}`}>
                    {getCategoryBadge(s.category)}
                  </span>
                  {s.is_default && (
                    <span className="SettingsWorkflow__Default">
                      <Star size={11} /> {t('branch.workflow.default')}
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <div className="SettingsWorkflow__ItemActions">
                    <button
                      className="SettingsWorkflow__ActionBtn"
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0}
                      title={t('branch.workflow.moveUp')}
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      className="SettingsWorkflow__ActionBtn"
                      onClick={() => handleMove(index, 1)}
                      disabled={index === statuses.length - 1}
                      title={t('branch.workflow.moveDown')}
                    >
                      <ChevronDown size={13} />
                    </button>
                    {!s.is_default && (
                      <button
                        className="SettingsWorkflow__ActionBtn"
                        onClick={() => handleSetDefault(s.workflow_status_id)}
                        title={t('branch.workflow.setAsDefault')}
                      >
                        <Star size={13} />
                      </button>
                    )}
                    <button
                      className="SettingsWorkflow__ActionBtn"
                      onClick={() => startEdit(s)}
                      title={t('common.actions.edit')}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="SettingsWorkflow__ActionBtn SettingsWorkflow__ActionBtn--danger"
                      onClick={() => handleDelete(s.workflow_status_id)}
                      title={t('common.actions.delete')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdmin && (
        <>
          {showAdd ? (
            <div className="SettingsWorkflow__AddForm">
              <div className="SettingsWorkflow__AddFields">
                <input
                  className="SettingsWorkflow__AddInput"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder={t('branch.workflow.keyPlaceholder')}
                />
                <input
                  className="SettingsWorkflow__AddInput"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t('branch.workflow.labelPlaceholder')}
                />
                <select
                  className="SettingsWorkflow__Select"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div className="SettingsWorkflow__ColorPicker">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`SettingsWorkflow__ColorBtn ${newColor === c ? 'SettingsWorkflow__ColorBtn--active' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
              <div className="SettingsWorkflow__AddActions">
                <button className="SettingsWorkflow__SubmitBtn" onClick={handleAdd}>
                  {t('branch.workflow.addStatus')}
                </button>
                <button className="SettingsWorkflow__CancelAddBtn" onClick={() => setShowAdd(false)}>
                  {t('common.actions.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button className="SettingsWorkflow__AddBtn" onClick={() => setShowAdd(true)}>
              <Plus size={14} />
              {t('branch.workflow.addStatus')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
