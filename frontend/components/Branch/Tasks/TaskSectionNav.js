import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import useSectionNav from '@/hooks/useSectionNav';
import { itemKeyOf, presentItems, sectionIdsOf, targetSectionOf } from '@/library/taskSectionNav';

// 마우스 누름이 포커스를 빼앗지 않게 한다 — 설명 편집기는 blur에 저장·종료되므로,
// 바로가기를 눌렀다고 편집 상태가 끝나면 안 된다(키보드로 Tab 이동할 때만 포커스가 옮겨 간다).
const keepFocus = (e) => e.preventDefault();

/**
 * 태스크 패널·전체 상세의 섹션 바로가기(스크롤 중에도 보이는 sticky 바).
 * 본문을 숨기거나 바꾸지 않고 같은 본문 안의 섹션으로 스크롤한다.
 *
 * nav = library/taskSectionNav의 PANEL_NAV | FULL_PAGE_NAV. 더보기 항목은 메뉴를 열 때 실제로 렌더된
 * 섹션만 보여 준다(의존성은 항목이 없으면 섹션 자체가 없다). 더보기 안의 섹션을 읽는 중이면 트리거가
 * 그 섹션 이름을 보여 준다.
 */
export default function TaskSectionNav({ nav, scrollEl, rootEl }) {
  const { t } = useTranslation();
  const [navEl, setNavEl] = useState(null);
  const sectionIds = useMemo(() => sectionIdsOf(nav), [nav]);
  const { activeSection, scrollToSection, presentSectionIds } = useSectionNav({
    scrollEl, rootEl, navEl, sectionIds,
  });
  const activeKey = itemKeyOf(nav, activeSection);
  const activeOverflow = nav.overflow.find((it) => it.key === activeKey) || null;

  // 더보기 메뉴: null = 닫힘. viaKeyboard일 때만 메뉴 안으로 포커스를 옮긴다 — 마우스로 열 때 포커스를
  // 옮기면 설명 편집기가 blur에 저장·종료된다.
  const [menu, setMenu] = useState(null);   // { items, viaKeyboard } | null
  const menuId = useId();
  const moreRef = useRef(null);
  const triggerRef = useRef(null);
  const trackRef = useRef(null);
  const label = (key) => t(`branchTasks.sectionNav.${key}`);

  const go = (item) => {
    const target = targetSectionOf(item, presentSectionIds());
    if (target) scrollToSection(target);
  };

  // 메뉴 안에 포커스가 있었으면(키보드 사용) 트리거로 돌려준다 — 사라지는 항목에 포커스가 남지 않게
  const closeMenu = () => {
    const focusInside = !!moreRef.current?.contains(document.activeElement);
    setMenu(null);
    if (focusInside) triggerRef.current?.focus();
  };

  // 현재 항목이 가로 트랙 밖이면 트랙만 옮겨 보이게 한다(다른 스크롤러는 건드리지 않는다)
  useEffect(() => {
    const track = trackRef.current;
    const btn = track?.querySelector(`[data-nav-key="${activeKey}"]`);
    if (!track || !btn) return;
    const left = btn.offsetLeft - track.offsetLeft;
    if (left < track.scrollLeft) track.scrollLeft = Math.max(0, left - 8);
    else if (left + btn.offsetWidth > track.scrollLeft + track.clientWidth) {
      track.scrollLeft = left + btn.offsetWidth - track.clientWidth + 8;
    }
  }, [activeKey]);

  // 메뉴: 바깥 누름 → 닫기. 키보드로 열었으면 첫 항목으로 포커스
  useEffect(() => {
    if (!menu) return undefined;
    if (menu.viaKeyboard) moreRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    const onDown = (e) => { if (!moreRef.current?.contains(e.target)) setMenu(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu]);

  // Escape·화살표는 포커스가 더보기 안에 있을 때만 — 댓글 입력기의 Esc(취소)를 가로채지 않는다
  const onMoreKeyDown = (e) => {
    if (!menu) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...moreRef.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const primary = nav.primary;   // 기본 항목의 섹션은 부모가 항상 렌더한다(태스크 로드 후 이 바가 그려진다)

  return (
    <nav ref={setNavEl} className="TaskSectionNav" aria-label={t('branchTasks.sectionNav.ariaLabel')}>
      <div ref={trackRef} className="TaskSectionNav__Track">
        {primary.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              data-nav-key={item.key}
              className={`TaskSectionNav__Item${active ? ' TaskSectionNav__Item--active' : ''}`}
              aria-current={active ? 'location' : undefined}
              onMouseDown={keepFocus}
              onClick={() => go(item)}
            >
              {label(item.key)}
            </button>
          );
        })}
      </div>
      {nav.overflow.length > 0 && (
        <div
          ref={moreRef}
          className="TaskSectionNav__More"
          onKeyDown={onMoreKeyDown}
          onBlur={(e) => { if (menu && !moreRef.current?.contains(e.relatedTarget)) setMenu(null); }}
        >
          <button
            ref={triggerRef}
            type="button"
            className={`TaskSectionNav__Item TaskSectionNav__MoreBtn${activeOverflow ? ' TaskSectionNav__Item--active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            aria-controls={menu ? menuId : undefined}
            aria-label={activeOverflow ? t('branchTasks.sectionNav.moreCurrent', { name: label(activeOverflow.key) }) : undefined}
            onMouseDown={keepFocus}
            // detail 0 = 키보드(Enter·Space)로 누른 click
            onClick={(e) => (menu
              ? closeMenu()
              : setMenu({ items: presentItems(nav.overflow, presentSectionIds()), viaKeyboard: e.detail === 0 }))}
          >
            {activeOverflow ? label(activeOverflow.key) : label('more')}
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {menu && (
            <div id={menuId} role="menu" className="TaskSectionNav__Menu">
              {menu.items.map((item) => {
                const active = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    className={`TaskSectionNav__MenuItem${active ? ' TaskSectionNav__MenuItem--active' : ''}`}
                    aria-current={active ? 'location' : undefined}
                    onMouseDown={keepFocus}
                    onClick={() => { closeMenu(); go(item); }}
                  >
                    {label(item.key)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
