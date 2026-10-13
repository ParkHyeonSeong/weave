import { createContext, useContext, useState } from 'react';
import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';
import ScrollTopButton from '@/components/common/ScrollTopButton';

// 본문 스크롤 영역(__Main) 요소. 전체 상세의 섹션 바로가기가 이 영역을 스크롤한다.
// (Canvas의 기존 `.Layout__Content` 조회는 이 레이아웃 아래에서 스크롤하지 않는 요소를 가리킨다.)
const PageScrollContext = createContext(null);
export function usePageScrollElement() {
  return useContext(PageScrollContext);
}

/**
 * 풀페이지 라우트(canvas·task·issue)용 레이아웃 — 본문 + 우측 ref 패널.
 * useRefPreview를 자체 보유하므로 라우트는 칩 클릭 상태를 신경 쓸 필요가 없고,
 * children을 element로 넘기면(참조가 고정됨) 칩 클릭으로 패널이 열려도 본문은
 * 리렌더되지 않는다. 읽기 모드 폴백(canvas의 onRefClick)이 필요한 라우트는
 * children을 함수로 넘겨 setPreviewRef를 받는다.
 *
 * scrollTopButton: 본문 영역 우하단 맨 위로 버튼(canvas·task 라우트). 버튼은 스크롤하지 않는
 * __MainWrap에 붙어 본문 영역을 따라간다 — ref 패널이 열려 본문이 좁아져도 그 오른쪽 아래에 있다.
 *
 * BranchDetail은 작업 패널과 나란히 놓이는 3열 구성 + 같은 task 중복 가드라는
 * 고유 사정이 있어, 이 컴포넌트를 쓰지 않고 useRefPreview를 직접 쓴다.
 */
export default function RefPanelPageLayout({ children, scrollTopButton = false }) {
  const [previewRef, setPreviewRef] = useRefPreview();
  const [mainEl, setMainEl] = useState(null);
  const [wrapEl, setWrapEl] = useState(null);
  return (
    <div className="RefPanelPageLayout">
      <div ref={setWrapEl} className="RefPanelPageLayout__MainWrap">
        <div ref={setMainEl} className="RefPanelPageLayout__Main">
          <PageScrollContext.Provider value={mainEl}>
            {typeof children === 'function' ? children(setPreviewRef) : children}
          </PageScrollContext.Provider>
        </div>
        {scrollTopButton && <ScrollTopButton scrollEl={mainEl} regionEl={wrapEl} />}
      </div>
      <RefPanelHost
        previewRef={previewRef}
        onClose={() => setPreviewRef(null)}
        onChangeRef={setPreviewRef}
      />
    </div>
  );
}
