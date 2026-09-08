import { useState, useEffect, useRef, useCallback } from 'react';
import { ExternalLink, Pencil, Unlink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { normalizeLinkHref, isSafeLinkHref, promptSetLink } from '@/library/editorLink';

const POPOVER_H = 36; // 팝오버 대략 높이(px) — 링크 위/아래 배치 판단용

// 에디터 안의 링크에 마우스를 올리면 그 위에 뜨는 미니 팝오버(열기·편집·삭제).
// 에디터가 항상 편집 모드(openOnClick:false)라 클릭으로 링크를 못 여는 것을 보완한다.
// 위치는 TableBubbleMenu/ScrumCellToolbar처럼 getBoundingClientRect + fixed로 그리드 클리핑을 피한다.
export default function LinkHoverPopover({ editor }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState(null);   // 현재 hover 중인 <a>
  const [rect, setRect] = useState(null);
  const closeTimer = useRef(null);
  const popoverRef = useRef(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const clear = useCallback(() => { setAnchor(null); setRect(null); }, []);
  const close = useCallback(() => { cancelClose(); clear(); }, [cancelClose, clear]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(clear, 140);
  }, [cancelClose, clear]);

  // 링크 hover 추적: pointerover/out + relatedTarget로 자식노드/팝오버 이동 시 깜빡임 방지
  useEffect(() => {
    if (!editor) return undefined;
    const dom = editor.view.dom;
    const linkType = editor.schema.marks.link;
    // bookmark 등 atom/node-view 앵커 제외: posAtDOM 위치에 실제 link mark가 있을 때만 캡처
    const isLinkMarkAnchor = (a) => {
      if (!linkType) return false;
      try {
        const $pos = editor.state.doc.resolve(editor.view.posAtDOM(a, 0));
        return linkType.isInSet($pos.marks())
          || (!!$pos.nodeBefore && linkType.isInSet($pos.nodeBefore.marks))
          || (!!$pos.nodeAfter && linkType.isInSet($pos.nodeAfter.marks));
      } catch { return false; }
    };
    const onOver = (e) => {
      const a = e.target?.closest?.('a');
      if (a && dom.contains(a) && isLinkMarkAnchor(a)) { cancelClose(); setAnchor(a); setRect(a.getBoundingClientRect()); }
    };
    const onOut = (e) => {
      const to = e.relatedTarget;
      const nextA = to && dom.contains(to) ? to.closest('a') : null;
      if (nextA && isLinkMarkAnchor(nextA)) return;            // 이 에디터의 '진짜 링크'로 이동만 유지(bookmark 등 atom 제외)
      if (to && popoverRef.current?.contains(to)) return;      // 이 팝오버로 이동은 유지
      scheduleClose();
    };
    dom.addEventListener('pointerover', onOver);
    dom.addEventListener('pointerout', onOut);
    return () => {
      dom.removeEventListener('pointerover', onOver);
      dom.removeEventListener('pointerout', onOut);
      cancelClose();
      clear(); // 에디터 교체(ScrumCell ydoc/fragmentKey 변경)·언마운트 시 stale anchor 잔존 방지
    };
  }, [editor, cancelClose, scheduleClose, clear]);

  // 스크롤/리사이즈 시 위치 추적(사라진 링크면 닫기)
  useEffect(() => {
    if (!anchor) return undefined;
    const reposition = () => {
      if (!anchor.isConnected) { clear(); return; }
      setRect(anchor.getBoundingClientRect());
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [anchor, clear]);

  if (!editor || !anchor || !rect) return null;

  const href = anchor.getAttribute('href') || '';
  // 링크가 Yjs 원격 갱신 등으로 doc에서 사라졌으면 안전하게 no-op (posAtDOM RangeError 방지)
  const selectAnchor = () => {
    if (!anchor.isConnected) return null;
    try {
      const pos = editor.view.posAtDOM(anchor, 0);
      return editor.chain().focus().setTextSelection(pos).extendMarkRange('link');
    } catch { return null; }
  };
  const onOpen = () => {
    const h = normalizeLinkHref(href);
    if (h && isSafeLinkHref(h)) window.open(h, '_blank', 'noopener,noreferrer');
  };
  const onEdit = () => { const c = selectAnchor(); if (c) { c.run(); promptSetLink(editor); } close(); };
  const onRemove = () => { const c = selectAnchor(); if (c) c.unsetLink().run(); close(); };

  // 링크 위에 공간이 없으면(상단 근처) 아래로 배치 — clamp로 생기는 간격(hover 끊김) 방지
  const top = rect.top - POPOVER_H >= 8 ? rect.top - POPOVER_H : rect.bottom + 4;

  return (
    <div
      ref={popoverRef}
      className="LinkHoverPopover"
      style={{ position: 'fixed', left: `${rect.left}px`, top: `${top}px`, zIndex: 650 }}
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
      onMouseDown={(e) => e.preventDefault()} // 버튼 클릭 시 에디터 blur/선택 이동 방지
    >
      <span className="LinkHoverPopover__Url" title={href}>{href}</span>
      <span className="LinkHoverPopover__Sep" />
      <button type="button" className="LinkHoverPopover__Btn" title={t('common.actions.open')} onClick={onOpen}><ExternalLink size={13} /></button>
      <button type="button" className="LinkHoverPopover__Btn" title={t('common.actions.edit')} onClick={onEdit}><Pencil size={13} /></button>
      <button type="button" className="LinkHoverPopover__Btn LinkHoverPopover__Btn--danger" title={t('common.linkPopover.removeLink')} onClick={onRemove}><Unlink size={13} /></button>
    </div>
  );
}
