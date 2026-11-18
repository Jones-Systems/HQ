import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  Button, PALETTE_IDS, PALETTE_PRESETS, PALETTE_ROLE_INFO, PALETTE_ROLES, normalizeHex, paletteTokens, weakestContrast,
  type PaletteColors, type PaletteId, type PaletteRole,
} from '@hq/ui';
import { isEdited } from './palette-state';
import type { PaletteController } from './usePalette';
import './appearance.css';

const PRIMARY_GROUPS = ['Backgrounds', 'Buttons and accent', 'Selection', 'Text'] as const;
const SWATCH_ROLES = ['canvas', 'surface', 'selected', 'accent', 'text'] as const satisfies readonly PaletteRole[];
const roleLabel = (role: PaletteRole | 'white') => role === 'white' ? 'white text' : PALETTE_ROLE_INFO[role].label.toLowerCase();
const ratio = (value: number) => `${(Math.floor(value * 10) / 10).toFixed(1)}:1`;

function ContrastNote({ colors, role, id }: { colors: PaletteColors; role: PaletteRole; id: string }) {
  const weakest = weakestContrast(colors, role);
  if (!weakest) return null;
  const other = weakest.fg === role ? weakest.on : weakest.fg;
  const pair = `Lowest contrast with ${roleLabel(other)}`;
  return weakest.pass
    ? <span id={id} className="palette-contrast" title={pair}>{ratio(weakest.ratio)}<span className="hq-sr-only"> {pair}</span></span>
    : <span id={id} className="palette-contrast is-low" title={pair}>Low contrast {ratio(weakest.ratio)}, needs {weakest.min}:1<span className="hq-sr-only"> {pair}</span></span>;
}

function ColorRow({ palette, role }: { palette: PaletteController; role: PaletteRole }) {
  const id = useId();
  const { label } = PALETTE_ROLE_INFO[role];
  const value = palette.colors[role];
  const overridden = role in palette.state.overrides[palette.state.preset];
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const commit = () => {
    const color = normalizeHex(draft);
    if (color) { palette.setColor(role, color); setDraft(color); setInvalid(false); } else setInvalid(true);
  };
  return <div className="palette-color" role="group" aria-labelledby={`${id}-label`}>
    <span id={`${id}-label`} className="palette-color-label">{label}{overridden && <span className="palette-edited"> · Edited</span>}</span>
    <span className="palette-color-inputs">
      <input type="color" aria-label={`${label} color picker`} value={value.toLowerCase()}
        onChange={event => { const color = normalizeHex(event.target.value); if (color) palette.setColor(role, color); }} />
      <input type="text" className="palette-hex" aria-label={`${label} hex value`} value={draft} maxLength={7}
        spellCheck={false} autoComplete="off" aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : `${id}-contrast`}
        onChange={event => {
          const text = event.target.value; setDraft(text);
          const color = /^#?[0-9a-f]{6}$/i.test(text.trim()) ? normalizeHex(text) : null;
          if (color) { palette.setColor(role, color); setInvalid(false); }
        }}
        onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
    </span>
    <span className="palette-color-meta">
      {invalid
        ? <span id={`${id}-error`} className="palette-contrast is-low" role="status">Use a hex color like #3E3A36. Still using {value}.</span>
        : <ContrastNote colors={palette.colors} role={role} id={`${id}-contrast`} />}
      {overridden && <Button size="sm" variant="ghost" aria-label={`Reset ${label}`} onClick={() => palette.resetColor(role)}>Reset</Button>}
    </span>
  </div>;
}

function PalettePreview({ colors }: { colors: PaletteColors }) {
  const style = { ...paletteTokens(colors), colorScheme: 'dark' } as CSSProperties;
  return <div className="palette-preview" data-hq-token-scope="" style={style} inert>
    <div className="palette-preview-nav">
      <span className="palette-preview-item is-selected">Projects</span>
      <span className="palette-preview-item">References</span>
      <span className="palette-preview-item">Flows</span>
    </div>
    <div className="palette-preview-body">
      <strong>Review</strong>
      <span className="palette-preview-muted">Secondary text and metadata</span>
      <span className="palette-preview-actions">
        <Button size="sm" variant="primary">Primary</Button>
        <Button size="sm">Secondary</Button>
        <Button size="sm" aria-pressed>Selected</Button>
        <Button size="sm" disabled>Disabled</Button>
      </span>
      <span className="palette-preview-link">Accent text</span>
    </div>
  </div>;
}

/** Settings › Appearance: dark palette presets and colour editing. Applying is immediate; light mode is unchanged. */
export function PaletteSettings({ palette, dark }: { palette: PaletteController; dark: boolean }) {
  const preset = PALETTE_PRESETS[palette.state.preset];
  const [confirmReset, setConfirmReset] = useState(false);
  const cards = useRef(new Map<PaletteId, HTMLButtonElement>());
  useEffect(() => { setConfirmReset(false); }, [palette.state.preset]);
  const edited = isEdited(palette.state, palette.state.preset);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = PALETTE_IDS[(PALETTE_IDS.indexOf(palette.state.preset) + step + PALETTE_IDS.length) % PALETTE_IDS.length]!;
    palette.select(next); cards.current.get(next)?.focus();
  };
  return <div className="settings-group palette-settings">
    <div className="settings-row palette-heading">
      <div className="settings-row-copy">
        <h3>Dark palette</h3>
        <p>Used whenever HQ is dark. Every palette has the same buttons and selection; only the colors change. Light mode keeps the standard light colors.</p>
        {!dark && <p className="palette-note">HQ is light right now. Choose Dark, or System on a dark device, to see this palette across HQ.</p>}
      </div>
    </div>
    <div className="palette-body">
      <div className="palette-presets" role="radiogroup" aria-label="Dark palette" onKeyDown={onKeyDown}>
        {PALETTE_IDS.map(id => {
          const item = PALETTE_PRESETS[id];
          const selected = id === palette.state.preset;
          const colors = id === palette.state.preset ? palette.colors : item.colors;
          return <button key={id} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
            className="palette-card" ref={element => { if (element) cards.current.set(id, element); else cards.current.delete(id); }}
            onClick={() => palette.select(id)}>
            <span className="palette-swatches" aria-hidden="true">{SWATCH_ROLES.map(role => <i key={role} style={{ background: colors[role] }} />)}</span>
            <span className="palette-card-copy">
              <strong>{item.name}</strong>
              <small>{selected ? 'Selected' : item.description}{isEdited(palette.state, id) ? ' · Edited' : ''}</small>
            </span>
          </button>;
        })}
      </div>
      <PalettePreview colors={palette.colors} />
      {!palette.saved && <p className="palette-save-failed" role="alert">Palette changes apply now but could not be saved. Local storage is unavailable, so they will be lost when HQ restarts.</p>}
      <section className="palette-editor" aria-label={`${preset.name} colors`}>
        <div className="palette-editor-head">
          <h4>{preset.name} colors</h4>
          <Button size="sm" disabled={!edited} onClick={() => setConfirmReset(true)}>Reset {preset.name}</Button>
        </div>
        {confirmReset && <div className="palette-confirm" role="group" aria-label={`Confirm reset of ${preset.name}`}>
          <p>Restore {preset.name} to its original colors? Edits to other palettes stay.</p>
          <span className="palette-confirm-actions">
            <Button size="sm" variant="primary" onClick={() => { palette.resetPreset(); setConfirmReset(false); }}>Restore original colors</Button>
            <Button size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
          </span>
        </div>}
        {PRIMARY_GROUPS.map(group => <fieldset key={group} className="palette-group">
          <legend>{group}</legend>
          {PALETTE_ROLES.filter(role => PALETTE_ROLE_INFO[role].group === group).map(role => <ColorRow key={role} palette={palette} role={role} />)}
        </fieldset>)}
        <details className="palette-more">
          <summary>More colors</summary>
          <p>Hover, pressed, disabled, focus and status colors. Overlays, tints and text-selection highlights follow these colors automatically.</p>
          <div className="palette-group">{PALETTE_ROLES.filter(role => PALETTE_ROLE_INFO[role].group === 'More colors').map(role => <ColorRow key={role} palette={palette} role={role} />)}</div>
        </details>
      </section>
    </div>
  </div>;
}
