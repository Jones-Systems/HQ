import type { ComponentSource, PropValue, PropValues } from '../contract.ts';

/** One `name: value` chip of a variant's prop diff. */
export interface PropChip {
  readonly name: string;
  readonly value: PropValue;
  /** `name: value`, with long text shortened. */
  readonly text: string;
  /** False when the variant restates the declared default, so it adds nothing over Base. */
  readonly changed: boolean;
}

const MAX_VALUE_CHARS = 24;

/** Compact display form of a prop value. Text is shortened; it is never quoted, so chips stay mono and short. */
export function formatPropValue(value: PropValue): string {
  if (typeof value !== 'string') return String(value);
  const flat = value.replace(/\s+/gu, ' ').trim();
  return flat.length > MAX_VALUE_CHARS ? `${flat.slice(0, MAX_VALUE_CHARS - 1)}…` : flat;
}

/**
 * Pure: the props a variant sets, in the order the component declares them, each marked as changed or as a
 * restatement of the declared default (Base). Props the component does not declare are ignored.
 */
export function variantDiff(source: ComponentSource, variantProps: PropValues): readonly PropChip[] {
  const chips: PropChip[] = [];
  for (const [name, spec] of Object.entries(source.props)) {
    if (!Object.hasOwn(variantProps, name)) continue;
    const value = variantProps[name] as PropValue;
    chips.push({ name, value, text: `${name}: ${formatPropValue(value)}`, changed: value !== spec.default });
  }
  return chips;
}

/** Splits chips for a small tile: the first `limit` are shown, the rest are counted. */
export function limitChips(chips: readonly PropChip[], limit: number): { readonly shown: readonly PropChip[]; readonly hidden: readonly PropChip[] } {
  const keep = Math.max(0, Math.floor(limit));
  return { shown: chips.slice(0, keep), hidden: chips.slice(keep) };
}

/** Names whose value differs between two resolved prop sets, in the order of `after`, then names that vanished. */
export function changedProps(before: PropValues, after: PropValues): readonly string[] {
  const names = new Set([...Object.keys(after), ...Object.keys(before)]);
  return [...names].filter((name) => !Object.is(before[name], after[name]));
}
