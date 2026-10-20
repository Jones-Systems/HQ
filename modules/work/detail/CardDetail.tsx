import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { Button, IconButton, SaveIndicator, StateView, StatusChip } from '@hq/ui';
import {
  DEFAULT_SETTINGS, formatClock, HORIZONS, KINDS, MOTIVATIONS, plannerToday, PRIORITIES, STATUS_LABEL, STATUSES, LIMITS,
  type DateInput, type Horizon, type Item, type ItemKind, type ItemPatch, type Motivation, type Priority, type ReferenceInput,
  type StepInput, type WorkState, type WorkStore, type WriteOutcome,
} from '../core';
import { changeStatus, failureMessage, isTyping, reportWrite } from '../board/actions';
import type { Feedback } from '../board/feedback';
import { KindIcon } from '../board/parts';
import { Checklist } from './Checklist';
import { DateEditor } from './DateEditor';
import { sharedDetailState, useDetailState, type DetailState, type TextField } from './detail-state';
import { createEditor, fieldWords, NOTES_DEBOUNCE_MS } from './edits';
import { References } from './References';
import '../board/board.css';
import './detail.css';

export interface CardDetailProps {
  store: WorkStore;
  state: WorkState;
  feedback: Feedback;
  itemId: string;
  onClose(): void;
  now?: () => Date;
  /** Unsaved text and conflicts; defaults to one module-level state for the session. */
  detail?: DetailState;
}

const CLOSE = <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;

/** Error words for a section save, or null when it saved or is tracked as unconfirmed. */
function problemOf(outcome: WriteOutcome): string | null {
  if (outcome.status !== 'failed') return null;
  if (outcome.error.kind === 'revision_conflict') return 'Changed elsewhere; see the banner above.';
  return failureMessage(outcome.error) ?? 'Not saved.';
}

/** What a text field shows: the unsaved buffer while there is one, else the (projected) Planner value. */
function textValue(item: Item, field: TextField, buffer?: { text: string }): string {
  return buffer?.text ?? (item[field] ?? '');
}

/**
 * The card detail panel (RV-3): title, kind, status, why, horizon, priority, area (a label, never a project),
 * notes with a 1,200 ms autosave, checklist, typed dates and links. Status pills are moves, so Undo restores the
 * card's exact place (RW-7). Conflicts offer Keep mine or Use theirs. Nothing here can start work.
 */
export function CardDetail({ store, state, feedback, itemId, onClose, now, detail: provided }: CardDetailProps) {
  const id = useId();
  const detail = provided ?? sharedDetailState('work-detail');
  const snapshot = useDetailState(detail);
  const editor = useMemo(() => createEditor(store, feedback, detail, itemId), [store, feedback, detail, itemId]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offline = state.save.kind === 'offline';

  const item = state.items.find((candidate) => candidate.id === itemId);
  const confirmed = state.confirmed?.items.find((candidate) => candidate.id === itemId);
  const buffers = snapshot.buffers[itemId] ?? {};
  const conflict = snapshot.conflicts[itemId];
  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now?.());

  // Leaving the panel, or the whole module, flushes pending notes rather than dropping them.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void editor.flushText('notes');
    }
  }, [editor]);

  // A notes edit kept while offline is sent once the Planner answers again; it was known not delivered.
  useEffect(() => {
    if (!offline && detail.buffer(itemId, 'notes') && !timer.current) void editor.flushText('notes');
  }, [offline, detail, editor, itemId]);

  if (!item) {
    return (
      <aside className="work-detail work-ui" aria-label="Card detail">
        {state.load === 'ready' || state.load === 'unavailable'
          ? <StateView state="unavailable" title="This item isn’t in the Planner snapshot" description="It may have been removed elsewhere. Nothing was changed." action={{ label: 'Close', onAction: onClose }} />
          : <StateView state="loading" title="Loading the Planner…" />}
      </aside>
    );
  }

  const setBuffer = (field: TextField, text: string) => {
    const base = detail.buffer(itemId, field)?.base ?? ((confirmed ?? item)[field] ?? '');
    detail.setBuffer(itemId, field, { text, base });
  };

  const onNotes = (text: string) => {
    setBuffer('notes', text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void editor.flushText('notes');
    }, NOTES_DEBOUNCE_MS);
  };

  const flushNow = (field: TextField) => {
    if (field === 'notes' && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void editor.flushText(field);
  };

  const onLineKey = (field: TextField) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); flushNow(field); }
    if (event.key === 'Escape' && detail.buffer(itemId, field)) { event.stopPropagation(); detail.clearBuffer(itemId, field); }
  };

  const patch = (body: ItemPatch, words: string) => void editor.save(body, { toast: `Saved ${words}` });
  const section = (key: 'dates' | 'next_steps' | 'references', words: string) => async (next: DateInput[] | StepInput[] | ReferenceInput[]) =>
    problemOf(await editor.save({ [key]: next } as ItemPatch, { toast: `Saved ${words}` }));

  const pending = state.pending.some((p) => 'id' in p.write && p.write.id === itemId);
  const unconfirmed = state.unconfirmed.some((u) => 'id' in u.write && u.write.id === itemId);
  const dirty = (Object.keys(buffers) as TextField[]).some((field) => buffers[field]!.text !== (item[field] ?? ''));
  const saveState = conflict ? <StatusChip tone="warning" label="Changed elsewhere" />
    : unconfirmed ? <SaveIndicator state="unknown" onCheck={() => void store.reconcile()} />
      : pending ? <SaveIndicator state="saving" />
        : offline && dirty ? <SaveIndicator state="offline" />
          : dirty ? <SaveIndicator state="unsaved" />
            : state.save.kind === 'saved' ? <SaveIndicator state="saved" savedAt={`· ${formatClock(state.save.at, settings.default_tz)}`} />
              : null;

  const archive = async () => {
    const archived = !item.archived_at;
    const outcome = await store.setArchived(item.id, archived);
    reportWrite(feedback, outcome, `${archived ? 'Archived' : 'Restored'} “${item.title}”`);
  };

  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !isTyping(event.target)) { event.preventDefault(); onClose(); }
  };

  return (
    <aside className="work-detail work-ui" aria-labelledby={`${id}-heading`} onKeyDown={onPanelKey}>
      <header className="work-detail-head">
        <span className="work-detail-crumb"><KindIcon kind={item.kind} /><span id={`${id}-heading`}>Card · {STATUS_LABEL[item.status]}</span></span>
        <span className="work-detail-save">{saveState}{offline && dirty && <span className="hq-meta">this session only</span>}</span>
        <IconButton label="Close card" icon={CLOSE} onClick={onClose} />
      </header>

      {conflict && (
        <div className="work-banner work-banner--conflict" role="alert">
          <StatusChip tone="warning" label="Changed elsewhere" />
          <span>The {fieldWords(conflict.fields)} changed in the Planner since you started editing. Your version is kept here until you choose.</span>
          <span className="work-conflict-actions">
            <Button size="sm" variant="primary" onClick={() => void editor.keepMine()}>Keep mine</Button>
            <Button size="sm" onClick={editor.useTheirs}>Use theirs</Button>
          </span>
        </div>
      )}
      {item.archived_at && (
        <div className="work-banner" role="status">
          <StatusChip tone="neutral" label="Archived" detail="not on the board; archive is not Done" />
          <Button size="sm" onClick={() => void archive()}>Restore</Button>
        </div>
      )}

      <label className="work-field" htmlFor={`${id}-title`}>
        <span className="hq-sr-only">Card title</span>
        <input
          id={`${id}-title`}
          className="work-input work-detail-title"
          value={textValue(item, 'title', buffers.title)}
          maxLength={LIMITS.title}
          onChange={(event) => setBuffer('title', event.target.value.replace(/[\r\n]+/gu, ' '))}
          onBlur={() => flushNow('title')}
          onKeyDown={onLineKey('title')}
        />
      </label>

      <section className="work-detail-section" aria-labelledby={`${id}-status`}>
        <h3 id={`${id}-status`} className="work-detail-label">Status</h3>
        <div className="work-pills" role="group" aria-labelledby={`${id}-status`}>
          {STATUSES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`work-pill work-pill--${option.id}`}
              aria-pressed={item.status === option.id}
              title={option.hint}
              onClick={() => void changeStatus(store, feedback, item, option.id)}
            >
              <span className={`work-st-dot work-st-dot--${option.id}`} aria-hidden="true" />{option.label}
            </button>
          ))}
        </div>
      </section>

      <div className="work-detail-fields">
        <label className="work-field">
          <span className="work-field-label">Why</span>
          <select className="work-input" value={item.motivation ?? ''} onChange={(event) => patch({ motivation: (event.target.value || null) as Motivation | null }, 'why')}>
            <option value="">Not set</option>
            {MOTIVATIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="work-field">
          <span className="work-field-label">Horizon</span>
          <select className="work-input" value={item.horizon ?? ''} onChange={(event) => patch({ horizon: (event.target.value || null) as Horizon | null }, 'horizon')}>
            <option value="">Not set</option>
            {HORIZONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="work-field">
          <span className="work-field-label">Kind</span>
          <select className="work-input" value={item.kind} onChange={(event) => patch({ kind: event.target.value as ItemKind }, 'kind')}>
            {KINDS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="work-field">
          <span className="work-field-label">Priority</span>
          <select className="work-input" value={item.priority ?? ''} onChange={(event) => patch({ priority: (event.target.value || null) as Priority | null }, 'priority')}>
            <option value="">Not set</option>
            {PRIORITIES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <div className="work-field">
          <label className="work-field-label" htmlFor={`${id}-area`}>Area</label>
          <input
            id={`${id}-area`}
            aria-describedby={`${id}-area-hint`}
            className="work-input"
            value={textValue(item, 'area', buffers.area)}
            maxLength={LIMITS.area}
            placeholder="A label, for example Garden"
            onChange={(event) => setBuffer('area', event.target.value)}
            onBlur={() => flushNow('area')}
            onKeyDown={onLineKey('area')}
          />
          <span className="hq-meta" id={`${id}-area-hint`}>A label only; it never selects a project.</span>
        </div>
      </div>

      <section className="work-detail-section" aria-labelledby={`${id}-dates`}>
        <h3 id={`${id}-dates`} className="work-detail-label">Dates</h3>
        <DateEditor dates={item.dates} today={today} settings={settings} onSave={section('dates', 'dates')} />
      </section>

      <section className="work-detail-section" aria-labelledby={`${id}-steps`}>
        <h3 id={`${id}-steps`} className="work-detail-label">Next steps</h3>
        <Checklist steps={item.next_steps} onSave={section('next_steps', 'checklist')} />
      </section>

      <section className="work-detail-section">
        <div className="work-field">
          <label className="work-detail-label" htmlFor={`${id}-notes`}>Notes</label>
          <textarea
            id={`${id}-notes`}
            aria-describedby={`${id}-notes-hint`}
            className="work-input work-notes"
            value={textValue(item, 'notes', buffers.notes)}
            maxLength={LIMITS.notes}
            onChange={(event) => onNotes(event.target.value)}
            onBlur={() => flushNow('notes')}
          />
          <span className="hq-meta" id={`${id}-notes-hint`}>Saves 1.2 seconds after you stop typing, and when you leave the field.</span>
        </div>
      </section>

      <section className="work-detail-section" aria-labelledby={`${id}-links`}>
        <h3 id={`${id}-links`} className="work-detail-label">Links</h3>
        <References references={item.references} onSave={section('references', 'links')} />
      </section>

      <footer className="work-detail-foot">
        <Button size="sm" onClick={() => void archive()}>{item.archived_at ? 'Restore' : 'Archive'}</Button>
        <span className="hq-meta">Editing a card is a planning change only. Nothing starts.</span>
      </footer>
    </aside>
  );
}
