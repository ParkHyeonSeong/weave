import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AdminLayout from '@/components/Admin/AdminLayout';
import TimeZoneSelect from '@/components/common/TimeZoneSelect';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import {
  clearWorkspaceSettingsCache,
  useWorkspaceSettings,
} from '@/library/workspaceSettings';

/**
 * 워크스페이스 공용 시간대 — 관리자만 바꾼다.
 *
 * 개인 시간대(Profile)와 **다른 설정**이다: 여기서 정한 값은 팀이 공유하는 Scrum 주차,
 * 회고 기간, 스프린트 기본 날짜의 기준이고, 개인 화면의 시각·연체 표시는 각자의 개인
 * 시간대를 따른다. 두 설정을 한 화면에 섞지 않고 서로를 명시적으로 가리킨다.
 *
 * 저장은 **앞으로의** 기준만 바꾼다. 이미 저장된 date-only 값(지난 주차·기간)은 그대로 둔다.
 */
export default function AdminWorkspacePage() {
  const { t } = useTranslation();
  const { refresh } = useWorkspaceSettings();

  const [loadStatus, setLoadStatus] = useState('loading');   // loading | success | error
  const [saved, setSaved] = useState('');                    // 서버가 확인한 값
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoadStatus('loading');
    setError('');
    try {
      const res = await axios.get('/admin/workspace');
      if (res.data.status) {
        setSaved(res.data.time_zone);
        setDraft(res.data.time_zone);
        setLoadStatus('success');
      } else {
        setLoadStatus('error');
      }
    } catch {
      setLoadStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = !!draft && draft !== saved;

  const save = async () => {
    setPending(true);
    setError('');
    setDone(false);
    try {
      const res = await axios.patch('/admin/workspace/time-zone', { time_zone: draft });
      if (res.data.status) {
        setSaved(res.data.time_zone);
        setDraft(res.data.time_zone);
        setDone(true);
        // 공유 캐시를 비우면 invalidate 이벤트가 돌아 Scrum 등 소비자가 새 기준으로 다시 읽는다.
        clearWorkspaceSettingsCache();
        refresh();
      } else {
        const err = getError(res.data);
        setError(errorText(err.code, err.category) ?? t('workspaceSettings.saveFailed'));
      }
    } catch (e) {
      setError(t('workspaceSettings.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <AdminLayout>
      <Head>
        <title>{t('workspaceSettings.pageTitle')}</title>
      </Head>
      <div className="Admin">
        <div className="Admin__Header">
          <Globe2 size={20} />
          <h1 className="Admin__Title">{t('workspaceSettings.title')}</h1>
        </div>

        <div className="Admin__Section">
          <div className="Admin__SectionHeader">
            <h2 className="Admin__SectionTitle">{t('workspaceSettings.timeZoneSection')}</h2>
          </div>
          <p className="LanguageRegion__SectionHint">{t('workspaceSettings.timeZoneHint')}</p>

          {loadStatus === 'loading' && (
            <p className="LanguageRegion__Note">{t('common.state.loading')}</p>
          )}

          {loadStatus === 'error' && (
            <div className="WorkspaceSettings__Error" role="alert">
              <span>{t('workspaceSettings.loadFailed')}</span>
              <button type="button" className="Profile__SaveBtn" onClick={load}>
                {t('common.actions.retry')}
              </button>
            </div>
          )}

          {loadStatus === 'success' && (
            <>
              <div className="LanguageRegion__Rows">
                <div className="LanguageRegion__Row">
                  <label className="LanguageRegion__RowLabel" htmlFor="workspace-time-zone">
                    {t('workspaceSettings.timeZoneLabel')}
                  </label>
                  <div className="LanguageRegion__RowControl">
                    <TimeZoneSelect
                      id="workspace-time-zone"
                      value={draft}
                      onChange={(tz) => { setDone(false); setDraft(tz); }}
                      disabled={pending}
                    />
                  </div>
                </div>
              </div>

              <p className="LanguageRegion__Note">{t('workspaceSettings.scopeNote')}</p>

              <div className="LanguageRegion__Actions">
                <button
                  type="button"
                  className="Profile__SaveBtn"
                  disabled={pending || !dirty}
                  onClick={save}
                >
                  {pending ? t('common.state.saving') : t('common.actions.save')}
                </button>
                {error && (
                  <span className="LanguageRegion__Status LanguageRegion__Status--error" role="alert">
                    {error}
                  </span>
                )}
                {!error && done && !dirty && (
                  <span className="LanguageRegion__Status LanguageRegion__Status--saved" role="status">
                    {t('common.state.saved')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
