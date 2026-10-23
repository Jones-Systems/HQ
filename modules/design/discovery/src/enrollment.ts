/**
 * Explicit source enrollment and workspace links. Enrollment grants discovery reads only; it is not
 * execution eligibility. Links between workspace projects and source entries are created only by an
 * explicit user action and never inferred from matching titles or remotes.
 */
import {
  hostId as toHostId, isBoundedText, isoTime,
  type IsoTime, type ProjectId, type SourceAdapter, type SourceEnrollment, type WorkspaceSourceLink,
} from './contract.ts';
import type { CatalogRecord } from './catalog.ts';

export type EnrollmentResult =
  | { readonly ok: true; readonly enrollment: SourceEnrollment }
  | { readonly ok: false; readonly reason: 'not-confirmed' | 'unknown-adapter' | 'adapter-not-qualified' | 'already-enrolled' | 'invalid' };

export interface EnrollmentRequest {
  readonly hostId: string;
  readonly label: string;
  readonly adapterKey: string;
  readonly fingerprint?: string;
  /** Must be the literal user confirmation; background code cannot enroll a source. */
  readonly confirmation: 'user-confirmed';
}

/**
 * Validates an explicit enrollment. A `qualified` adapter must carry a qualification reference;
 * `fake` adapters are allowed and stay labelled as fake in every view.
 */
export function enrollSource(
  request: EnrollmentRequest,
  adapters: Readonly<Record<string, SourceAdapter>>,
  existing: readonly SourceEnrollment[],
  at: IsoTime,
): EnrollmentResult {
  if ((request as { confirmation?: unknown }).confirmation !== 'user-confirmed') return { ok: false, reason: 'not-confirmed' };
  let host;
  try { host = toHostId(request.hostId); isoTime(at); } catch { return { ok: false, reason: 'invalid' }; }
  if (!isBoundedText(request.label, 120) || (request.fingerprint !== undefined && !isBoundedText(request.fingerprint, 200))) {
    return { ok: false, reason: 'invalid' };
  }
  const adapter = Object.hasOwn(adapters, request.adapterKey) ? adapters[request.adapterKey] : undefined;
  if (!adapter) return { ok: false, reason: 'unknown-adapter' };
  if (adapter.qualification !== 'fake' && !(adapter.qualification === 'qualified' && isBoundedText(adapter.qualificationRef, 300))) {
    return { ok: false, reason: 'adapter-not-qualified' };
  }
  if (existing.some((item) => item.hostId === host)) return { ok: false, reason: 'already-enrolled' };
  return {
    ok: true,
    enrollment: {
      hostId: host, label: request.label, adapterKey: request.adapterKey, enrolledAt: at,
      ...(request.fingerprint !== undefined ? { fingerprint: request.fingerprint } : {}),
    },
  };
}

/** Explicit re-verification after a held identity conflict: records the newly accepted fingerprint. */
export function acceptHostFingerprint(enrollment: SourceEnrollment, fingerprint: string, confirmation: 'user-confirmed'): SourceEnrollment {
  if ((confirmation as unknown) !== 'user-confirmed' || !isBoundedText(fingerprint, 200)) throw new TypeError('Explicit confirmation and a valid fingerprint are required');
  return { ...enrollment, fingerprint };
}

/**
 * Creates an explicit link from an editable workspace project to a read-only source entry. The link
 * records the revision observed at linking time; it never copies or merges the entry.
 */
export function linkWorkspaceProject(project: ProjectId, record: CatalogRecord, linkedAt: IsoTime, confirmation: 'user-confirmed'): WorkspaceSourceLink {
  if ((confirmation as unknown) !== 'user-confirmed') throw new TypeError('Linking requires an explicit user action');
  isoTime(linkedAt);
  return { projectId: project, sourceProjectId: record.entry.sourceProjectId, linkedAt, observedRevision: record.entry.revision ?? null };
}
