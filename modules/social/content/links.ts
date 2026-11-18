import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import { referenceKey, type ReferenceUndo } from '@hq/ui';
import { FEATURE_HQ_REFERENCES, MAX_DRAFT_LINKS, MESSAGES, PortFailure, type SocialSession, type SocialWorkspacePort, workspaceSnapshot } from '../core';

export const UNSAVED_LINKS = 'not saved — needs Social service support';

/** A claimed successful save must echo the links; otherwise keep the existing unknown-save path. */
export function referenceSavePort(port: SocialWorkspacePort, features: readonly string[]): SocialWorkspacePort {
  return {
    ...port,
    async saveDraft(request) {
      if (request.links?.length && !features.includes(FEATURE_HQ_REFERENCES)) {
        throw new PortFailure({ kind: 'invalid', message: MESSAGES.linksUnsupported });
      }
      const { links: _links, ...withoutLinks } = request;
      const saved = await port.saveDraft(features.includes(FEATURE_HQ_REFERENCES) ? request : withoutLinks);
      if (features.includes(FEATURE_HQ_REFERENCES) && request.links
        && JSON.stringify(saved.links ?? []) !== JSON.stringify(request.links)) {
        throw new PortFailure({ kind: 'unknown', attemptedAt: new Date().toISOString() });
      }
      return saved;
    },
  };
}

/** Validate before touching editor state; duplicate identity ignores snapshot title/revision. */
export function addDraftLink(links: readonly ReferenceEnvelope[], value: unknown, projectId: string): ReferenceEnvelope[] {
  const envelope = parseReference(value);
  if (!envelope) throw new Error('Paste or drop a valid HQ reference.');
  if (envelope.projectId !== projectId) throw new Error('Another project: this reference is read-only.');
  if (links.some((link) => referenceKey(link) === referenceKey(envelope))) throw new Error('Already linked.');
  if (links.length >= MAX_DRAFT_LINKS) throw new Error('30-link limit reached.');
  return [...links, envelope];
}

/** Inverse mutations save against the latest editor base and refuse to overwrite later link edits. */
export async function saveDraftLinks(
  session: SocialSession, port: SocialWorkspacePort, key: string, links: ReferenceEnvelope[],
): Promise<ReferenceUndo> {
  const editor = session.getState().editors[key];
  const workspace = session.getState().workspace;
  if (!editor || editor.status !== 'editing' || workspace.status !== 'ready') throw new Error('Resolve the draft save before changing links.');
  if (!workspaceSnapshot(workspace)?.features.includes(FEATURE_HQ_REFERENCES)) throw new Error(UNSAVED_LINKS);
  const previous = editor.fields.links ?? [];
  session.editDraft(key, { links });
  const saved = await session.saveEditor(referenceSavePort(port, workspace.snapshot.features), key);
  if (!saved) throw new Error('Link change was not confirmed. Your proposed links are kept in the draft.');
  return {
    async undo() {
      const current = session.getState().editors[key];
      if (!current || JSON.stringify(current.fields.links ?? []) !== JSON.stringify(links)) {
        throw new Error('Links changed since this action. Undo is no longer safe.');
      }
      await saveDraftLinks(session, port, key, previous);
    },
  };
}
