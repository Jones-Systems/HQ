import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface SegmentOption<V extends string | number> {
  readonly value: V;
  readonly label: string;
}

export interface SegmentedControlProps<V extends string | number> {
  /** Accessible name of the group, for example "Backdrop". */
  readonly label: string;
  readonly options: readonly SegmentOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
}

/** Radio group drawn as a segmented control. Roving focus; arrow keys, Home and End choose and focus. */
export function SegmentedControl<V extends string | number>({ label, options, value, onChange }: SegmentedControlProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((option) => option.value === value));
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current + 1) % options.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current + last) % options.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    const target = options[next];
    if (target === undefined) return;
    event.preventDefault();
    onChange(target.value);
    refs.current[next]?.focus();
  };
  return <div className="hqc-seg" role="radiogroup" aria-label={label}>
    {options.map((option, index) => <button
      key={String(option.value)}
      ref={(element) => { refs.current[index] = element; }}
      type="button"
      role="radio"
      aria-checked={index === current}
      tabIndex={index === current ? 0 : -1}
      className="hqc-seg-item hq-press"
      onClick={() => onChange(option.value)}
      onKeyDown={move}
    >{option.label}</button>)}
  </div>;
}
