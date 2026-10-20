import type { ReferenceProvider } from '@hq/contracts/references';

/** Root registers only landed read-only providers. Unregistered kinds remain unknown. */
export const REFERENCE_PROVIDERS: readonly ReferenceProvider[] = Object.freeze([]);
