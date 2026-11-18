import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@hq/ui';
import { SyncIndicator } from '../board/SyncStatus';
import {
  activeFilterCount, areasOf, EMPTY_FILTERS, HORIZONS, KINDS,
  type Filters, type WorkState, type WorkStore,
} from '../core';
import { CloseIcon, FilterIcon, SearchIcon } from './icons';
import type { WorkUi } from './session';

/** The honest label on the example Planner: fictional, in memory, for this session only. */
export const EXAMPLE_NOTE = 'Fictional example planning, kept in memory for this session only. No Planner is connected, nothing is saved beyond this session, and nothing starts.';

/**
 * Board-level filters, inline in the top bar as compact chips (X-2). Each control is a native select or input, so the
 * keyboard and assistive paths are the platform's; an active one shows as a filled chip with its own clear button.
 * Area filters by the Planner's label; it is never a project and never switches one. At narrow widths the set folds
 * behind a Filters button and opens as a popover, by CSS alone: every control stays in the page.
 */
export function FilterBar({ ui, filters, state }: { ui: WorkUi; filters: Filters; state: WorkState }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Filters>) => ui.update({ filters: { ...filters, ...patch } });
  const areas = areasOf(state.items);
  const count = activeFilterCount(filters);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) { setOpen(false); event.stopPropagation(); }
  };

  /** One chip-styled select. An active value gets a clear button beside it. */
  const chip = (key: 'kind' | 'horizon' | 'area', label: string, options: readonly { value: string; label: string }[], describedBy?: string) => {
    const value = filters[key];
    const current = options.find((option) => option.value === value);
    return (
      <span className="wd-fchip" data-active={value ? 'true' : undefined}>
        <label className="wd-fchip-label" htmlFor={`${id}-${key}`}>{label}</label>
        <select
          id={`${id}-${key}`} className="wd-fchip-select" value={value} aria-describedby={describedBy}
          onChange={(event) => set({ [key]: event.target.value } as Partial<Filters>)}
        >
          <option value="">Any</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {value && (
          <button type="button" className="wd-fchip-clear" aria-label={`Clear ${label} filter${current ? `: ${current.label}` : ''}`} onClick={() => set({ [key]: '' } as Partial<Filters>)}>
            <CloseIcon />
          </button>
        )}
      </span>
    );
  };

  return (
    <div className="wd-filters" role="group" aria-label="Filter planning" data-open={open ? 'true' : undefined} onKeyDown={onKeyDown}>
      <button
        type="button" className="wd-filter-toggle" aria-expanded={open} aria-controls={`${id}-set`}
        data-active={count > 0 ? 'true' : undefined} onClick={() => setOpen((value) => !value)}
      >
        <FilterIcon />
        <span>Filters</span>
        {count > 0 && <span className="wk-count wd-filter-count" aria-label={`${count} active`}>{count}</span>}
      </button>
      <div className="wd-filter-set" id={`${id}-set`}>
        <span className="wd-fchip wd-fchip--search" data-active={filters.q ? 'true' : undefined}>
          <SearchIcon />
          <label className="hq-sr-only" htmlFor={`${id}-q`}>Search</label>
          <input
            id={`${id}-q`} className="wd-fchip-input" type="search" placeholder="Search planning" value={filters.q}
            onChange={(event) => set({ q: event.target.value })}
          />
        </span>
        {chip('kind', 'Kind', KINDS.map((option) => ({ value: option.id, label: option.label })))}
        {chip('horizon', 'Horizon', [...HORIZONS.map((option) => ({ value: option.id, label: option.label })), { value: '__none', label: 'Not set' }])}
        {chip('area', 'Area label', [...areas.map((area) => ({ value: area, label: area })), { value: '__none', label: 'No label' }], `${id}-area-hint`)}
        <span className="hq-sr-only" id={`${id}-area-hint`}>A Planner label, not a project.</span>
        {count > 0 && <Button size="sm" variant="ghost" className="wd-filter-clear" onClick={() => ui.update({ filters: EMPTY_FILTERS })}>Clear filters ({count})</Button>}
      </div>
    </div>
  );
}

/**
 * The example-data marker: a small badge in the top bar whose popover carries the full honesty text. The text is in the
 * page as a note at all times, so assistive technology reads it; the popover only shows it to the eye on hover, focus
 * or click.
 */
export function ExampleMarker() {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="wd-example" data-open={open ? 'true' : undefined}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { setOpen(false); event.stopPropagation(); } }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    >
      <button type="button" className="wd-example-tag" aria-expanded={open} aria-describedby={id} onClick={() => setOpen((value) => !value)}>
        Example data
      </button>
      <span className="wd-example-pop" role="note" id={id}>{EXAMPLE_NOTE}</span>
    </span>
  );
}

/** The save and connection indicator, once, at the end of the bar. */
export function BarStatus({ store, state }: { store: WorkStore; state: WorkState }) {
  return <div className="wd-status"><SyncIndicator store={store} state={state} /></div>;
}
