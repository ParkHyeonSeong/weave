import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * DropdownPortal - 트리거(anchor) rect 기준 fixed 배치로 document.body에 포털되는 드롭다운 래퍼
 *
 * `overflow: hidden` 조상(그룹 리스트 등)에 드롭다운이 클리핑되는 문제를 해소하기 위해,
 * 드롭다운 내용을 body 최상위로 이동시키고 트리거 위치를 기준으로 fixed 좌표를 계산한다.
 *
 * - 위치는 open 시 즉시 계산 + rAF 1회 재계산(초회는 드롭다운이 아직 렌더되지 않아 실측 폭/높이를
 *   알 수 없으므로 기본값으로 클램프됨 → 렌더 직후 실측으로 재보정 필요) + scroll(캡처 단계, 중첩
 *   스크롤 컨테이너 포함)·resize 시 갱신.
 * - 뷰포트 가장자리에서 좌우 클램프, 아래로 다 안 들어가면 위로 플립.
 * - 트리거보다 좁아지지 않도록 minWidth를 anchor 폭으로 지정.
 *
 * @param {React.RefObject<HTMLElement>} anchorRef - 위치 기준이 되는 트리거 요소 ref
 * @param {boolean} open - 드롭다운 표시 여부
 * @param {'left'|'right'} [align='left'] - anchor 기준 정렬(오른쪽 정렬 시 anchor 우측에 맞춤)
 * @param {React.ReactNode} children - 드롭다운 내용
 * @param {React.RefObject<HTMLElement>} dropdownRef - 포털된 드롭다운 루트에 부착할 ref(외부 클릭 판정용)
 * @param {boolean} [keepInViewport=false] - 세로로도 화면 안(8px 여백)에 붙잡아 두고, 내용 높이가 바뀌면 다시 맞춘다.
 *   트리거가 스크롤로 화면 밖에 나가도 입력·버튼이 화면 밖으로 나가지 않아야 하는 편집창용(라벨 편집창).
 *   끄면(기본) 지금 동작 그대로다.
 */
export default function DropdownPortal({ anchorRef, open, align = 'left', children, dropdownRef, keepInViewport = false }) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    let ro = null;
    const update = () => {
      const r = anchorRef.current.getBoundingClientRect();
      const dd = dropdownRef.current;
      const w = dd ? dd.offsetWidth : 200;
      const h = dd ? dd.offsetHeight : 240;
      let left = align === 'right' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = r.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4); // 아래 안 맞으면 위로 플립
      if (keepInViewport) {
        // 트리거가 화면 위로 나가면 top이 음수가 된다 — 위·아래 8px 안으로 붙잡는다(높이가 화면보다 크면 위에 붙인다)
        top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
        if (dd && !ro && typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(() => { if (anchorRef.current) update(); });   // 실패 문구 등으로 높이가 바뀌면 다시 맞춘다
          ro.observe(dd);
        }
      }
      setPos({ left, top, minWidth: r.width });
    };
    update();
    const raf = requestAnimationFrame(update); // 필수: 초회는 dd가 null(기본 폭 200 가정)이라 렌더 직후 실측으로 재계산
    window.addEventListener('scroll', update, true); // 캡처: 내부 스크롤러 포함
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [open, align, anchorRef, dropdownRef, keepInViewport]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={dropdownRef}
      // z 2000 = DatePicker 포털 티어 — 모달 백드롭(z1000) 안의 셀렉트가 위에 떠야 함
      style={{ position: 'fixed', left: pos.left, top: pos.top, minWidth: pos.minWidth, zIndex: 2000 }}
    >
      {children}
    </div>,
    document.body
  );
}
