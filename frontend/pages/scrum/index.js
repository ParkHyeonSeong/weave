import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import ScrumHome from '@/components/Scrum/ScrumHome';
export default function ScrumIndex() {
  const { t } = useTranslation();
  return (<><Head><title>{t('pageTitles.scrum')}</title></Head><ScrumHome /></>);
}
