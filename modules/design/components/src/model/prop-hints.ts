import type { PropSpec } from '../contract.ts';
import { coerceProp } from './props.ts';

/** Matches the longest text `coerceProp` accepts when a string prop declares no `maxLength`. */
const DEFAULT_MAX_CHARS = 2000;

/** Short type chip text for a control row. */
export function propTypeLabel(spec: PropSpec): string {
  return spec.kind === 'boolean' ? 'bool' : spec.kind;
}

/**
 * Constraint hint shown beside a control, for example `0–24, step 1`, `≤ 60 chars` or `primary · neutral · danger`.
 * It states only what `coerceProp` enforces, plus a declared step as guidance.
 */
export function constraintHint(spec: PropSpec): string {
  switch (spec.kind) {
    case 'string':
      return `≤ ${spec.maxLength ?? DEFAULT_MAX_CHARS} chars`;
    case 'number': {
      const bounds = spec.min !== undefined && spec.max !== undefined ? `${spec.min}–${spec.max}`
        : spec.min !== undefined ? `≥ ${spec.min}` : spec.max !== undefined ? `≤ ${spec.max}` : '';
      const step = spec.step === undefined ? '' : `step ${spec.step}`;
      return [bounds, step].filter((part) => part !== '').join(', ') || 'any number';
    }
    case 'boolean':
      return '';
    case 'enum':
      return spec.options.join(' · ');
    case 'color':
      return 'hex, rgb() or hsl()';
  }
}

/**
 * Why a raw control value cannot be applied, in plain words for a `FieldError`; null when `coerceProp` accepts it.
 * `raw` is what the control produced: text, a number (NaN for an empty number field) or a boolean.
 */
export function propError(name: string, spec: PropSpec, raw: unknown): string | null {
  try {
    coerceProp(name, spec, raw);
    return null;
  } catch {
    // Fall through to a message that names what to change.
  }
  switch (spec.kind) {
    case 'string': {
      if (typeof raw !== 'string') return 'Enter some text.';
      return `Too long: ${raw.length} of ${spec.maxLength ?? DEFAULT_MAX_CHARS} characters.`;
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return 'Enter a number.';
      if (spec.min !== undefined && spec.max !== undefined) return `Use a number from ${spec.min} to ${spec.max}.`;
      return spec.min !== undefined ? `Use ${spec.min} or more.` : `Use ${spec.max} or less.`;
    }
    case 'boolean':
      return 'Choose on or off.';
    case 'enum':
      return `Choose one of: ${spec.options.join(', ')}.`;
    case 'color':
      return 'Use a hex, rgb() or hsl() colour, such as #3b5bdb.';
  }
}
