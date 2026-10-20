import { useEffect, useId, useState } from 'react';
import { Button, Menu, StateView, StatusChip } from '@hq/ui';
import {
  CHANNELS, DEFAULT_BRAND_ID, isDirty,
  type Channel, type Draft, type DraftFields, type SocialSession, type SocialSessionState, type SocialWorkspacePort, type WorkspaceSnapshot,
} from '../core';
import { changeDraft, errorText } from './actions';
import { DraftEditor } from './DraftEditor';
import { DEFAULT_FILTERS, NEW_DRAFT_KEY, contentDestination, dateLabel, filterDrafts, isLibraryFilters, type LibraryFilters } from './model';

export interface LibraryProps {
  readonly session: SocialSession;
  readonly state: SocialSessionState;
  readonly port: SocialWorkspacePort;
  readonly snapshot: WorkspaceSnapshot;
  /** The open draft ID, or `new`, from the destination. */
  readonly draftId?: string;
  readonly navigate: (destination: string) => void;
  readonly paused?: string;
}

export function newDraftFields(snapshot: WorkspaceSnapshot, brand: string): DraftFields {
  const brandId = snapshot.brands.some((item) => item.id === brand) ? brand : DEFAULT_BRAND_ID;
  return { title: '', body: '', brand_id: brandId, channel: 'General', planned_date: '', archived: 0 };
}

export function Library({ session, state, port, snapshot, draftId, navigate, paused }: LibraryProps) {
  const id = useId();
  const stored = state.view.library;
  const filters: LibraryFilters = isLibraryFilters(stored) ? stored : DEFAULT_FILTERS;
  const setFilters = (patch: Partial<LibraryFilters>) => session.setView('library', { ...filters, ...patch });
  const [notice, setNotice] = useState<string | null>(null);
  const brandName = (brandId: string) => snapshot.brands.find((brand) => brand.id === brandId)?.name ?? 'Unknown brand';
  const drafts = filterDrafts(snapshot.content, filters);
  const draft = draftId && draftId !== NEW_DRAFT_KEY ? snapshot.content.find((item) => item.id === draftId) : undefined;
  const editor = draftId ? state.editors[draftId] : undefined;

  // Opening a destination opens (or returns to) its editor; an existing editor keeps its unsaved text.
  useEffect(() => {
    if (!draftId || state.editors[draftId]) return;
    if (draftId === NEW_DRAFT_KEY) session.openEditor(NEW_DRAFT_KEY, null, newDraftFields(snapshot, filters.brand));
    else if (draft) session.openEditor(draftId, draft);
  }, [draftId, draft, session, snapshot, filters.brand, state.editors]);

  async function setArchived(item: Draft, archived: 0 | 1) {
    const result = await changeDraft(session, port, item, { archived });
    setNotice(result.ok ? `${archived ? 'Archived' : 'Restored'} “${item.title}”.` : `Could not ${archived ? 'archive' : 'restore'} “${item.title}”. ${errorText(result.error)}`);
  }

  const open = (target: string) => navigate(contentDestination({ page: 'library', draftId: target }));
  const empty = snapshot.content.length === 0;

  return (
    <div className="soc-library">
      <section className="soc-list" aria-labelledby={`${id}-heading`}>
        <header className="soc-list-head">
          <h2 id={`${id}-heading`}>Library</h2>
          <Button variant="primary" size="sm" onClick={() => open(NEW_DRAFT_KEY)}>New draft</Button>
        </header>
        <div className="soc-filters" role="group" aria-label="Filter drafts">
          <label className="soc-field soc-field--wide">
            <span>Search</span>
            <input type="search" value={filters.query} onChange={(event) => setFilters({ query: event.target.value })} />
          </label>
          <label className="soc-field">
            <span>Brand</span>
            <select value={filters.brand} onChange={(event) => setFilters({ brand: event.target.value })}>
              <option value="all">All brands</option>
              {snapshot.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          <label className="soc-field">
            <span>Channel</span>
            <select value={filters.channel} onChange={(event) => setFilters({ channel: event.target.value as 'all' | Channel })}>
              <option value="all">All channels</option>
              {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
            </select>
          </label>
          <label className="soc-field">
            <span>Planned date</span>
            <select value={filters.planned} onChange={(event) => setFilters({ planned: event.target.value as LibraryFilters['planned'] })}>
              <option value="all">Any</option>
              <option value="planned">Has a planned date</option>
              <option value="unplanned">No date yet</option>
            </select>
          </label>
          <label className="soc-field">
            <span>Show</span>
            <select value={filters.archived} onChange={(event) => setFilters({ archived: event.target.value as LibraryFilters['archived'] })}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">Active and archived</option>
            </select>
          </label>
        </div>
        {notice && <p className="soc-note" role="status">{notice}</p>}
        {empty ? (
          <StateView state="empty" title="No drafts yet" description="Drafts you write here are saved in the Social workspace." action={{ label: 'New draft', onAction: () => open(NEW_DRAFT_KEY) }} />
        ) : drafts.length === 0 ? (
          <StateView state="empty" title="No drafts match these filters" action={{ label: 'Clear filters', onAction: () => session.setView('library', DEFAULT_FILTERS) }} />
        ) : (
          <ul className="soc-rows" aria-label="Drafts">
            {drafts.map((item) => {
              const open_ = state.editors[item.id];
              const unsaved = Boolean(open_ && isDirty(open_));
              return (
                <li key={item.id} className="soc-row" aria-current={item.id === draftId ? 'true' : undefined}>
                  <button type="button" className="soc-row-main" onClick={() => open(item.id)}>
                    <strong>{item.title}</strong>
                    <span className="hq-meta">
                      {brandName(item.brand_id)} · {item.channel} · {item.planned_date ? `Planned ${dateLabel(item.planned_date)}` : 'No date yet'}
                    </span>
                  </button>
                  {unsaved && <StatusChip tone="info" label="Unsaved changes" />}
                  {item.archived === 1 && <StatusChip tone="neutral" label="Archived" />}
                  <Menu
                    trigger="…" triggerLabel={`Actions for ${item.title}`} variant="ghost" size="sm" align="end"
                    items={[
                      { id: 'open', label: 'Open', onSelect: () => open(item.id) },
                      item.archived === 1
                        ? { id: 'restore', label: 'Restore', onSelect: () => void setArchived(item, 0), disabled: Boolean(paused) }
                        : { id: 'archive', label: 'Archive', onSelect: () => void setArchived(item, 1), disabled: Boolean(paused) },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="soc-pane">
        {draftId && editor ? (
          <DraftEditor
            key={draftId} session={session} port={port} editorKey={draftId} editor={editor}
            brands={snapshot.brands} features={snapshot.features} paused={paused}
            onSaved={(savedId) => {
              // A new draft or a saved copy now rests on a different record; its clean editor
              // under this key is closed and the record reopens under its own ID.
              if (savedId !== draftId) {
                open(savedId);
                session.closeEditor(draftId);
              }
            }}
            onClose={() => {
              session.closeEditor(draftId);
              navigate(contentDestination({ page: 'library' }));
            }}
            onOpenDraft={open}
          />
        ) : draftId && !editor && draftId !== NEW_DRAFT_KEY && !draft ? (
          <StateView state="unavailable" title="This draft is not in the workspace" description="It may have been removed elsewhere." action={{ label: 'Back to the library', onAction: () => navigate('library') }} />
        ) : (
          <StateView state="empty" title="Select a draft" description="Open a draft from the list, or start a new one." />
        )}
      </div>
    </div>
  );
}
