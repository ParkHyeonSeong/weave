import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Minus, Maximize, Download, Copy, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clampScale, getOneToOneScale, zoomAtPoint } from '@/library/lightboxZoom';
import { downloadImage, copyImageToClipboard } from '@/library/lightboxIO';
import { showToast } from '@/components/Layout/Toast';

const MIN_SCALE = 1;
const BASE_MAX_SCALE = 8;
const WHEEL_STEP = 1.0015; // deltaY당 배율(부드러운 휠 줌)
const BTN_STEP = 1.25;

export default function Lightbox({ images, index, onClose, onIndexChange }) {
  const { t } = useTranslation();
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, tx, ty }
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [loadError, setLoadError] = useState(false);

  const current = images[index];
  const hasGallery = images.length > 1;

  const reset = useCallback(() => setView({ scale: 1, tx: 0, ty: 0 }), []);

  // 이미지(인덱스) 바뀌면 줌/팬/에러 리셋
  useEffect(() => { reset(); setLoadError(false); }, [index, reset]);

  // 열려 있는 동안 body 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const maxScale = () => {
    const fitW = imgRef.current?.clientWidth || 0;
    return Math.max(BASE_MAX_SCALE, getOneToOneScale(natural.w, fitW));
  };

  const goPrev = useCallback(() => {
    if (hasGallery) onIndexChange((index - 1 + images.length) % images.length);
  }, [hasGallery, index, images.length, onIndexChange]);
  const goNext = useCallback(() => {
    if (hasGallery) onIndexChange((index + 1) % images.length);
  }, [hasGallery, index, images.length, onIndexChange]);

  const zoomByButton = (factor) => {
    setView((v) => {
      const next = clampScale(v.scale * factor, MIN_SCALE, maxScale());
      return zoomAtPoint(v, next, { x: 0, y: 0 });
    });
  };
  const setOneToOne = () => {
    const fitW = imgRef.current?.clientWidth || 0;
    setView((v) => {
      const next = clampScale(getOneToOneScale(natural.w, fitW), MIN_SCALE, maxScale());
      return zoomAtPoint(v, next, { x: 0, y: 0 });
    });
  };

  // 키보드: Esc 닫기 / ←→ 이전·다음 / +- 줌 / 0 리셋
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); }
      else if (e.key === 'ArrowLeft') { goPrev(); }
      else if (e.key === 'ArrowRight') { goNext(); }
      else if (e.key === '+' || e.key === '=') { zoomByButton(BTN_STEP); }
      else if (e.key === '-') { zoomByButton(1 / BTN_STEP); }
      else if (e.key === '0') { reset(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goPrev, goNext, onClose, reset, natural]);

  // 휠 줌: React onWheel은 root에 passive로 붙어 preventDefault가 무시되므로
  // 스테이지에 네이티브 non-passive 리스너를 직접 단다.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const handler = (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const pointer = { x: e.clientX - (rect.left + rect.width / 2), y: e.clientY - (rect.top + rect.height / 2) };
      setView((v) => {
        const next = clampScale(v.scale * Math.pow(WHEEL_STEP, -e.deltaY), MIN_SCALE, maxScale());
        return zoomAtPoint(v, next, pointer);
      });
    };
    stage.addEventListener('wheel', handler, { passive: false });
    return () => stage.removeEventListener('wheel', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.startX), ty: d.ty + (e.clientY - d.startY) }));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose(); };

  const onDownload = async () => {
    const ok = await downloadImage(current.src, current.filename);
    showToast(
      ok ? t('common.lightbox.downloaded') : t('common.lightbox.openedInNewTab'),
      ok ? 'success' : 'info',
    );
  };
  const onCopy = async () => {
    try {
      await copyImageToClipboard(current.src);
      showToast(t('common.lightbox.copied'), 'success');
    } catch {
      showToast(t('common.lightbox.copyFailed'), 'error');
    }
  };

  return createPortal(
    <div className="Lightbox__Backdrop" onClick={handleBackdrop}>
      <div className="Lightbox__Topbar">
        {hasGallery && <span className="Lightbox__Counter">{index + 1} / {images.length}</span>}
        <div className="Lightbox__TopActions">
          <button className="Lightbox__IconBtn" title={t('common.lightbox.copy')} onClick={onCopy}><Copy size={18} /></button>
          <button className="Lightbox__IconBtn" title={t('common.lightbox.download')} onClick={onDownload}><Download size={18} /></button>
          <button className="Lightbox__IconBtn" title={t('common.actions.close')} onClick={onClose}><X size={20} /></button>
        </div>
      </div>

      {hasGallery && (
        <>
          <button className="Lightbox__Nav Lightbox__Nav--prev" title={t('common.actions.previous')} onClick={goPrev}><ChevronLeft size={32} /></button>
          <button className="Lightbox__Nav Lightbox__Nav--next" title={t('common.actions.next')} onClick={goNext}><ChevronRight size={32} /></button>
        </>
      )}

      <div className="Lightbox__Stage" ref={stageRef} onClick={handleBackdrop}>
        {loadError ? (
          <div className="Lightbox__Error">{t('common.lightbox.loadError')}</div>
        ) : (
          <img
            ref={imgRef}
            className="Lightbox__Image"
            src={current.src}
            alt={current.alt}
            draggable={false}
            style={{
              transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
              cursor: view.scale > 1 ? 'grab' : 'default',
            }}
            onLoad={(e) => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
            onError={() => setLoadError(true)}
            onDoubleClick={() => (view.scale > 1 ? reset() : zoomByButton(2))}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>

      <div className="Lightbox__Zoombar" onClick={(e) => e.stopPropagation()}>
        <button className="Lightbox__IconBtn" title={t('common.lightbox.zoomOut')} onClick={() => zoomByButton(1 / BTN_STEP)}><Minus size={18} /></button>
        <button className="Lightbox__ZoomBtn" title={t('common.lightbox.actualSize')} onClick={setOneToOne}>100%</button>
        <button className="Lightbox__ZoomBtn" title={t('common.lightbox.fitToScreen')} onClick={reset}><Maximize size={16} /></button>
        <button className="Lightbox__IconBtn" title={t('common.lightbox.zoomIn')} onClick={() => zoomByButton(BTN_STEP)}><Plus size={18} /></button>
      </div>
    </div>,
    document.body
  );
}
