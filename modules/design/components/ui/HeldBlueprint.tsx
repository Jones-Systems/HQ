import type { ComponentSource, PropValue, PropValues } from '../src/contract.ts';
import { blueprintCaption, dimsLabel, frameSize, primaryText } from '../src/model/blueprint.ts';
import type { UsedToken, WidthPreset } from '../src/model/blueprint.ts';
import { formatPropValue } from '../src/model/variant-diff.ts';

/** The most token swatches drawn before the rest are counted. */
const MAX_SWATCHES = 8;

export interface HeldBlueprintProps {
  readonly source: ComponentSource;
  readonly variantName: string;
  /** Stable key of the shown variant; the content cross-fades when it changes. */
  readonly variantKey: string;
  /** Resolved props, defaults then variant then overrides. */
  readonly props: PropValues;
  readonly width: WidthPreset;
  readonly tokens: readonly UsedToken[];
  /** How many times each resolved value changed; a changed value replays `hq-flash`. */
  readonly changes: Readonly<Record<string, number>>;
}

function show(value: PropValue | undefined): string {
  return value === undefined ? '—' : formatPropValue(value);
}

/**
 * The stage while component execution is held. It is drawn only from metadata the component declares: its size,
 * name, the variant name, the resolved prop values and the tokens it uses. No component markup, style or script is
 * read here, so nothing of the component can reach the page. It is a blueprint, not a render.
 */
export function HeldBlueprint({ source, variantName, variantKey, props, width, tokens, changes }: HeldBlueprintProps) {
  const size = frameSize(source.size, width);
  const text = primaryText(source, props);
  const textFlash = text === null ? 0 : (changes[text.name] ?? 0);
  const swatches = tokens.filter((token) => token.type === 'color' && token.value !== null);
  const names = Object.keys(source.props);
  return <div className="hqc-bp" data-held-blueprint="true">
    <div className="hqc-bp-frame" style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}
      role="img" aria-label={`Blueprint of ${source.name}, ${variantName}, ${dimsLabel(size)} pixels. Not a render.`}>
      <div key={`${source.componentId}:${variantKey}`} className="hqc-bp-content hq-enter-fade">
        <b className="hqc-bp-name">{source.name}</b>
        <span key={textFlash} className={textFlash > 0 ? 'hqc-bp-caption hq-flash' : 'hqc-bp-caption'}>{blueprintCaption(variantName, text?.text ?? null)}</span>
        <span className="hqc-bp-tag"><i aria-hidden="true" />Blueprint · not a render</span>
      </div>
    </div>
    <span className="hqc-bp-dims" aria-hidden="true">{dimsLabel(size)}</span>
    {names.length === 0 ? null : <ul className="hqc-bp-props" aria-label="Resolved props">
      {names.map((name) => {
        const count = changes[name] ?? 0;
        return <li key={`${name}:${count}`} className={count > 0 ? 'hqc-chip hq-flash' : 'hqc-chip'}>
          <span className="hqc-chip-name">{name}</span> <span className="hqc-chip-value">{show(props[name])}</span>
        </li>;
      })}
    </ul>}
    {swatches.length === 0 ? null : <ul className="hqc-bp-swatches" aria-label="Tokens used">
      {swatches.slice(0, MAX_SWATCHES).map((token) => <li key={token.id} title={`${token.id} · ${token.value}`}>
        <span className="hqc-swatch hqc-swatch-sm" style={{ backgroundColor: token.value ?? undefined }} />
        <span className="hqc-visually-hidden">{token.id}</span>
      </li>)}
      {swatches.length > MAX_SWATCHES ? <li className="hqc-bp-more hqc-mono">+{swatches.length - MAX_SWATCHES}</li> : null}
      {tokens.length > swatches.length ? <li className="hqc-bp-more hqc-mono" title="Tokens that are not colours">+{tokens.length - swatches.length} other</li> : null}
    </ul>}
  </div>;
}
