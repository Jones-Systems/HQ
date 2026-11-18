import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly panel: ReactNode;
}

export interface TabsProps {
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly tabs: readonly TabItem[];
  /** Controlled selection. Omit it to let the component own the selection, starting at `defaultSelectedId`. */
  readonly selectedId?: string;
  readonly defaultSelectedId?: string;
  readonly onSelectedChange?: (id: string) => void;
  /** `automatic`: selection follows focus. `manual`: arrows move focus; Enter or Space selects. */
  readonly activation?: 'automatic' | 'manual';
  readonly className?: string;
}

/** WAI-ARIA tabs: one tab stop, ArrowLeft/ArrowRight wrap, Home/End jump; the selected panel is reachable with Tab. */
export function Tabs({ label, tabs, selectedId, defaultSelectedId, onSelectedChange, activation = 'automatic', className }: TabsProps) {
  const id = useId();
  const [ownSelection, setOwnSelection] = useState(defaultSelectedId ?? tabs[0]?.id);
  const selected = selectedId ?? ownSelection;
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const select = (tabId: string) => {
    if (selectedId === undefined) setOwnSelection(tabId);
    onSelectedChange?.(tabId);
  };
  const stop = focusedId ?? selected;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === (focusedId ?? selected));
    const last = tabs.length - 1;
    const next = event.key === 'ArrowRight' ? (index >= last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index <= 0 ? last : index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    if (next === -1) return;
    event.preventDefault();
    const target = tabs[next]!;
    setFocusedId(target.id);
    tabRefs.current.get(target.id)?.focus();
    if (activation === 'automatic') select(target.id);
  };

  return (
    <div className={cx('hq-tabs', className)}>
      <div role="tablist" aria-label={label} className="hq-tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.id}`}
            aria-selected={tab.id === selected}
            aria-controls={`${id}-panel-${tab.id}`}
            tabIndex={tab.id === stop ? 0 : -1}
            className="hq-tab"
            onClick={() => { setFocusedId(tab.id); select(tab.id); }}
            onBlur={(event) => {
              // Leaving the tab list returns the single tab stop to the selected tab.
              if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setFocusedId(undefined);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${id}-panel-${tab.id}`}
          aria-labelledby={`${id}-tab-${tab.id}`}
          hidden={tab.id !== selected}
          tabIndex={0}
          className="hq-tabpanel"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
