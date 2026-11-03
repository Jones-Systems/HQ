import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from 'react';
import { PALETTE_PRESETS, DEFAULT_PALETTE_ID, paletteTokens, type PaletteColors } from '@hq/ui';
import type { Appearance } from '@hq/contracts';
import { readGeneratedRoles } from './generated-roles';
import { APPEARANCES, switchAppearance } from './theme-switch';

const LABELS: Record<Appearance, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeDevice(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
}
const deviceIsDark = () => typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;

/** A miniature rail and panel. Each layer sets its own `color-scheme` and colour roles, so it never follows the page. */
function TileLayer({ scope, className }: { scope: CSSProperties; className?: string }) {
  return <span className={className ? `theme-tile-layer ${className}` : 'theme-tile-layer'} data-hq-token-scope="" style={scope}>
    <span className="theme-tile-rail"><i /><i /><i /></span>
    <span className="theme-tile-panel"><b /><u /><u /><s /></span>
  </span>;
}

/** Light, Dark and System as drawn tiles with radio-group semantics. Dark shows the selected dark palette. */
export function ThemeTiles({ appearance, onChange, colors = PALETTE_PRESETS[DEFAULT_PALETTE_ID].colors }: { appearance: Appearance; onChange?: (value: Appearance) => void; colors?: PaletteColors }) {
  const dark = useSyncExternalStore(subscribeDevice, deviceIsDark, () => false);
  const [generated, setGenerated] = useState<Record<string, string>>({});
  useLayoutEffect(() => { setGenerated(readGeneratedRoles()); }, []);
  const light: CSSProperties = { ...generated, colorScheme: 'light' } as CSSProperties;
  const night: CSSProperties = { ...paletteTokens(colors), colorScheme: 'dark' } as CSSProperties;
  const buttons = useRef(new Map<Appearance, HTMLButtonElement>());
  const choose = (value: Appearance) => { if (value !== appearance) switchAppearance(() => onChange?.(value)); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = APPEARANCES[(APPEARANCES.indexOf(appearance) + step + APPEARANCES.length) % APPEARANCES.length]!;
    choose(next); buttons.current.get(next)?.focus();
  };
  return <div className="theme-tiles" role="radiogroup" aria-label="Color theme" onKeyDown={onKeyDown}>
    {APPEARANCES.map(value => {
      const selected = value === appearance;
      return <button key={value} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} className="theme-tile"
        aria-labelledby={`theme-${value}-label`} aria-describedby={value === 'system' ? 'theme-system-note' : undefined}
        ref={element => { if (element) buttons.current.set(value, element); else buttons.current.delete(value); }} onClick={() => choose(value)}>
        <span className="theme-tile-art" aria-hidden="true">
          {value === 'light' && <TileLayer scope={light} />}
          {value === 'dark' && <TileLayer scope={night} />}
          {value === 'system' && <><TileLayer scope={light} /><TileLayer scope={night} className="is-split" /></>}
        </span>
        <span className="theme-tile-copy">
          <span id={`theme-${value}-label`} className="theme-tile-label">{LABELS[value]}</span>
          {value === 'system' && <span id="theme-system-note" className="theme-tile-note">Following your device: {dark ? 'Dark' : 'Light'}</span>}
        </span>
      </button>;
    })}
  </div>;
}
