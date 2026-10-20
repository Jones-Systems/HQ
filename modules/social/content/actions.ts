import {
  checkDraft, draftFields, isDirty, workspaceSnapshot,
  type Draft, type DraftEditor, type DraftFields, type PortError, type SocialSession, type SocialWorkspacePort,
} from '../core';
import type { SaveState } from '@hq/ui';

export type ChangeResult =
  | { readonly ok: true; readonly draft: Draft }
  | { readonly ok: false; readonly error: PortError | { readonly kind: 'blocked'; readonly message: string } };

export const BLOCKED_BY_EDIT = 'This draft has unsaved edits in the Library. Save or discard them first.';

/**
 * Changes stored fields of one draft (planned date, archive state) through exactly one versioned
 * save of the stored record. Unsaved editor text is never folded in: a draft with unsaved edits is
 * refused, and a clean open editor is closed so it reopens from the saved record.
 */
export async function changeDraft(
  session: SocialSession, port: SocialWorkspacePort, draft: Draft, patch: Partial<Pick<DraftFields, 'planned_date' | 'archived'>>,
): Promise<ChangeResult> {
  const open = session.getState().editors[draft.id];
  if (open && (isDirty(open) || open.status !== 'editing')) return { ok: false, error: { kind: 'blocked', message: BLOCKED_BY_EDIT } };
  if (open) session.closeEditor(draft.id);
  const key = `change:${draft.id}`;
  session.closeEditor(key);
  session.openEditor(key, draft);
  session.editDraft(key, patch);
  const saved = await session.saveEditor(port, key);
  const error = session.getState().editors[key]?.error;
  session.closeEditor(key);
  if (saved) return { ok: true, draft: saved };
  return { ok: false, error: error ?? { kind: 'unknown', attemptedAt: new Date().toISOString() } };
}

/** What the save bar shows for an editor. A conflict has its own banner and keeps the last indicator. */
export function saveStateOf(editor: DraftEditor): SaveState {
  if (editor.status === 'saving') return 'saving';
  if (editor.status === 'error') return editor.error?.kind === 'unknown' ? 'unknown' : 'failed';
  if (editor.status === 'conflict') return 'failed';
  return isDirty(editor) ? 'unsaved' : 'saved';
}

export function sameStoredFields(draft: Draft, fields: DraftFields, features: readonly string[]): boolean {
  const checked = checkDraft(fields, { features });
  if (!checked.ok) return false;
  const { links: _links, ...stored } = draftFields(draft);
  return JSON.stringify(stored) === JSON.stringify(checked.value.fields);
}

export type Reconciliation =
  /** The save happened; the editor now rests on the stored copy. */
  | { readonly kind: 'applied'; readonly draft: Draft }
  /** The stored copy is unchanged; saving again is safe and is the user's choice. */
  | { readonly kind: 'not-applied' }
  /** Someone else's change is stored; treat as a conflict. */
  | { readonly kind: 'changed' }
  /** A new draft whose text now exists in the library; it may be the lost save, but that is not proved. */
  | { readonly kind: 'possible-match'; readonly drafts: readonly Draft[] }
  | { readonly kind: 'unavailable' };

/**
 * Reconciles a save whose result is unknown by reading the workspace once. It never saves:
 * any further save is a separate explicit user action.
 */
export async function reconcileUnknownSave(session: SocialSession, port: SocialWorkspacePort, key: string): Promise<Reconciliation> {
  const editor = session.getState().editors[key];
  if (!editor) return { kind: 'unavailable' };
  await session.load(port);
  const load = session.getState().workspace;
  const snapshot = workspaceSnapshot(load);
  if (load.status !== 'ready' || !snapshot) return { kind: 'unavailable' };
  if (!editor.base) {
    const drafts = snapshot.content.filter((draft) => sameStoredFields(draft, editor.fields, snapshot.features));
    return drafts.length ? { kind: 'possible-match', drafts } : { kind: 'not-applied' };
  }
  const latest = snapshot.content.find((draft) => draft.id === editor.base!.id);
  if (!latest) return { kind: 'changed' };
  if (latest.version === editor.base.version) return { kind: 'not-applied' };
  if (latest.version === editor.base.version + 1 && sameStoredFields(latest, editor.fields, snapshot.features)) {
    session.closeEditor(key);
    session.openEditor(key, latest);
    return { kind: 'applied', draft: latest };
  }
  return { kind: 'changed' };
}

/** Maps a validation message to the field it names, for `aria-invalid`. */
export function invalidField(error: PortError | undefined): keyof DraftFields | null {
  if (error?.kind !== 'invalid') return null;
  const message = error.message;
  if (message.startsWith('Title')) return 'title';
  if (message.startsWith('Body')) return 'body';
  if (message === 'Unknown channel') return 'channel';
  if (message === 'Unknown brand') return 'brand_id';
  if (message.includes('planning date') || message.startsWith('Planning date')) return 'planned_date';
  if (message.includes('links') || message.startsWith('Links')) return 'links';
  return null;
}

/** Service messages carry no final stop; add one so a following sentence reads correctly. */
function sentence(message: string): string {
  return /[.!?]$/u.test(message) ? message : `${message}.`;
}

export function errorText(error: PortError | { kind: 'blocked'; message: string }): string {
  switch (error.kind) {
    case 'invalid':
    case 'conflict':
    case 'blocked':
      return sentence(error.message);
    case 'not_found': return 'This draft is no longer in the workspace.';
    case 'forbidden': return 'The Social service refused this change. Reload the workspace and try again.';
    case 'unavailable': return 'The Social service is unreachable. Nothing was changed.';
    case 'unknown': return 'The result is unknown: the Social service may or may not have saved it. Check before trying again.';
  }
}
