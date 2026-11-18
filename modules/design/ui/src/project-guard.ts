import type { ReferenceEnvelope } from '@hq/contracts';

/**
 * Project context belongs to the shell. Design never changes it implicitly:
 * a palette pick, a reference to another project, or a section request only
 * creates a pending proposal. The shell is asked exactly once, when the user
 * confirms that exact proposal.
 */
export type SwitchOrigin = 'palette' | 'reference' | 'section';

export interface ProjectSwitchProposal {
  readonly token: number;
  readonly projectId: string;
  readonly label: string;
  readonly origin: SwitchOrigin;
}

export interface GuardState {
  readonly pending: ProjectSwitchProposal | null;
  readonly nextToken: number;
}

export const INITIAL_GUARD: GuardState = { pending: null, nextToken: 1 };

export function proposeSwitch(state: GuardState, currentProjectId: string, projectId: string, label: string, origin: SwitchOrigin): GuardState {
  if (projectId === currentProjectId || projectId.length === 0) return { ...state, pending: null };
  return { pending: { token: state.nextToken, projectId, label, origin }, nextToken: state.nextToken + 1 };
}

export function cancelSwitch(state: GuardState): GuardState {
  return state.pending === null ? state : { ...state, pending: null };
}

/**
 * Only the token shown to the user can be confirmed. A stale token (the prompt
 * was replaced) or a second confirm yields no request.
 */
export function confirmSwitch(state: GuardState, token: number): { readonly state: GuardState; readonly request: string | null } {
  if (state.pending === null || state.pending.token !== token) return { state, request: null };
  return { state: { ...state, pending: null }, request: state.pending.projectId };
}

export type ReferenceResolution =
  | { readonly type: 'foreign-domain'; readonly domain: ReferenceEnvelope['domain'] }
  | { readonly type: 'other-project'; readonly projectId: string }
  | { readonly type: 'same-project'; readonly kind: string; readonly entityId: string };

/** Classify a reference. A missing target or another project is never permission to switch. */
export function classifyReference(reference: ReferenceEnvelope, currentProjectId: string): ReferenceResolution {
  if (reference.domain !== 'design') return { type: 'foreign-domain', domain: reference.domain };
  if (reference.projectId !== currentProjectId) return { type: 'other-project', projectId: reference.projectId };
  return { type: 'same-project', kind: reference.kind, entityId: reference.entityId };
}
