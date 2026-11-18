import type { ReactNode } from 'react';
import { Menu } from '@hq/ui';

export interface ChipOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
  /** Hue and shape for the chip, for example `need` or `high`. Colour only reinforces the word. */
  readonly tone?: string;
}

export interface ChipPickerProps<Id extends string> {
  /** The field's name, for example `Why`. The trigger is named `Why: Need`, so its value is announced with it. */
  readonly label: string;
  readonly value: Id | null;
  readonly options: readonly ChipOption<Id>[];
  /** Offered as the first item when set, and shown while there is no value. `null` removes the value. */
  readonly emptyLabel?: string;
  readonly onChange: (next: Id | null) => void;
  readonly align?: 'start' | 'end';
  /** A leading mark such as the status shape, aria-hidden. */
  readonly leading?: (value: Id | null) => ReactNode;
}

const CHEVRON = <svg className="wk-pick-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>;

/**
 * A compact chip that opens a menu of the field's values (the shared `Menu`, so Enter, Space and ↓ open it, arrows
 * and type-ahead move, Escape closes and returns focus). It replaces a native select in the detail panel. Choosing
 * the current value sends nothing. The menu items are radio items, so the current value is announced as checked.
 */
export function ChipPicker<Id extends string>({ label, value, options, emptyLabel, onChange, align = 'start', leading }: ChipPickerProps<Id>) {
  const current = options.find((option) => option.id === value);
  const words = current?.label ?? emptyLabel ?? 'Not set';
  const items = [
    ...(emptyLabel === undefined ? [] : [{ id: '', label: emptyLabel, checked: value === null, onSelect: () => { if (value !== null) onChange(null); } }]),
    ...options.map((option) => ({
      id: option.id, label: option.label, checked: option.id === value,
      onSelect: () => { if (option.id !== value) onChange(option.id); },
    })),
  ];
  return (
    <span className={`wk-pick${current?.tone ? ` wk-pick--${current.tone}` : ''}${value === null ? ' is-empty' : ''}`}>
      <Menu
        variant="ghost" size="sm" align={align} className="wk-pick-menu"
        triggerLabel={`${label}: ${words}`}
        items={items}
        trigger={<>{leading?.(value)}<span className="wk-pick-text">{words}</span>{CHEVRON}</>}
      />
    </span>
  );
}
