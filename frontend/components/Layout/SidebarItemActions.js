import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';

/** 사이드바 아이템 호버 ⋯ 버튼. 클릭 시 공용 컨텍스트 메뉴를 연다(우클릭과 동일). */
export default function SidebarItemActions({ onMenu }) {
  const { t } = useTranslation();
  return (
    <button
      className="Sidebar__BranchAddBtn"
      onClick={(e) => { e.stopPropagation(); onMenu(e); }}
      title={t('common.actions.more')}
      aria-label={t('common.actions.more')}
    >
      <MoreHorizontal size={14} />
    </button>
  );
}
