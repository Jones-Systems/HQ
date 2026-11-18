/** Synthetic Requests fixtures for the Design end-to-end matrix. Nothing here is owner data or a real capability claim. */
import type { AnnotationRef, CandidateId, ClaimId, EvidenceRef, PacketLink, ReturnedCandidate, SourceRef, VersionId } from '../../../../modules/design/requests/src/contract.ts';
import { brandId } from '../../../../modules/design/requests/src/validate.ts';

export function source(version = 'v-a1'): SourceRef {
  return { projectId: brandId('fixture-project'), viewId: brandId('fixture-view-home'), versionId: brandId(version), sourceRevision: `rev-${version}` };
}

export function annotation(letter = 'A'): AnnotationRef {
  return {
    id: brandId(`ann-${letter}`), letter, kind: 'pick', note: `Tighten spacing near ${letter}`,
    anchor: {
      versionId: brandId('v-a1'), route: '/home', state: 'default', viewport: { w: 1280, h: 800, dpr: 2 }, scroll: { x: 0, y: 120 },
      captureDigest: 'sha256:fixture-capture',
      target: { kind: 'element', path: 'main > section:nth-child(2) > h2', rect: { x: 40, y: 200, width: 600, height: 48 } },
    },
  };
}

export function evidence(id = 'ev-capture-1'): EvidenceRef {
  return { evidenceId: brandId(id), kind: 'capture', label: 'Baseline capture', digest: 'sha256:fixture-evidence', versionId: brandId('v-a1') };
}

/** A returned candidate for a frozen packet, with one agent-reported and one observed claim. */
export function candidate(packet: PacketLink, id = 'cand-1'): ReturnedCandidate {
  return {
    candidateId: brandId<'CandidateId'>(id) as CandidateId, packet,
    baselineVersionId: brandId<'VersionId'>('v-a1') as VersionId, candidateVersionId: brandId<'VersionId'>('v-a2') as VersionId,
    claims: [
      { claimId: brandId<'ClaimId'>('claim-spacing') as ClaimId, text: 'Heading spacing reduced to 24px.', level: 'agent-reported', evidence: [] },
      { claimId: brandId<'ClaimId'>('claim-capture') as ClaimId, text: 'Capture shows the new spacing.', level: 'observed', evidence: [evidence('ev-cand-capture')] },
    ],
    observedStatus: 'returned', observedAt: '2026-01-02T00:00:00.000Z', evidence: [evidence('ev-cand-capture')],
  };
}
