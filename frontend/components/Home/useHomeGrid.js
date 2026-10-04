import { useLayoutEffect, useState } from 'react';
import { getHomeGridMetrics } from '@/library/homeLayout';

export default function useHomeGrid(gridRef) {
  const [geometry, setGeometry] = useState(() => ({
    ...getHomeGridMetrics(984, 912), ready: false, key: 'unmeasured',
  }));

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const container = grid?.closest('.Layout__Content') || grid?.parentElement;
    const measure = () => {
      const width = grid?.getBoundingClientRect().width || 0;
      const contentWidth = container?.clientWidth || container?.getBoundingClientRect().width || 0;
      if (!width || !contentWidth) {
        setGeometry(previous => previous.ready ? { ...previous, ready: false, key: 'unmeasured' } : previous);
        return;
      }
      const next = getHomeGridMetrics(contentWidth, width);
      const key = [next.mode, next.columns, width, next.rowStep, next.columnGap].join(':');
      setGeometry(previous => previous.key === key ? previous : { ...next, width, ready: true, key });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (grid) observer?.observe(grid);
    if (container && container !== grid) observer?.observe(container);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [gridRef]);
  return geometry;
}
