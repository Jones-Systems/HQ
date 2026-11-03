import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, IconButton, InlineNotice, Presence, StatusIndicator, useToast, type StatusTone } from '@hq/ui';
import type { DomainId } from '@hq/contracts';
import { DOMAIN_LABELS } from '../domain-metadata';
import { useDataSources } from '../settings/DataSources';
import type { StoragePort } from '../state';
import {
  checklistAction, checklistProgress, evaluateChecklist, isFirstRun, markCelebrated, markUsed, markVisited, ONBOARDING_NARROW_PX,
  OPEN_COMMAND_PALETTE_EVENT, OPEN_SETTINGS_EVENT, platformShortcut, readOnboarding, setPanelState, SHOW_WELCOME_EVENT, summarizeSources,
  writeOnboarding, type ChecklistId, type ChecklistItem, type SourceSummary,
} from './onboarding-state';
import './onboarding.css';

export interface GettingStartedProps {
  readonly storage: StoragePort;
  /** The domain on screen; opening one counts toward the "look around" step. */
  readonly domain: DomainId;
  /** The panel hides while Settings is open, and keeps its state. */
  readonly settingsOpen: boolean;
  /** Go to a domain's destination, the same navigation the rail uses. Opening Settings uses the `hq-open-settings` event instead. */
  readonly onNavigate: (domain: DomainId, destination: string) => void;
  /** Added to the placement anchor. Override `--gs-inset-inline`, `--gs-inset-block` or `--gs-max` here to move or size the panel. */
  readonly className?: string;
}

/** How long "You're all set" stays before the card folds into its pill. */
const ALL_SET_MS = 3200;
const TOAST_ID = 'hq-onboarding-hidden';

// The four rail icons from `PresentationShell`, so the rows read as the same four places.
const DOMAINS: readonly { readonly id: DomainId; readonly purpose: string; readonly paths: readonly string[] }[] = [
  { id: 'design', purpose: 'Projects, references and live design work', paths: ['m12 3 9 9-9 9-9-9Z'] },
  { id: 'social', purpose: 'Draft, plan and publish posts', paths: ['M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z', 'M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0Z'] },
  { id: 'work', purpose: 'Planning board and calendar', paths: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z', 'M8 9h8M8 15h8'] },
  { id: 'wiki', purpose: 'Your local knowledge base', paths: ['M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z', 'M12 5v15'] },
];
const TONES: Record<SourceSummary['tone'], StatusTone> = { neutral: 'neutral', good: 'success', warning: 'warning' };
const openSettings = (source: 'social' | 'work' | 'wiki') => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { source } }));

function Check({ done }: { done: boolean }) {
  return <span className="gs-check" aria-hidden="true" data-done={done || undefined}>
    <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle className="gs-check-ring" cx="8" cy="8" r="6.6" />
      <path className="gs-check-mark" d="m4.9 8.2 2.2 2.2 4-4.4" pathLength="1" />
    </svg>
  </span>;
}

function Ring({ done, total }: { done: number; total: number }) {
  const circumference = 2 * Math.PI * 6;
  return <svg className="gs-ring" aria-hidden="true" viewBox="0 0 16 16" fill="none" strokeWidth="2">
    <circle className="gs-ring-track" cx="8" cy="8" r="6" />
    <circle className="gs-ring-value" cx="8" cy="8" r="6" strokeLinecap="round" transform="rotate(-90 8 8)" strokeDasharray={`${(done / total) * circumference} ${circumference}`} />
  </svg>;
}

/**
 * A calm, non-modal first-run card anchored at the bottom-left of the workspace. It never traps focus, never blocks the
 * app, and folds into a pill. Progress comes from the shell's data-source state and from what the user has done.
 *
 * Mounting contract:
 * - Render it inside `DataSourcesProvider` (it reads `useDataSources()`), and with the shell's `<ToastViewport />` mounted
 *   somewhere so the Hide confirmation (with Undo) can show.
 * - Render it as a direct child of the workspace column: a flex column that holds the module and, after it, the footer.
 *   The component is a zero-height row; the card and pill hang above its bottom edge, clear of the rail and footer.
 *   Keep that row between the module and the footer; keep the workspace `overflow: hidden` so the card cannot leave it.
 * - Keep it mounted while Settings is open and pass `settingsOpen`: the panel hides but keeps its state.
 * - Listens on `window` for `hq-show-welcome` (reopen) and `hq-open-command-palette` (marks the palette step used), and
 *   dispatches `hq-open-settings` (`detail: { source }`) and `hq-open-command-palette` from its checklist.
 */
export function GettingStarted({ storage, domain, settingsOpen, onNavigate, className }: GettingStartedProps) {
  const { statuses } = useDataSources();
  const toast = useToast();
  const [onboarding, setOnboarding] = useState(() => readOnboarding(storage));
  const [firstRun] = useState(() => isFirstRun(storage));
  const shortcut = useMemo(() => platformShortcut(typeof navigator === 'undefined' ? '' : navigator.platform), []);
  const titleId = useId();
  const progressId = useId();

  // Persist every change. A refused write leaves the panel working for this session.
  const written = useRef(onboarding);
  useEffect(() => { if (written.current !== onboarding) { written.current = onboarding; writeOnboarding(storage, onboarding); } }, [storage, onboarding]);

  // Count what the user opens and tries, whether or not the panel is showing.
  useEffect(() => { if (!settingsOpen) setOnboarding(previous => markVisited(previous, domain)); }, [domain, settingsOpen]);
  useEffect(() => {
    const used = () => setOnboarding(previous => markUsed(previous, 'palette'));
    const onKey = (event: globalThis.KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') used(); };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, used);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, used); window.removeEventListener('keydown', onKey); };
  }, []);

  // Narrow workspaces rest as the pill. Hidden (width 0) keeps the last real width, so returning from Settings never flickers.
  const anchor = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const read = () => { const next = element.getBoundingClientRect().width; setWidth(previous => next > 0 ? next : previous ?? 0); };
    read();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  const narrow = width !== null && width > 0 && width < ONBOARDING_NARROW_PX;
  const [peek, setPeek] = useState(false);
  useEffect(() => { if (!narrow) setPeek(false); }, [narrow]);
  const shown = onboarding.state === 'hidden' ? 'hidden' : narrow && !peek ? 'collapsed' : onboarding.state;
  const shownRef = useRef(shown); shownRef.current = shown;

  // Focus: collapsing lands on the pill, expanding on the card, and Hide returns to wherever the user came from.
  const card = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<'card' | 'pill' | null>(null);
  const focusInside = () => !!card.current && card.current.contains(document.activeElement);
  useEffect(() => {
    if (pendingFocus.current === 'card' && shown === 'open') { titleRef.current?.focus(); pendingFocus.current = null; }
    if (pendingFocus.current === 'pill' && shown === 'collapsed') { pillRef.current?.focus(); pendingFocus.current = null; }
  });

  const summaries = useMemo(() => summarizeSources(statuses), [statuses]);
  const items = useMemo(() => evaluateChecklist(onboarding, summaries, shortcut), [onboarding, summaries, shortcut]);

  // `known` holds the last answer for items that wait on a source check, so a recheck never un-ticks anything.
  const known = useRef<Partial<Record<ChecklistId, boolean>>>({});
  const [fresh, setFresh] = useState<ReadonlySet<ChecklistId>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const progress = checklistProgress(items, known.current);
  const wasComplete = useRef<boolean | null>(null);
  useEffect(() => {
    const flipped: ChecklistItem[] = [];
    for (const item of items) {
      if (item.done === undefined) continue;
      if (known.current[item.id] === false && item.done) flipped.push(item);
      known.current[item.id] = item.done;
    }
    if (!items.every(item => known.current[item.id] !== undefined)) return;
    const now = checklistProgress(items, known.current);
    if (flipped.length) {
      setFresh(previous => new Set([...previous, ...flipped.map(item => item.id)]));
      setAnnouncement(now.complete ? `You're all set. ${now.done} of ${now.total} complete.` : `${flipped.map(item => item.label).join(', ')}: done. ${now.done} of ${now.total} complete.`);
    }
    // The moment everything becomes done is celebrated once; a profile that already was complete is not.
    if (wasComplete.current === false && now.complete && shownRef.current !== 'hidden') {
      if (shownRef.current === 'open' && !onboarding.celebrated) setCelebrating(true); else setOnboarding(previous => markCelebrated(previous));
    }
    wasComplete.current = now.complete;
  }, [items, onboarding.celebrated]);
  useEffect(() => {
    if (!celebrating) return;
    const timer = window.setTimeout(() => {
      pendingFocus.current = focusInside() ? 'pill' : null;
      setCelebrating(false);
      setOnboarding(previous => markCelebrated(setPanelState(previous, 'collapsed')));
    }, ALL_SET_MS);
    return () => window.clearTimeout(timer);
  }, [celebrating]);

  const collapse = () => {
    pendingFocus.current = focusInside() ? 'pill' : null;
    setPeek(false); setCelebrating(false);
    setOnboarding(previous => celebrating ? markCelebrated(setPanelState(previous, 'collapsed')) : setPanelState(previous, 'collapsed'));
  };
  const expand = useCallback(() => {
    pendingFocus.current = 'card';
    setPeek(true);
    setOnboarding(previous => setPanelState(previous, 'open'));
  }, []);
  const hide = () => {
    const back = cameFrom.current?.isConnected ? cameFrom.current : null;
    setCelebrating(false);
    setOnboarding(previous => setPanelState(previous, 'hidden'));
    toast.show({ id: TOAST_ID, title: `Getting started hidden — reopen it from ${shortcut} › Show getting started`, action: { label: 'Undo', onAction: expand } });
    back?.focus();
  };
  useEffect(() => {
    const show = () => { cameFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; expand(); };
    window.addEventListener(SHOW_WELCOME_EVENT, show);
    return () => window.removeEventListener(SHOW_WELCOME_EVENT, show);
  }, [expand]);

  const run = (id: ChecklistId) => {
    const action = checklistAction(id, onboarding);
    if (action.type === 'navigate') onNavigate(action.domain, action.destination);
    else if (action.type === 'open-settings') openSettings(action.source);
    else window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.stopPropagation();
    collapse();
  };

  // A source that was set up but didn't answer gets one inline notice; the last list is kept while it folds away.
  const unreachableNow = (['work', 'social'] as const).filter(id => summaries[id].kind === 'unreachable');
  const lastUnreachable = useRef(unreachableNow);
  if (unreachableNow.length) lastUnreachable.current = unreachableNow;
  const unreachable = lastUnreachable.current;
  const count = `${progress.done}/${progress.total}`;

  return <div className={className ? `gs-anchor ${className}` : 'gs-anchor'} ref={anchor} hidden={settingsOpen}>
    <div className="hq-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {width !== null && <>
      <Presence show={shown === 'open'} motion="collapse" as="section" className="gs-card" initial={firstRun} aria-labelledby={titleId}
        onKeyDown={onKeyDown} onFocusCapture={event => { const from = event.relatedTarget; if (from instanceof HTMLElement && !event.currentTarget.contains(from)) cameFrom.current = from; }}>
        <div className="gs-inner" ref={card}>
          <header className="gs-header">
            <div className="gs-heading">
              <h2 id={titleId} className="gs-title" tabIndex={-1} ref={titleRef}>Welcome to HQ</h2>
              <p className="gs-lede">Design, Social, Work and Wiki in one place. Here's how to get set up.</p>
            </div>
            <IconButton size="sm" label="Collapse getting started" onClick={collapse}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>} />
          </header>
          <div className="gs-progress">
            <span className="gs-count" id={progressId}>{progress.done} of {progress.total}</span>
            <div className="gs-bar" role="progressbar" aria-labelledby={progressId} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}
              aria-valuetext={`${progress.done} of ${progress.total} done`} ref={element => { element?.style.setProperty('--gs-progress', String((progress.done / progress.total) * 100)); }}>
              <span className="gs-bar-fill" />
            </div>
          </div>
          <Presence show={celebrating} motion="collapse" initial={false}>
            <div className="gs-allset"><Check done /><div><strong>You're all set</strong><span>Reopen this any time from {shortcut} › Show getting started.</span></div></div>
          </Presence>
          <Presence show={!celebrating} motion="collapse" className="gs-body-slot" initial={false}>
            <div className="gs-body">
              <Presence show={unreachableNow.length > 0} motion="collapse" initial={false}>
                <div className="gs-notice">
                  <InlineNotice tone="warning" variant="bar" title={`${unreachable.map(id => DOMAIN_LABELS[id]).join(' and ')} ${unreachable.length > 1 ? 'are' : 'is'} unreachable`}
                    actions={[{ label: 'Open Data sources', onAction: () => openSettings(unreachable[0] ?? 'work') }]}>
                    HQ couldn't reach {unreachable.length > 1 ? 'them' : 'it'} on the last check.
                  </InlineNotice>
                </div>
              </Presence>
              <h3 className="gs-subhead">What's in HQ</h3>
              <ul className="gs-domains">
                {DOMAINS.map(row => {
                  const summary = row.id === 'design' ? null : summaries[row.id];
                  return <li className="gs-domain" key={row.id}>
                    <svg className="gs-domain-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">{row.paths.map(d => <path key={d} d={d} />)}</svg>
                    <div className="gs-domain-text">
                      <div className="gs-domain-head">
                        <strong>{DOMAIN_LABELS[row.id]}</strong>
                        <StatusIndicator live={false} className="gs-status" tone={summary ? TONES[summary.tone] : 'neutral'} label={summary ? summary.text : 'Local, on this device'} busy={summary?.kind === 'checking'} />
                      </div>
                      <span className="gs-purpose">{row.purpose}</span>
                    </div>
                  </li>;
                })}
              </ul>
              <h3 className="gs-subhead">Get set up</h3>
              <ol className="gs-checklist">
                {items.map(item => {
                  const done = item.done ?? known.current[item.id] ?? false;
                  return <li key={item.id} className={`gs-item${fresh.has(item.id) ? ' is-fresh hq-flash' : ''}`} data-done={done || undefined}
                    onAnimationEnd={event => { if (event.target === event.currentTarget) setFresh(previous => { const next = new Set(previous); next.delete(item.id); return next; }); }}>
                    <Check done={done} />
                    <button type="button" className="gs-item-button" onClick={() => run(item.id)} aria-describedby={`${progressId}-${item.id}`}>{item.label}</button>
                    <span className="gs-item-hint" id={`${progressId}-${item.id}`}><span className="hq-sr-only">{done ? 'Done. ' : 'Not done. '}</span>{item.hint}</span>
                  </li>;
                })}
              </ol>
            </div>
          </Presence>
          <footer className="gs-footer">
            <span className="gs-reopen">Reopen from {shortcut} › Show getting started</span>
            <Button size="sm" variant="ghost" onClick={hide}>Hide</Button>
          </footer>
        </div>
      </Presence>
      <Presence show={shown === 'collapsed'} motion="scale" className="gs-pill-slot" initial={firstRun}>
        <button type="button" className={`gs-pill${fresh.size ? ' hq-flash' : ''}${progress.complete ? ' is-complete' : ''}`} ref={pillRef} aria-expanded={false} title="Show getting started"
          onClick={expand} onAnimationEnd={event => { if (event.target === event.currentTarget) setFresh(new Set()); }}>
          <Ring done={progress.done} total={progress.total} />
          <span>Getting started · {count}</span>
        </button>
      </Presence>
    </>}
  </div>;
}
