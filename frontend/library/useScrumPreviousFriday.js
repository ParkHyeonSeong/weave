import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { axios, getWsBaseURL } from '@/library/_axios';
import { attachWsTokenRefresh } from '@/library/wsTokenRefresh';
import { addWeeks, isoWeekOfDateOnly, weekDates } from '@/library/isoWeek';
import { weekCellKey } from '@/library/scrumCellContent';

function previousFridayOf(monday) {
  const week = isoWeekOfDateOnly(monday);
  if (!week) return null;
  const previous = addWeeks(week.isoYear, week.isoWeek, -1);
  return { ...previous, date: weekDates(previous.isoYear, previous.isoWeek)[4].date };
}

// 기존 주간 연결로 원본을 읽고 바로 닫는다. 편집기·접속자 표시·브로드캐스트 채널은 만들지 않는다.
// 평문 cells API는 체크박스·태스크 칩·서식을 보존하지 못하므로 Yjs 문서에서 JSON을 읽는다.
export async function readPreviousFriday(boardId, monday, userId, signal) {
  const previous = previousFridayOf(monday);
  const res = await axios.get(`/scrum/${boardId}/weeks/${previous.isoYear}/${previous.isoWeek}`, { signal, timeout: 15000 });
  if (!res.data.status || !res.data.week) throw new Error('Previous week unavailable');
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`${getWsBaseURL()}/api/ws/scrum/${boardId}/weeks`, String(res.data.week.week_id), doc, { connect: false, disableBc: true });
    provider.awareness.setLocalState(null);
    const detachRefresh = attachWsTokenRefresh(provider);
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      let content;
      try {
        if (!error) content = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(weekCellKey(userId, 4, 'plan')));
      } catch (err) { error = err; }
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      provider.off('sync', onSync);
      detachRefresh();
      provider.destroy();
      doc.destroy();
      if (error) reject(error);
      else resolve({ date: previous.date, doc: content });
    };
    const onSync = (synced) => { if (synced) finish(); };
    const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Previous week sync timed out')), 15000);
    provider.on('sync', onSync);
    signal.addEventListener('abort', onAbort, { once: true });
    provider.connect();
  });
}

// 현재 월요일의 내 할 일이 비었을 때만 사용한다. 다른 주로 이동하면 이전 요청과 결과를 버린다.
export default function useScrumPreviousFriday({ boardId, monday, userId, enabled }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const key = `${boardId}:${monday}:${userId}:${attempt}`;
  const active = enabled && !!boardId && !!userId && !!monday;

  useEffect(() => {
    if (!active) { setResult(null); return undefined; }
    const controller = new AbortController();
    setResult({ key, status: 'loading' });
    readPreviousFriday(boardId, monday, userId, controller.signal).then(
      (source) => { if (!controller.signal.aborted) setResult({ key, status: 'ready', ...source }); },
      () => { if (!controller.signal.aborted) setResult({ key, status: 'error' }); },
    );
    return () => controller.abort();
  }, [active, boardId, monday, userId, key]);

  const current = active ? (result?.key === key ? result : { status: 'loading' }) : { status: 'idle' };
  return { ...current, date: previousFridayOf(monday)?.date, retry };
}
