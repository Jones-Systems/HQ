import { useRef, type KeyboardEvent } from 'react';
import { STATUSES, type Status } from '../core';
import { StatusDot } from '../theme';

export interface StatusTabsProps {
  current: Status;
  counts: Readonly<Record<Status, number>>;
  /** The status a dragged card is hovering, for the highlight. */
  dropStatus: Status | null;
  onSelect(status: Status): void;
}

/**
 * The narrow layout's status switcher: one column at a time. Each tab is also a drop zone (`data-drop-tab`), so a card
 * can be dragged onto another status without leaving the column it is in. Arrow keys move between tabs.
 */
export function StatusTabs({ current, counts, dropStatus, onSelect }: StatusTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = STATUSES.findIndex((status) => status.id === current);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? STATUSES.length - 1 : null;
    if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const target = STATUSES[(next + STATUSES.length) % STATUSES.length]!;
    onSelect(target.id);
    list.current?.querySelector<HTMLElement>(`[data-drop-tab="${target.id}"]`)?.focus();
  };
  return (
    <div className="work-tabs" role="tablist" aria-label="Status" ref={list} onKeyDown={onKeyDown}>
      {STATUSES.map(({ id, label }) => (
        <button
          key={id} type="button" role="tab" id={`work-tab-${id}`} className="work-tab"
          aria-selected={id === current} aria-controls={`work-col-${id}`} tabIndex={id === current ? 0 : -1}
          data-drop-tab={id} data-drop-target={dropStatus === id || undefined}
          onClick={() => onSelect(id)}
        >
          <StatusDot status={id as Status} />
          <span>{label}</span>
          <span className="wk-count work-tab-count">{counts[id as Status]}</span>
        </button>
      ))}
    </div>
  );
}
