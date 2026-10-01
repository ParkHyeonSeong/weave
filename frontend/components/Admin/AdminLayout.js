import { useEffect } from 'react';
import Header from '@/components/Layout/Header';
import AdminSidebar from './AdminSidebar';
import { subscribeToPush } from '@/library/pushSubscription';

export default function AdminLayout({ children }) {
  // 이미 허용한 기기의 구독을 조용히 갱신한다(Layout과 같다). 종 드롭다운은 이 페이지에서 서버 등록까지 확인된
  // 구독만 연결됨으로 보므로, Layout 없이 종을 그리는 관리자 화면도 로드 때 한 번 등록을 확인한다.
  useEffect(() => {
    let profile = {};
    try {
      profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    } catch {}
    if (profile.user_id) subscribeToPush();
  }, []);

  return (
    <div className="Layout">
      <Header />
      <div className="Layout__Body">
        <AdminSidebar />
        <main className="Layout__Content">
          {children}
        </main>
      </div>
    </div>
  );
}
