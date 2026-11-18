import {
  DRAFT_PRIVACY, DRAFT_SCHEMA,
  type AnnotationId, type AnnotationRef, type AttachmentCandidate, type AttachmentId, type ClarificationId,
  type DecisionPacket, type Destination, type DraftId, type DraftPhase, type EvidenceId, type EvidenceRef,
  type PacketLink, type RequestContent, type RequestDraft, type RequestId, type ReviewLink, type SourceRef, type VersionId,
} from './contract.ts';
import { canonicalize } from './jcs.ts';
import { ValidationError, parseDraft } from './validate.ts';

/** Every owner edit is one of these pure operations; each bumps the draft revision. */
export type DraftEdit =
  | { readonly type: 'set-title'; readonly title: string }
  | { readonly type: 'set-intent'; readonly intent: string }
  | { readonly type: 'add-source'; readonly source: SourceRef }
  | { readonly type: 'remove-source'; readonly versionId: VersionId }
  | { readonly type: 'add-annotation'; readonly annotation: AnnotationRef }
  | { readonly type: 'remove-annotation'; readonly id: AnnotationId }
  | { readonly type: 'add-evidence'; readonly evidence: EvidenceRef }
  | { readonly type: 'remove-evidence'; readonly evidenceId: EvidenceId }
  /** New attachments always start unselected. */
  | { readonly type: 'add-attachment'; readonly attachment: Omit<AttachmentCandidate, 'selected'> }
  | { readonly type: 'select-attachment'; readonly attachmentId: AttachmentId; readonly selected: boolean }
  | { readonly type: 'remove-attachment'; readonly attachmentId: AttachmentId }
  | { readonly type: 'ask'; readonly clarificationId: ClarificationId; readonly question: string }
  | { readonly type: 'answer'; readonly clarificationId: ClarificationId; readonly answer: string }
  | { readonly type: 'dismiss'; readonly clarificationId: ClarificationId }
  | { readonly type: 'set-phase'; readonly phase: DraftPhase }
  | { readonly type: 'set-destination'; readonly destination: Destination };

export interface NewDraftInit {
  readonly requestId: RequestId;
  readonly draftId: DraftId;
  readonly now: string;
  readonly title?: string;
  readonly sources?: readonly SourceRef[];
}

export function newDraft(init: NewDraftInit): RequestDraft {
  return parseDraft({
    schema: DRAFT_SCHEMA, privacy: DRAFT_PRIVACY, requestId: init.requestId, draftId: init.draftId, revision: 0,
    phase: 'draft', createdAt: init.now, updatedAt: init.now, origin: 'initial', continuesFrom: null, review: null,
    title: init.title ?? '', intent: '', sources: init.sources ?? [], annotations: [], evidence: [], attachments: [],
    clarifications: [], destination: { kind: 'unassigned' },
  });
}

function missing(what: string, id: string): never { throw new ValidationError('edit', `${what} ${id} not found`); }

function body(draft: RequestDraft, edit: DraftEdit): Partial<RequestDraft> {
  switch (edit.type) {
    case 'set-title': return { title: edit.title };
    case 'set-intent': return { intent: edit.intent };
    case 'add-source': return { sources: [...draft.sources, edit.source] };
    case 'remove-source':
      if (!draft.sources.some((item) => item.versionId === edit.versionId)) missing('source', edit.versionId);
      return { sources: draft.sources.filter((item) => item.versionId !== edit.versionId) };
    case 'add-annotation': return { annotations: [...draft.annotations, edit.annotation] };
    case 'remove-annotation':
      if (!draft.annotations.some((item) => item.id === edit.id)) missing('annotation', edit.id);
      return { annotations: draft.annotations.filter((item) => item.id !== edit.id) };
    case 'add-evidence': return { evidence: [...draft.evidence, edit.evidence] };
    case 'remove-evidence':
      if (!draft.evidence.some((item) => item.evidenceId === edit.evidenceId)) missing('evidence', edit.evidenceId);
      return { evidence: draft.evidence.filter((item) => item.evidenceId !== edit.evidenceId) };
    case 'add-attachment': return { attachments: [...draft.attachments, { ...edit.attachment, selected: false }] };
    case 'select-attachment':
      if (!draft.attachments.some((item) => item.attachmentId === edit.attachmentId)) missing('attachment', edit.attachmentId);
      return { attachments: draft.attachments.map((item) => item.attachmentId === edit.attachmentId ? { ...item, selected: edit.selected } : item) };
    case 'remove-attachment':
      if (!draft.attachments.some((item) => item.attachmentId === edit.attachmentId)) missing('attachment', edit.attachmentId);
      return { attachments: draft.attachments.filter((item) => item.attachmentId !== edit.attachmentId) };
    case 'ask':
      if (edit.question.trim() === '') throw new ValidationError('edit.question', 'empty question');
      return { phase: 'clarify', clarifications: [...draft.clarifications, { clarificationId: edit.clarificationId, question: edit.question }] };
    case 'answer':
      if (!draft.clarifications.some((item) => item.clarificationId === edit.clarificationId)) missing('clarification', edit.clarificationId);
      return {
        clarifications: draft.clarifications.map((item) => item.clarificationId === edit.clarificationId
          ? { clarificationId: item.clarificationId, question: item.question, answer: edit.answer } : item),
      };
    case 'dismiss':
      if (!draft.clarifications.some((item) => item.clarificationId === edit.clarificationId)) missing('clarification', edit.clarificationId);
      return {
        clarifications: draft.clarifications.map((item) => item.clarificationId === edit.clarificationId
          ? { ...item, dismissed: true as const } : item),
      };
    case 'set-phase': return { phase: edit.phase };
    case 'set-destination': return { destination: edit.destination };
  }
}

/** Applies one edit, validating the whole result. The input draft is never mutated. */
export function applyEdit(draft: RequestDraft, edit: DraftEdit, now: string): RequestDraft {
  return parseDraft({ ...draft, ...body(draft, edit), revision: draft.revision + 1, updatedAt: now });
}

export function openClarifications(draft: RequestDraft) {
  return draft.clarifications.filter((item) => item.answer === undefined && item.dismissed !== true);
}

export function contentOf(value: RequestContent & { readonly attachments: readonly { readonly attachmentId: AttachmentId; readonly selected?: boolean }[] }) {
  return {
    title: value.title, intent: value.intent, sources: value.sources, annotations: value.annotations, evidence: value.evidence,
    clarifications: value.clarifications, destination: value.destination,
    attachments: value.attachments.filter((item) => item.selected !== false).map(({ selected: _selected, ...rest }) => rest),
  };
}

/** True when freezing the draft would only repeat the packet it continues. */
export function sameContent(draft: RequestDraft, packet: DecisionPacket): boolean {
  return canonicalize(contentOf(draft)) === canonicalize(contentOf(packet));
}

/**
 * Reasons freezing is not yet possible. `head` is the request's latest packet
 * (the one a continuation must continue), or null before the first freeze.
 */
export function freezeBlockers(draft: RequestDraft, head: DecisionPacket | null): string[] {
  const reasons: string[] = [];
  if (draft.title.trim() === '') reasons.push('Add a title.');
  if (draft.intent.trim() === '') reasons.push('Describe what should change.');
  if (draft.sources.length === 0) reasons.push('Add at least one source version.');
  if (new Set(draft.sources.map((item) => item.projectId)).size > 1) reasons.push('Use sources from one project.');
  const open = openClarifications(draft).length;
  if (open > 0) reasons.push(`Answer or dismiss ${open} open clarification${open === 1 ? '' : 's'}.`);
  const continues = draft.continuesFrom?.packetId ?? null;
  if (continues !== (head?.packetId ?? null)) reasons.push('This draft no longer continues the latest packet.');
  else if (head && sameContent(draft, head)) reasons.push(`No changes since packet ${head.lineage.sequence}.`);
  return reasons;
}

export function linkOf(packet: DecisionPacket): PacketLink {
  return { packetId: packet.packetId, authoringDigest: packet.authoringDigest };
}

/**
 * The linked editable continuation written by freeze. Content starts as the
 * frozen packet; unselected attachment candidates stay local and unselected.
 */
export function continuationOf(packet: DecisionPacket, consumed: RequestDraft, draftId: DraftId, now: string): RequestDraft {
  const included = new Set(packet.attachments.map((item) => item.attachmentId));
  return parseDraft({
    schema: DRAFT_SCHEMA, privacy: DRAFT_PRIVACY, requestId: packet.lineage.requestId, draftId, revision: 0, phase: 'draft',
    createdAt: now, updatedAt: now, origin: 'continuation', continuesFrom: linkOf(packet), review: null,
    title: packet.title, intent: packet.intent, sources: packet.sources, annotations: packet.annotations, evidence: packet.evidence,
    clarifications: packet.clarifications, destination: packet.destination,
    attachments: [
      ...packet.attachments.map((item) => ({ ...item, selected: true })),
      ...consumed.attachments.filter((item) => !included.has(item.attachmentId)).map((item) => ({ ...item, selected: false })),
    ],
  });
}

/**
 * A revise decision starts a new draft linked to the reviewed packet. The
 * active continuation's unsent edits and all original evidence carry forward;
 * the candidate's evidence is appended, never substituted.
 */
export function revisionOf(active: RequestDraft, review: ReviewLink, added: readonly EvidenceRef[], draftId: DraftId, now: string): RequestDraft {
  const known = new Set(active.evidence.map((item) => item.evidenceId));
  return parseDraft({
    ...active, draftId, revision: 0, phase: 'draft', createdAt: now, updatedAt: now, origin: 'revision', review,
    evidence: [...active.evidence, ...added.filter((item) => !known.has(item.evidenceId))],
  });
}
