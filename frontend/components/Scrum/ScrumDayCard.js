import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { yUndoPluginKey, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { Check, ChevronUp, CircleCheck, Copy, Info, Plus, Sunrise, Sunset, Undo2 } from 'lucide-react';
import ScrumCell from './ScrumCell';
import Avatar from '@/components/common/Avatar';
import { cellHasContent, jsonHasContent, weekCellKey } from '@/library/scrumCellContent';
import { collectTaskIds, stripFinishedItems } from '@/library/scrumCarryOver';
import { WEEKDAY_LONG_KEYS } from '@/library/scrumViewModel';
import { hydrateEditor, resolveTaskCategories } from '@/library/refHydration';

// 팀원 목록에서 이 카드로 스크롤할 때 쓰는 DOM id
export const dayCardDomId = (userId) => `scrum-day-card-${userId}`;

const NO_PINS = { plan: false, recap: false };
const PIN_PLAN = { plan: true };
const PIN_RECAP = { recap: true };

// 가져오기가 넣은 트랜잭션 표시. 안내 띠는 이 표시가 없는 첫 변경(사용자가 고침·되돌림)에서 닫힌다.
const CARRY_META = 'scrumCarryOver';

// '쓰기'로 연 칸이면 편집기가 생기자마자 포커스를 넘긴다(누른 버튼은 사라지므로).
function focusIfRequested(requestRef, pane, editor) {
  if (!editor || editor.isDestroyed || requestRef.current !== pane) return;
  requestRef.current = null;
  editor.commands.focus('end');
}

// 전날 할 일을 JSON으로 읽고 끝난 항목을 뺀다(스펙 §6.4·§8). 태스크 상태는 칩 하이드레이션과 같은
// 조회로 지금 값을 묻는다. 조회가 실패하거나 예외로 끝나면 아무것도 빼지 않는다(failed).
async function readCarryOver(source) {
  let status;
  try {
    status = await resolveTaskCategories(collectTaskIds(source));
  } catch {
    status = { failed: true };
  }
  if (status.failed) return { doc: source, removed: 0, failed: true };
  return { ...stripFinishedItems(source, status.categoryById), failed: false };
}

// 하루 보기의 사람 카드 한 장 — 그날의 할 일(plan)·리캡(gap) 칸 (스펙 §6.2).
// 칸 두 개는 언제나 .ScrumDayCard__Panes 한 부모 아래 key="plan"/"recap"으로만 그린다:
// 카드 모양이 바뀌어도(둘 다 없음 → 하나만 → 둘 다) 편집기가 다시 마운트되지 않아
// 실행 취소 기록·포커스가 남는다(스펙 §8). 한 줄 행(slim row)은 그 부모 밖에 둔다.
// synced: 주간 문서의 첫 동기화. 그 전의 빈 문서로는 썼는지 말하지 않는다 — 작성 상태·'아직 작성 전이에요'·
// 한 줄 행의 '없어요' 글자·가져오기 버튼을 숨기고, 칸과 '쓰기' 버튼은 그대로 둔다.
export default function ScrumDayCard({ ydoc, member, members, isMe, dayIdx, open, onToggle, synced, previousFriday }) {
  const { t } = useTranslation();
  const nameId = useId();
  const userId = member.user_id;
  const planKey = weekCellKey(userId, dayIdx, 'plan');
  const recapKey = weekCellKey(userId, dayIdx, 'gap');
  // 문서가 바뀔 때마다 호출부(ScrumDayView)가 다시 그려 준다
  const hasPlan = cellHasContent(ydoc, planKey);
  const hasRecap = cellHasContent(ydoc, recapKey);

  // 고정된 칸: '쓰기'로 열었거나 한 번 만진 칸은 그날 동안 계속 보인다 — 내용을 다 지우거나
  // 옆 칸에 처음 쓰는 순간에도 편집기가 사라지거나 자리가 바뀌지 않게. 요일이 바뀌면 day가 달라져 풀린다.
  const [pins, setPins] = useState({ day: dayIdx, ...NO_PINS });
  const pinned = pins.day === dayIdx ? pins : NO_PINS;
  const pin = useCallback((next) => setPins((p) => {
    const cur = p.day === dayIdx ? p : { day: dayIdx, ...NO_PINS };
    const plan = cur.plan || !!next.plan;
    const recap = cur.recap || !!next.recap;
    return plan === cur.plan && recap === cur.recap ? cur : { day: dayIdx, plan, recap };
  }), [dayIdx]);

  // 내 카드는 둘 다 비어도 할 일 칸을 바로 쓸 수 있게 연다. 남의 빈 칸은 하루 보기에서 쓰지 않는다.
  const showPlan = hasPlan || pinned.plan || (isMe && !hasRecap);
  const showRecap = hasRecap || pinned.recap;

  const focusRequest = useRef(null);   // 'plan' | 'recap' | null
  const [planEditor, setPlanEditor] = useState(null);
  const [notice, setNotice] = useState(null);   // 가져온 뒤 안내 띠: { day, editor, message, count, undoable }
  const onPlanEditor = useCallback((editor) => {
    setPlanEditor(editor);
    // 안내 띠는 가져오기를 받은 편집기에 묶인다 — 칸이 접히거나 새로 만들어지면 되돌릴 기록도 없으니 닫는다
    setNotice((n) => (n && n.editor !== editor ? null : n));
    focusIfRequested(focusRequest, 'plan', editor);
  }, []);
  const onRecapEditor = useCallback((editor) => focusIfRequested(focusRequest, 'recap', editor), []);
  const openPane = (pane) => {
    focusRequest.current = pane;
    // 지금 보이는 칸도 함께 고정해, 새 칸에 쓰기 시작해도 옆 칸이 접히지 않게 한다
    pin({ plan: showPlan || pane === 'plan', recap: showRecap || pane === 'recap' });
  };

  // 내 빈 할 일에만 가져온다. 월요일은 지난주 금요일, 화~금은 같은 주의 전날이다.
  // 첫 동기화 전에는 이날 할 일이 정말 빈지 모르므로 보이지 않는다(서버 내용과 겹쳐 넣지 않게).
  // 전날 칸(${나}:${요일-1}:plan)은 읽기만 하고, 쓰기는 이날 할 일 편집기의 트랜잭션 하나로만 한다.
  const canCarry = synced && isMe && !hasPlan && (dayIdx === 0
    ? previousFriday?.status === 'ready' && jsonHasContent(previousFriday.doc)
    : cellHasContent(ydoc, weekCellKey(userId, dayIdx - 1, 'plan')));
  const prevDayName = dayIdx === 0
    ? t('scrum.carry.previousFriday', { date: previousFriday?.dateLabel })
    : t(WEEKDAY_LONG_KEYS[dayIdx - 1]);
  const fridayPending = synced && isMe && !hasPlan && dayIdx === 0
    && ['loading', 'error'].includes(previousFriday?.status);
  const [carryRequest, setCarryRequest] = useState(null);   // { day } — 그날 할 일 편집기가 준비되면 가져온다
  const carrying = useRef(false);                           // 상태를 묻는 중 — 여러 번 눌러도 한 번만 가져온다

  const carryOver = async (editor) => {
    if (carrying.current) return;
    carrying.current = true;
    try {
      const source = dayIdx === 0 ? previousFriday.doc
        : yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(weekCellKey(userId, dayIdx - 1, 'plan')));
      const { doc, removed, failed } = await readCarryOver(source);
      // 묻는 사이 편집기가 사라졌거나(접기·요일 이동) 칸에 누가 이미 썼으면 덮어쓰지 않는다
      if (!editor || editor.isDestroyed || cellHasContent(ydoc, planKey)) return;
      if (!jsonHasContent(doc)) {   // 전부 끝났다 — 빈 문서는 넣지 않고, 띠가 버튼 자리를 대신하니 포커스는 빈 칸으로
        setNotice({ day: dayIdx, editor, message: 'scrum.carry.nothing', undoable: false });
        editor.commands.focus('end');
        return;
      }
      // 편집기 트랜잭션 하나로 넣어야 Yjs 실행 취소 한 번(되돌리기·Cmd+Z)에 통째로 돌아간다.
      // Yjs UndoManager는 0.5초 안의 변경을 한 묶음으로 합치므로, 먼저 묶음을 끊는다 — 그래야 칸을 지운 직후
      // 가져와도 되돌리기가 가져오기만 걷어 내고 가져오기 직전(빈 칸)으로 돌아간다(지운 내용은 되살리지 않는다).
      yUndoPluginKey.getState(editor.state)?.undoManager?.stopCapturing();
      editor.chain().setMeta(CARRY_META, true).setContent(doc).focus('end').run();
      // 들어온 칩은 전날 칸의 상태 스냅숏(attrs)으로 그려진다 — 칩 하이드레이션으로 화면만 지금 상태로 덧칠한다.
      // 방금 물은 태스크 상태는 30초 캐시가 내주므로 새 요청이 없고, 문서를 바꾸지 않아 띠도 닫히지 않는다.
      if (editor && !editor.isDestroyed) hydrateEditor(editor);
      setNotice({
        day: dayIdx, editor, undoable: true, count: removed,
        message: failed ? 'scrum.carry.doneUnknown' : removed ? 'scrum.carry.doneRemoved' : 'scrum.carry.done',
      });
    } catch {
      // 예상 밖 예외(문서 변환·끝난 항목 빼기·setContent)는 편집기 트랜잭션이 dispatch되기 전이라 칸이 그대로다.
      // 처리 안 된 reject로 새지 않게 여기서 끝낸다. 맞는 안내 문구가 없어 띠 없이 두고, 버튼이 남아 다시 누를 수 있다.
    } finally {
      carrying.current = false;
    }
  };

  // 할 일 칸이 접혀 있으면(리캡만 있음) 칸을 먼저 연다 — 편집기는 마운트 뒤 onEditor로 오므로 그때 가져온다.
  const requestCarry = () => {
    if (carrying.current) return;
    if (!showPlan) openPane('plan');
    setCarryRequest({ day: dayIdx });
  };
  // carryOver는 매 렌더 새로 만들어지지만 이 렌더의 값(요일·키)을 쓰면 되므로 deps에 넣지 않는다
  useEffect(() => {
    if (!carryRequest) return;
    if (carryRequest.day !== dayIdx) { setCarryRequest(null); return; }   // 그새 요일이 바뀌었으면 버린다
    if (!planEditor || planEditor.isDestroyed) return;                     // 편집기를 기다린다
    setCarryRequest(null);
    carryOver(planEditor);
  }, [carryRequest, dayIdx, planEditor]);

  // 띠는 이 요일, 지금의 할 일 편집기에 넣은 가져오기에만 보인다
  const activeNotice = notice && notice.day === dayIdx && notice.editor === planEditor ? notice : null;
  useEffect(() => {
    const editor = activeNotice?.editor;
    if (!editor || editor.isDestroyed) return undefined;
    const onUpdate = ({ transaction }) => {
      if (!transaction.getMeta(CARRY_META)) setNotice(null);   // 사용자가 칸을 고쳤다
    };
    editor.on('update', onUpdate);
    return () => editor.off('update', onUpdate);
  }, [activeNotice]);

  const undoCarry = () => {
    const editor = activeNotice?.editor;
    setNotice(null);
    if (!editor || editor.isDestroyed) return;
    editor.commands.undo();
    editor.commands.focus();   // 누른 버튼이 띠와 함께 사라지므로 포커스는 칸으로
  };

  const planPlaceholder = isMe ? t('scrum.day.planPlaceholder') : '';

  const paneLabel = (pane) => (
    <span className="ScrumDayCard__PaneLabel">
      {pane === 'plan' ? <Sunrise size={14} /> : <Sunset size={14} />}
      {t(pane === 'plan' ? 'scrum.grid.rowPlan' : 'scrum.grid.rowRecap')}
    </span>
  );
  const carryButton = canCarry && (
    <button type="button" className="ScrumDayCard__CarryBtn" onClick={requestCarry}>
      <Copy size={14} />
      {t('scrum.carry.button', { day: prevDayName })}
    </button>
  );
  const slimRow = (pane) => (
    <div className="ScrumDayCard__Slim">
      {paneLabel(pane)}
      {synced && <span className="ScrumDayCard__SlimNote">{t(pane === 'plan' ? 'scrum.day.noPlan' : 'scrum.day.noRecap')}</span>}
      {/* 리캡만 있을 때: 할 일 쓰기 행 안에서 가져온다(누르면 할 일 칸이 열린다) */}
      {pane === 'plan' && carryButton}
      {isMe && (
        <button type="button" className="ScrumDayCard__Write" onClick={() => openPane(pane)}>
          <Plus size={13} />
          {t(pane === 'plan' ? 'scrum.day.writePlan' : 'scrum.day.writeRecap')}
        </button>
      )}
    </div>
  );

  const name = member.username;
  return (
    <article
      id={dayCardDomId(userId)}
      className={`ScrumDayCard${isMe ? ' ScrumDayCard--me' : ''}`}
      aria-labelledby={nameId}
    >
      <header className="ScrumDayCard__Head">
        <div className="ScrumDayCard__Who">
          <Avatar user={member} size={30} className="ScrumDayCard__Avatar" />
          <h3 className="ScrumDayCard__Name" id={nameId}>{name}</h3>
          {isMe && <em className="ScrumDayCard__You">{t('scrum.you')}</em>}
        </div>
        {synced && (hasPlan ? (
          <span className="ScrumDayCard__Status ScrumDayCard__Status--written">
            <CircleCheck size={14} />
            {t('scrum.day.statusWritten')}
          </span>
        ) : (
          <span className="ScrumDayCard__Status">{t('scrum.day.statusEmpty')}</span>
        ))}
        <button
          type="button"
          className="ScrumDayCard__Toggle"
          aria-expanded={open}
          aria-label={t(open ? 'scrum.day.fold' : 'scrum.day.unfold', { name })}
          onClick={() => onToggle(userId)}
        >
          <ChevronUp size={16} />
        </button>
      </header>
      {open && (
        <div className="ScrumDayCard__Body">
          {fridayPending && (
            <div className="ScrumDayCard__Carry" role="status">
              <span className="ScrumDayCard__CarryHint">
                {t(previousFriday.status === 'error' ? 'scrum.carry.previousFailed' : 'scrum.carry.previousLoading')}
              </span>
              {previousFriday.status === 'error' && (
                <button type="button" className="ScrumDayCard__CarryBtn" onClick={previousFriday.retry}>{t('common.actions.retry')}</button>
              )}
            </div>
          )}
          {/* 자리가 고정된 슬롯들 — 앞 슬롯이 생기고 없어져도 Panes는 같은 자리에 남는다 */}
          {activeNotice && (
            <div className="ScrumDayCard__Carried" role="status">
              {activeNotice.undoable
                ? <Check size={15} className="ScrumDayCard__CarriedIcon" />
                : <Info size={15} className="ScrumDayCard__CarriedIcon" />}
              <span className="ScrumDayCard__CarriedText">
                {t(activeNotice.message, { day: prevDayName, count: activeNotice.count })}
              </span>
              {activeNotice.undoable && (
                <button type="button" className="ScrumDayCard__Undo" onClick={undoCarry}>
                  <Undo2 size={13} />
                  {t('scrum.carry.undo')}
                </button>
              )}
            </div>
          )}
          {/* 할 일 칸이 보이면(둘 다 비었거나 할 일 칸을 연 뒤) 빈 할 일 칸 위에서 가져온다. 띠가 떠 있으면 띠가 대신한다 */}
          {showPlan && carryButton && !activeNotice && (
            <div className="ScrumDayCard__Carry">
              {carryButton}
              <span className="ScrumDayCard__CarryHint">{t('scrum.carry.hint')}</span>
            </div>
          )}
          {!showPlan && showRecap && slimRow('plan')}
          {(showPlan || showRecap) && (
            <div className={`ScrumDayCard__Panes${showPlan && showRecap ? ' ScrumDayCard__Panes--split' : ''}`}>
              {showPlan && (
                <section key="plan" className="ScrumDayCard__Pane ScrumDayCard__Pane--plan" onFocus={() => pin(PIN_PLAN)}>
                  {paneLabel('plan')}
                  <ScrumCell ydoc={ydoc} fragmentKey={planKey} placeholder={planPlaceholder} members={members} onEditor={onPlanEditor} />
                </section>
              )}
              {showRecap && (
                <section key="recap" className="ScrumDayCard__Pane ScrumDayCard__Pane--recap" onFocus={() => pin(PIN_RECAP)}>
                  {paneLabel('recap')}
                  <ScrumCell ydoc={ydoc} fragmentKey={recapKey} placeholder="" members={members} onEditor={onRecapEditor} />
                </section>
              )}
            </div>
          )}
          {showPlan && !showRecap && slimRow('recap')}
          {synced && !showPlan && !showRecap && <p className="ScrumDayCard__Empty">{t('scrum.day.notWritten')}</p>}
        </div>
      )}
    </article>
  );
}
