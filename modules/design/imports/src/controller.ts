import type { ImportId, ImportSource, ProjectId, RecordId } from './contract.ts';
import { createBundle, createDraftBackup, serializeBundle, type Bundle, type BundleCoverage, type BundleKind } from './bundle.ts';
import {
  applyImport, listImports, listOpenConflicts, planImport, resolveConflict, undoImport,
  type ConflictChoice, type ImportDeps, type ImportPlan, type Rejection, type RejectionReason,
} from './importer.ts';

/**
 * Framework-free controller for the Imports surface. Root injects the
 * capabilities; a missing capability is shown as unavailable, never faked.
 */
export interface ImportsCapabilities {
  /** Desktop file/URL selection. Absent until root qualifies a picker. */
  readonly pickSource?: () => Promise<ImportSource | null>;
  /** Saves bundle bytes to an owner-chosen location. Absent until qualified. */
  readonly saveBundle?: (bytes: Uint8Array, suggestedName: string, kind: BundleKind) => Promise<boolean>;
}

export type Tone = 'neutral' | 'positive' | 'attention' | 'critical';

export interface PlanRow {
  readonly key: string;
  readonly action: string;
  readonly tone: Tone;
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
}

export const EXPORT_CHOICES: readonly { readonly kind: BundleKind; readonly label: string; readonly description: string }[] = [
  { kind: 'backup', label: 'Workspace backup', description: 'Everything editable in this workspace. Drafts and cache are not included.' },
  { kind: 'export', label: 'Publishable export', description: 'Shareable copy without drafts, with only the files your records use.' },
  { kind: 'draft-backup', label: 'Private draft backup', description: 'Only unsent drafts. Keep this file private.' },
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

export function describeRejection(rejection: Rejection): string {
  return `${REJECTION_TEXT[rejection.reason]} Nothing was written.`;
}

export function summarizePlan(result: ImportPlan | Rejection): PlanSummary {
  if (!result.ok) {
    return {
      headline: describeRejection(result),
      detail: result.problems.map((problem) => (problem.itemKey === undefined ? problem.code : `${problem.itemKey}: ${problem.code}`)).join(', '),
      rows: [], canApply: false,
    };
  }
  const { counts } = result.manifest;
  const parts = [`${counts.created} new`, `${counts.updated} updated`, `${counts.unchanged} unchanged`, `${counts.conflicts} conflicts`];
  return {
    headline: result.noop ? 'Already imported. Applying would change nothing.' : `${counts.items} items ready to import`,
    detail: parts.join(' · '),
    rows: result.manifest.records.map((record) => ({ key: record.itemKey, action: ACTION_TEXT[record.action], tone: ACTION_TONE[record.action] })),
    canApply: !result.noop,
  };
}

export const bundleFileName = (kind: BundleKind, createdAt: string): string =>
  `hq-design-${kind}-${createdAt.replace(/[^0-9]/gu, '').slice(0, 14)}.json`;

export interface ImportsController {
  getState(): ImportsState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  choose(): Promise<void>;
  apply(): Promise<void>;
  undo(id: ImportId): Promise<void>;
  resolve(recordId: RecordId, choice: ConflictChoice): Promise<void>;
  setExportChoice(kind: BundleKind): void;
  setConfirmPrivate(value: boolean): void;
  exportNow(): Promise<Bundle | null>;
}

export function createImportsController(deps: ImportDeps, project: ProjectId, capabilities: ImportsCapabilities = {}): ImportsController {
  let state: ImportsState = {
    status: 'idle', summary: null, message: null, history: [], conflicts: [],
    exportChoice: 'backup', confirmPrivate: false, lastExport: null,
    canPick: capabilities.pickSource !== undefined, canSave: capabilities.saveBundle !== undefined,
  };
  let plan: ImportPlan | null = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ImportsState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const fail = (error: unknown) => set({ status: 'error', message: error instanceof Error ? error.message : 'Unexpected failure' });

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

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: () => refresh().catch(fail),
    async choose() {
      if (capabilities.pickSource === undefined) { set({ message: 'File selection is unavailable in this build.' }); return; }
      set({ status: 'busy', message: null });
      try {
        const source = await capabilities.pickSource();
        if (source === null) { set({ status: 'idle' }); return; }
        const result = await planImport(deps, { projectId: project, source });
        plan = result.ok ? result : null;
        set({ status: result.ok ? 'planned' : 'rejected', summary: summarizePlan(result) });
      } catch (error) { fail(error); }
    },
    async apply() {
      if (plan === null || plan.noop) return;
      const current = plan;
      plan = null;
      set({ status: 'busy' });
      try {
        await applyImport(deps, current);
        set({ status: 'applied', message: 'Import applied.', summary: { ...summarizePlan(current), canApply: false } });
        await refresh();
      } catch (error) { fail(error); }
    },
    async undo(id) {
      set({ status: 'busy' });
      try {
        const result = await undoImport(deps, id);
        if (!result.ok) { set({ status: 'rejected', message: describeRejection(result) }); return; }
        const { tombstoned, reverted, retained } = result.undo;
        set({ status: 'idle', message: `Undo removed ${tombstoned.length}, restored ${reverted.length}, kept ${retained.length} edited or newer records.` });
        await refresh();
      } catch (error) { fail(error); }
    },
    async resolve(recordId, choice) {
      set({ status: 'busy' });
      try {
        await resolveConflict(deps, recordId, choice);
        set({ status: 'idle', message: choice === 'keep-current' ? 'Kept your version.' : 'Took the incoming version.' });
        await refresh();
      } catch (error) { fail(error); }
    },
    setExportChoice(kind) { set({ exportChoice: kind, confirmPrivate: false }); },
    setConfirmPrivate(value) { set({ confirmPrivate: value }); },
    async exportNow() {
      const kind = state.exportChoice;
      if (kind === 'draft-backup' && !state.confirmPrivate) { set({ message: 'Confirm that the draft backup stays private.' }); return null; }
      set({ status: 'busy', message: null });
      try {
        const bundle = kind === 'draft-backup'
          ? await createDraftBackup(deps, { confirmPrivate: true })
          : await createBundle(deps, { kind });
        const bytes = serializeBundle(bundle);
        const saved = capabilities.saveBundle === undefined ? null : await capabilities.saveBundle(bytes, bundleFileName(kind, bundle.createdAt), kind);
        set({
          status: 'idle', lastExport: { kind, digest: bundle.digest, bytes: bytes.byteLength, saved, coverage: bundle.coverage },
          message: saved === null ? 'Bundle prepared. Saving to disk is unavailable in this build.' : saved ? 'Bundle saved.' : 'Save cancelled.',
        });
        return bundle;
      } catch (error) { fail(error); return null; }
    },
  };
}
