import { useState, useEffect, useRef } from 'react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { X, Upload, ArrowRight, Check, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const STEPS = ['upload', 'mapping', 'result'];

export default function JiraMigrationModal({ branchId, onClose }) {
  const { t } = useTranslation();
  const [step, setStep] = useState('upload');
  const fileRef = useRef(null);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Preview
  const [migrationId, setMigrationId] = useState('');
  const [assignees, setAssignees] = useState([]);
  const [stats, setStats] = useState(null);
  const [members, setMembers] = useState([]);
  const [userMapping, setUserMapping] = useState({});

  // Execute
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [executeError, setExecuteError] = useState('');

  // 브랜치 멤버 로드
  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const res = await axios.get(`/branches/${branchId}/members`);
        if (res.data.status) setMembers(res.data.members);
      } catch {}
    };
    fetchMembers();
  }, [branchId]);

  // CSV 업로드
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError(t('branch.jira.csvOnly'));
      return;
    }

    setUploading(true);
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await axios.post(
        `/branches/${branchId}/jira-migrate/preview`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      if (res.data.status) {
        setMigrationId(res.data.migration_id);
        setAssignees(res.data.assignees);
        setStats(res.data.stats);
        setStep('mapping');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? (err.code === 'CSV_PARSE_ERROR' ? t('branch.jira.csvParseFailed') : t('branch.jira.uploadFailed'));
        setUploadError(msg);
      }
    } catch {
      setUploadError(t('branch.jira.uploadError'));
    }
    setUploading(false);
  };

  // 담당자 매핑 변경
  const handleMappingChange = (jiraName, userId) => {
    setUserMapping((prev) => {
      const next = { ...prev };
      if (userId) {
        next[jiraName] = Number(userId);
      } else {
        delete next[jiraName];
      }
      return next;
    });
  };

  // 마이그레이션 실행
  const handleExecute = async () => {
    setExecuting(true);
    setExecuteError('');

    try {
      const res = await axios.post(`/branches/${branchId}/jira-migrate/execute`, {
        migration_id: migrationId,
        user_mapping: userMapping,
      });

      if (res.data.status) {
        setResult(res.data.stats);
        setStep('result');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? (err.code === 'MIGRATION_EXPIRED' ? t('branch.jira.sessionExpired') : res.data.detail || t('branch.jira.migrationFailed'));
        setExecuteError(msg);
      }
    } catch {
      setExecuteError(t('branch.jira.migrationError'));
    }
    setExecuting(false);
  };

  const handleClose = () => {
    if (step === 'result') {
      window.location.reload();
    } else {
      onClose();
    }
  };

  return (
    <div className="JiraMigrationModal__Backdrop" onClick={handleClose}>
      <div className="JiraMigrationModal" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="JiraMigrationModal__Header">
          <h3 className="JiraMigrationModal__Title">{t('branch.jira.title')}</h3>
          <button className="JiraMigrationModal__CloseBtn" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* 스텝 인디케이터 */}
        <div className="JiraMigrationModal__Steps">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`JiraMigrationModal__Step ${
                STEPS.indexOf(step) >= i ? 'JiraMigrationModal__Step--active' : ''
              }`}
            >
              <span className="JiraMigrationModal__StepNum">{i + 1}</span>
              <span className="JiraMigrationModal__StepLabel">
                {s === 'upload' ? t('branch.jira.step.upload') : s === 'mapping' ? t('branch.jira.step.mapping') : t('branch.jira.step.result')}
              </span>
            </div>
          ))}
        </div>

        {/* 본문 */}
        <div className="JiraMigrationModal__Body">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="JiraMigrationModal__Upload">
              <div
                className="JiraMigrationModal__DropZone"
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={32} />
                <p className="JiraMigrationModal__DropText">
                  {t('branch.jira.dropText')}
                </p>
                <p className="JiraMigrationModal__DropHint">
                  {'Jira > Filters > Export > CSV (all fields)'}
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              {uploading && (
                <p className="JiraMigrationModal__Status">{t('branch.jira.parsing')}</p>
              )}
              {uploadError && (
                <p className="JiraMigrationModal__Error">
                  <AlertCircle size={14} /> {uploadError}
                </p>
              )}
            </div>
          )}

          {/* Step 2: Mapping */}
          {step === 'mapping' && stats && (
            <div className="JiraMigrationModal__Mapping">
              {/* 통계 */}
              <div className="JiraMigrationModal__Stats">
                <div className="JiraMigrationModal__StatItem">
                  <span className="JiraMigrationModal__StatValue">{stats.epics}</span>
                  <span className="JiraMigrationModal__StatLabel">{t('branch.jira.stats.epics')}</span>
                </div>
                <div className="JiraMigrationModal__StatItem">
                  <span className="JiraMigrationModal__StatValue">{stats.tasks}</span>
                  <span className="JiraMigrationModal__StatLabel">{t('branch.jira.stats.tasks')}</span>
                </div>
                <div className="JiraMigrationModal__StatItem">
                  <span className="JiraMigrationModal__StatValue">{stats.subtasks}</span>
                  <span className="JiraMigrationModal__StatLabel">{t('branch.jira.stats.subtasks')}</span>
                </div>
                <div className="JiraMigrationModal__StatItem">
                  <span className="JiraMigrationModal__StatValue">{stats.sprints}</span>
                  <span className="JiraMigrationModal__StatLabel">{t('branch.jira.stats.sprints')}</span>
                </div>
                <div className="JiraMigrationModal__StatItem">
                  <span className="JiraMigrationModal__StatValue">{stats.labels}</span>
                  <span className="JiraMigrationModal__StatLabel">{t('branch.jira.stats.labels')}</span>
                </div>
              </div>

              {/* 담당자 매핑 */}
              {assignees.length > 0 && (
                <>
                  <h4 className="JiraMigrationModal__SectionTitle">
                    {t('branch.jira.assigneeMapping', { count: assignees.length })}
                  </h4>
                  <div className="JiraMigrationModal__MappingList">
                    {assignees.map((name) => (
                      <div key={name} className="JiraMigrationModal__MappingRow">
                        <span className="JiraMigrationModal__JiraName">{name}</span>
                        <ArrowRight size={14} className="JiraMigrationModal__Arrow" />
                        <select
                          className="JiraMigrationModal__Select"
                          value={userMapping[name] || ''}
                          onChange={(e) => handleMappingChange(name, e.target.value)}
                        >
                          <option value="">{t('branch.jira.skip')}</option>
                          {members.map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.username} ({m.email})
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  <p className="JiraMigrationModal__MappingHint">
                    {t('branch.jira.skipHint')}
                  </p>
                </>
              )}

              {executeError && (
                <p className="JiraMigrationModal__Error">
                  <AlertCircle size={14} /> {executeError}
                </p>
              )}
            </div>
          )}

          {/* Step 3: Result */}
          {step === 'result' && result && (
            <div className="JiraMigrationModal__Result">
              <div className="JiraMigrationModal__ResultIcon">
                <Check size={32} />
              </div>
              <h4 className="JiraMigrationModal__ResultTitle">{t('branch.jira.complete')}</h4>
              <div className="JiraMigrationModal__ResultStats">
                <div className="JiraMigrationModal__ResultRow">
                  <span>{t('branch.jira.result.taskTypes')}</span>
                  <span>{t('branch.jira.createdCount', { count: result.task_types })}</span>
                </div>
                <div className="JiraMigrationModal__ResultRow">
                  <span>{t('branch.jira.result.labels')}</span>
                  <span>{t('branch.jira.createdCount', { count: result.labels })}</span>
                </div>
                <div className="JiraMigrationModal__ResultRow">
                  <span>{t('branch.jira.result.sprints')}</span>
                  <span>{t('branch.jira.createdCount', { count: result.sprints })}</span>
                </div>
                <div className="JiraMigrationModal__ResultRow">
                  <span>{t('branch.jira.result.epics')}</span>
                  <span>{t('branch.jira.createdCount', { count: result.epics })}</span>
                </div>
                <div className="JiraMigrationModal__ResultRow">
                  <span>{t('branch.jira.result.tasks')}</span>
                  <span>{t('branch.jira.createdCount', { count: result.tasks })}</span>
                </div>
                {result.tasks_failed > 0 && (
                  <div className="JiraMigrationModal__ResultRow JiraMigrationModal__ResultRow--error">
                    <span>{t('branch.jira.result.failed')}</span>
                    <span>{result.tasks_failed}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="JiraMigrationModal__Footer">
          <div className="JiraMigrationModal__FooterRight">
            {step === 'mapping' && (
              <>
                <button
                  className="JiraMigrationModal__CancelBtn"
                  onClick={handleClose}
                  disabled={executing}
                >
                  {t('common.actions.cancel')}
                </button>
                <button
                  className="JiraMigrationModal__SubmitBtn"
                  onClick={handleExecute}
                  disabled={executing}
                >
                  {executing ? t('branch.jira.migrating') : t('branch.jira.startMigration')}
                </button>
              </>
            )}
            {step === 'result' && (
              <button className="JiraMigrationModal__SubmitBtn" onClick={handleClose}>
                {t('common.actions.close')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
