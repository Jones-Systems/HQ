// The history button and its popover: this session's entries, newest first, with a kind icon, a human label and the
// current entry marked. Arrow keys move through the list, Enter opens an entry, Escape closes and returns to the button.

import { createElement as h, useEffect, useId, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { describeEntry, shownOf, stepIndex } from './chrome.ts';
import type { HistoryEntry } from './history.ts';
import { Icon } from './icons.ts';
import type { WikiSession } from './session.ts';

export function HistoryMenu(props: {
  readonly session: WikiSession;
  readonly entries: readonly HistoryEntry[];
  readonly index: number;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly onJump: (index: number) => void;
  readonly buttonRef: { current: HTMLButtonElement | null };
}): ReactElement {
  const { open, setOpen } = props;
  const uid = useId();
  const popId = `${uid}-history`;
  const wrapper = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLOListElement | null>(null);

  // Opening moves focus to the current entry. Outside presses close without taking focus.
  useEffect(() => {
    if (!open) return undefined;
    list.current?.querySelector<HTMLElement>('[aria-current="step"]')?.focus();
    const away = (event: Event): void => {
      if (wrapper.current !== null && !wrapper.current.contains(event.target as Node | null)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open, setOpen]);

  const items = (): HTMLElement[] => Array.from(list.current?.querySelectorAll<HTMLElement>('button') ?? []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      props.buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const buttons = items();
      const at = buttons.indexOf(event.target as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : stepIndex(at, event.key === 'ArrowDown' ? 1 : -1, buttons.length);
      buttons[next]?.focus();
    }
  };

  const total = props.entries.length;
  return h(
    'div',
    { className: 'wiki-popover-anchor', ref: wrapper },
    h(
      'button',
      {
        type: 'button',
        ref: props.buttonRef,
        className: 'wiki-icon-button',
        'aria-label': 'History',
        'aria-haspopup': 'true',
        'aria-expanded': open,
        'aria-controls': popId,
        title: 'History',
        onClick: () => setOpen(!open),
      },
      h(Icon, { name: 'history' }),
    ),
    open
      ? h(
          'nav',
          { id: popId, className: 'wiki-popover wiki-history', 'aria-label': 'Session history', onKeyDown },
          h('div', { className: 'wiki-history-head' }, h('span', { className: 'wiki-eyebrow' }, 'History'), h('span', { className: 'wiki-history-count' }, `${total} ${total === 1 ? 'entry' : 'entries'}`)),
          h(
            'ol',
            { className: 'wiki-history-list', ref: list },
            props.entries
              .map((entry, index) => ({ entry, index }))
              .reverse()
              .map(({ entry, index }) => {
                const text = describeEntry(shownOf(entry), props.session);
                const current = index === props.index;
                return h(
                  'li',
                  { key: index },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'wiki-history-item',
                      'data-entry': String(index),
                      'aria-current': current ? 'step' : undefined,
                      tabIndex: current ? 0 : -1,
                      onClick: () => {
                        setOpen(false);
                        props.onJump(index);
                      },
                    },
                    h(Icon, { name: text.icon, className: 'wiki-history-icon' }),
                    h('span', { className: 'wiki-history-label' }, text.label),
                    text.detail === null ? null : h('span', { className: 'wiki-history-detail' }, text.detail),
                    current ? h('span', { className: 'wiki-history-tag' }, 'Current') : null,
                  ),
                );
              }),
          ),
        )
      : null,
  );
}
