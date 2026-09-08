import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isOutOfRange } from '@/library/dateRange';
import { useDateFormat } from '@/hooks/useDateFormat';
import { parseDateOnly } from '@/library/formatDateTime';

const POPOVER_WIDTH = 256;
const POPOVER_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;

// 요일 머리글은 locale을 따른다. 1970-01-04가 일요일이므로 그 주를 기준으로 뽑는다
// (date-only 문자열이라 timezone 변환이 개입하지 않는다).
const WEEK_DAY_KEYS = ['1970-01-04', '1970-01-05', '1970-01-06', '1970-01-07',
  '1970-01-08', '1970-01-09', '1970-01-10'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmtDateStr(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function parseDateStr(s) {
  if (!s) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function sameYMD(a, b) {
  return a && b && a.y === b.y && a.m === b.m && a.d === b.d;
}

// "오늘" 강조는 **개인 timezone**을 따른다(공유 기간이 아니라 개인 파생 상태다).
function todayParts(todayStr) {
  const p = parseDateOnly(todayStr);
  return p ? { y: p.y, m: p.m - 1, d: p.d } : { y: 1970, m: 0, d: 1 };
}

function buildMonthCells(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, i - firstDay + 1);
    cells.push({
      y: d.getFullYear(),
      m: d.getMonth(),
      d: d.getDate(),
      inMonth: d.getMonth() === month,
    });
  }
  return cells;
}



export default function DatePicker({
  value,
  onChange,
  placeholder,
  size = 'md',
  className = '',
  disabled = false,
  trigger = null,
  min = null,
  max = null,
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('days');
  const [hoverTrigger, setHoverTrigger] = useState(false);
  const [position, setPosition] = useState(null);

  const { t } = useTranslation();
  const { formatDateOnly, today: personalToday } = useDateFormat();
  const monthLabel = (year, month) => formatDateOnly(
    `${year}-${String(month + 1).padStart(2, '0')}-01`, { year: 'numeric', month: 'long' },
  );
  const weekDays = WEEK_DAY_KEYS.map((d) => formatDateOnly(d, { weekday: 'short' }));
  const placeholderText = placeholder ?? t('common.actions.pickDate');

  const parsed = useMemo(() => parseDateStr(value), [value]);
  // intentionally not memoized: re-evaluate per render so the "today" highlight
  // stays correct if the tab is left open across midnight.
  const today = todayParts(personalToday());

  const [viewYear, setViewYear] = useState(() => (parsed ? parsed.y : today.y));
  const [viewMonth, setViewMonth] = useState(() => (parsed ? parsed.m : today.m));
  const [yearGridStart, setYearGridStart] = useState(() => (parsed ? parsed.y : today.y) - 6);

  const rootRef = useRef(null);
  const popoverRef = useRef(null);

  const closePopover = () => {
    setOpen(false);
    setView('days');
    setPosition(null);
  };

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      if (popoverRef.current && popoverRef.current.contains(e.target)) return;
      closePopover();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closePopover();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // 팝오버가 열린 채로 value가 바뀌면(외부에서 선택 날짜 변경) 보이는 달/연도도 동기화.
  // 달력 안 월 이동(shiftMonth)은 value/open을 바꾸지 않으므로 사용자의 탐색을 방해하지 않는다.
  useEffect(() => {
    if (open && parsed) {
      setViewYear(parsed.y);
      setViewMonth(parsed.m);
      setYearGridStart(parsed.y - 6);
    }
  }, [parsed, open]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const compute = () => {
      if (!rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const flipTop = spaceBelow < POPOVER_HEIGHT && spaceAbove > spaceBelow;
      let top = flipTop ? rect.top - POPOVER_HEIGHT - 4 : rect.bottom + 4;
      let left = rect.left;
      if (left + POPOVER_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
        left = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
      }
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
      if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
      setPosition({ top, left });
    };
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [open]);

  const handleTriggerClick = (e) => {
    if (disabled) return;
    e.stopPropagation();
    if (!open) {
      const baseY = parsed ? parsed.y : today.y;
      const baseM = parsed ? parsed.m : today.m;
      setViewYear(baseY);
      setViewMonth(baseM);
      setYearGridStart(baseY - 6);
      setView('days');
    }
    setOpen((prev) => !prev);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
    closePopover();
  };

  const handleDayClick = (cell) => {
    onChange(fmtDateStr(cell.y, cell.m, cell.d));
    closePopover();
  };

  const shiftMonth = (delta) => {
    const next = viewMonth + delta;
    if (next < 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else if (next > 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth(next);
    }
  };

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth), [viewYear, viewMonth]);
  const years = useMemo(
    () => Array.from({ length: 12 }, (_, i) => yearGridStart + i),
    [yearGridStart],
  );

  const iconSize = size === 'sm' ? 12 : 14;
  const showClear = value && hoverTrigger;

  const popover = open && position && (
    <div
      ref={popoverRef}
      className="DatePicker__Popover"
      style={{ position: 'fixed', top: position.top, left: position.left, width: POPOVER_WIDTH }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="DatePicker__Header">
        <button
          type="button"
          className="DatePicker__NavBtn"
          onClick={() => (view === 'days' ? shiftMonth(-1) : setYearGridStart((s) => s - 12))}
          aria-label={t('common.actions.previous')}
        >
          <ChevronLeft size={14} />
        </button>
        {view === 'days' ? (
          <button
            type="button"
            className="DatePicker__HeaderLabel"
            onClick={() => {
              setYearGridStart(viewYear - 6);
              setView('years');
            }}
          >
            {monthLabel(viewYear, viewMonth)}
          </button>
        ) : (
          <span className="DatePicker__HeaderLabel DatePicker__HeaderLabel--static">
            {yearGridStart} - {yearGridStart + 11}
          </span>
        )}
        <button
          type="button"
          className="DatePicker__NavBtn"
          onClick={() => (view === 'days' ? shiftMonth(1) : setYearGridStart((s) => s + 12))}
          aria-label={t('common.actions.next')}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {view === 'days' ? (
        <>
          <div className="DatePicker__WeekHeader">
            {weekDays.map((d) => (
              <span key={d} className="DatePicker__WeekDay">{d}</span>
            ))}
          </div>
          <div className="DatePicker__DayGrid">
            {cells.map((cell, idx) => {
              const selected = sameYMD(cell, parsed);
              const isToday = sameYMD(cell, today);
              const outOfRange = isOutOfRange(fmtDateStr(cell.y, cell.m, cell.d), min, max);
              const cls = [
                'DatePicker__Day',
                cell.inMonth ? '' : 'DatePicker__Day--out',
                selected ? 'DatePicker__Day--selected' : '',
                isToday ? 'DatePicker__Day--today' : '',
                outOfRange ? 'DatePicker__Day--disabled' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={idx}
                  type="button"
                  className={cls}
                  disabled={outOfRange}
                  onClick={() => handleDayClick(cell)}
                >
                  {cell.d}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="DatePicker__YearGrid">
          {years.map((y) => {
            const cls = [
              'DatePicker__Year',
              parsed && parsed.y === y ? 'DatePicker__Year--selected' : '',
              today.y === y ? 'DatePicker__Year--today' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={y}
                type="button"
                className={cls}
                onClick={() => { setViewYear(y); setView('days'); }}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}

      {value && (
        <div className="DatePicker__Footer">
          <button
            type="button"
            className="DatePicker__ClearLink"
            onClick={handleClear}
          >
            {t('common.actions.clear')}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`DatePicker DatePicker--${size} ${open ? 'DatePicker--open' : ''} ${className}`}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setHoverTrigger(true)}
      onMouseLeave={() => setHoverTrigger(false)}
    >
      {trigger ? (
        // 호출부가 넘긴 임의 마크업(라벨 등)을 트리거로 사용 — 캘린더 점프 진입점
        <button
          type="button"
          className="DatePicker__CustomTrigger"
          onClick={handleTriggerClick}
          disabled={disabled}
        >
          {trigger}
        </button>
      ) : (
        <button
          type="button"
          className="DatePicker__Trigger"
          onClick={handleTriggerClick}
          disabled={disabled}
        >
          <span className="DatePicker__Value">
            {value || <span className="DatePicker__Placeholder">{placeholderText}</span>}
          </span>
          {showClear ? (
            <span
              className="DatePicker__ClearBtn"
              role="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClear}
              aria-label={t('common.datePicker.clearDate')}
            >
              <X size={iconSize} />
            </span>
          ) : (
            <span className="DatePicker__Icon">
              <Calendar size={iconSize} />
            </span>
          )}
        </button>
      )}

      {popover && createPortal(popover, document.body)}
    </div>
  );
}
