/**
 * Evidence labels. Composition forwards data between lanes; it must never make data from a fake, synthetic
 * or cached source look real, and must never raise a claim above what its provider made.
 */
import type { ProvenanceKind } from '../../canvas/src/contract.ts';

export type DataStatus = 'fake' | 'synthetic' | 'cached' | 'workspace';

export interface EvidenceTag {
  readonly status: DataStatus;
  /** Shown verbatim next to the data. */
  readonly text: string;
}

export const FAKE_TAG: EvidenceTag = Object.freeze({ status: 'fake', text: 'FAKE — synthetic, in-memory, not durable' });
export const SYNTHETIC_TAG: EvidenceTag = Object.freeze({ status: 'synthetic', text: 'Synthetic fixture — not real project data' });
export const CACHED_TAG: EvidenceTag = Object.freeze({ status: 'cached', text: 'Cached snapshot — not refreshed on open' });
export const WORKSPACE_TAG: EvidenceTag = Object.freeze({ status: 'workspace', text: 'Workspace record' });

/** Only workspace records may read as real; every other status is shown with its label. */
export function isLabelledAsNotReal(tag: EvidenceTag): boolean {
  return tag.status !== 'workspace';
}

export function labelledProviderTitle(label: string, tag: EvidenceTag): string {
  return isLabelledAsNotReal(tag) && !label.includes(`(${tag.status})`) ? `${label} (${tag.status})` : label;
}

/**
 * Lane evidence claims to canvas provenance. Browser-made evidence stays browser-made; nothing maps to
 * native evidence, and unknown claims degrade to `unspecified` rather than up.
 */
const PROVENANCE_BY_CLAIM: Readonly<Record<string, ProvenanceKind>> = Object.freeze({
  'web-sandbox': 'component-sandbox',
  'web-approximation': 'web-approximation',
  'static-capture': 'static-capture',
  'live-preview': 'live-preview',
  'reference': 'reference',
});

export function provenanceForClaim(claim: string): ProvenanceKind {
  return Object.hasOwn(PROVENANCE_BY_CLAIM, claim) ? PROVENANCE_BY_CLAIM[claim]! : 'unspecified';
}

/** Where a project version's provenance comes from: a stored capture, never a live or native claim. */
export function tagForVersionOrigin(origin: string): EvidenceTag {
  return origin === 'synthetic-fixture' ? SYNTHETIC_TAG : WORKSPACE_TAG;
}
