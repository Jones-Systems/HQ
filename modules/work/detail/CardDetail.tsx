import { useEffect, useId, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { animateElement, Button, IconButton, InlineNotice, prefersReducedMotion, StateView, StatusIndicator, type ReferencePort } from '@hq/ui';
import {
  areasOf, DEFAULT_SETTINGS, formatClock, HORIZONS, KINDS, MOTIVATIONS, plannerToday, PRIORITIES, STATUS_LABEL, LIMITS,
  type DateInput, type Horizon, type Item, type ItemKind, type ItemPatch, type Motivation, type Priority, type ReferenceInput,
  type StepInput, type WorkState, type WorkStore, type WriteOutcome,
} from '../core';
import { changeStatus, failureMessage, isTyping, reportWrite } from '../board/actions';
import type { Feedback } from '../board/feedback';
import { KindIcon } from '../theme';
import { Checklist } from './Checklist';
import { ChipPicker } from './ChipPicker';
import { DateEditor } from './DateEditor';
import { sharedDetailState, useDetailState, type DetailState, type FieldConflict, type TextField } from './detail-state';
import { createEditor, fieldWords, NOTES_DEBOUNCE_MS } from './edits';
import { Present } from './exiting';
import { References } from './References';
import { HqLinks } from './HqLinks';
import { StatusPills } from './StatusPills';
import '../theme';
import '../board/board.css';
import '../board/feedback.css';
import './detail.css';

export interface CardDetailProps {
  projectId?: string;
  references?: ReferencePort;
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
  if (outcome.error.kind === 'revision_conflict') return 'Changed elsewhere; see the notice above.';
  return failureMessage(outcome.error) ?? 'Not saved.';
}

/** What a text field shows: the unsaved buffer while there is one, else the (projected) Planner value. */
function textValue(item: Item, field: TextField, buffer?: { text: string }): string {
  return buffer?.text ?? (item[field] ?? '');
}

/**
 * The panel leaves the page when the host unmounts it, which is immediate. So that it still slides away, a
 * non-interactive copy at the same place plays the exit and removes itself. Nothing in the copy is focusable or
 * announced, and nothing happens at all under reduced motion.
 */
function slideAway(panel: HTMLElement | null): void {
  if (!panel || prefersReducedMotion() || typeof panel.animate !== 'function') return;
  const rect = panel.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const copy = panel.cloneNode(true) as HTMLElement;
  copy.classList.remove('hq-enter-slide-end');
  copy.classList.add('work-detail-ghost');
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('aria-labelledby');
  copy.inert = true;
  copy.style.setProperty('--ghost-x', `${rect.left}px`);
  copy.style.setProperty('--ghost-y', `${rect.top}px`);
  copy.style.setProperty('--ghost-w', `${rect.width}px`);
  copy.style.setProperty('--ghost-h', `${rect.height}px`);
  document.body.append(copy);
  const remove = () => copy.remove();
  const animation = animateElement(copy, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(16px)' }], { duration: 'base', easing: 'exit' });
  if (animation) animation.addEventListener('finish', remove);
  setTimeout(remove, 400);
}

/** One labelled row of the properties list: the name, then its compact control. */
function Prop({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`work-prop${wide ? ' work-prop--wide' : ''}`}><span className="work-prop-label">{label}</span><div className="work-prop-value">{children}</div></div>;
}

/**
 * The card detail panel (RV-3, D-3): a large wrapping title, an animated status row, why, horizon, priority and
 * kind as compact pickers, area as a label, notes with a 1,200 ms autosave, checklist, typed dates and links. Status
 * pills are moves, so Undo restores the card's exact place (RW-7). A conflict offers Keep mine or Use theirs. The
 * header says Saving…, Saved or Changed elsewhere. It works at any width from 320 to 640 px, as a side panel or a
 * sheet. Nothing here can start work.
 */
export function CardDetail({ store, state, feedback, itemId, onClose, now, detail: provided, projectId, references }: CardDetailProps) {
  const id = useId();
  const detail = provided ?? sharedDetailState('work-detail');
  const snapshot = useDetailState(detail);
  const editor = useMemo(() => createEditor(store, feedback, detail, itemId), [store, feedback, detail, itemId]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLElement>(null);
  const titleField = useRef<HTMLTextAreaElement>(null);
  const offline = state.save.kind === 'offline';

  const item = state.items.find((candidate) => candidate.id === itemId);
  const confirmed = state.confirmed?.items.find((candidate) => candidate.id === itemId);
  const buffers = snapshot.buffers[itemId] ?? {};
  const conflict = snapshot.conflicts[itemId];
  // The notice keeps its words while it fades out after Keep mine or Use theirs.
  const lastConflict = useRef<FieldConflict | undefined>(conflict);
  if (conflict) lastConflict.current = conflict;
  const settings = state.confirmed?.settings ?? DEFAULT_SETTINGS;
  const today = plannerToday(settings, now?.());
  const areas = useMemo(() => areasOf(state.items), [state.items]);

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

  // Browsers without `field-sizing` need the title field sized by hand so a long title wraps instead of clipping.
  const titleText = item ? textValue(item, 'title', buffers.title) : '';
  useLayoutEffect(() => {
    const field = titleField.current;
    if (!field || (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content'))) return;
    field.style.setProperty('--work-title-h', 'auto');
    field.style.setProperty('--work-title-h', `${field.scrollHeight}px`);
  }, [titleText]);

  const close = () => {
    slideAway(panel.current);
    onClose();
  };

  if (!item) {
    return (
      <aside className="work-detail work-ui" aria-label="Card detail">
        {state.load === 'ready' || state.load === 'unavailable'
          ? <StateView state="unavailable" title="This item isn’t in the Planner snapshot" description="It may have been removed elsewhere. Nothing was changed." action={{ label: 'Close', onAction: close }} />
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

  const onLineKey = (field: TextField) => (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); flushNow(field); }
    if (event.key === 'Escape' && detail.buffer(itemId, field)) { event.stopPropagation(); detail.clearBuffer(itemId, field); }
  };

  const patch = (body: ItemPatch, words: string) => void editor.save(body, { toast: `Saved ${words}` });
  const section = (key: 'dates' | 'next_steps' | 'references', words: string) => async (next: DateInput[] | StepInput[] | ReferenceInput[]) =>
    problemOf(await editor.save({ [key]: next } as ItemPatch, { toast: `Saved ${words}` }));

  const pending = state.pending.some((p) => 'id' in p.write && p.write.id === itemId);
  const unconfirmed = state.unconfirmed.some((u) => 'id' in u.write && u.write.id === itemId);
  const dirty = (Object.keys(buffers) as TextField[]).some((field) => buffers[field]!.text !== (item[field] ?? ''));
  const saveState = conflict ? <StatusIndicator tone="warning" label="Changed elsewhere" />
    : unconfirmed ? <StatusIndicator tone="unknown" label="Save result unknown" action={{ label: 'Check', onAction: () => void store.reconcile() }} />
      : pending ? <StatusIndicator tone="neutral" busy label="Saving…" />
        : offline && dirty ? <StatusIndicator tone="danger" label="Offline · kept on this device" />
          : dirty ? <StatusIndicator tone="neutral" label="Unsaved changes" />
            : state.save.kind === 'saved' ? <StatusIndicator tone="success" label="Saved" detail={`· ${formatClock(state.save.at, settings.default_tz)}`} />
              : null;

  const archive = async () => {
    const archived = !item.archived_at;
    const outcome = await store.setArchived(item.id, archived);
    reportWrite(feedback, outcome, `${archived ? 'Archived' : 'Restored'} “${item.title}”`);
  };

  const onPanelKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !isTyping(event.target)) { event.preventDefault(); close(); }
  };

  const shown = lastConflict.current;
  return (
    <aside className="work-detail work-ui hq-enter-slide-end" aria-labelledby={`${id}-heading`} onKeyDown={onPanelKey} ref={panel}>
      <header className="work-detail-head">
        <span className="work-detail-crumb"><KindIcon kind={item.kind} /><span id={`${id}-heading`}>Card · {STATUS_LABEL[item.status]}</span></span>
        <span className="work-detail-save">{saveState}{offline && dirty && <span className="hq-meta">this session only</span>}</span>
        <IconButton label="Close card" icon={CLOSE} onClick={close} />
      </header>

      <div className="work-detail-body">
        <Present show={!!conflict} motion="drop" as="div" className="work-detail-notice">
          {shown && (
            <InlineNotice
              tone="warning" live="assertive" title="Changed elsewhere"
              actions={[{ label: 'Keep mine', onAction: () => void editor.keepMine() }, { label: 'Use theirs', onAction: editor.useTheirs }]}
            >
              The {fieldWords(shown.fields)} changed in the Planner since you started editing. Your version is kept here until you choose.
            </InlineNotice>
          )}
        </Present>
        <Present show={!!item.archived_at} motion="drop" as="div" className="work-detail-notice">
          <InlineNotice tone="neutral" variant="bar" live="polite" title="Archived" actions={[{ label: 'Restore', onAction: () => void archive() }]}>
            not on the board; archive is not Done
          </InlineNotice>
        </Present>

        <label className="work-field" htmlFor={`${id}-title`}>
          <span className="hq-sr-only">Card title</span>
          <textarea
            id={`${id}-title`}
            ref={titleField}
            rows={1}
            className="work-input work-detail-title"
            value={textValue(item, 'title', buffers.title)}
            maxLength={LIMITS.title}
            spellCheck
            onChange={(event) => setBuffer('title', event.target.value.replace(/[\r\n]+/gu, ' '))}
            onBlur={() => flushNow('title')}
            onKeyDown={onLineKey('title')}
          />
        </label>

        <section className="work-detail-section" aria-labelledby={`${id}-status`}>
          <h3 id={`${id}-status`} className="work-detail-label">Status</h3>
          <StatusPills labelledBy={`${id}-status`} status={item.status} onSelect={(status) => void changeStatus(store, feedback, item, status)} />
        </section>

        <section className="work-props" aria-label="Properties">
          <Prop label="Why">
            <ChipPicker
              label="Why" value={item.motivation} emptyLabel="Not set"
              options={MOTIVATIONS.map((option) => ({ id: option.id as Motivation, label: option.label, tone: option.id }))}
              onChange={(next) => patch({ motivation: next }, 'why')}
            />
          </Prop>
          <Prop label="Horizon">
            <ChipPicker
              label="Horizon" value={item.horizon} emptyLabel="Not set"
              options={HORIZONS.map((option) => ({ id: option.id as Horizon, label: option.label }))}
              onChange={(next) => patch({ horizon: next }, 'horizon')}
            />
          </Prop>
          <Prop label="Priority">
            <ChipPicker
              label="Priority" value={item.priority} emptyLabel="Not set"
              options={PRIORITIES.map((option) => ({ id: option.id as Priority, label: option.label, tone: option.id === 'high' ? 'high' : undefined }))}
              onChange={(next) => patch({ priority: next }, 'priority')}
            />
          </Prop>
          <Prop label="Kind">
            <ChipPicker
              label="Kind" value={item.kind}
              options={KINDS.map((option) => ({ id: option.id as ItemKind, label: option.label }))}
              leading={(kind) => (kind ? <KindIcon kind={kind} small /> : null)}
              onChange={(next) => { if (next) patch({ kind: next }, 'kind'); }}
            />
          </Prop>
          <Prop label="Area" wide>
            <input
              id={`${id}-area`}
              aria-label="Area"
              aria-describedby={`${id}-area-hint`}
              list={`${id}-areas`}
              className="work-input work-area-input"
              value={textValue(item, 'area', buffers.area)}
              maxLength={LIMITS.area}
              placeholder="A label, for example Garden"
              onChange={(event) => setBuffer('area', event.target.value)}
              onBlur={() => flushNow('area')}
              onKeyDown={onLineKey('area')}
            />
            <datalist id={`${id}-areas`}>{areas.map((area) => <option key={area} value={area} />)}</datalist>
            <span className="hq-meta" id={`${id}-area-hint`}>A label only; it never selects a project.</span>
          </Prop>
        </section>

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
          <References references={item.references} hideHq={!!projectId} onSave={section('references', 'links')} disabled={pending || unconfirmed} />
          {projectId && <HqLinks key={item.id} item={item} projectId={projectId} {...(references ? { port: references } : {})}
            returnTo={{ label: item.title, to: { domain: 'work', destination: `item/${item.id}` } }}
            state={state} store={store} editor={editor} {...(now ? { now } : {})} />}
        </section>

        <footer className="work-detail-foot">
          <Button size="sm" onClick={() => void archive()}>{item.archived_at ? 'Restore' : 'Archive'}</Button>
          <span className="hq-meta">Editing a card is a planning change only. Nothing starts.</span>
        </footer>
      </div>
    </aside>
  );
}
