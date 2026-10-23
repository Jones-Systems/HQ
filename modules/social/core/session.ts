import { useSyncExternalStore } from 'react';
import { portErrorOf, type Draft, type DraftFields, type PortError, type SaveDraft, type SocialWorkspacePort, type WorkspaceSnapshot } from './port';

/**
 * Social UI state that must survive the shell remounting the module on every domain switch
 * (spec.hq-social-work#iface.domain-module.001). It lives at module level, keyed by the HQ
 * project ID, for the session only; persistence across restarts waits for a storage port (G-3).
 */

export type WorkspaceLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly last?: WorkspaceSnapshot }
  | { readonly status: 'ready'; readonly snapshot: WorkspaceSnapshot }
  /** `last` keeps the stale snapshot visible with its own `observedAt`, never as fresh. */
  | { readonly status: 'error'; readonly error: PortError; readonly last?: WorkspaceSnapshot };

export interface DraftEditor {
  /** The stored draft this editor started from; null for a new, unsaved draft. */
  readonly base: Draft | null;
  readonly fields: DraftFields;
  readonly status: 'editing' | 'saving' | 'conflict' | 'error';
  readonly error?: PortError;
}

export interface SocialSessionState {
  readonly workspace: WorkspaceLoad;
  readonly editors: Readonly<Record<string, DraftEditor>>;
  /** Page-owned UI state such as filters, selection and scroll, keyed by page. */
  readonly view: Readonly<Record<string, unknown>>;
}

const INITIAL: SocialSessionState = { workspace: { status: 'idle' }, editors: {}, view: {} };

export function draftFields(draft: Draft): DraftFields {
  const { id: _id, version: _version, updated_at: _updatedAt, ...fields } = draft;
  return fields;
}

export function isDirty(editor: DraftEditor): boolean {
  if (!editor.base) return true;
  return JSON.stringify(editor.fields) !== JSON.stringify(draftFields(editor.base));
}

/** The newest snapshot held, fresh or stale; check `load.status` before calling it current. */
export function workspaceSnapshot(load: WorkspaceLoad): WorkspaceSnapshot | undefined {
  return load.status === 'ready' ? load.snapshot : load.status === 'idle' ? undefined : load.last;
}

export class SocialSession {
  private state: SocialSessionState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;

  getState = (): SocialSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: SocialSessionState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private setEditor(key: string, editor: DraftEditor | null): void {
    const { [key]: _previous, ...rest } = this.state.editors;
    this.set({ ...this.state, editors: editor ? { ...rest, [key]: editor } : rest });
  }

  /** Reads the workspace (a content-class call). Concurrent calls share one request. */
  load(port: SocialWorkspacePort): Promise<void> {
    if (this.loading) return this.loading;
    const last = workspaceSnapshot(this.state.workspace);
    this.set({ ...this.state, workspace: { status: 'loading', ...(last ? { last } : {}) } });
    this.loading = port.snapshot().then(
      (snapshot) => this.set({ ...this.state, workspace: { status: 'ready', snapshot } }),
      (reason) => this.set({ ...this.state, workspace: { status: 'error', error: portErrorOf(reason) ?? { kind: 'unavailable' }, ...(last ? { last } : {}) } }),
    ).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /** Opens an editor, or returns the existing one so unsaved text is never replaced. */
  openEditor(key: string, base: Draft | null, fields?: DraftFields): DraftEditor {
    const existing = this.state.editors[key];
    if (existing) return existing;
    if (!base && !fields) throw new Error('A new draft editor needs initial fields');
    const editor: DraftEditor = { base, fields: fields ?? draftFields(base!), status: 'editing' };
    this.setEditor(key, editor);
    return editor;
  }

  editDraft(key: string, patch: Partial<DraftFields>): void {
    const editor = this.state.editors[key];
    if (!editor || editor.status === 'saving') return;
    this.setEditor(key, { ...editor, fields: { ...editor.fields, ...patch } });
  }

  closeEditor(key: string): void {
    this.setEditor(key, null);
  }

  /**
   * One versioned save. A conflict keeps the user's text and never overwrites the other copy;
   * the user chooses `reopenLatest` or `saveAsCopy`. Nothing is retried automatically.
   */
  async saveEditor(port: SocialWorkspacePort, key: string): Promise<Draft | null> {
    const editor = this.state.editors[key];
    if (!editor || editor.status === 'saving') return null;
    const request: SaveDraft = editor.base ? { ...editor.fields, id: editor.base.id, version: editor.base.version } : { ...editor.fields };
    return this.save(port, key, editor, request);
  }

  /** Saves the editor's text as a new draft, leaving the changed copy untouched. */
  async saveAsCopy(port: SocialWorkspacePort, key: string): Promise<Draft | null> {
    const editor = this.state.editors[key];
    if (!editor || editor.status === 'saving') return null;
    return this.save(port, key, editor, { ...editor.fields });
  }

  /** Reloads the workspace and replaces the editor with the latest stored copy. */
  async reopenLatest(port: SocialWorkspacePort, key: string): Promise<Draft | null> {
    const editor = this.state.editors[key];
    if (!editor?.base) return null;
    await this.load(port);
    const latest = workspaceSnapshot(this.state.workspace)?.content.find((draft) => draft.id === editor.base!.id) ?? null;
    if (latest) this.setEditor(key, { base: latest, fields: draftFields(latest), status: 'editing' });
    return latest;
  }

  private async save(port: SocialWorkspacePort, key: string, editor: DraftEditor, request: SaveDraft): Promise<Draft | null> {
    this.setEditor(key, { ...editor, status: 'saving' });
    try {
      const saved = await port.saveDraft(request);
      this.setEditor(key, { base: saved, fields: draftFields(saved), status: 'editing' });
      this.replaceDraft(saved);
      return saved;
    } catch (reason) {
      const error = portErrorOf(reason) ?? { kind: 'unknown', attemptedAt: new Date().toISOString() };
      this.setEditor(key, { ...editor, status: error.kind === 'conflict' ? 'conflict' : 'error', error });
      return null;
    }
  }

  private replaceDraft(saved: Draft): void {
    const load = this.state.workspace;
    if (load.status !== 'ready') return;
    const content = [saved, ...load.snapshot.content.filter((draft) => draft.id !== saved.id)];
    this.set({ ...this.state, workspace: { status: 'ready', snapshot: { ...load.snapshot, content } } });
  }

  setView(page: string, value: unknown): void {
    this.set({ ...this.state, view: { ...this.state.view, [page]: value } });
  }
}

const sessions = new Map<string, SocialSession>();

/** The session for an HQ project; the same instance across module remounts. */
export function socialSession(projectId: string): SocialSession {
  let session = sessions.get(projectId);
  if (!session) {
    session = new SocialSession();
    sessions.set(projectId, session);
  }
  return session;
}

/** Test-only: forget every session. */
export function resetSocialSessions(): void {
  sessions.clear();
}

export function useSocialSession(projectId: string): { readonly state: SocialSessionState; readonly session: SocialSession } {
  const session = socialSession(projectId);
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  return { state, session };
}
