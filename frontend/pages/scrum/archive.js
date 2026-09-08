import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import { axios } from '@/library/_axios';
import ArchiveView from '@/components/Home/shared/ArchiveView';

export default function ScrumArchive() {
  const { t } = useTranslation();
  return (
    <>
      <Head><title>{t('pageTitles.scrumArchive')}</title></Head>
      <ArchiveView
        title={t('misc.archive.title', { app: 'Scrum' })}
        backHref="/scrum"
        fetchItems={async () => {
          const res = await axios.get('/scrum/archived');
          return res.data.status
            ? res.data.boards.map((b) => ({ id: b.board_id, name: b.name, sub: '', color: b.color }))
            : [];
        }}
        onRestore={async (id) => (await axios.post(`/scrum/${id}/restore`)).data.status === true}
        onPermanentDelete={async (id) => (await axios.delete(`/scrum/${id}/permanent`)).data.status === true}
      />
    </>
  );
}
