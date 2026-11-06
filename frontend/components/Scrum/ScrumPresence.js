import { useTranslation } from 'react-i18next';
import AvatarStack from '@/components/common/AvatarStack';

// 보드 머리의 '편집 중' 표시 — 지금 주간 문서에 접속한 사람들(users: awareness 목록).
// 아바타는 캔버스 접속자 표시와 같은 공용 AvatarStack(4개 + 나머지 +N)이 그린다 — awareness 항목의
// name·color·avatar_url을 <Avatar>가 그대로 읽는다. +N은 가려진 사람 이름을 보여 준다(showHiddenNames).
// 인원 글자는 전체 수를 센다.
export default function ScrumPresence({ users }) {
  const { t } = useTranslation();
  return (
    <div className="ScrumBoard__Live">
      <AvatarStack users={users} max={4} showHiddenNames />
      <span className="ScrumBoard__LiveText">
        <span className="ScrumBoard__LiveDot" aria-hidden="true" />
        {t('scrum.board.editingCount', { count: users.length })}
      </span>
    </div>
  );
}
