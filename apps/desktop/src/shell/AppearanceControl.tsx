import type { KeyboardEvent } from 'react';
import type { Appearance } from '@hq/contracts';
import { cycleAppearance } from '../state';
import { AppearanceIcon } from './icons';

const CHOICES: readonly Appearance[] = ['light', 'dark', 'system'];
export const APPEARANCE_LABELS: Readonly<Record<Appearance, string>> = { light: 'Light', dark: 'Dark', system: 'System' };

export interface AppearanceControlProps {
  readonly appearance: Appearance;
  /** `cycled` is true for the compact button, whose step may not change what is on screen. */
  readonly onChange: (next: Appearance, cycled: boolean) => void;
}

/**
 * Wide windows get a three-way radio group, so every choice is visible; compact ones get one button that steps
 * Light → Dark → System. CSS shows one of the two.
 */
export function AppearanceControl({ appearance, onChange }: AppearanceControlProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = CHOICES[(CHOICES.indexOf(appearance) + step + CHOICES.length) % CHOICES.length]!;
    onChange(next, false);
    event.currentTarget.querySelector<HTMLElement>(`[data-appearance="${next}"]`)?.focus();
  };
  const label = APPEARANCE_LABELS[appearance];
  return (
    <>
      <div className="shell-segmented" role="radiogroup" aria-label="Appearance" onKeyDown={onKeyDown}>
        {CHOICES.map((choice) => (
          <button key={choice} type="button" role="radio" data-appearance={choice} aria-checked={appearance === choice}
            tabIndex={appearance === choice ? 0 : -1} aria-label={APPEARANCE_LABELS[choice]} title={APPEARANCE_LABELS[choice]}
            onClick={() => onChange(choice, false)}>
            <AppearanceIcon appearance={choice} />
          </button>
        ))}
      </div>
      <button type="button" className="shell-icon-button shell-appearance-cycle" aria-label={`Appearance: ${label}`}
        title={`Appearance: ${label}. Switch to ${APPEARANCE_LABELS[cycleAppearance(appearance)]}`}
        onClick={() => onChange(cycleAppearance(appearance), true)}>
        <AppearanceIcon key={appearance} appearance={appearance} className="shell-icon hq-enter-scale" />
      </button>
    </>
  );
}
