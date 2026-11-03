import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button, ErrorBoundary, FieldError, fieldErrorProps, InlineNotice, navigateWithTransition, NOTICE_TONES, PageTransition, Presence,
  PRESENCE_MOTIONS, Skeleton, StatusIndicator, ToastViewport, useListMotion, useReducedMotion, useToast, useToasts,
  type NoticeTone, type PresenceMotion,
} from '../../src';

/** Every control here is fictional. Sizes and state go through classes; nothing writes a `style` attribute (CSP `style-src 'self'`). */

function Sub({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="kit-sub" aria-labelledby={`kit-motion-${id}`} data-kit-sub={id}>
      <h3 id={`kit-motion-${id}`} className="kit-subheading">{title}</h3>
      {note && <p className="kit-note">{note}</p>}
      {children}
    </section>
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/* ---------- 1. Toasts ---------- */

function ToastsDemo() {
  const toast = useToast();
  const toasts = useToasts();
  const [log, setLog] = useState('No toast action yet');
  const loadingId = useRef<string | null>(null);
  const burst = useRef(0);
  useEffect(() => { window.hqKit = { ...window.hqKit, toast }; }, [toast]);

  const raiseBurst = () => {
    burst.current += 1;
    for (let index = 1; index <= 5; index += 1) toast.info(`Burst ${burst.current}.${index}: card synced`);
  };

  return (
    <Sub id="toasts" title="Toasts" note="One ToastViewport is mounted at the bottom-end corner. F8 jumps to the newest toast and back; Escape dismisses the focused toast; hover or focus pauses every timer.">
      <div className="kit-row" role="group" aria-label="Toast tones">
        <Button size="sm" onClick={() => toast.info('Board synced from this device')}>Info</Button>
        <Button size="sm" onClick={() => toast.success('Card saved')}>Success</Button>
        <Button size="sm" onClick={() => toast.warning('Saved with a caveat', { description: 'Two linked references are stale.' })}>Warning</Button>
        <Button size="sm" onClick={() => toast.error("Couldn't save the board", { description: 'Your move is kept on this device.' })}>Error</Button>
        <Button size="sm" onClick={() => toast.unknown('Save result unknown', { description: 'The Planner did not answer.', action: { label: 'Check', onAction: () => setLog('Check pressed') } })}>Unknown</Button>
        <Button size="sm" onClick={() => { loadingId.current = toast.loading('Exporting board…'); }}>Loading</Button>
        <Button size="sm" variant="ghost" onClick={() => { if (loadingId.current) { toast.update(loadingId.current, { tone: 'success', title: 'Board exported' }); loadingId.current = null; } }}>Resolve loading</Button>
      </div>
      <div className="kit-row" role="group" aria-label="Toast scenarios">
        <Button size="sm" variant="secondary" onClick={() => toast.show({
          title: 'Moved “Tasting-night signage” to Active', meta: 'Planning change only · no run started',
          action: { label: 'Undo', onAction: () => setLog('Undo pressed') },
        })}>Undo toast</Button>
        <Button size="sm" variant="secondary" onClick={() => { toast.promise(sleep(1600).then(() => 3), { loading: 'Exporting cards…', success: (n) => `Exported ${n} cards`, error: 'Export failed' }).catch(() => {}); }}>Promise resolves</Button>
        <Button size="sm" variant="secondary" onClick={() => { toast.promise(sleep(1600).then(() => { throw new Error('Planner offline'); }), { loading: 'Publishing board…', success: 'Published', error: (e) => `Publish failed: ${e instanceof Error ? e.message : String(e)}` }).catch(() => {}); }}>Promise rejects</Button>
        <Button size="sm" variant="secondary" onClick={() => { for (let n = 0; n < 3; n += 1) toast.info('Synced board'); }}>Repeat ×3</Button>
        <Button size="sm" variant="secondary" onClick={raiseBurst}>Burst of 5</Button>
        <Button size="sm" variant="danger" onClick={() => toast.dismiss()}>Dismiss all</Button>
      </div>
      <p className="kit-note" role="status" data-kit-toast-log>{log} · {toasts.length} in store</p>
    </Sub>
  );
}

/* ---------- 2. Inline notices ---------- */

const NOTICE_COPY: Record<NoticeTone, [string, string]> = {
  neutral: ['Board is read-only', 'Open it in Work to change cards.'],
  info: ['Showing the cached board', 'Nothing was refreshed since 14:02.'],
  success: ['Board refreshed', 'Everything is up to date.'],
  warning: ['Two references are stale', 'Last observed 3 days ago.'],
  danger: ["Couldn't refresh the board", 'Showing what loaded at 14:02. Nothing was changed.'],
  unknown: ['Save result unknown', 'The Planner did not answer. Check before retrying.'],
};

function NoticesDemo() {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [log, setLog] = useState('No notice action yet');
  const retry = () => { setBusy(true); setLog('Retry started'); void sleep(1600).then(() => { setBusy(false); setLog('Retry finished'); }); };

  return (
    <Sub id="notices" title="Inline notices" note="Banner variant, then the compact bar variant. The last banner collapses open and closed inside Presence.">
      <div className="kit-notices" data-kit-notices="banner">
        {NOTICE_TONES.map((tone) => (
          <InlineNotice key={tone} tone={tone} live="off" title={NOTICE_COPY[tone][0]}
            actions={tone === 'danger' ? [{ label: 'Retry', onAction: retry, busy, busyLabel: 'Retrying' }, { label: 'Details', onAction: () => setLog('Details') }]
              : tone === 'unknown' ? [{ label: 'Check', onAction: () => setLog('Check') }] : undefined}
            onDismiss={tone === 'info' ? () => setDismissed(true) : undefined}>
            {NOTICE_COPY[tone][1]}
          </InlineNotice>
        ))}
      </div>
      <div className="kit-notices" data-kit-notices="bar">
        {NOTICE_TONES.map((tone) => (
          <InlineNotice key={tone} tone={tone} variant="bar" live="off" title={NOTICE_COPY[tone][0]}
            actions={tone === 'danger' ? [{ label: 'Retry', onAction: retry, busy, busyLabel: 'Retrying' }] : tone === 'warning' ? [{ label: 'Refresh', onAction: () => setLog('Refresh') }] : undefined}>
            {NOTICE_COPY[tone][1]}
          </InlineNotice>
        ))}
      </div>
      <div className="kit-row">
        <Button size="sm" variant="secondary" aria-pressed={shown} onClick={() => setShown((value) => !value)}>{shown ? 'Hide' : 'Show'} collapsing notice</Button>
        {dismissed && <Button size="sm" variant="ghost" onClick={() => setDismissed(false)}>Restore dismissed info notice</Button>}
        <span className="kit-note" role="status">{log}</span>
      </div>
      <div className="kit-collapse-stage" data-kit-collapse-stage>
        <Presence show={shown} motion="collapse" data-kit-id="collapse-notice">
          <InlineNotice tone="danger" title="Couldn't refresh the board" actions={[{ label: 'Retry', onAction: retry, busy, busyLabel: 'Retrying' }]}>
            This notice collapses; the line below glides up and down with it.
          </InlineNotice>
        </Presence>
        <p className="kit-note" data-kit-below-collapse>Content below the notice. It moves with the collapse instead of jumping.</p>
      </div>
    </Sub>
  );
}

/* ---------- 3. Status indicators and field errors ---------- */

function IndicatorsDemo() {
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(true);
  const [title, setTitle] = useState('');
  const [touched, setTouched] = useState(false);
  const error = touched && title.trim().length < 3 ? 'Title needs at least 3 characters.' : '';
  const sync = () => { setSyncing(true); void sleep(1800).then(() => setSyncing(false)); };

  return (
    <Sub id="indicators" title="Status indicators and field errors">
      <div className="kit-row" data-kit-indicators>
        <StatusIndicator tone="success" label="Synced" detail="2 min ago" />
        <StatusIndicator tone="neutral" busy label="Syncing" />
        <StatusIndicator tone={syncing ? 'neutral' : 'warning'} busy={syncing} label={syncing ? 'Syncing' : 'Stale'} detail={syncing ? undefined : 'last observed 3 days ago'}
          action={syncing ? undefined : { label: 'Sync now', onAction: sync }} />
        {offline
          ? <StatusIndicator tone="danger" label="Offline" detail="showing saved copy" action={{ label: 'Reconnect', onAction: () => setOffline(false) }} />
          : <StatusIndicator tone="success" label="Online" action={{ label: 'Go offline', onAction: () => setOffline(true) }} />}
        <StatusIndicator tone="unknown" label="Unknown" detail="dispatch not confirmed" action={{ label: 'Check', onAction: () => {} }} />
      </div>
      <div className="kit-field">
        <label className="kit-field-label" htmlFor="kit-title">Card title</label>
        <input id="kit-title" className="kit-input" value={title} placeholder="At least 3 characters" autoComplete="off"
          onChange={(event) => setTitle(event.target.value)} onBlur={() => setTouched(true)} {...fieldErrorProps('kit-title-error', error)} />
        <FieldError id="kit-title-error" announce>{error}</FieldError>
      </div>
    </Sub>
  );
}

/* ---------- 4. Presence ---------- */

const PRESENCE_DEMO = PRESENCE_MOTIONS.filter((motion): motion is Exclude<PresenceMotion, 'toast'> => motion !== 'toast');

function PresenceDemo() {
  const [shown, setShown] = useState<Record<string, boolean>>(() => Object.fromEntries(PRESENCE_DEMO.map((motion) => [motion, true])));
  const setAll = (value: boolean) => setShown(Object.fromEntries(PRESENCE_DEMO.map((motion) => [motion, value])));
  return (
    <Sub id="presence" title="Presence" note="Each toggle mounts or unmounts a chip with that motion. Exit runs faster than enter.">
      <div className="kit-row">
        <Button size="sm" variant="secondary" onClick={() => setAll(false)}>Hide all</Button>
        <Button size="sm" variant="secondary" onClick={() => setAll(true)}>Show all</Button>
      </div>
      <div className="kit-presence-grid">
        {PRESENCE_DEMO.map((motion) => (
          <div key={motion} className="kit-presence-cell" data-kit-presence={motion}>
            <Button size="sm" variant={shown[motion] ? 'primary' : 'ghost'} aria-pressed={shown[motion]}
              onClick={() => setShown((current) => ({ ...current, [motion]: !current[motion] }))}>{motion}</Button>
            <div className="kit-stage">
              <Presence show={shown[motion] ?? false} motion={motion}>
                <div className="kit-chip">{motion}</div>
              </Presence>
            </div>
          </div>
        ))}
      </div>
    </Sub>
  );
}

/* ---------- 5. useListMotion ---------- */

interface Item { readonly id: string; readonly label: string }
const SEED: readonly Item[] = ['Write menu card copy', 'Order table linens', 'Print tasting-night signage', 'Confirm florist', 'Book sound check'].map((label, index) => ({ id: `item-${index + 1}`, label }));

function ListDemo() {
  const [items, setItems] = useState<readonly Item[]>(SEED);
  const next = useRef(SEED.length + 1);
  const listRef = useListMotion<HTMLUListElement>(items.map((item) => item.id));
  const shuffle = () => setItems((current) => {
    const copy = [...current];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[other]] = [copy[other]!, copy[index]!];
    }
    return copy;
  });
  const sort = () => setItems((current) => [...current].sort((a, b) => a.label.localeCompare(b.label)));
  const add = () => setItems((current) => { const id = next.current; next.current += 1; return [{ id: `item-${id}`, label: `New card ${id}` }, ...current]; });
  const remove = () => setItems((current) => current.slice(1));
  return (
    <Sub id="list" title="List motion" note="Shuffle and Sort glide items to their new place; Add inserts at the top; Remove drops the first.">
      <div className="kit-row">
        <Button size="sm" variant="secondary" onClick={shuffle}>Shuffle</Button>
        <Button size="sm" variant="secondary" onClick={sort}>Sort A–Z</Button>
        <Button size="sm" variant="secondary" onClick={add}>Add</Button>
        <Button size="sm" variant="secondary" onClick={remove} disabled={items.length === 0}>Remove</Button>
        <span className="hq-meta" data-kit-list-count>{items.length} items</span>
      </div>
      <ul ref={listRef} className="kit-list" data-kit-list>
        {items.map((item) => <li key={item.id} className="kit-list-item" data-hq-motion-key={item.id}>{item.label}</li>)}
      </ul>
    </Sub>
  );
}

/* ---------- 6. PageTransition ---------- */

const PAGES = [
  { id: 'overview', label: 'Overview', body: 'Overview panel: this week’s cards at a glance (fictional).' },
  { id: 'schedule', label: 'Schedule', body: 'Schedule panel: tasting night, florist call, sound check (fictional).' },
  { id: 'review', label: 'Review', body: 'Review panel: nothing waiting for you (fictional).' },
] as const;

function PageDemo() {
  const [index, setIndex] = useState(0);
  const go = (target: number) => {
    if (target === index) return;
    navigateWithTransition(() => setIndex(target), target > index ? 'forward' : 'back');
  };
  const page = PAGES[index]!;
  return (
    <Sub id="page" title="Page transition" note="navigateWithTransition swaps the panel through the View Transitions API: the old one fades out fast, the new one rises in.">
      <div className="kit-row" role="group" aria-label="Panels">
        {PAGES.map((candidate, position) => (
          <Button key={candidate.id} size="sm" variant={position === index ? 'primary' : 'ghost'} aria-pressed={position === index} onClick={() => go(position)}>{candidate.label}</Button>
        ))}
      </div>
      <div className="kit-page-stage" data-kit-page-stage>
        <PageTransition id={page.id}>
          <div className="kit-page-panel" data-kit-page={page.id}>
            <strong>{page.label}</strong>
            <span className="kit-note">{page.body}</span>
          </div>
        </PageTransition>
      </div>
    </Sub>
  );
}

/* ---------- 7. Skeleton and utility classes ---------- */

function UtilityDemo() {
  const [flash, setFlash] = useState(0);
  const [pressed, setPressed] = useState(0);
  return (
    <Sub id="utilities" title="Skeleton and utility classes">
      <div className="kit-skeletons" aria-busy="true" data-kit-skeletons>
        <div className="kit-skeleton-cell"><span className="hq-meta">text ×3</span><Skeleton shape="text" lines={3} /></div>
        <div className="kit-skeleton-cell"><span className="hq-meta">block</span><Skeleton shape="block" /></div>
        <div className="kit-skeleton-cell"><span className="hq-meta">block 96px</span><Skeleton shape="block" width="60%" height="96px" /></div>
        <div className="kit-skeleton-cell"><span className="hq-meta">circle</span><Skeleton shape="circle" width="40px" /></div>
      </div>
      <div className="kit-utilities">
        <div className="kit-utility">
          <span className="hq-meta">hq-stagger</span>
          <div className="hq-stagger kit-stagger" key="stagger">
            {['One', 'Two', 'Three', 'Four', 'Five'].map((label) => <span key={label} className="kit-chip">{label}</span>)}
          </div>
        </div>
        <div className="kit-utility">
          <span className="hq-meta">hq-press</span>
          <button type="button" className="hq-press kit-chip kit-chip-button" onClick={() => setPressed((n) => n + 1)}>Press and hold ({pressed})</button>
        </div>
        <div className="kit-utility">
          <span className="hq-meta">hq-lift</span>
          <div className="hq-lift kit-card" tabIndex={0}>Hover to lift</div>
        </div>
        <div className="kit-utility">
          <span className="hq-meta">hq-flash</span>
          <div key={flash} className={flash === 0 ? 'kit-card' : 'hq-flash kit-card'} data-kit-flash>Saved row</div>
          <Button size="sm" variant="secondary" onClick={() => setFlash((n) => n + 1)}>Flash</Button>
        </div>
        <div className="kit-utility">
          <span className="hq-meta">hq-shimmer-text</span>
          <span className="hq-shimmer-text kit-shimmer" data-kit-shimmer>Syncing…</span>
        </div>
      </div>
    </Sub>
  );
}

/* ---------- 8. ErrorBoundary ---------- */

function Crashable() {
  const [crashed, setCrashed] = useState(false);
  if (crashed) throw new Error('Fictional render failure');
  return (
    <div className="kit-crash-panel">
      <span className="kit-note">This panel renders normally until it is crashed.</span>
      <Button size="sm" variant="danger" onClick={() => setCrashed(true)}>Crash this panel</Button>
    </div>
  );
}

function BoundaryDemo() {
  const [caught, setCaught] = useState(0);
  return (
    <Sub id="boundary" title="Error boundary" note="A render crash stays inside the panel. React also logs the caught error to the console; that line is expected.">
      <div className="kit-boundary" data-kit-boundary>
        <ErrorBoundary title="The panel stopped working" onError={() => setCaught((n) => n + 1)}><Crashable /></ErrorBoundary>
      </div>
      <span className="hq-meta" data-kit-caught>{caught} {caught === 1 ? 'crash' : 'crashes'} caught · the rest of this page keeps working</span>
    </Sub>
  );
}

/* ---------- Section ---------- */

export function MotionFeedbackSection() {
  const reduced = useReducedMotion();
  return (
    <section className="kit-section" aria-labelledby="kit-motion" data-kit-section="motion" data-kit-reduced={reduced ? 'on' : 'off'}>
      <h2 id="kit-motion" className="kit-heading">Motion and feedback</h2>
      <p className="kit-note">Reduced motion is {reduced ? 'on' : 'off'}. Switch it in the header; the toggle writes <code>data-hq-motion</code> on the root.</p>
      <ToastsDemo />
      <NoticesDemo />
      <IndicatorsDemo />
      <PresenceDemo />
      <ListDemo />
      <PageDemo />
      <UtilityDemo />
      <BoundaryDemo />
      <ToastViewport />
    </section>
  );
}

/** Header switch for the shell's reduced-motion override (`<html data-hq-motion="reduce">`). */
export function ReducedMotionToggle({ initial }: { initial: boolean }) {
  const [reduce, setReduce] = useState(initial);
  useEffect(() => {
    const root = document.documentElement;
    if (reduce) root.setAttribute('data-hq-motion', 'reduce'); else root.removeAttribute('data-hq-motion');
  }, [reduce]);
  useEffect(() => {
    window.hqKit = { ...window.hqKit, setReducedMotion: setReduce };
  }, []);
  return (
    <Button size="sm" variant={reduce ? 'primary' : 'ghost'} role="switch" aria-checked={reduce} onClick={() => setReduce((value) => !value)} data-kit-reduced-toggle>
      Reduced motion
    </Button>
  );
}
