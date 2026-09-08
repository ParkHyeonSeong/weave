import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { CalendarCheck, History, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { useDateFormat } from '@/hooks/useDateFormat';

export default function ScrumHomeCards() {
  const { t } = useTranslation();
  // 회고 기간은 공유 date-only 값이다 — 시간대 변환 없이 표기만 locale에 맞춘다.
  const { formatDateOnlyRange } = useDateFormat();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const { isHidden } = useUiPrefs();

  useEffect(() => {
    let alive = true;
    axios.get('/scrum/home-cards')
      .then((r) => { if (alive && r.data.status) setData(r.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const pending = (data.today_pending || []).filter((b) => !dismissed.has(`t${b.board_id}`) && !isHidden('scrums', b.board_id));
  const retro = (data.retro_due || []).filter((b) => !dismissed.has(`r${b.board_id}`) && !isHidden('scrums', b.board_id));
  if (pending.length === 0 && retro.length === 0) return null;

  const dismiss = (k) => setDismissed((p) => new Set(p).add(k));

  return (
    <div className="ScrumCards">
      {pending.map((b) => (
        <div key={`t${b.board_id}`} className="ScrumCard ScrumCard--today" style={{ '--accent': b.color }}>
          <div className="ScrumCard__Main" onClick={() => router.push(`/scrum/${b.board_id}`)}>
            <CalendarCheck size={16} />
            <span><b>{b.name}</b> · {t('home.scrumCards.todayPending')}</span>
          </div>
          <button className="ScrumCard__Go" onClick={() => router.push(`/scrum/${b.board_id}`)}>{t('home.scrumCards.writeNow')}</button>
          <button className="ScrumCard__X" onClick={() => dismiss(`t${b.board_id}`)} aria-label={t('common.actions.close')}><X size={14} /></button>
        </div>
      ))}
      {retro.map((b) => (
        <div key={`r${b.board_id}`} className="ScrumCard ScrumCard--retro">
          <div className="ScrumCard__Main" onClick={() => router.push(`/scrum/${b.board_id}?tab=retro`)}>
            <History size={16} />
            <span><b>{b.name}</b> · {t('home.scrumCards.retroDue')} ({formatDateOnlyRange(b.period_start, b.period_end)})</span>
          </div>
          <button className="ScrumCard__Go ScrumCard__Go--retro" onClick={() => router.push(`/scrum/${b.board_id}?tab=retro`)}>{t('home.scrumCards.writeRetro')}</button>
          <button className="ScrumCard__X" onClick={() => dismiss(`r${b.board_id}`)} aria-label={t('common.actions.close')}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
