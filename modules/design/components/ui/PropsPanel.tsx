import { useId, useState } from 'react';
import { Button, FieldError } from '@hq/ui';
import type { ComponentSource, PropSpec, PropValue, PropValues, VariantId, VariantSet } from '../src/contract.ts';
import { coerceProp } from '../src/model/props.ts';
import { constraintHint, propError, propTypeLabel } from '../src/model/prop-hints.ts';
import { variantDiff } from '../src/model/variant-diff.ts';

export interface PropsPanelProps {
  readonly source: ComponentSource;
  readonly variants: VariantSet | null;
  readonly variantId: VariantId | null;
  readonly overrides: PropValues;
  readonly resolved: PropValues;
  readonly onOverrides: (overrides: PropValues) => void;
}

function PropControl({ name, spec, value, overridden, onChange, onReset }: {
  readonly name: string;
  readonly spec: PropSpec;
  readonly value: PropValue | undefined;
  readonly overridden: boolean;
  readonly onChange: (value: PropValue) => void;
  readonly onReset: () => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // Text being typed that the contract does not accept yet. It is shown with its error and never applied.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hint = constraintHint(spec);
  const apply = (raw: unknown, text: string | null) => {
    const message = propError(name, spec, raw);
    if (message === null) {
      setDraft(null);
      setError(null);
      onChange(coerceProp(name, spec, raw));
      return;
    }
    setDraft(text ?? String(raw));
    setError(message);
  };
  const revert = () => { setDraft(null); setError(null); };
  const invalid = error === null ? {} : { 'aria-invalid': true as const };
  const describedBy = [hint === '' ? null : hintId, error === null ? null : errorId].filter((part) => part !== null).join(' ') || undefined;
  let control;
  switch (spec.kind) {
    case 'string':
      control = <input id={id} type="text" value={draft ?? String(value ?? '')} aria-describedby={describedBy} {...invalid}
        onChange={(event) => apply(event.target.value, event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') revert(); }} />;
      break;
    case 'number':
      control = <input id={id} type="number" value={draft ?? String(value ?? spec.default)} min={spec.min} max={spec.max} step={spec.step}
        aria-describedby={describedBy} {...invalid}
        onChange={(event) => apply(event.target.valueAsNumber, event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') revert(); }} />;
      break;
    case 'boolean':
      control = <label className="hqc-check"><input id={id} type="checkbox" checked={value === true} aria-describedby={describedBy}
        onChange={(event) => apply(event.target.checked, null)} /><span>{value === true ? 'on' : 'off'}</span></label>;
      break;
    case 'enum':
      control = <select id={id} value={String(value ?? spec.default)} aria-describedby={describedBy} onChange={(event) => apply(event.target.value, null)}>
        {spec.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>;
      break;
    case 'color':
      control = <span className="hqc-color-field">
        <span className="hqc-swatch hqc-swatch-sm" aria-hidden="true" style={{ backgroundColor: String(value ?? spec.default) }} />
        <input id={id} type="text" value={draft ?? String(value ?? spec.default)} spellCheck={false} aria-describedby={describedBy} {...invalid}
          onChange={(event) => apply(event.target.value.trim(), event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') revert(); }} />
      </span>;
      break;
  }
  const resettable = overridden || draft !== null;
  return <div className="hqc-prop" data-overridden={overridden ? 'true' : 'false'} data-invalid={error === null ? 'false' : 'true'}>
    <label htmlFor={id} className="hqc-prop-name">
      <span>{name}</span>
      <span className="hqc-kind">{propTypeLabel(spec)}</span>
      {overridden ? <span className="hqc-dot" role="img" aria-label="Overridden" title="Overridden from the variant or defaults" /> : null}
    </label>
    <div className="hqc-prop-field">
      {control}
      {hint === '' ? null : <span id={hintId} className="hqc-hint hqc-mono">{hint}</span>}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
    {resettable
      ? <button type="button" className="hqc-link" onClick={() => { revert(); onReset(); }} aria-label={`Reset ${name}`}>Reset</button>
      : <span className="hqc-link-slot" aria-hidden="true" />}
  </div>;
}

/**
 * Controls: one row per prop with its type, a constraint hint, an overridden dot and Reset. Editing changes only
 * the render input and panel session; the stored source revision is read-only here. A **Spec** disclosure holds the
 * full props table and what each variant sets.
 */
export function PropsPanel({ source, variants, variantId, overrides, resolved, onOverrides }: PropsPanelProps) {
  const entries = Object.entries(source.props);
  const overriddenCount = Object.keys(overrides).length;
  return <section className="hqc-panel hqc-controls" aria-label="Props">
    <header className="hqc-panel-head">
      <h2>Controls</h2>
      <span className="hqc-mono hqc-meta">r{source.revision} · {source.digest.slice(7, 17)}…</span>
      {overriddenCount === 0 ? null : <Button size="sm" variant="ghost" onClick={() => onOverrides({})}>Reset all</Button>}
    </header>
    {entries.length === 0 ? <p className="hqc-note">This component declares no props.</p> : <div className="hqc-props">
      {entries.map(([name, spec]) => <PropControl
        key={`${variantId ?? 'base'}:${name}`}
        name={name}
        spec={spec}
        value={resolved[name]}
        overridden={name in overrides}
        onChange={(value) => onOverrides({ ...overrides, [name]: value })}
        onReset={() => {
          const { [name]: _removed, ...rest } = overrides;
          onOverrides(rest);
        }}
      />)}
    </div>}
    <details className="hqc-spec">
      <summary>Spec</summary>
      <div className="hqc-spec-body">
        <table className="hqc-spec-table">
          <caption>Props</caption>
          <thead><tr><th scope="col">Prop</th><th scope="col">Type</th><th scope="col">Default</th><th scope="col">Constraint</th></tr></thead>
          <tbody>
            {entries.map(([name, spec]) => <tr key={name}>
              <th scope="row" className="hqc-mono">{name}</th>
              <td>{propTypeLabel(spec)}</td>
              <td className="hqc-mono">{String(spec.default)}</td>
              <td className="hqc-mono">{constraintHint(spec)}</td>
            </tr>)}
          </tbody>
        </table>
        {variants === null || variants.variants.length === 0 ? null : <table className="hqc-spec-table">
          <caption>Variant overrides</caption>
          <thead><tr><th scope="col">Variant</th><th scope="col">Sets</th></tr></thead>
          <tbody>
            {variants.variants.map((variant) => <tr key={variant.id} aria-current={variant.id === variantId ? 'true' : undefined}>
              <th scope="row">{variant.name}</th>
              <td className="hqc-mono">{variantDiff(source, variant.props).map((chip) => chip.text).join(' · ') || 'nothing'}</td>
            </tr>)}
          </tbody>
        </table>}
      </div>
    </details>
    <p className="hqc-note">Source r{source.revision} is read-only here; variants and overrides never change it.</p>
  </section>;
}
