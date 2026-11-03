import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button, InlineNotice, Presence, StatusIndicator, useListMotion, useToast } from '@hq/ui';
import {
  RATING_VALUES, type RatingValue, type TasteClientPort, type TasteCommand, type TasteScope, type TasteSnapshot,
} from '../contract.ts';
import { DeckCard, type DeckCardHandle } from './DeckCard.tsx';
import {
  QUICK_RATINGS, STAMP_WORDS, choiceDirection, choiceForKey, choiceText, classifyAppend, deckImageUrl, deckItemKey,
  deckOrigin, deckSubject, prepareRating, pushRecent, scaleFocusTarget, snapshotHasCommand,
  type DeckChoice, type DeckOutcome, type RecentRating,
} from './deck-model.ts';
import { useTasteQueue, type TasteQueueItem, type TasteQueueValue } from './queue-context.ts';
import type { NewId } from './view-model.ts';
import './deck.css';

export interface QuickRateDeckProps {
  readonly client: TasteClientPort;
  readonly scope: TasteScope;
  readonly snapshot: TasteSnapshot;
  readonly newId: NewId;
  /** The journal is read-only, or another save is in flight. */
  readonly disabled: boolean;
  /** Read the snapshot again. Called after a confirmed save, and after a refusal that a stale read could have caused. */
  readonly onSaved: () => void;
}

/** Toast ids: a rating confirmation updates in place, and one problem toast at a time is kept for the deck. */
const TOAST_RATED = 'taste-deck-rated';
const TOAST_PROBLEM = 'taste-deck-problem';
const SAVED_VISIBLE_MS = 6000;

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving'; readonly key: string; readonly choice: DeckChoice }
  | { readonly kind: 'unknown'; readonly key: string; readonly value: RatingValue }
  | { readonly kind: 'failed'; readonly key: string; readonly message: string };

interface Unconfirmed { readonly item: TasteQueueItem; readonly value: RatingValue; readonly command: TasteCommand }

/**
 * "Waiting to rate": the items other views sent to Taste, one card at a time with the next peeking behind it.
 * Renders nothing when Taste is mounted without a queue. A rating is an overall liking assessment recorded in the
 * current scope through the panel's own client; the card leaves only once the journal confirms it, and a failed or
 * unknown save keeps the card where it is.
 */
export function QuickRateDeck(props: QuickRateDeckProps) {
  const queue = useTasteQueue();
  return queue ? <Deck {...props} queue={queue} /> : null;
}

function Deck({ client, scope, snapshot, newId, disabled, onSaved, queue }: QuickRateDeckProps & { readonly queue: TasteQueueValue }) {
  const toast = useToast();
  const titleId = useId();
  const exactId = useId();
  const items = queue.items;
  const top = items[0];
  const next = items[1];
  const topKey = top ? deckItemKey(top) : null;

  const [phase, setPhaseState] = useState<Phase>({ kind: 'idle' });
  const [recent, setRecent] = useState<readonly RecentRating[]>([]);
  const [justSaved, setJustSaved] = useState<RecentRating | null>(null);
  const [exactOpen, setExactOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<DeckCardHandle>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const hadFocus = useRef(false);
  const busy = useRef(false);
  const phaseRef = useRef<Phase>({ kind: 'idle' });
  const unconfirmed = useRef<Unconfirmed | null>(null);
  const recentRef = useListMotion<HTMLUListElement>(recent.map((entry) => entry.key));

  function setPhase(value: Phase) { phaseRef.current = value; setPhaseState(value); }

  // Async work below reads the newest props through this, not the render it was created in. The functions use
  // only refs and state setters otherwise, so a handler or toast action from an earlier render stays correct.
  const latest = useRef({ client, scope, snapshot, newId, disabled, onSaved, queue, top, toast });
  useEffect(() => { latest.current = { client, scope, snapshot, newId, disabled, onSaved, queue, top, toast }; });

  // The inline "Saved" is a recent-result note: it fades from the header after a few seconds.
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(null), SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [justSaved]);

  // Rating the last card removes the focused surface; keep keyboard focus in the deck instead of dropping to the page.
  useEffect(() => {
    if (top || !hadFocus.current) return;
    hadFocus.current = false;
    doneRef.current?.focus({ preventScroll: true });
  }, [top]);

  async function send(command: TasteCommand): Promise<DeckOutcome> {
    try {
      return classifyAppend(await latest.current.client.submit(command));
    } catch {
      return { kind: 'unknown' };
    }
  }

  /** Turns an outcome into what the owner sees. Only a confirmed save moves the card off and out of the queue. */
  async function settle(item: TasteQueueItem, value: RatingValue, command: TasteCommand | null, outcome: DeckOutcome) {
    const ctx = latest.current;
    const key = deckItemKey(item);
    const atFront = ctx.top !== undefined && deckItemKey(ctx.top) === key;
    if (outcome.kind === 'saved') {
      unconfirmed.current = null;
      if (atFront) await cardRef.current?.flyOff(choiceDirection({ kind: 'rate', value }));
      const entry: RecentRating = { key, label: item.label, value };
      setRecent((list) => pushRecent(list, entry));
      setJustSaved(entry);
      ctx.toast.dismiss(TOAST_PROBLEM);
      const waiting = Math.max(0, ctx.queue.items.length - 1);
      ctx.toast.success(`Saved “${item.label}” as ${STAMP_WORDS[value]} · ${value}`, {
        id: TOAST_RATED, meta: `${ctx.scope.kind === 'general' ? 'General taste' : 'Project taste'} · ${waiting} waiting`,
      });
      ctx.queue.onRated(item);
      ctx.onSaved();
      setPhase({ kind: 'idle' });
    } else if (outcome.kind === 'failed') {
      cardRef.current?.snapBack();
      setJustSaved(null);
      setPhase({ kind: 'failed', key, message: outcome.message });
      ctx.toast.error("Couldn't save the rating", { id: TOAST_PROBLEM, description: `${outcome.message} “${item.label}” is still waiting.` });
      // A refusal can come from a stale read (the rating changed elsewhere); read again so the next try is current.
      ctx.onSaved();
    } else {
      if (command) unconfirmed.current = { item, value, command };
      cardRef.current?.snapBack();
      setJustSaved(null);
      setPhase({ kind: 'unknown', key, value });
      ctx.toast.unknown('Rating not confirmed', {
        id: TOAST_PROBLEM, description: `“${item.label}” may or may not be saved, so it stays in the deck until you check.`,
        action: { label: 'Check', onAction: () => { void check(); }, dismiss: false },
      });
    }
  }

  async function act(choice: DeckChoice) {
    const ctx = latest.current;
    const item = ctx.top;
    if (!item || busy.current || ctx.disabled || phaseRef.current.kind === 'unknown') return;
    busy.current = true;
    try {
      if (choice.kind === 'skip') {
        await cardRef.current?.flyOff('down');
        setPhase({ kind: 'idle' });
        ctx.queue.onSkipped(item);
        return;
      }
      setPhase({ kind: 'saving', key: deckItemKey(item), choice });
      const prepared = prepareRating(ctx.snapshot, ctx.scope, deckSubject(item), choice.value, ctx.newId);
      if (prepared.kind === 'already-saved') {
        await settle(item, choice.value, null, { kind: 'saved' });
        return;
      }
      await settle(item, choice.value, prepared.command, await send(prepared.command));
    } finally {
      busy.current = false;
    }
  }

  /** Reads the journal back to see whether the unconfirmed entry is there. Writes nothing. */
  async function check() {
    const pending = unconfirmed.current;
    const ctx = latest.current;
    if (!pending || busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const fresh = await ctx.client.snapshot(ctx.scope.kind === 'project' ? ctx.scope.projectId : null);
      if (snapshotHasCommand(fresh, pending.command)) {
        await settle(pending.item, pending.value, pending.command, { kind: 'saved' });
      } else {
        ctx.toast.unknown('Not in the journal yet', {
          id: TOAST_PROBLEM, description: 'Retrying sends the same entry and cannot duplicate it.',
          action: { label: 'Retry', onAction: () => { void retry(); }, dismiss: false },
        });
      }
    } catch {
      ctx.toast.unknown("Couldn't read the journal", {
        id: TOAST_PROBLEM, description: 'The rating is still unconfirmed. Nothing was changed.',
        action: { label: 'Check', onAction: () => { void check(); }, dismiss: false },
      });
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  /** Sends the same entry again. Its client event id is unchanged, so the journal cannot record it twice. */
  async function retry() {
    const pending = unconfirmed.current;
    if (!pending || busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      await settle(pending.item, pending.value, pending.command, await send(pending.command));
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    const choice = choiceForKey(event);
    if (!choice) return;
    event.preventDefault();
    void act(choice);
  };

  // Arrows inside the exact-rating row move along it instead of rating.
  const onExactKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const target = scaleFocusTarget(event.key, buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length);
    if (target === null || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    buttons[target]?.focus();
  };

  const status: Phase = phase.kind !== 'idle' && phase.key === topKey ? phase : { kind: 'idle' };
  const locked = disabled || status.kind === 'saving' || status.kind === 'unknown';
  const committed = status.kind === 'saving' ? status.choice : null;
  const origin = (item: TasteQueueItem) => deckOrigin(item.from, queue.originLabel);
  const documentOrigin = typeof location === 'undefined' ? '' : location.origin;
  const imageFor = (item: TasteQueueItem) => deckImageUrl(item.imageUrl, documentOrigin);

  if (items.length === 0 && recent.length === 0) {
    return <p className="taste-deck-hint">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2.2" /><path d="M4 9.5h16" /></svg>
      <span>Send references, components or flows here with <strong>Rate taste</strong>.</span>
    </p>;
  }

  return <section className="taste-deck hq-enter-rise" aria-labelledby={titleId}>
    <header className="taste-deck-head">
      <h3 id={titleId}>Waiting to rate</h3>
      {items.length > 0 && <span className="taste-deck-count">{items.length} waiting</span>}
      {justSaved && <span className="taste-deck-saved hq-enter-fade" key={justSaved.key + justSaved.value}>
        <StatusIndicator tone="success" label="Saved" detail={`${justSaved.label} · ${STAMP_WORDS[justSaved.value]} ${justSaved.value}`} live={false} />
      </span>}
    </header>

    {top ? <div ref={groupRef} className="taste-deck-surface" role="group" tabIndex={0} aria-disabled={disabled || undefined}
      aria-label={`Waiting to rate: ${top.label}, ${items.length} waiting. Arrow keys rate: left 2, right 4, up 5, down or S skips, 1 to 5 exact.`}
      onKeyDown={onKeyDown} onFocus={() => { hadFocus.current = true; }}
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) hadFocus.current = false; }}>
      <div className="taste-deck-stage" onPointerDown={() => groupRef.current?.focus({ preventScroll: true })}>
        <DeckCard ref={cardRef} key={deckItemKey(top)} item={top} position="front" origin={origin(top)} imageUrl={imageFor(top)}
          committed={committed} state={status.kind === 'saving' ? 'saving' : status.kind === 'unknown' ? 'unknown' : 'idle'}
          dragEnabled={!locked} onRelease={(choice) => void act(choice)} />
        {next && <DeckCard key={deckItemKey(next)} item={next} position="peek" origin={origin(next)} imageUrl={imageFor(next)}
          committed={null} state="idle" dragEnabled={false} onRelease={() => undefined} />}
      </div>

      <div className="taste-deck-side">
        <div className="taste-deck-actions">
          {QUICK_RATINGS.map((quick) => <Button key={quick.value} variant="secondary" className="taste-deck-action" data-tone={quick.value}
            aria-label={`${quick.label}, rating ${quick.value}`} aria-keyshortcuts={arrowName(quick.arrow)}
            aria-disabled={locked || undefined} disabled={disabled}
            busy={committed?.kind === 'rate' && committed.value === quick.value} busyLabel="Saving"
            onClick={() => void act({ kind: 'rate', value: quick.value })}>
            <span className="taste-deck-action-label">{quick.label}</span>
            <span className="taste-deck-action-key" aria-hidden="true"><kbd>{quick.arrow}</kbd>{quick.value}</span>
          </Button>)}
          <Button variant="ghost" className="taste-deck-action taste-deck-skip" aria-label="Skip" aria-keyshortcuts="ArrowDown S"
            aria-disabled={locked || undefined} disabled={disabled} onClick={() => void act({ kind: 'skip' })}>
            <span className="taste-deck-action-label">Skip</span>
            <span className="taste-deck-action-key" aria-hidden="true"><kbd>↓</kbd></span>
          </Button>
        </div>

        <div className="taste-deck-exact">
          <button type="button" className="taste-deck-exact-toggle" aria-expanded={exactOpen} aria-controls={exactId}
            onClick={() => setExactOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>Exact rating
          </button>
          <Presence show={exactOpen} motion="collapse" id={exactId}>
            <div className="taste-deck-exact-pad">
              <div className="taste-deck-exact-row" role="group" aria-label="Exact rating, 1 to 5" onKeyDown={onExactKeyDown}>
                {RATING_VALUES.map((value) => <Button key={value} variant="secondary" size="sm" className="taste-deck-exact-button"
                  aria-label={`${value}, ${STAMP_WORDS[value]}`} aria-disabled={locked || undefined} disabled={disabled}
                  onClick={() => void act({ kind: 'rate', value })}>
                  <b>{value}</b><span>{STAMP_WORDS[value]}</span>
                </Button>)}
              </div>
            </div>
          </Presence>
        </div>

        {status.kind === 'failed' && <InlineNotice tone="danger" variant="bar" className="taste-deck-notice hq-enter-rise"
          title="Not saved">{status.message} “{top.label}” is still waiting.</InlineNotice>}
        {status.kind === 'unknown' && <InlineNotice tone="unknown" className="taste-deck-notice hq-enter-rise" title="Rating not confirmed"
          actions={[{ label: 'Check', onAction: () => void check(), busy: checking, busyLabel: 'Checking' },
            { label: 'Retry same entry', onAction: () => void retry() }]}>
          The save may or may not have reached the journal. Retrying sends the same entry and cannot duplicate it.
        </InlineNotice>}
        {disabled && status.kind === 'idle' && <p className="taste-muted">Ratings are paused while the journal is read-only.</p>}

        <ul className="taste-deck-keys" aria-label="Keyboard shortcuts">
          <li><kbd>←</kbd> Not for me · 2</li>
          <li><kbd>→</kbd> Like · 4</li>
          <li><kbd>↑</kbd> Love · 5</li>
          <li><kbd>↓</kbd> <kbd>S</kbd> Skip</li>
          <li><kbd>1</kbd>–<kbd>5</kbd> Exact</li>
        </ul>
        <p className="taste-deck-keys-note">Focus the deck to use keys. Drag a card left, right or up to rate it.</p>
      </div>
    </div> : <p ref={doneRef} className="taste-deck-done" role="status" tabIndex={-1}>Everything waiting is rated. Send more with <strong>Rate taste</strong>.</p>}

    {recent.length > 0 && <div className="taste-deck-recent">
      <span className="taste-deck-recent-title">Just rated</span>
      <ul ref={recentRef} aria-label="Just rated">
        {recent.map((entry) => <li key={entry.key} data-hq-motion-key={entry.key} className="taste-deck-chip" data-value={entry.value}
          title={`${entry.label} · ${choiceText({ kind: 'rate', value: entry.value })}`}>
          <span className="taste-deck-chip-label">{entry.label}</span>
          <b>{STAMP_WORDS[entry.value]} · {entry.value}</b>
        </li>)}
      </ul>
    </div>}

    {top && <span className="taste-sr" role="status">{`${top.label}. ${origin(top)}. ${items.length} waiting.`}</span>}
  </section>;
}

function arrowName(glyph: string): string {
  return glyph === '←' ? 'ArrowLeft' : glyph === '→' ? 'ArrowRight' : 'ArrowUp';
}
