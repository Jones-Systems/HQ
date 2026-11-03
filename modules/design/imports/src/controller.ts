import { StorageConflictError, type ImportId, type ImportSource, type ProjectId, type RecordId } from './contract.ts';
import { createBundle, createDraftBackup, serializeBundle, type Bundle, type BundleCoverage, type BundleKind } from './bundle.ts';
import {
  applyImport, listImports, listOpenConflicts, planImport, resolveConflict, StoredSchemaError, undoImport,
  type ConflictChoice, type ImportDeps, type ImportPlan, type Rejection, type RejectionReason,
} from './importer.ts';

/**
 * Framework-free controller for the Imports surface. Root injects the
 * capabilities; a missing capability is shown as unavailable, never faked.
 * Everything added for the Choose → Review → Done flow is view state: it
 * describes what the surface shows and says, and never changes what the
 * importer plans, writes or undoes.
 */
export interface ImportsCapabilities {
  /** Desktop file/URL selection. Absent until root qualifies a picker. */
  readonly pickSource?: () => Promise<ImportSource | null>;
  /** Saves bundle bytes to an owner-chosen location. Absent until qualified. */
  readonly saveBundle?: (bytes: Uint8Array, suggestedName: string, kind: BundleKind) => Promise<boolean>;
}

export interface ImportsControllerOptions {
  /**
   * Keeps a busy state on screen at least this long (ms), so an action that finishes in a frame still reads as work
   * that happened. Display timing only: the importer runs and commits exactly as before. Default 0 (off).
   */
  readonly minBusyMs?: number;
}

export type Tone = 'neutral' | 'positive' | 'attention' | 'critical';

/** How a plan row reads on screen: a word and a shape, never colour alone. */
export type PlanKind = 'new' | 'update' | 'skip' | 'conflict' | 'rejected';

export interface PlanRow {
  readonly key: string;
  readonly action: string;
  readonly tone: Tone;
  readonly kind: PlanKind;
}

export interface PlanSummary {
  readonly headline: string;
  readonly detail: string;
  readonly rows: readonly PlanRow[];
  readonly canApply: boolean;
}

export interface HistoryRow {
  readonly importId: ImportId;
  readonly importedAt: string;
  readonly label: string;
  readonly undone: boolean;
}

export interface ConflictRow {
  readonly recordId: RecordId;
  readonly itemKey: string;
  readonly label: string;
}

export interface ExportResult {
  readonly kind: BundleKind;
  readonly digest: string;
  readonly bytes: number;
  readonly saved: boolean | null;
  readonly coverage: BundleCoverage;
}

/** What an applied import left behind, for the Done step. */
export interface AppliedImport {
  readonly importId: ImportId;
  readonly importedAt: string;
  readonly counts: { readonly items: number; readonly created: number; readonly updated: number; readonly unchanged: number; readonly conflicts: number };
  readonly rows: readonly PlanRow[];
}

export type ImportsStep = 'choose' | 'review' | 'done';
export type BusyAction = 'choose' | 'apply' | 'undo' | 'resolve' | 'export' | 'check';
/** The part of the screen an outcome belongs to; a problem shows as an inline notice there. */
export type OutcomeWhere = 'choose' | 'review' | 'done' | 'conflicts' | 'history' | 'export';

/**
 * One thing that happened, in words. `success` and `info` are announced as toasts; `danger` and `unknown` also stay as
 * an inline notice in the step where they happened until the next action. `unknown` means the result could not be
 * confirmed, so the owner is offered Check, never a blind retry.
 */
export interface ImportsOutcome {
  readonly seq: number;
  readonly tone: 'success' | 'info' | 'danger' | 'unknown';
  readonly where: OutcomeWhere;
  readonly title: string;
  readonly detail: string;
  readonly meta?: string;
  /** The import this is about: Undo (after an apply) and Check (after an unknown result) act on it. */
  readonly importId?: ImportId;
  readonly undoable?: boolean;
  readonly checkable?: boolean;
}

export interface ImportsState {
  readonly status: 'idle' | 'busy' | 'planned' | 'applied' | 'rejected' | 'error';
  readonly summary: PlanSummary | null;
  readonly message: string | null;
  readonly history: readonly HistoryRow[];
  readonly conflicts: readonly ConflictRow[];
  readonly exportChoice: BundleKind;
  readonly confirmPrivate: boolean;
  readonly lastExport: ExportResult | null;
  readonly canPick: boolean;
  readonly canSave: boolean;
  /** What is running while `status` is `busy`, and the import or conflict it acts on. */
  readonly busyAction: BusyAction | null;
  readonly busyId: string | null;
  /** Set once the plan has been applied; cleared when the owner starts another import. */
  readonly applied: AppliedImport | null;
  /** The latest outcome. Its inline notice (problems only) clears on the next action or when dismissed. */
  readonly outcome: ImportsOutcome | null;
}

export const EXPORT_CHOICES: readonly { readonly kind: BundleKind; readonly label: string; readonly description: string }[] = [
  { kind: 'backup', label: 'Workspace backup', description: 'Everything editable in this workspace. Drafts and cache are not included.' },
  { kind: 'export', label: 'Publishable export', description: 'Shareable copy without drafts, with only the files your records use.' },
  { kind: 'draft-backup', label: 'Private draft backup', description: 'Only unsent drafts. Keep this file private.' },
];

export const IMPORT_STEPS: readonly { readonly step: ImportsStep; readonly label: string }[] = [
  { step: 'choose', label: 'Choose' },
  { step: 'review', label: 'Review' },
  { step: 'done', label: 'Done' },
];

const REJECTION_TEXT: Readonly<Record<RejectionReason, string>> = {
  'unsupported-source-kind': 'HQ does not recognise this import format.',
  'unsupported-version': 'This import uses a newer format version than HQ supports.',
  'invalid-source': 'Some items cannot be imported.',
  'unsupported-stored-schema': 'Stored import records use a newer format; they are left read-only.',
  'corrupt-stored-record': 'A stored import record is damaged; nothing was repaired.',
  namespace: 'The workspace store is unavailable for imports.',
  'unknown-import': 'That import is no longer recorded.',
  integrity: 'An existing version does not match its identifier.',
};

const ACTION_TEXT = { created: 'New', updated: 'Updated', unchanged: 'Unchanged', conflict: 'Conflict — your edits kept' } as const;
const ACTION_TONE: Readonly<Record<keyof typeof ACTION_TEXT, Tone>> = { created: 'positive', updated: 'positive', unchanged: 'neutral', conflict: 'attention' };
const ACTION_KIND: Readonly<Record<keyof typeof ACTION_TEXT, PlanKind>> = { created: 'new', updated: 'update', unchanged: 'skip', conflict: 'conflict' };

export function describeRejection(rejection: Rejection): string {
  return `${REJECTION_TEXT[rejection.reason]} Nothing was written.`;
}

export function summarizePlan(result: ImportPlan | Rejection): PlanSummary {
  if (!result.ok) {
    return {
      headline: describeRejection(result),
      detail: result.problems.map((problem) => (problem.itemKey === undefined ? problem.code : `${problem.itemKey}: ${problem.code}`)).join(', '),
      rows: result.problems.map((problem) => ({ key: problem.itemKey ?? 'Whole import', action: problem.code, tone: 'critical', kind: 'rejected' })),
      canApply: false,
    };
  }
  const { counts } = result.manifest;
  const parts = [`${counts.created} new`, `${counts.updated} updated`, `${counts.unchanged} unchanged`, `${counts.conflicts} conflicts`];
  return {
    headline: result.noop ? 'Already imported. Applying would change nothing.' : `${counts.items} items ready to import`,
    detail: parts.join(' · '),
    rows: result.manifest.records.map((record) => ({ key: record.itemKey, action: ACTION_TEXT[record.action], tone: ACTION_TONE[record.action], kind: ACTION_KIND[record.action] })),
    canApply: !result.noop,
  };
}

export const bundleFileName = (kind: BundleKind, createdAt: string): string =>
  `hq-design-${kind}-${createdAt.replace(/[^0-9]/gu, '').slice(0, 14)}.json`;

// ---------------------------------------------------------------------------
// Pure view helpers
// ---------------------------------------------------------------------------

/** The step the surface shows: Done once an import has landed, Review while a plan exists, otherwise Choose. */
export function deriveStep(state: Pick<ImportsState, 'summary' | 'applied'>): ImportsStep {
  if (state.applied !== null) return 'done';
  return state.summary === null ? 'choose' : 'review';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `20 Oct 2026, 12:00 UTC`: locale- and zone-independent, for a tooltip beside a relative time. */
export function formatExactTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", then a date. A clock skewed into the future reads as now. */
export function formatRelativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((nowMs - then) / 1000);
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const at = new Date(then);
  const sameYear = at.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}${sameYear ? '' : ` ${at.getUTCFullYear()}`}`;
}

/** "2 screens" when every item is a PNG, otherwise "4 items". */
export function describeItemCount(count: number, keys: readonly string[]): string {
  const screens = keys.length > 0 && keys.every((key) => key.toLowerCase().endsWith('.png'));
  const noun = screens ? 'screen' : 'item';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "2 new · 0 updated · 0 unchanged · 0 conflicts" */
export const describeCounts = (counts: AppliedImport['counts']): string =>
  `${counts.created} new · ${counts.updated} updated · ${counts.unchanged} unchanged · ${counts.conflicts} conflicts`;

/** Only the counts that are not zero, for a toast: "2 new", "1 new · 1 updated", or "Nothing changed". */
export function describeLanded(counts: AppliedImport['counts']): string {
  const parts = [
    counts.created > 0 ? `${counts.created} new` : '',
    counts.updated > 0 ? `${counts.updated} updated` : '',
    counts.unchanged > 0 ? `${counts.unchanged} unchanged` : '',
    counts.conflicts > 0 ? `${counts.conflicts} ${counts.conflicts === 1 ? 'conflict' : 'conflicts'}` : '',
  ].filter((part) => part !== '');
  return parts.length === 0 ? 'Nothing changed' : parts.join(' · ');
}

export interface ImportsController {
  getState(): ImportsState;
  subscribe(listener: () => void): () => void;
  /** Each outcome as it happens, once, so a toast is never missed or repeated when updates batch. */
  onOutcome(listener: (outcome: ImportsOutcome) => void): () => void;
  refresh(): Promise<void>;
  choose(): Promise<void>;
  apply(): Promise<void>;
  undo(id: ImportId): Promise<void>;
  resolve(recordId: RecordId, choice: ConflictChoice): Promise<void>;
  /** Re-reads what the store recorded after an unconfirmed outcome and says what it found. */
  check(): Promise<void>;
  /** Drops the current plan or the Done summary and returns to Choose. Never writes. */
  reset(): void;
  /** Dismisses the inline notice; the toast is the owner's to dismiss. */
  dismissOutcome(): void;
  setExportChoice(kind: BundleKind): void;
  setConfirmPrivate(value: boolean): void;
  exportNow(): Promise<Bundle | null>;
}

/** What was in flight when an outcome could not be confirmed, so Check knows what to look for. */
type Unconfirmed =
  | { readonly action: 'apply'; readonly importId: ImportId; readonly plan: ImportPlan }
  | { readonly action: 'undo'; readonly importId: ImportId }
  | { readonly action: 'resolve'; readonly recordId: RecordId };

/** The store said no and wrote nothing. Anything else thrown during a write leaves the result unknown. */
const isDefiniteFailure = (error: unknown): boolean => error instanceof StorageConflictError || error instanceof StoredSchemaError;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'Unexpected failure');

export function createImportsController(deps: ImportDeps, project: ProjectId, capabilities: ImportsCapabilities = {}, options: ImportsControllerOptions = {}): ImportsController {
  let state: ImportsState = {
    status: 'idle', summary: null, message: null, history: [], conflicts: [],
    exportChoice: 'backup', confirmPrivate: false, lastExport: null,
    canPick: capabilities.pickSource !== undefined, canSave: capabilities.saveBundle !== undefined,
    busyAction: null, busyId: null, applied: null, outcome: null,
  };
  let plan: ImportPlan | null = null;
  let unconfirmed: Unconfirmed | null = null;
  let sequence = 0;
  const minBusyMs = options.minBusyMs ?? 0;
  const listeners = new Set<() => void>();
  const outcomeListeners = new Set<(outcome: ImportsOutcome) => void>();
  const set = (patch: Partial<ImportsState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const idle = { busyAction: null, busyId: null } as const;
  const begin = (action: BusyAction, id: string | null = null, patch: Partial<ImportsState> = {}): number => {
    set({ ...patch, status: 'busy', busyAction: action, busyId: id, outcome: null });
    return Date.now();
  };
  const hold = async (startedAt: number): Promise<void> => {
    const remaining = minBusyMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise<void>((resolve) => { setTimeout(resolve, remaining); });
  };
  const publish = (next: Omit<ImportsOutcome, 'seq'>): void => {
    sequence += 1;
    const outcome: ImportsOutcome = { ...next, seq: sequence };
    set({ outcome });
    for (const listener of outcomeListeners) listener(outcome);
  };

  /** A failed read or a definite refusal says nothing was written; a failed write of unknown result offers Check. */
  const fail = (error: unknown, where: OutcomeWhere, titles: { readonly failed: string; readonly unknown: string }, write: Unconfirmed | null = null): void => {
    const text = errorText(error);
    set({ status: 'error', message: text, ...idle });
    if (write !== null && !isDefiniteFailure(error)) {
      unconfirmed = write;
      publish({ tone: 'unknown', where, title: titles.unknown, detail: `${text}. HQ could not confirm whether the change was written.`, checkable: true,
        ...(write.action === 'resolve' ? {} : { importId: write.importId }) });
    } else {
      unconfirmed = null;
      publish({ tone: 'danger', where, title: titles.failed, detail: `${text}. Nothing was changed.` });
    }
  };
  /** Reading the history failed; what was just written is unaffected, so the surface keeps its step and says so in place. */
  const historyFailed = (error: unknown): void => {
    const text = errorText(error);
    set({ message: text });
    publish({ tone: 'danger', where: 'history', title: "Couldn't load the import history", detail: `${text}. Nothing was changed.` });
  };

  async function refresh(): Promise<void> {
    const [history, conflicts] = await Promise.all([listImports(deps), listOpenConflicts(deps)]);
    set({
      history: history.filter((entry) => entry.manifest.projectId === project).map((entry) => ({
        importId: entry.manifest.importId, importedAt: entry.manifest.importedAt, undone: entry.undone,
        label: `${entry.manifest.counts.items} items · ${entry.manifest.counts.created} new · ${entry.manifest.counts.updated} updated · ${entry.manifest.counts.conflicts} conflicts`,
      })),
      conflicts: conflicts.map((conflict) => ({ recordId: conflict.recordId, itemKey: conflict.itemKey, label: `${conflict.incoming.title} changed at its source after you edited it` })),
    });
  }
  const refreshQuietly = async (): Promise<void> => {
    try { await refresh(); } catch (error) { historyFailed(error); }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onOutcome(listener) {
      outcomeListeners.add(listener);
      return () => outcomeListeners.delete(listener);
    },
    refresh: refreshQuietly,
    async choose() {
      if (capabilities.pickSource === undefined) { set({ message: 'File selection is unavailable in this build.' }); return; }
      const startedAt = begin('choose', null, { message: null });
      try {
        const source = await capabilities.pickSource();
        if (source === null) { set({ status: 'idle', ...idle }); return; }
        const result = await planImport(deps, { projectId: project, source });
        await hold(startedAt);
        plan = result.ok ? result : null;
        set({ status: result.ok ? 'planned' : 'rejected', summary: summarizePlan(result), applied: null, ...idle });
        if (!result.ok) publish({ tone: 'danger', where: 'review', title: "Couldn't import these files", detail: describeRejection(result) });
      } catch (error) { fail(error, 'choose', { failed: "Couldn't read the files", unknown: "Couldn't read the files" }); }
    },
    async apply() {
      if (plan === null || plan.noop) return;
      const current = plan;
      plan = null;
      const importId = current.manifest.importId;
      const startedAt = begin('apply', importId);
      try {
        await applyImport(deps, current);
        await hold(startedAt);
      } catch (error) {
        fail(error, 'review', { failed: "Couldn't apply the import", unknown: 'Import result unknown' }, { action: 'apply', importId, plan: current });
        // A definite refusal wrote nothing, so the same plan can be reviewed and applied again.
        if (unconfirmed === null) { plan = current; set({ status: 'planned' }); }
        return;
      }
      const summary = summarizePlan(current);
      const { counts } = current.manifest;
      const landed = summary.rows.filter((row) => row.kind === 'new' || row.kind === 'update');
      set({
        status: 'applied', message: 'Import applied.', summary: { ...summary, canApply: false }, ...idle,
        applied: { importId, importedAt: current.manifest.importedAt, counts, rows: summary.rows },
      });
      publish({
        tone: 'success', where: 'done', importId, undoable: true,
        title: landed.length === 0 ? 'Import applied' : `Imported ${describeItemCount(landed.length, landed.map((row) => row.key))}`,
        detail: describeLanded(counts),
      });
      await refreshQuietly();
    },
    async undo(id) {
      const startedAt = begin('undo', id);
      try {
        const result = await undoImport(deps, id);
        await hold(startedAt);
        if (!result.ok) {
          set({ status: 'rejected', message: describeRejection(result), ...idle });
          publish({ tone: 'danger', where: 'history', title: "Couldn't undo the import", detail: describeRejection(result) });
          return;
        }
        const { tombstoned, reverted, retained } = result.undo;
        const message = `Undo removed ${tombstoned.length}, restored ${reverted.length}, kept ${retained.length} edited or newer records.`;
        set({ status: 'idle', message, ...idle });
        publish({ tone: 'success', where: 'history', title: 'Undid the import', detail: message, importId: id });
        await refreshQuietly();
      } catch (error) { fail(error, 'history', { failed: "Couldn't undo the import", unknown: 'Undo result unknown' }, { action: 'undo', importId: id }); }
    },
    async resolve(recordId, choice) {
      const startedAt = begin('resolve', recordId);
      try {
        await resolveConflict(deps, recordId, choice);
        await hold(startedAt);
        const message = choice === 'keep-current' ? 'Kept your version.' : 'Took the incoming version.';
        set({ status: 'idle', message, ...idle });
        publish({ tone: 'success', where: 'conflicts', title: message, detail: 'The conflict is resolved. Both versions stay in the record history.' });
        await refreshQuietly();
      } catch (error) { fail(error, 'conflicts', { failed: "Couldn't resolve the conflict", unknown: 'Conflict result unknown' }, { action: 'resolve', recordId }); }
    },
    async check() {
      const target = unconfirmed;
      if (target === null) { await refreshQuietly(); return; }
      begin('check');
      try {
        await refresh();
        const history = state.history;
        if (target.action === 'apply') {
          const landed = history.some((entry) => entry.importId === target.importId);
          if (landed) {
            const summary = summarizePlan(target.plan);
            unconfirmed = null;
            set({
              status: 'applied', summary: { ...summary, canApply: false }, ...idle,
              applied: { importId: target.importId, importedAt: target.plan.manifest.importedAt, counts: target.plan.manifest.counts, rows: summary.rows },
            });
            publish({ tone: 'success', where: 'done', title: 'The import had landed', detail: 'HQ found it in the history. Nothing needs repeating.', importId: target.importId, undoable: true });
          } else {
            unconfirmed = null;
            plan = target.plan;
            set({ status: 'planned', ...idle });
            publish({ tone: 'danger', where: 'review', title: 'The import was not applied', detail: 'HQ found no record of it and nothing was written. The preview is still here: apply it again when you are ready.' });
          }
        } else if (target.action === 'undo') {
          const undone = history.find((entry) => entry.importId === target.importId)?.undone === true;
          unconfirmed = null;
          set({ status: 'idle', ...idle });
          publish(undone
            ? { tone: 'success', where: 'history', title: 'The undo had landed', detail: 'HQ found the import marked as undone.', importId: target.importId }
            : { tone: 'danger', where: 'history', title: 'The import was not undone', detail: 'HQ found it still in place. Undo it again when you are ready.', importId: target.importId });
        } else {
          const open = state.conflicts.some((conflict) => conflict.recordId === target.recordId);
          unconfirmed = null;
          set({ status: 'idle', ...idle });
          publish(open
            ? { tone: 'danger', where: 'conflicts', title: 'The conflict is still open', detail: 'HQ found nothing written. Choose again when you are ready.' }
            : { tone: 'success', where: 'conflicts', title: 'The conflict was resolved', detail: 'HQ found it closed. Nothing needs repeating.' });
        }
      } catch (error) {
        set({ status: 'error', ...idle });
        publish({ tone: 'unknown', where: 'history', title: 'Still could not confirm', detail: `${errorText(error)}. The result is still unknown.`, checkable: true,
          ...(target.action === 'resolve' ? {} : { importId: target.importId }) });
      }
    },
    reset() {
      if (state.status === 'busy') return;
      plan = null;
      unconfirmed = null;
      set({ status: 'idle', summary: null, applied: null, outcome: null, ...idle });
    },
    dismissOutcome() { set({ outcome: null }); },
    setExportChoice(kind) { set({ exportChoice: kind, confirmPrivate: false }); },
    setConfirmPrivate(value) { set({ confirmPrivate: value }); },
    async exportNow() {
      const kind = state.exportChoice;
      if (kind === 'draft-backup' && !state.confirmPrivate) {
        set({ message: 'Confirm that the draft backup stays private.' });
        publish({ tone: 'info', where: 'export', title: 'Confirm the private draft backup', detail: 'Tick the box to say this file stays private, then create it.' });
        return null;
      }
      const startedAt = begin('export');
      set({ message: null });
      try {
        const bundle = kind === 'draft-backup'
          ? await createDraftBackup(deps, { confirmPrivate: true })
          : await createBundle(deps, { kind });
        const bytes = serializeBundle(bundle);
        const saved = capabilities.saveBundle === undefined ? null : await capabilities.saveBundle(bytes, bundleFileName(kind, bundle.createdAt), kind);
        await hold(startedAt);
        set({
          status: 'idle', ...idle, lastExport: { kind, digest: bundle.digest, bytes: bytes.byteLength, saved, coverage: bundle.coverage },
          message: saved === null ? 'Bundle prepared. Saving to disk is unavailable in this build.' : saved ? 'Bundle saved.' : 'Save cancelled.',
        });
        publish(saved === null
          ? { tone: 'info', where: 'export', title: 'Bundle prepared', detail: 'Saving to disk is unavailable in this build, so nothing was written.' }
          : saved
            ? { tone: 'success', where: 'export', title: 'Bundle saved', detail: 'The file was written where you chose.' }
            : { tone: 'info', where: 'export', title: 'Save cancelled', detail: 'The bundle was prepared but not written.' });
        return bundle;
      } catch (error) { fail(error, 'export', { failed: "Couldn't prepare the bundle", unknown: "Couldn't prepare the bundle" }); return null; }
    },
  };
}
