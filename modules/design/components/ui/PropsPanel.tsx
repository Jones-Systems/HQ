import { useId } from 'react';
import type { ComponentSource, PropSpec, PropValue, PropValues, VariantId, VariantSet } from '../src/contract.ts';
import { coerceProp } from '../src/model/props.ts';

export interface PropsPanelProps {
  readonly source: ComponentSource;
  readonly variants: VariantSet | null;
  readonly variantId: VariantId | null;
  readonly overrides: PropValues;
  readonly resolved: PropValues;
  readonly onSelectVariant: (variantId: VariantId | null) => void;
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
  const accept = (raw: unknown) => {
    try {
      onChange(coerceProp(name, spec, raw));
    } catch {
      // Invalid input is not applied; the control keeps showing the last valid value.
    }
  };
  let control;
  switch (spec.kind) {
    case 'string':
      control = <input id={id} type="text" value={String(value ?? '')} maxLength={spec.maxLength} onChange={(event) => accept(event.target.value)} />;
      break;
    case 'number':
      control = <input id={id} type="number" value={Number(value ?? spec.default)} min={spec.min} max={spec.max} step={spec.step}
        onChange={(event) => accept(event.target.valueAsNumber)} />;
      break;
    case 'boolean':
      control = <input id={id} type="checkbox" checked={value === true} onChange={(event) => accept(event.target.checked)} />;
      break;
    case 'enum':
      control = <select id={id} value={String(value ?? spec.default)} onChange={(event) => accept(event.target.value)}>
        {spec.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>;
      break;
    case 'color':
      control = <input id={id} type="text" value={String(value ?? spec.default)} spellCheck={false} onChange={(event) => accept(event.target.value.trim())} />;
      break;
  }
  return <div className="hqc-prop" data-overridden={overridden ? 'true' : 'false'}>
    <label htmlFor={id}>{name}<span className="hqc-kind">{spec.kind}</span></label>
    {control}
    <button type="button" className="hqc-link" disabled={!overridden} onClick={onReset} aria-label={`Reset ${name}`}>Reset</button>
  </div>;
}

/**
 * Props and variants. Selecting a variant or editing a prop changes only the
 * render input and panel session; the stored source revision is read-only here.
 */
export function PropsPanel({ source, variants, variantId, overrides, resolved, onSelectVariant, onOverrides }: PropsPanelProps) {
  const groupName = useId();
  const options: { id: VariantId | null; name: string }[] = [{ id: null, name: 'Defaults' }, ...(variants?.variants ?? [])];
  return <section className="hqc-panel" aria-label="Props and variants">
    <fieldset className="hqc-variants">
      <legend>Variants</legend>
      {options.map((option) => <label key={option.id ?? '~default'} className="hqc-radio">
        <input type="radio" name={groupName} checked={option.id === variantId} onChange={() => onSelectVariant(option.id)} />
        {option.name}
      </label>)}
    </fieldset>
    <fieldset className="hqc-props">
      <legend>Props</legend>
      {Object.entries(source.props).map(([name, spec]) => <PropControl
        key={name}
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
    </fieldset>
    <p className="hqc-note">Source r{source.revision} is read-only here; variants and overrides never change it.</p>
  </section>;
}
