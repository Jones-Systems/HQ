import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, InlineNotice, Menu, Splitter, StateView, useListMotion, type ReferencePort } from '@hq/ui';
import {
  CHANNELS, DEFAULT_BRAND_ID, isDirty,
  type Channel, type Draft, type DraftFields, type SocialSession, type SocialSessionState, type SocialWorkspacePort, type WorkspaceSnapshot,
} from '../core';
import { ChannelBadge, EmptyState, SocialIcon, useSocialFrame } from '../ui';
import { changeDraft, errorText } from './actions';
import { DraftEditor } from './DraftEditor';
import { DEFAULT_FILTERS, NEW_DRAFT_KEY, contentDestination, dateLabel, filterDrafts, isLibraryFilters, shortDateLabel, type LibraryFilters } from './model';
import './library.css';

export interface LibraryProps {
  readonly projectId?: string;
  readonly references?: ReferencePort;
  readonly session: SocialSession;
  readonly state: SocialSessionState;
  readonly port: SocialWorkspacePort;
  readonly snapshot: WorkspaceSnapshot;
  /** The open draft ID, or `new`, from the destination. */
  readonly draftId?: string;
  readonly navigate: (destination: string) => void;
  readonly paused?: string;
}

const LIST_KEY = 'hq.social.library-panel.v1';
function readListSize(): { width: number; restored: number } {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LIST_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && 'width' in saved && 'restored' in saved
      && typeof saved.width === 'number' && Number.isFinite(saved.width) && saved.width >= 0 && saved.width <= 560
      && typeof saved.restored === 'number' && Number.isFinite(saved.restored) && saved.restored > 0 && saved.restored <= 560) {
      return { width: saved.width, restored: saved.restored };
    }
  } catch { /* A blocked preference store does not affect drafts. */ }
  return { width: 340, restored: 340 };
}

export function newDraftFields(snapshot: WorkspaceSnapshot, brand: string): DraftFields {
  const brandId = snapshot.brands.some((item) => item.id === brand) ? brand : DEFAULT_BRAND_ID;
  return { title: '', body: '', brand_id: brandId, channel: 'General', planned_date: '', archived: 0 };
}

const ARCHIVE_SEGMENTS: readonly { readonly value: LibraryFilters['archived']; readonly label: string }[] = [
  { value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' },
];

/** A filter shown as a compact chip: a native select, so keyboard and screen-reader behaviour come for free. */
function FilterChip({ label, value, active, onChange, children }: {
  readonly label: string; readonly value: string; readonly active: boolean; readonly onChange: (value: string) => void; readonly children: ReactNode;
}) {
  return (
    <label className="soc-chipfilter" data-active={active || undefined}>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
      <SocialIcon name="chevron-down" />
    </label>
  );
}

interface ListNotice { readonly tone: 'success' | 'danger'; readonly title: string; readonly text?: string; readonly undo?: () => void }

export function Library({ session, state, port, snapshot, draftId, navigate, paused, projectId, references }: LibraryProps) {
  const id = useId();
  const framed = useSocialFrame() !== null;
  const layout = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const dragWidth = useRef<number | null>(null);
  const restore = useRef<HTMLButtonElement>(null);
  const hide = useRef<HTMLButtonElement>(null);
  const [listSize, setListSize] = useState(readListSize);
  const collapsed = listSize.width === 0;
  const wasCollapsed = useRef(collapsed);
  useLayoutEffect(() => {
    layout.current?.style.setProperty('--soc-list-width', `${listSize.width}px`);
    const active = list.current?.ownerDocument.activeElement;
    if (collapsed && list.current?.contains(active ?? null)) restore.current?.focus();
    // The Show button unmounts as the list returns; focus follows to the Hide button that replaces it.
    else if (!collapsed && wasCollapsed.current && (!active || active === active.ownerDocument.body)) hide.current?.focus();
    wasCollapsed.current = collapsed;
    try { localStorage.setItem(LIST_KEY, JSON.stringify(listSize)); }
    catch { /* The current mount still remembers its layout. */ }
  }, [listSize, collapsed]);
  const finishListDrag = () => {
    const previous = dragWidth.current;
    dragWidth.current = null;
    if (previous !== null && previous > 0) setListSize(current => current.width === 0 ? { ...current, restored: previous } : current);
  };
  const toggleList = () => setListSize(current => ({ ...current, width: current.width === 0 ? current.restored : 0 }));
  const resizeList = (value: number) => setListSize(current => {
    const width = Math.max(0, Math.min(560, value));
    return { width, restored: width > 0 ? width : current.restored };
  });
  const stored = state.view.library;
  const filters: LibraryFilters = isLibraryFilters(stored) ? stored : DEFAULT_FILTERS;
  const setFilters = (patch: Partial<LibraryFilters>) => session.setView('library', { ...filters, ...patch });
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const [notice, setNotice] = useState<ListNotice | null>(null);
  const brandName = (brandId: string) => snapshot.brands.find((brand) => brand.id === brandId)?.name ?? 'Unknown brand';
  const drafts = filterDrafts(snapshot.content, filters);
  const draft = draftId && draftId !== NEW_DRAFT_KEY ? snapshot.content.find((item) => item.id === draftId) : undefined;
  const editor = draftId ? state.editors[draftId] : undefined;

  // Rows glide to their new place when a filter or a save reorders them; rows that arrive fade in.
  const rows = useListMotion<HTMLUListElement>(drafts.map((item) => item.id));
  // The first set of rows rises in with a stagger; later changes belong to the list motion above.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 900);
    return () => clearTimeout(timer);
  }, []);

  // Opening a destination opens (or returns to) its editor; an existing editor keeps its unsaved text. That includes a
  // `new` editor another page filled in, such as a draft started from a run result: it is never replaced here.
  useEffect(() => {
    if (!draftId || state.editors[draftId]) return;
    if (draftId === NEW_DRAFT_KEY) session.openEditor(NEW_DRAFT_KEY, null, newDraftFields(snapshot, filters.brand));
    else if (draft) session.openEditor(draftId, draft);
  }, [draftId, draft, session, snapshot, filters.brand, state.editors]);

  // A success note clears itself; a failure stays until it is dismissed.
  useEffect(() => {
    if (notice?.tone !== 'success') return undefined;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function setArchived(item: Draft, archived: 0 | 1, undoable = true) {
    const verb = archived ? 'archive' : 'restore';
    const result = await changeDraft(session, port, item, { archived });
    if (!result.ok) {
      setNotice({ tone: 'danger', title: `Could not ${verb} “${item.title}”.`, text: errorText(result.error) });
      return;
    }
    // Undo is one more explicit, versioned save of the record just stored.
    setNotice({ tone: 'success', title: `${archived ? 'Archived' : 'Restored'} “${item.title}”.`, ...(undoable ? { undo: () => void setArchived(result.draft, archived ? 0 : 1, false) } : {}) });
  }

  const open = (target: string) => navigate(contentDestination({ page: 'library', draftId: target }));
  const empty = snapshot.content.length === 0;
  const newDraft = (
    <Button variant="primary" size="sm" onClick={() => open(NEW_DRAFT_KEY)}><SocialIcon name="plus" />New draft</Button>
  );

  // Nothing yet and nothing open: one invitation, not a pair of empty panels.
  if (empty && !draftId) {
    return (
      <div className="sx-panel sx-panel--dashed soc-lib-empty">
        <EmptyState icon="library" title="No drafts yet" action={newDraft}>
          Start from a rough idea, or start one from a workbench result so its source stays attached. Drafts you write here are saved in the Social workspace.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="soc-lib" ref={layout} onPointerDownCapture={event => {
      if (event.button === 0 && (event.target as Element).getAttribute('role') === 'separator') dragWidth.current = listSize.width;
    }} onPointerUpCapture={finishListDrag} onPointerCancelCapture={finishListDrag}>
      <div className="soc-lib-grid" data-detail={draftId ? 'open' : 'list'} data-collapsed={collapsed || undefined}>
        <div className="soc-lib-listwrap">
          {/* With the list collapsed, the way back is the one control left in its column. */}
          {collapsed && (
            <Button className="soc-lib-toggle" ref={restore} size="sm" variant="ghost" aria-label="Show draft list" title="Show draft list"
              aria-expanded={false} aria-controls={`${id}-list`} onClick={toggleList}>
              <SocialIcon name="chevron-right" />
            </Button>
          )}
          <section className="soc-lib-list" ref={list} id={`${id}-list`} hidden={collapsed} aria-labelledby={`${id}-heading`}>
            <header className="soc-lib-head">
              {/* Inside the Social frame the page header owns the title and the one primary New draft. */}
              <h2 id={`${id}-heading`}>{framed ? 'Drafts' : 'Library'}</h2>
              <span className="hq-meta">{drafts.length === snapshot.content.length ? `${drafts.length}` : `${drafts.length} of ${snapshot.content.length}`}</span>
              {!framed && <span className="soc-lib-head-action">{newDraft}</span>}
              <Button className="soc-lib-toggle" ref={hide} size="sm" variant="ghost" aria-label="Hide draft list" title="Hide draft list"
                aria-expanded aria-controls={`${id}-list`} onClick={toggleList}>
                <SocialIcon name="chevron-left" />
              </Button>
            </header>
            <div className="soc-lib-filters" role="group" aria-label="Filter drafts">
              <label className="soc-lib-search">
                <SocialIcon name="search" />
                <input type="search" aria-label="Search" placeholder="Search drafts" value={filters.query} onChange={(event) => setFilters({ query: event.target.value })} />
              </label>
              <div className="sx-segmented" role="group" aria-label="Show">
                {ARCHIVE_SEGMENTS.map((segment) => (
                  <button key={segment.value} type="button" aria-pressed={filters.archived === segment.value} onClick={() => setFilters({ archived: segment.value })}>{segment.label}</button>
                ))}
              </div>
              <div className="soc-lib-chips">
                <FilterChip label="Brand" value={filters.brand} active={filters.brand !== 'all'} onChange={(brand) => setFilters({ brand })}>
                  <option value="all">All brands</option>
                  {snapshot.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </FilterChip>
                <FilterChip label="Channel" value={filters.channel} active={filters.channel !== 'all'} onChange={(channel) => setFilters({ channel: channel as 'all' | Channel })}>
                  <option value="all">All channels</option>
                  {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                </FilterChip>
                <FilterChip label="Planned date" value={filters.planned} active={filters.planned !== 'all'} onChange={(planned) => setFilters({ planned: planned as LibraryFilters['planned'] })}>
                  <option value="all">Any date</option>
                  <option value="planned">Planned</option>
                  <option value="unplanned">No date yet</option>
                </FilterChip>
                {filtered && <button type="button" className="soc-lib-clear" onClick={() => session.setView('library', DEFAULT_FILTERS)}>Clear</button>}
              </div>
            </div>
            {notice && (
              <InlineNotice
                variant="bar" tone={notice.tone} title={notice.title}
                actions={notice.undo ? [{ label: 'Undo', onAction: notice.undo }] : undefined}
                onDismiss={() => setNotice(null)}
              >{notice.text}</InlineNotice>
            )}
            {empty ? (
              <EmptyState icon="library" title="No drafts yet">Drafts you write here are saved in the Social workspace.</EmptyState>
            ) : drafts.length === 0 ? (
              <EmptyState icon="search" title="No drafts match these filters" action={<Button size="sm" variant="secondary" onClick={() => session.setView('library', DEFAULT_FILTERS)}>Clear filters</Button>} />
            ) : (
              <ul className={entered ? 'soc-lib-rows' : 'soc-lib-rows hq-stagger'} aria-label="Drafts" ref={rows}>
                {drafts.map((item) => {
                  const open_ = state.editors[item.id];
                  const unsaved = Boolean(open_ && isDirty(open_));
                  const selected = item.id === draftId;
                  return (
                    <li key={item.id} className="soc-lib-row" data-hq-motion-key={item.id} data-selected={selected || undefined}>
                      <button type="button" className="soc-lib-row-main" aria-current={selected ? 'true' : undefined} onClick={() => open(item.id)}>
                        <strong className="soc-lib-title">{item.title}</strong>
                        <ChannelBadge channel={item.channel} className="soc-lib-badge" />
                        <span className="soc-lib-meta">
                          <span className="soc-lib-brand">{brandName(item.brand_id)}</span>
                          {item.planned_date
                            ? <span className="soc-lib-date" title={`Planned ${dateLabel(item.planned_date)}`}><SocialIcon name="calendar" /><span className="hq-sr-only">Planned </span>{shortDateLabel(item.planned_date)}</span>
                            : <span className="soc-lib-nodate">No date yet</span>}
                        </span>
                      </button>
                      <span className="soc-lib-side">
                        {unsaved && <span className="soc-lib-dot" title="Unsaved changes"><span className="hq-sr-only">Unsaved changes</span></span>}
                        {item.archived === 1 && <span className="sx-tag">Archived</span>}
                        <Menu
                          trigger="…" triggerLabel={`Actions for ${item.title}`} variant="ghost" size="sm" align="end"
                          items={[
                            { id: 'open', label: 'Open', onSelect: () => open(item.id) },
                            item.archived === 1
                              ? { id: 'restore', label: 'Restore', onSelect: () => void setArchived(item, 0), disabled: Boolean(paused) }
                              : { id: 'archive', label: 'Archive', onSelect: () => void setArchived(item, 1), disabled: Boolean(paused) },
                          ]}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
        <Splitter label="Resize draft list" value={listSize.width} min={0} max={560} onResize={resizeList} onToggle={toggleList} />
        <div className="soc-lib-pane">
          {draftId && editor ? (
            <DraftEditor
              key={draftId} projectId={projectId} references={references} session={session} port={port} editorKey={draftId} editor={editor}
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
              // The editor stays open in the session, so unsaved text is kept; the list marks it with a dot.
              onBack={() => navigate(contentDestination({ page: 'library' }))}
              onOpenDraft={open}
            />
          ) : draftId && !editor && draftId !== NEW_DRAFT_KEY && !draft ? (
            <StateView state="unavailable" title="This draft is not in the workspace" description="It may have been removed elsewhere." action={{ label: 'Back to the library', onAction: () => navigate('library') }} />
          ) : (
            <div className="sx-panel sx-panel--dashed soc-lib-select">
              <EmptyState icon="library" title="Select a draft">Open a draft from the list, or start a new one.</EmptyState>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
