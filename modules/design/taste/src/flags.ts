import type { TasteFeatureFlags } from './contract.ts';

/**
 * Rating controls are built and renderable for owner acceptance (plan
 * amendment to ctx.taste.001). Automatic guidance activation and legacy
 * journal reuse are fixed off: overrides for them are ignored and reported.
 */
export const DEFAULT_TASTE_FLAGS: TasteFeatureFlags = Object.freeze({
  ratingControls: true,
  automaticGuidance: false,
  legacyJournalReuse: false,
});

export function resolveTasteFlags(overrides: unknown): { readonly flags: TasteFeatureFlags; readonly ignored: readonly string[] } {
  const input = typeof overrides === 'object' && overrides !== null ? overrides as Record<string, unknown> : {};
  const ignored = Object.keys(input).filter((key) => key !== 'ratingControls' || typeof input[key] !== 'boolean');
  const ratingControls = typeof input.ratingControls === 'boolean' ? input.ratingControls : DEFAULT_TASTE_FLAGS.ratingControls;
  return {
    flags: Object.freeze({ ratingControls, automaticGuidance: false, legacyJournalReuse: false }),
    ignored: ignored.sort(),
  };
}
