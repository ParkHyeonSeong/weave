import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import { axios } from '@/library/_axios';
import ArchiveView from '@/components/Home/shared/ArchiveView';

export default function BranchArchive() {
  const { t } = useTranslation();
  return (
    <>
      <Head><title>{t('pageTitles.branchArchive')}</title></Head>
      <ArchiveView
        title={t('misc.archive.title', { app: 'Branch' })}
        backHref="/branch"
        fetchItems={async () => {
          const res = await axios.get('/branches/archived');
          return res.data.status
            ? res.data.branches.map((b) => ({ id: b.branch_id, name: b.branch_name, sub: b.key, color: b.color }))
            : [];
        }}
        onRestore={async (id) => (await axios.post(`/branches/${id}/restore`)).data.status === true}
        onPermanentDelete={async (id) => (await axios.delete(`/branches/${id}/permanent`)).data.status === true}
      />
    </>
  );
}
