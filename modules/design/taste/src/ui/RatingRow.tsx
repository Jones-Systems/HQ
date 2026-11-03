import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { StatusIndicator } from '@hq/ui';
import { RATING_VALUES, type RatingValue } from '../contract.ts';
import { scaleFocusTarget } from './deck-model.ts';
import type { RatingSlot } from './view-model.ts';

/** How long the inline "Saved" stays beside a row that just took a new rating. */
const SAVED_VISIBLE_MS = 3200;

/**
 * One rating row: a label and a segmented 1–5 control. The selected value is a pill that slides between steps
 * (token durations, none under reduced motion). The five steps are native radio inputs, so a screen reader hears
 * a labelled group and "n of 5"; arrows move focus along the row, and Space or Enter chooses. Choosing writes to an
 * append-only journal, so passing over a step never rates it. A row shows "Saved" only after the snapshot read back
 * the new rating, never on a click alone.
 */
export function RatingRow({ slot, name, disabled, onRate, labels, anchors }: {
  readonly slot: RatingSlot; readonly name: string; readonly disabled: boolean;
  readonly onRate: (value: RatingValue) => void;
  readonly labels?: Readonly<Record<RatingValue, string>>;
  readonly anchors?: readonly [string, string];
}) {
  const previous = slot.history.map((item) => item.value).join(', ');
  const current = slot.current?.value ?? null;
  const confirmed = slot.current?.assessmentId ?? null;
  const rowRef = useRef<HTMLFieldSetElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const [seated, setSeated] = useState(current !== null);
  const [saved, setSaved] = useState(false);
  const seen = useRef({ name, confirmed });

  useEffect(() => { if (current !== null) setSeated(true); }, [current]);

  // A newly confirmed rating in this row's own slot. Switching scope changes `name` and is not a save.
  useEffect(() => {
    const last = seen.current;
    seen.current = { name, confirmed };
    if (last.name !== name) { setSaved(false); return; }
    if (confirmed === null || confirmed === last.confirmed) return;
    const row = rowRef.current;
    if (row) {
      row.classList.remove('hq-flash');
      void row.offsetWidth;
      row.classList.add('hq-flash');
    }
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [name, confirmed]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const inputs = [...(scaleRef.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])];
    const index = inputs.indexOf(document.activeElement as HTMLInputElement);
    if (index < 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!inputs[index]?.checked) inputs[index]?.click();
      return;
    }
    const target = scaleFocusTarget(event.key, index, inputs.length);
    if (target === null) return;
    event.preventDefault();
    inputs[target]?.focus();
  };

  return <fieldset ref={rowRef} className="taste-row" disabled={disabled}
    onAnimationEnd={(event) => { if (event.target === rowRef.current) rowRef.current?.classList.remove('hq-flash'); }}>
    <legend>{slot.label}</legend>
    <div className="taste-scale">
      {anchors && <span className="taste-anchor" data-end="low" aria-hidden="true">{anchors[0]}</span>}
      <div ref={scaleRef} className="taste-seg" data-value={current ?? undefined} data-seated={seated || undefined}
        onKeyDown={onKeyDown}>
        <span className="taste-seg-pill" aria-hidden="true" />
        {RATING_VALUES.map((value) => <label key={value} className="taste-point hq-press" data-checked={current === value || undefined}
          title={labels?.[value]}>
          <input type="radio" name={name} value={value} checked={current === value}
            aria-label={labels ? `${slot.label}: ${value}, ${labels[value]}` : `${slot.label}: ${value} of 5`}
            onChange={() => onRate(value)} />
          <span aria-hidden="true">{value}</span>
        </label>)}
      </div>
      <span className="taste-scale-end">
        {anchors && <span className="taste-anchor" data-end="high" aria-hidden="true">{anchors[1]}</span>}
        {labels && current !== null && <span className="taste-seg-word" aria-hidden="true">{labels[current]}</span>}
        {saved && <span className="taste-saved hq-enter-fade"><StatusIndicator tone="success" label="Saved" live={false} /></span>}
      </span>
    </div>
    {slot.history.length > 0 && <span className="taste-history">Re-rated; earlier {previous}</span>}
  </fieldset>;
}
