import type {
  ComponentSource, PropSpec, PropValue, PropValues, RenderInput, Variant, VariantId, VariantSet,
} from '../contract.ts';
import { brandId } from './ids.ts';
import { deepFreeze } from './jcs.ts';

const PROP_NAME = /^[a-z][A-Za-z0-9]{0,47}$/u;
const MAX_PROPS = 64;
const MAX_VARIANTS = 64;

/** Hex, rgb()/rgba() or hsl()/hsla() with numeric arguments only. */
export const COLOR_PATTERN = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|hsl)a?\(\s*-?[\d.]+%?(\s*[,\s/]\s*-?[\d.]+%?){2,3}\s*\))$/iu;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseSpec(name: string, value: unknown): PropSpec {
  if (value === null || typeof value !== 'object') throw new TypeError(`Prop "${name}" spec must be an object.`);
  const spec = value as Record<string, unknown>;
  switch (spec.kind) {
    case 'string': {
      const maxLength = spec.maxLength === undefined ? undefined : spec.maxLength;
      if (maxLength !== undefined && (!Number.isInteger(maxLength) || (maxLength as number) < 1)) throw new TypeError(`Prop "${name}" maxLength is invalid.`);
      const parsed: PropSpec = { kind: 'string', default: '', ...(maxLength === undefined ? {} : { maxLength: maxLength as number }) };
      return { ...parsed, default: coerceProp(name, parsed, spec.default) as string };
    }
    case 'number': {
      for (const key of ['min', 'max', 'step'] as const) {
        if (spec[key] !== undefined && !finite(spec[key])) throw new TypeError(`Prop "${name}" ${key} must be finite.`);
      }
      if (finite(spec.min) && finite(spec.max) && spec.min > spec.max) throw new TypeError(`Prop "${name}" min exceeds max.`);
      if (finite(spec.step) && spec.step <= 0) throw new TypeError(`Prop "${name}" step must be positive.`);
      const parsed: PropSpec = {
        kind: 'number', default: 0,
        ...(finite(spec.min) ? { min: spec.min } : {}),
        ...(finite(spec.max) ? { max: spec.max } : {}),
        ...(finite(spec.step) ? { step: spec.step } : {}),
      };
      return { ...parsed, default: coerceProp(name, parsed, spec.default) as number };
    }
    case 'boolean':
      return { kind: 'boolean', default: coerceProp(name, { kind: 'boolean', default: false }, spec.default) as boolean };
    case 'enum': {
      if (!Array.isArray(spec.options) || spec.options.length === 0 || spec.options.length > 32
        || !spec.options.every((option) => typeof option === 'string' && option.length > 0 && option.length <= 64)
        || new Set(spec.options).size !== spec.options.length) {
        throw new TypeError(`Prop "${name}" options must be unique nonempty strings.`);
      }
      const parsed: PropSpec = { kind: 'enum', default: spec.options[0] as string, options: [...spec.options] as string[] };
      return { ...parsed, default: coerceProp(name, parsed, spec.default) as string };
    }
    case 'color':
      return { kind: 'color', default: coerceProp(name, { kind: 'color', default: '#000' }, spec.default) as string };
    default:
      throw new TypeError(`Prop "${name}" has unknown kind.`);
  }
}

export function validatePropSpecs(value: unknown): Readonly<Record<string, PropSpec>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Component props must be an object.');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_PROPS) throw new TypeError(`A component declares at most ${MAX_PROPS} props.`);
  const specs: Record<string, PropSpec> = {};
  for (const [name, spec] of entries) {
    if (!PROP_NAME.test(name)) throw new TypeError(`Prop name "${name}" must be camelCase ASCII.`);
    specs[name] = parseSpec(name, spec);
  }
  return specs;
}

/** Returns the value if it satisfies the spec; never clamps or silently converts. */
export function coerceProp(name: string, spec: PropSpec, value: unknown): PropValue {
  const fail = (): never => { throw new TypeError(`Value for prop "${name}" does not satisfy its ${spec.kind} spec.`); };
  switch (spec.kind) {
    case 'string':
      if (typeof value !== 'string' || value.length > (spec.maxLength ?? 2000)) return fail();
      return value;
    case 'number':
      if (!finite(value) || (spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) return fail();
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') return fail();
      return value;
    case 'enum':
      if (typeof value !== 'string' || !spec.options.includes(value)) return fail();
      return value;
    case 'color':
      if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) return fail();
      return value;
  }
}

export function defaultProps(source: ComponentSource): PropValues {
  return Object.fromEntries(Object.entries(source.props).map(([name, spec]) => [name, spec.default]));
}

function checkValues(source: ComponentSource, values: unknown, label: string): PropValues {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new TypeError(`${label} props must be an object.`);
  const checked: Record<string, PropValue> = {};
  for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
    const spec = source.props[name];
    if (spec === undefined) throw new TypeError(`${label} sets undeclared prop "${name}".`);
    checked[name] = coerceProp(name, spec, value);
  }
  return checked;
}

/** Validates a stored variant set against the exact source revision it claims. */
export function parseVariantSet(source: ComponentSource, value: unknown): VariantSet {
  if (value === null || typeof value !== 'object') throw new TypeError('Variant set must be an object.');
  const set = value as Record<string, unknown>;
  if (set.componentId !== source.componentId) throw new TypeError('Variant set belongs to a different component.');
  if (set.sourceRevision !== source.revision) {
    throw new TypeError(`Variant set targets revision ${String(set.sourceRevision)}, not ${source.revision}; it is not rebound implicitly.`);
  }
  if (!Array.isArray(set.variants) || set.variants.length > MAX_VARIANTS) throw new TypeError('Variant list is invalid.');
  const seen = new Set<string>();
  const variants: Variant[] = set.variants.map((item: unknown) => {
    if (item === null || typeof item !== 'object') throw new TypeError('Variant must be an object.');
    const variant = item as Record<string, unknown>;
    const id = brandId('VariantId', variant.id);
    if (seen.has(id)) throw new TypeError(`Duplicate variant id "${id}".`);
    seen.add(id);
    if (typeof variant.name !== 'string' || variant.name.trim().length === 0 || variant.name.length > 120) throw new TypeError('Variant name is invalid.');
    return { id, name: variant.name, props: checkValues(source, variant.props, `Variant "${id}"`) };
  });
  return deepFreeze({ componentId: source.componentId, sourceRevision: source.revision, variants });
}

/**
 * Pure: defaults, then the selected variant, then explicit overrides. The
 * stored source and variant set are only read. Changing the selection
 * therefore never changes stored source bytes or digest.
 */
export function resolveRenderInput(
  source: ComponentSource,
  variants: VariantSet | null,
  variantId: VariantId | null,
  overrides: unknown,
  tokens: Readonly<Record<string, string>>,
): RenderInput {
  let variant: Variant | null = null;
  if (variantId !== null) {
    if (variants === null || variants.sourceRevision !== source.revision) throw new TypeError('Selected variant has no matching variant set.');
    variant = variants.variants.find((item) => item.id === variantId) ?? null;
    if (variant === null) throw new TypeError(`Unknown variant "${variantId}".`);
  }
  const props = { ...defaultProps(source), ...(variant?.props ?? {}), ...checkValues(source, overrides, 'Override') };
  return deepFreeze({
    componentId: source.componentId,
    sourceRevision: source.revision,
    sourceDigest: source.digest,
    variantId: variant?.id ?? null,
    props,
    tokens: { ...tokens },
  });
}

/** CSS custom properties for scalar props; strings are passed to script only. */
export function propsToCss(source: ComponentSource, props: PropValues): string {
  const lines: string[] = [];
  for (const [name, spec] of Object.entries(source.props)) {
    const value = props[name];
    const cssName = `--prop-${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;
    if (spec.kind === 'color' && typeof value === 'string' && COLOR_PATTERN.test(value)) lines.push(`${cssName}:${value};`);
    if (spec.kind === 'number' && finite(value)) lines.push(`${cssName}:${value};`);
    if (spec.kind === 'boolean' && typeof value === 'boolean') lines.push(`${cssName}:${value ? 1 : 0};`);
    if (spec.kind === 'enum' && typeof value === 'string' && /^[A-Za-z0-9_-]+$/u.test(value)) lines.push(`${cssName}:${value};`);
  }
  return lines.length === 0 ? '' : `:root{${lines.join('')}}`;
}
