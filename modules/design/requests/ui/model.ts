/** Framework-free view model helpers for the requests views. */
import type { DecisionPacket, ReturnedCandidate } from '../src/contract.ts';
import type { SessionState } from '../src/session.ts';

export const STEPS = ['Draft', 'Clarify', 'Freeze', 'Review'] as const;
export type Step = (typeof STEPS)[number];

/** Where the request is in draft → clarify → freeze → review. */
export function currentStep(state: SessionState, candidate: ReturnedCandidate | null): Step {
  if (candidate && state.packets.some((packet) => packet.packetId === candidate.packet.packetId)) return 'Review';
  if (state.draft?.phase === 'clarify') return 'Clarify';
  if (state.draft && state.blockers.length === 0) return 'Freeze';
  return 'Draft';
}

export function saveLabel(state: SessionState): string {
  if (state.readOnly) return 'Read-only';
  if (state.unknown) return 'Outcome unknown';
  switch (state.save) {
    case 'saved': return state.savedAt ? `Saved locally ${time(state.savedAt)}` : 'Saved locally';
    case 'unsaved': return 'Unsaved changes';
    case 'saving': return 'Saving…';
    case 'error': return 'Not saved';
  }
}

function time(iso: string): string { return iso.slice(11, 16); }

export function shortDigest(digest: string): string {
  return digest.startsWith('sha256:') ? `sha256:${digest.slice(7, 19)}` : digest;
}

export function headPacket(state: SessionState): DecisionPacket | null { return state.packets.at(-1) ?? null; }

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
