import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import { axios } from '@/library/_axios';
import ArchiveView from '@/components/Home/shared/ArchiveView';

export default function TrackArchive() {
  const { t } = useTranslation();
  return (
    <>
      <Head><title>{t('pageTitles.trackArchive')}</title></Head>
      <ArchiveView
        title={t('misc.archive.title', { app: 'Track' })}
        backHref="/tracks"
        fetchItems={async () => {
          const res = await axios.get('/tracks/archived');
          return res.data.status
            ? res.data.tracks.map((track) => ({ id: track.track_id, name: track.track_name, sub: '', color: track.color }))
            : [];
        }}
        onRestore={async (id) => (await axios.post(`/tracks/${id}/restore`)).data.status === true}
        onPermanentDelete={async (id) => (await axios.delete(`/tracks/${id}/permanent`)).data.status === true}
      />
    </>
  );
}
