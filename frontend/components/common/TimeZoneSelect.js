import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { canonicalTimeZone } from '@/library/localePrefs';

// 검색 가능한 IANA timezone 선택기.
//
// 목록은 Intl.supportedValuesOf('timeZone')에서 얻고 'UTC'를 명시적으로 더한다 —
// supportedValuesOf에 UTC가 **없다**(Node 20/브라우저 실측). 그 목록만으로 만들면
// 사용자가 UTC를 고를 방법이 사라진다.
//
// 표시는 사람이 읽는 순서로 한다: 도시명 → 현재 GMT offset → canonical IANA ID(보조).
// 저장·전송 값은 **언제나 canonical IANA ID 그대로**다 — 표시만 다듬는다.
//
// 국기 아이콘은 쓰지 않는다. timezone은 국가가 아니고(America/New_York ≠ 미국 전체),
// 국기는 정치적으로 논쟁적인 매핑을 만든다.
function buildZones() {
  let list = [];
  try {
    list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch { list = []; }
  const set = new Set(list);
  set.add('UTC');
  return [...set].sort();
}

/** 'America/New_York' → 'New York'. 표시용 도시명(마지막 구간, underscore는 공백). */
export function zoneCityLabel(zone) {
  if (!zone) return '';
  const seg = String(zone).split('/');
  return seg[seg.length - 1].replace(/_/g, ' ');
}

/** 검색 정규화 — 공백과 underscore를 같은 것으로 본다('new york' ↔ 'New_York'). */
function normalizeQuery(text) {
  return String(text || '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

/** 'Asia/Seoul' → 'GMT+9' 같은 현재 offset 라벨(표시용). DST 때문에 계절에 따라 달라진다. */
function offsetLabel(zone, now) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(now);
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

export default function TimeZoneSelect({ value, onChange, id, disabled = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  const zones = useMemo(buildZones, []);
  const now = useMemo(() => new Date(), []);

  const current = value || '';
  const currentOffset = current ? offsetLabel(current, now) : '';

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    if (!q) return zones;
    // ID와 도시명 모두 같은 정규화를 거치므로 'new york'·'new_york'·'seoul'이 전부 걸린다.
    return zones.filter((z) => normalizeQuery(z).includes(q));
  }, [zones, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 열면 검색창으로 포커스가 가고, 활성 항목은 **현재 선택값**에서 시작한다.
  // (예전엔 목록이 항상 알파벳 맨 앞 Africa/Abidjan에서 시작해 지금 값이 보이지 않았다.)
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      const at = zones.indexOf(current);
      setActiveIndex(at >= 0 ? at : 0);
    } else {
      setQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 검색어가 바뀌면 활성 항목을 첫 결과로 되돌린다(빈 목록이면 0).
  useEffect(() => { setActiveIndex(0); }, [query]);

  // 활성 항목을 항상 보이게 스크롤한다 — 키보드 이동과 최초 오픈 모두.
  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector('[data-active="true"]');
    // scrollIntoView가 없는 환경(jsdom 등)에서도 목록은 그대로 동작해야 한다.
    if (typeof active?.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, filtered]);

  const close = ({ focusTrigger = true } = {}) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  const select = (zone) => {
    const canonical = canonicalTimeZone(zone);
    if (canonical) onChange(canonical);      // 저장 값은 canonical IANA ID 그대로
    close();
  };

  const move = (delta) => {
    if (!filtered.length) return;
    setActiveIndex((i) => (i + delta + filtered.length) % filtered.length);
  };

  const onSearchKeyDown = (e) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Enter':
        if (filtered.length) { e.preventDefault(); select(filtered[activeIndex] || filtered[0]); }
        break;
      case 'Escape': e.preventDefault(); close(); break;
      default: break;
    }
  };

  const listId = `${id || 'timezone'}-list`;
  const optionId = (index) => `${listId}-opt-${index}`;

  return (
    <div className="TimeZoneSelect" ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="TimeZoneSelect__Trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="TimeZoneSelect__Value">
          <span className="TimeZoneSelect__City">{zoneCityLabel(current)}</span>
          {currentOffset && <span className="TimeZoneSelect__Offset">{currentOffset}</span>}
          <span className="TimeZoneSelect__Id">{current}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {open && (
        <div className="TimeZoneSelect__Popover">
          <div className="TimeZoneSelect__SearchRow">
            <Search size={14} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="TimeZoneSelect__Search"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={filtered.length ? optionId(activeIndex) : undefined}
              placeholder={t('languageRegion.searchPlaceholder')}
              aria-label={t('languageRegion.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
          </div>
          <ul
            className="TimeZoneSelect__List"
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={t('languageRegion.timeZoneLabel')}
          >
            {filtered.length === 0 && (
              <li className="TimeZoneSelect__Empty">{t('languageRegion.noMatches')}</li>
            )}
            {filtered.map((zone, index) => {
              const selected = zone === current;
              const active = index === activeIndex;
              return (
                <li key={zone}>
                  <button
                    type="button"
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    data-active={active || undefined}
                    tabIndex={-1}
                    className={`TimeZoneSelect__Option${selected ? ' TimeZoneSelect__Option--selected' : ''}${active ? ' TimeZoneSelect__Option--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(zone)}
                  >
                    <span className="TimeZoneSelect__OptionMain">
                      <span className="TimeZoneSelect__City">{zoneCityLabel(zone)}</span>
                      <span className="TimeZoneSelect__Id">{zone}</span>
                    </span>
                    <span className="TimeZoneSelect__Offset">{offsetLabel(zone, now)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
