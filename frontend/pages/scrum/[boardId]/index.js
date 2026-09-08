import { useTranslation } from 'react-i18next';
import Head from 'next/head';
import ScrumBoardView from '@/components/Scrum/ScrumBoardView';
export default function ScrumBoardPage() {
  const { t } = useTranslation();
  return (<><Head><title>{t('pageTitles.scrum')}</title></Head><ScrumBoardView /></>);
}
