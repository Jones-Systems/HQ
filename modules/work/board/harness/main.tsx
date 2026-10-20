import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createFixturePlanner, createWorkStore, DEFAULT_SETTINGS, exampleItems, HQ_REFERENCES_FEATURE, PLANNER_PORT_KEYS,
  plannerToday, useWorkState, withFaults, type Item, type ItemPatch, type PlannerPort, type Status,
} from '../../core';
import { createDraftStore, DraftsPanel, QuickCapture, useCaptureShortcut } from '../../capture';
import { CardDetail, createDetailState } from '../../detail';
import { createFeedback } from '../feedback';
import { StatusBoard } from '../StatusBoard';
import { SyncBanners } from '../SyncStatus';
import { useUndoShortcut, WorkToasts } from '../WorkToasts';
import './harness.css';

// Evidence harness: the real board, detail and capture over the fictional fixture
// Planner. Transport faults and the "other device" are synthetic; the page is
// served only from a loopback static build.

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;

const STAMP = '2026-10-01T15:00:00.000Z';
const today = plannerToday(DEFAULT_SETTINGS, new Date());

function extra(id: string, title: string, status: Status, position: number, fields: Partial<Item> = {}): Item {
  return {
    id, revision: 1, title, kind: 'idea', status, motivation: null, horizon: null, priority: null, area: null, notes: '',
    next_steps: [], references: [], dates: [], position, is_example: true, created_at: STAMP, updated_at: STAMP,
    archived_at: null, reviewed_at: null, ...fields,
  };
}

const ITEMS: Item[] = [
  ...exampleItems(today),
  extra('hx-seeds', 'Sort the seed packets', 'inbox', 4096, { kind: 'chore' }),
  extra('hx-zine', 'Draft a garden zine', 'considering', 2048, {
    motivation: 'exploring', horizon: 'soon', area: 'Garden',
    next_steps: [{ id: 'st-1', text: 'Pick a paper size', done: true }, { id: 'st-2', text: 'Sketch the cover', done: false }],
    references: [{
      id: 'ref-hq-post', kind: 'hq', label: 'Spring post',
      target: { version: 1, domain: 'social', projectId: 'fixture-project', kind: 'draft', entityId: 'draft-1', title: 'Spring post', returnDestination: { domain: 'work', destination: 'home' } },
    }],
  }),
];

/** Counts every port call by method, for the on-page call log. */
function counted(inner: PlannerPort) {
  const counts = new Map<string, number>();
  const listeners = new Set<() => void>();
  let version = 0;
  const port = Object.fromEntries(PLANNER_PORT_KEYS.map((key) => [key, (...args: unknown[]) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    version += 1;
    listeners.forEach((listener) => listener());
    return (inner[key] as (...a: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as PlannerPort;
  return {
    port,
    counts,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    version: () => version,
  };
}

const fixture = createFixturePlanner({ items: ITEMS, features: [HQ_REFERENCES_FEATURE] });
const faulty = withFaults(fixture.port);
const log = counted(faulty.port);
const store = createWorkStore(log.port);
const feedback = createFeedback();
const drafts = createDraftStore();
const detail = createDetailState();
let otherRequest = 0;

/** A write from a synthetic second device, straight to the fixture Planner. */
async function editElsewhere(id: string, patch: ItemPatch) {
  const current = (await fixture.port.snapshot()).items.find((item) => item.id === id);
  if (current) await fixture.port.patch(id, current.revision, patch, `other-device-${(otherRequest += 1)}`);
}

let prepared = false;

async function prepare(open: string | null) {
  if (prepared) return;
  prepared = true;
  await store.load();
  const scenario = params.get('scenario');
  if (scenario === 'conflict' && open) {
    const item = store.getState().confirmed!.items.find((candidate) => candidate.id === open)!;
    detail.setBuffer(open, 'notes', { text: `${item.notes} Mine: two thin coats.`.trim(), base: item.notes });
    await editElsewhere(open, { notes: `${item.notes} Theirs: one thick coat.`.trim() });
    await store.poll();
  }
  if (scenario === 'unconfirmed') {
    faulty.faults.next('lose-response');
    const item = store.getState().items.find((candidate) => candidate.id === 'hx-seeds')!;
    await store.move(item.id, 'next', { place: 'top' });
  }
  if (params.has('offline')) {
    faulty.faults.readsUnavailable(true);
    await store.poll();
  }
}

function Harness() {
  const state = useWorkState(store);
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(params.get('open'));
  const [capture, setCapture] = useState<Status | null>(params.has('capture') ? 'inbox' : null);
  const [appearance, setAppearance] = useState(theme);
  const [offline, setOffline] = useState(params.has('offline'));
  useSyncExternalStore(log.subscribe, log.version);
  useUndoShortcut(root, store, feedback);
  useCaptureShortcut(root, () => setCapture('inbox'));
  useEffect(() => { void prepare(params.get('open')); }, []);
  useEffect(() => { document.documentElement.dataset.theme = appearance; }, [appearance]);

  const toggleOffline = async () => {
    faulty.faults.readsUnavailable(!offline);
    setOffline(!offline);
    await store.poll();
  };
  const calls = [...log.counts].map(([method, n]) => `${method} ×${n}`).join(' · ');

  return (
    <div className="harness">
      <header className="harness-bar" aria-label="Harness controls">
        <strong>Work board harness</strong>
        <span className="harness-note">Fictional fixture Planner · synthetic faults · not the app shell</span>
        <span className="harness-group" role="group" aria-label="Theme">
          <button type="button" aria-pressed={appearance === 'light'} onClick={() => setAppearance('light')}>Light</button>
          <button type="button" aria-pressed={appearance === 'dark'} onClick={() => setAppearance('dark')}>Dark</button>
        </span>
        <button type="button" aria-pressed={offline} onClick={() => void toggleOffline()}>Planner offline</button>
        <button type="button" onClick={() => faulty.faults.next('lose-response')}>Lose next response</button>
      </header>
      <div className={`harness-main${open ? ' harness-main--detail' : ''}`} ref={root}>
        <div className="harness-board work-ui">
          <SyncBanners store={store} state={state} />
          <DraftsPanel drafts={drafts} store={store} feedback={feedback} />
          <StatusBoard store={store} state={state} feedback={feedback} selectedId={open} onOpenItem={setOpen} onCapture={setCapture} />
        </div>
        {open && <CardDetail store={store} state={state} feedback={feedback} itemId={open} onClose={() => setOpen(null)} detail={detail} />}
        <QuickCapture open={capture !== null} initialStatus={capture ?? 'inbox'} onClose={() => setCapture(null)} store={store} state={state} feedback={feedback} drafts={drafts} />
        <WorkToasts store={store} state={state} feedback={feedback} />
      </div>
      <footer className="harness-log" aria-label="Port calls">
        Port calls: {calls || 'none yet'}. The port has only Planner reads and writes; it has no execution member.
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
