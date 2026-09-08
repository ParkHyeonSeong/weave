// 프레임워크 오류 화면(pages/404.js·pages/500.js)의 공용 표현부.
//
// 데이터를 조회하지 않는다 — 500은 서버가 요청을 끝내지 못한 상황에서 뜨는 화면이라
// 여기서 API를 부르면 화면 자체가 다시 실패한다. 문구는 호출부가 현재 언어로 만들어 넘긴다.
// 행동 버튼도 호출부가 children으로 준다(404는 홈으로, 500은 다시 시도 + 홈으로).
//
// 시각은 ErrorBoundary와 같은 토큰·여백을 쓰되 이쪽은 앱 셸 안에서 렌더되므로
// 100vh가 아니라 콘텐츠 영역 기준으로 중앙에 둔다(styles/components/layout/errorBoundary.scss).
export default function ErrorPage({ icon: Icon, code, title, message, children }) {
  return (
    <div className="ErrorPage">
      <Icon className="ErrorPage__Icon" size={48} aria-hidden="true" />
      <p className="ErrorPage__Code">{code}</p>
      <h1 className="ErrorPage__Title">{title}</h1>
      <p className="ErrorPage__Message">{message}</p>
      <div className="ErrorPage__Actions">{children}</div>
    </div>
  );
}
