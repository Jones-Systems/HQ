import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useToast } from '@hq/ui';
import type { ReferenceId } from '../../../references/src/contract.ts';
import { sourceLabel, type ReferenceTasteSubject } from '../../../references/ui/view-model.ts';
import type { RevealedReference } from '../../../references/ui/ReferenceGrid.tsx';
import type { ReferencesEnvironment, ScreenshotDetails, ScreenshotImportResult } from './env.ts';
import { readThumbnail, type SelectedImageFile } from './images.ts';
import {
  currentItem, defaultTitle, EMPTY_QUEUE, nameList, newQueueItem, outcomeOf, queueReducer, queueSettledCleanly, splitDropped,
  type ItemOutcome, type QueueItem, type QueueState,
} from './queue.ts';

/** What the form hands over for the item it is filling in. */
export interface ImportFields {
  readonly title: string;
  readonly source: ScreenshotDetails['source'];
  /** ISO time, only when the owner edited it; otherwise the file's modification date is used. */
  readonly capturedAt?: string;
}

export interface ScreenshotImporter {
  readonly items: readonly QueueItem[];
  /** The item the form is filling in. */
  readonly current: QueueItem | undefined;
  readonly busy: boolean;
  /** An unconfirmed save pauses importing until the saved library has been read again. */
  readonly needsReload: boolean;
  readonly revealed: RevealedReference | null;
  readonly addFiles: (files: readonly SelectedImageFile[]) => void;
  readonly remove: (id: string) => void;
  readonly retry: (id: string) => void;
  readonly clear: () => void;
  /** Imports the current item; with `applyToRest`, then every other waiting item with the same source. */
  readonly run: (fields: ImportFields, applyToRest: boolean) => Promise<void>;
  readonly reload: () => void;
}

export interface ScreenshotImporterOptions {
  /** "Rate taste" on a saved toast. Omit and the toast offers no such action. */
  readonly onSendToTaste?: (subject: ReferenceTasteSubject) => void;
}

const BATCH_TOAST = 'design-references-import';
const SETTLED_CLEAR_MS = 2400;

async function tasteSubject(env: ReferencesEnvironment, id: ReferenceId): Promise<ReferenceTasteSubject | null> {
  const record = env.library.state.references[id];
  if (!record) return null;
  const asset = record.asset;
  const imageUrl = asset === null ? null : await (env.previewImage?.(asset) ?? Promise.resolve(env.previewUrl(asset.digest)));
  return { id, title: record.title, detail: sourceLabel(record), imageUrl: imageUrl ?? null };
}

/**
 * Owns the import queue: what is waiting, what is importing, and how each image ended. The form (in
 * `ScreenshotImport`) reads and drives it. Outcomes are announced through toasts; an unconfirmed save pauses importing.
 */
export function useScreenshotImporter(env: ReferencesEnvironment, options: ScreenshotImporterOptions = {}): ScreenshotImporter {
  const toast = useToast();
  const [state, dispatch] = useReducer(queueReducer, EMPTY_QUEUE);
  const latest = useRef<QueueState>(state);
  latest.current = state;
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [revealed, setRevealed] = useState<RevealedReference | null>(null);
  const running = useRef(false);
  const paused = useRef(false);
  const sequence = useRef(0);
  const onSendToTaste = options.onSendToTaste;

  const setPaused = (value: boolean) => { paused.current = value; setNeedsReload(value); };

  // Thumbnails are made one at a time, in the order the files were added.
  useEffect(() => {
    const next = state.items.find((item) => item.thumbnail === undefined);
    if (!next) return;
    let active = true;
    void readThumbnail(next.file).then((url) => { if (active) dispatch({ type: 'thumbnail', id: next.id, url }); });
    return () => { active = false; };
  }, [state.items]);

  // A list that finished cleanly tidies itself away; one with a problem stays until the owner clears it.
  useEffect(() => {
    if (busy || !queueSettledCleanly(state.items)) return;
    const timer = window.setTimeout(() => dispatch({ type: 'clear' }), SETTLED_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [busy, state.items]);

  const reload = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void env.library.reload()
      .then(() => {
        setPaused(false);
        toast.info('Saved library reloaded', { description: 'Check for your screenshot before importing again.' });
      })
      .catch(() => { toast.error("Couldn't reload the saved library", { description: 'Importing stays paused.' }); })
      .finally(() => { running.current = false; setBusy(false); });
  }, [env, toast]);

  const sendSaved = useCallback(async (ids: readonly ReferenceId[]) => {
    if (!onSendToTaste) return;
    for (const id of ids) {
      const subject = await tasteSubject(env, id);
      if (subject) onSendToTaste(subject);
    }
  }, [env, onSendToTaste]);

  const addFiles = useCallback((files: readonly SelectedImageFile[]) => {
    const { accepted, rejected } = splitDropped(files);
    if (rejected.length > 0) {
      toast.warning(rejected.length === 1 ? 'Skipped 1 file' : `Skipped ${rejected.length} files`,
        { description: `${nameList(rejected.map((file) => file.name))}: only PNG, JPEG and WebP images can be imported.` });
    }
    if (accepted.length === 0) return;
    if (paused.current) {
      toast.warning('Importing is paused', { description: 'Reload the saved library before adding more screenshots.' });
      return;
    }
    dispatch({ type: 'add', items: accepted.map(newQueueItem) });
  }, [toast]);

  const run = useCallback(async (fields: ImportFields, applyToRest: boolean) => {
    if (running.current || paused.current) return;
    const first = currentItem(latest.current);
    if (!first) return;
    const batch = applyToRest
      ? [first.id, ...latest.current.items.filter((item) => item.status === 'waiting' && item.id !== first.id).map((item) => item.id)]
      : [first.id];
    running.current = true;
    setBusy(true);
    const saved: { readonly id: ReferenceId; readonly title: string }[] = [];
    let kept = 0;
    let failed = 0;
    let firstProblem: string | null = null;
    let unconfirmed: ItemOutcome | null = null;
    let attempted = 0;
    try {
      for (const id of batch) {
        const item = latest.current.items.find((candidate) => candidate.id === id);
        if (!item || (item.status !== 'waiting' && item.status !== 'failed')) continue;
        attempted += 1;
        dispatch({ type: 'status', id, status: 'importing', message: null });
        if (batch.length > 1) toast.show({ id: BATCH_TOAST, tone: 'loading', title: `Importing ${attempted} of ${batch.length}`, meta: item.name });
        const lead = id === first.id;
        const title = lead ? fields.title.trim() : defaultTitle(item.name) || 'Untitled screenshot';
        const details: ScreenshotDetails = { title, source: fields.source, ...(lead && fields.capturedAt !== undefined ? { capturedAt: fields.capturedAt } : {}) };
        let result: ScreenshotImportResult | 'threw';
        try { result = await env.importScreenshot(item.file, details); } catch { result = 'threw'; }
        const outcome = outcomeOf(result);
        dispatch({ type: 'status', id, status: outcome.status, message: outcome.message, referenceId: outcome.referenceId, title });
        if (outcome.status === 'saved' && outcome.referenceId) saved.push({ id: outcome.referenceId, title });
        else if (outcome.status === 'kept-existing') kept += 1;
        else if (outcome.status === 'failed') { failed += 1; firstProblem ??= outcome.message; }
        if (batch.length === 1) announceOne(outcome, title);
        if (outcome.status === 'unknown') { unconfirmed = outcome; break; }
      }
    } finally {
      dispatch({ type: 'advance' });
      running.current = false;
      setBusy(false);
    }
    if (unconfirmed) setPaused(true);
    const last = saved.at(-1);
    if (last) { sequence.current += 1; setRevealed({ id: last.id, nonce: sequence.current }); }
    if (batch.length > 1) announceBatch(attempted, saved.map((item) => item.id), kept, failed, firstProblem, unconfirmed);

    function announceOne(outcome: ItemOutcome, title: string) {
      switch (outcome.status) {
        case 'saved':
          toast.success(`Saved “${title}”`, {
            ...(outcome.message ? { description: outcome.message } : {}),
            ...(onSendToTaste && outcome.referenceId ? { action: { label: 'Rate taste', onAction: () => { void sendSaved([outcome.referenceId!]); } } } : {}),
          });
          break;
        case 'kept-existing': toast.info(outcome.message ?? 'This screenshot was kept as it was.'); break;
        case 'failed': toast.error(`Couldn't import “${title}”`, { description: outcome.message ?? undefined, meta: 'Nothing was saved' }); break;
        case 'unknown':
          toast.unknown('Save result unknown', { description: outcome.message ?? undefined, action: { label: 'Check', onAction: reload } });
          break;
      }
    }

    function announceBatch(total: number, ids: readonly ReferenceId[], keptCount: number, failedCount: number, problem: string | null, stopped: ItemOutcome | null) {
      const noun = (count: number) => count === 1 ? '1 screenshot' : `${count} screenshots`;
      if (stopped) {
        toast.dismiss(BATCH_TOAST);
        toast.unknown('Save result unknown', {
          description: `${stopped.message ?? ''} ${ids.length > 0 ? `${noun(ids.length)} saved before it. ` : ''}The rest were not imported.`.trim(),
          action: { label: 'Check', onAction: reload },
        });
        return;
      }
      const rate = onSendToTaste && ids.length > 0 ? { action: { label: 'Rate taste', onAction: () => { void sendSaved(ids); } } } : {};
      if (failedCount === 0 && keptCount === 0) {
        toast.show({ id: BATCH_TOAST, tone: 'success', title: `Saved ${noun(ids.length)}`, ...rate });
        return;
      }
      const notes = [keptCount > 0 ? `${keptCount} kept existing` : null, failedCount > 0 ? `${failedCount} failed` : null].filter(Boolean).join(' · ');
      toast.show({
        id: BATCH_TOAST, tone: failedCount > 0 ? 'warning' : 'info', title: `Saved ${ids.length} of ${total}`,
        description: failedCount > 0 && problem ? problem : undefined, meta: notes, ...rate,
      });
    }
  }, [env, toast, onSendToTaste, reload, sendSaved]);

  return {
    items: state.items,
    current: currentItem(state),
    busy, needsReload, revealed, addFiles, reload, run,
    remove: useCallback((id: string) => { if (!running.current) dispatch({ type: 'remove', id }); }, []),
    retry: useCallback((id: string) => { if (!running.current && !paused.current) dispatch({ type: 'retry', id }); }, []),
    clear: useCallback(() => { if (!running.current) dispatch({ type: 'clear' }); }, []),
  };
}
