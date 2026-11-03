import { useEffect, useRef, useState } from 'react';
import type { ReferenceEnvelope } from '@hq/contracts';
import { Button, InlineNotice } from '@hq/ui';
import { DEFAULT_BRAND_ID, isDirty, workspaceSnapshot, type DraftEditor, type RunRecord } from '../core';
import { NEW_DRAFT_KEY, contentDestination, isLibraryFilters } from '../content/model';
import { SocialIcon } from '../ui';
import { canSaveCitation, draftFromResult, runCitation } from './citation';
import { useWorkbench } from './env';
import type { ResultSummary } from './results';

/** Earlier versions kept a Start draft editor per run under this key; Overview still maps such a key to its receipt. */
const LEGACY_PREFIX = 'workbench-run:';

/** The run whose receipt held a legacy Start draft editor, or null for any other editor key. */
export function startDraftRunId(key: string): string | null {
  return key.startsWith(LEGACY_PREFIX) ? key.slice(LEGACY_PREFIX.length) : null;
}

function citesRun(links: readonly ReferenceEnvelope[] | undefined, runId: string): boolean {
  return links?.some((link) => link.kind === 'run' && link.entityId === runId) ?? false;
}

/**
 * Whether replacing this editor could lose text. Blank text is safe to replace; so is a saved draft with no edits.
 * Anything mid-save, conflicted or failed is never replaced, because its outcome is still being settled.
 */
function holdsUnsavedText(editor: DraftEditor): boolean {
  if (editor.status !== 'editing') return true;
  if (editor.base) return isDirty(editor);
  return editor.fields.title.trim() !== '' || editor.fields.body.trim() !== '';
}

/**
 * Start draft from a result (RR-6): opens the Library's new-draft composer, prefilled with the result text and its
 * run citation. The draft stays unsaved until the user saves it there, and nothing here saves, plans or runs
 * anything. Text already in that composer is never overwritten: the user chooses to open it or replace it.
 *
 * The receipt's state is read from data, not remembered: the 'new' editor citing this run means a draft was started,
 * and a stored draft citing it means one was saved. That needs the service to store links (`hq-references-v1`);
 * without it the receipt keeps offering Start draft and says the citation will not be saved.
 */
export function StartDraft({ run, toolName, summary }: { readonly run: RunRecord; readonly toolName: string; readonly summary: ResultSummary }) {
  const { session, state, context, navigate } = useWorkbench();
  const snapshot = workspaceSnapshot(state.workspace);
  const features = snapshot?.features ?? [];
  const editor = state.editors[NEW_DRAFT_KEY];
  const [confirming, setConfirming] = useState(false);
  const notice = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const started = editor !== undefined && editor.base === null && citesRun(editor.fields.links, run.id);
  const stored = snapshot?.content.find((draft) => citesRun(draft.links, run.id));
  const blocked = confirming && editor !== undefined && holdsUnsavedText(editor);

  useEffect(() => {
    // Focus moves to what just appeared, so the choice is reachable without hunting for it.
    if (blocked) notice.current?.querySelector('button')?.focus();
  }, [blocked]);

  const library = (draftId: string) => navigate(contentDestination({ page: 'library', draftId }));

  const fields = () => {
    const filters = state.view.library;
    const brand = isLibraryFilters(filters) && snapshot?.brands.some((item) => item.id === filters.brand) ? filters.brand : DEFAULT_BRAND_ID;
    return { ...draftFromResult(run, toolName, summary, runCitation(run, toolName, context.id), features), brand_id: brand };
  };

  const open = () => {
    const existing = session.getState().editors[NEW_DRAFT_KEY];
    if (existing && holdsUnsavedText(existing)) {
      setConfirming(true);
      return;
    }
    // A blank or clean editor under this key would be kept by openEditor, so it is closed first.
    if (existing) session.closeEditor(NEW_DRAFT_KEY);
    session.openEditor(NEW_DRAFT_KEY, null, fields());
    library(NEW_DRAFT_KEY);
  };

  const replace = () => {
    setConfirming(false);
    session.closeEditor(NEW_DRAFT_KEY);
    session.openEditor(NEW_DRAFT_KEY, null, fields());
    library(NEW_DRAFT_KEY);
  };

  return (
    <div className="sw-start">
      {started ? (
        <p className="sw-start-status">
          <SocialIcon name="library" /><b>Draft started</b> · <button type="button" className="sw-link" onClick={() => library(NEW_DRAFT_KEY)}>Open in Library</button>
        </p>
      ) : (
        <Button ref={trigger} variant="secondary" onClick={open}><SocialIcon name="sparkle" />{stored ? 'Start another draft' : 'Start draft'}</Button>
      )}
      {stored && (
        <p className="sw-start-status">
          <SocialIcon name="check" /><b>Draft saved</b> · <button type="button" className="sw-link" aria-label="Open saved draft" onClick={() => library(stored.id)}>Open</button>
        </p>
      )}
      {blocked && (
        <div ref={notice}>
          <InlineNotice
            tone="warning" title="The Library's new draft has unsaved text" live="polite"
            actions={[{ label: 'Open the unsaved draft', onAction: () => { setConfirming(false); library(NEW_DRAFT_KEY); } }, { label: 'Replace it with this result', onAction: replace }]}
            onDismiss={() => { setConfirming(false); trigger.current?.focus(); }}
          >
            Starting a draft here would replace it. Nothing has changed.
          </InlineNotice>
        </div>
      )}
      <p className="sw-hint">
        {started ? 'Unsaved until you save it in the Library. Nothing is posted or planned.'
          : 'Opens the Library composer with this result and its run citation. Nothing is saved until you save it there.'}
        {!canSaveCitation(features) && ' This service does not store links yet (hq-references-v1), so the run citation is not saved with the draft.'}
      </p>
    </div>
  );
}
