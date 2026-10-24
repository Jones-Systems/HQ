import type { BlobDigest, ReferenceKind } from './contract.ts';
import type { AnchorId, AnchorKind, CaptureId, PinId, SubjectId, SubjectIdentity } from './graph-contract.ts';
import { jcsDigest } from './jcs.ts';
import { normalizeUrl } from './provenance.ts';

/**
 * Stable IDs: SHA-256 of the JCS canonical identity, versioned with `v`.
 * Titles, labels, notes, capture times and rights never participate.
 */
export async function deriveSubjectId(identity: SubjectIdentity): Promise<SubjectId> {
  return `sub_${await jcsDigest({ v: 1, identity })}` as SubjectId;
}

export async function deriveCaptureId(
  subjectId: SubjectId, kind: ReferenceKind, assetDigest: BlobDigest | null, captureKey: string | null,
): Promise<CaptureId> {
  return `cap_${await jcsDigest({ v: 1, subject: subjectId, kind, asset: assetDigest, key: captureKey })}` as CaptureId;
}

export async function deriveAnchorId(
  captureId: CaptureId, assetDigest: BlobDigest, kind: AnchorKind, key: string,
): Promise<AnchorId> {
  return `anc_${await jcsDigest({ v: 1, capture: captureId, asset: assetDigest, kind, key })}` as AnchorId;
}

export async function derivePinId(
  projectId: string, viewId: string | null, captureId: CaptureId, anchorId: AnchorId | null,
): Promise<PinId> {
  return `pin_${await jcsDigest({ v: 1, project: projectId, view: viewId, capture: captureId, anchor: anchorId })}` as PinId;
}

const SUBJECT_ID = /^sub_[0-9a-f]{64}$/u;
const CAPTURE_ID = /^cap_[0-9a-f]{64}$/u;
const ANCHOR_ID = /^anc_[0-9a-f]{64}$/u;
const PIN_ID = /^pin_[0-9a-f]{64}$/u;
export const isSubjectId = (value: unknown): value is SubjectId => typeof value === 'string' && SUBJECT_ID.test(value);
export const isCaptureId = (value: unknown): value is CaptureId => typeof value === 'string' && CAPTURE_ID.test(value);
export const isAnchorId = (value: unknown): value is AnchorId => typeof value === 'string' && ANCHOR_ID.test(value);
export const isPinId = (value: unknown): value is PinId => typeof value === 'string' && PIN_ID.test(value);

/** Site identity is the bare origin: lowercase scheme/host, default port removed, no path, query or fragment. */
export function normalizeOrigin(raw: string): string | null {
  const normalized = normalizeUrl(raw);
  if (normalized === null) return null;
  const url = new URL(normalized);
  if (url.pathname !== '/' || url.search !== '') return null;
  return url.origin;
}

export function originOf(normalizedUrl: string): string {
  return new URL(normalizedUrl).origin;
}
