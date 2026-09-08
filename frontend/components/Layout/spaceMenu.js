import {
  ArrowRight, ExternalLink, Settings, Pencil, Users, Eye, EyeOff, Archive, LogOut,
  FileText, FileCode, FolderPlus,
} from 'lucide-react';

// space: { appType:'branch'|'canvas'|'track'|'scrum', id, name, role, isHidden }
// h: { open, openNewTab, settings, rename, members, toggleHide, archive, leave, addDoc, addTypst, addFolder }
//
// t는 호출부(useTranslation)가 넘긴다. 이 모듈은 React 컴포넌트가 아니라 순수 빌더라
// 훅을 쓸 수 없고, i18next를 직접 읽으면 언어 변경 시 메뉴가 재렌더되지 않는다.
export function buildSpaceMenu(space, h, t) {
  const isAdmin = space.role === 'admin' || space.role === 'owner';
  const items = [];

  items.push({ id: 'open', group: 'open', icon: ArrowRight, label: t('spaceMenu.open'), onSelect: h.open });
  items.push({ id: 'open-new', group: 'open', icon: ExternalLink, label: t('spaceMenu.openNewTab'), onSelect: h.openNewTab });

  // create 그룹은 생성 핸들러가 제공될 때만(사이드바). 홈 카드 등 미제공 표면은 생략.
  if (space.appType === 'canvas' && h.addDoc) {
    items.push({ id: 'add-doc', group: 'create', icon: FileText, label: t('spaceMenu.addDocument'), onSelect: h.addDoc });
    items.push({ id: 'add-typst', group: 'create', icon: FileCode, label: t('spaceMenu.addTypst'), onSelect: h.addTypst });
    items.push({ id: 'add-folder', group: 'create', icon: FolderPlus, label: t('spaceMenu.addFolder'), onSelect: h.addFolder });
  }

  items.push({ id: 'settings', group: 'edit', icon: Settings, label: t('spaceMenu.settings'), onSelect: h.settings });
  // 숨긴 행은 인라인 rename 입력칸을 렌더하지 않으므로 rename 항목을 노출하지 않음.
  if (isAdmin && !space.isHidden) {
    items.push({ id: 'rename', group: 'edit', icon: Pencil, label: t('spaceMenu.rename'), onSelect: h.rename });
  }

  items.push({ id: 'members', group: 'share', icon: Users, label: t('spaceMenu.manageMembers'), onSelect: h.members });

  items.push({
    id: 'hide', group: 'organize', icon: space.isHidden ? Eye : EyeOff,
    label: space.isHidden ? t('spaceMenu.unhide') : t('spaceMenu.hide'), onSelect: h.toggleHide,
  });

  if (isAdmin) {
    items.push({ id: 'archive', group: 'danger', icon: Archive, variant: 'danger', label: t('spaceMenu.archive'), onSelect: h.archive });
  }
  items.push({ id: 'leave', group: 'danger', icon: LogOut, variant: 'danger', label: t('spaceMenu.leave'), onSelect: h.leave });

  return items;
}
