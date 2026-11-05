import { useState, useEffect } from 'react';

// Y.Doc 내용이 바뀔 때마다 올라가는 숫자 — 문서에서 파생한 값(예: 칸에 글이 있는지)을
// 호출부가 다시 계산하는 신호로 쓴다. 연속 update(타이핑·원격 동기화)는 프레임당 한 번으로 묶는다.
// ydoc이 null인 동안에도 숫자를 돌려준다.
export default function useYDocRevision(ydoc) {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!ydoc) return undefined;
    let frame = null;
    const onUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setRevision((n) => n + 1);
      });
    };
    ydoc.on('update', onUpdate);
    return () => {
      ydoc.off('update', onUpdate);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ydoc]);

  return revision;
}
