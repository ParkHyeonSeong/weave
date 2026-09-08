import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import { axios } from '@/library/_axios';
import ArchiveView from '@/components/Home/shared/ArchiveView';

export default function CanvasArchive() {
  const { t } = useTranslation();
  return (
    <>
      <Head><title>{t('misc.pageTitles.canvasArchive')}</title></Head>
      <ArchiveView
        title={t('misc.archive.title', { app: 'Canvas' })}
        backHref="/canvas"
        fetchItems={async () => {
          const res = await axios.get('/canvases/archived');
          return res.data.status
            ? res.data.canvases.map((c) => ({ id: c.canvas_id, name: c.canvas_name, sub: c.key, color: c.color }))
            : [];
        }}
        onRestore={async (id) => (await axios.post(`/canvases/${id}/restore`)).data.status === true}
        onPermanentDelete={async (id) => (await axios.delete(`/canvases/${id}/permanent`)).data.status === true}
      />
    </>
  );
}
