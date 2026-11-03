import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@hq/ui';
import {
  createFixturePlanner, createWorkStore, withFaults, type Filters, type PlannerPort, type WorkStore,
} from '../../core';
import { VIEW_NOW, viewItems } from '../fixtures';
import { PLANNING_VIEW_IDS, PlanningViews, type PlanningViewId } from '..';
import { WorkDomain } from '../../nav/WorkDomain';
import { setWorkSessionPort } from '../../nav/session';
import { SocialContent } from '../../../social/content';
import { createFixtureWorkspace } from '../../../social/core';
import './page.css';

// Evidence page for task.work-views.001: every planning view, and the RS-3
// state matrix, rendered from the fictional fixture under the app's exact CSP.
// ?view=<id>&theme=light|dark[&act=move]   one view (act=move shows the Undo toast)
// ?states&theme=light|dark                 loading, unavailable, error, empty, saving, unknown, offline, conflict
// Nothing here reaches a network: the fixture adapter is in memory and connect-src is 'none'.

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
const fixedNow = () => new Date(VIEW_NOW);

function ticking() {
  let t = Date.parse(VIEW_NOW);
  return () => new Date((t += 1000));
}

function fixture(items = viewItems()) {
  const planner = createFixturePlanner({ items, now: ticking() });
  const faulty = withFaults(planner.port);
  return { device: planner.port, faults: faulty.faults, port: faulty.port };
}

/** Never answers a snapshot, so the loading state stays on screen. */
function silent(port: PlannerPort): PlannerPort {
  return { ...port, snapshot: () => new Promise(() => {}) };
}

/** Holds writes in flight, so the saving state stays on screen. */
function holding(port: PlannerPort): PlannerPort {
  const wait = <T,>(): Promise<T> => new Promise(() => {});
  return { ...port, patch: wait, move: wait, setArchived: wait, markReviewed: wait, updateSettings: wait, create: wait };
}

const STATES = ['loading', 'unavailable', 'error', 'empty', 'saving', 'unknown', 'offline', 'conflict'] as const;
type StateName = (typeof STATES)[number];

async function stateStore(name: StateName): Promise<{ store: WorkStore; view: PlanningViewId; filters?: Filters }> {
  const f = fixture(name === 'empty' ? [] : viewItems());
  const make = (port: PlannerPort) => createWorkStore(port, { now: ticking() });
  switch (name) {
    case 'loading': return { store: make(silent(f.port)), view: 'glance' };
    case 'unavailable': { f.faults.readsUnavailable(true); const store = make(f.port); await store.load(); return { store, view: 'list' }; }
    case 'error': {
      const store = make(f.port);
      await store.load();
      return { store, view: 'list', filters: new Proxy({} as Filters, { get: () => { throw new Error('fictional render failure'); } }) };
    }
    case 'empty': { const store = make(f.port); await store.load(); return { store, view: 'glance' }; }
    case 'saving': { const store = make(holding(f.port)); await store.load(); void store.patch('ex-old-recipes', { notes: 'Fictional note' }); return { store, view: 'archive' }; }
    case 'unknown': { const store = make(f.port); await store.load(); f.faults.next('lose-response'); await store.patch('ex-old-recipes', { notes: 'Fictional note' }); return { store, view: 'archive' }; }
    case 'offline': { const store = make(f.port); await store.load(); f.faults.next('unavailable'); await store.patch('ex-old-recipes', { notes: 'Fictional note' }); return { store, view: 'archive' }; }
    case 'conflict': {
      const store = make(f.port);
      await store.load();
      await f.device.patch('ex-old-recipes', 1, { notes: 'Changed on another device' }, 'evidence-device-0001');
      await store.patch('ex-old-recipes', { notes: 'Fictional note' });
      return { store, view: 'archive' };
    }
  }
}

/** Moves the shed deadline one day later from the keyboard, as a person would, so the Undo toast shows. */
function MoveOnce() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const chip = document.querySelector<HTMLElement>('.wv-cal-chip[data-item-id="ex-shed-paint"] button');
      chip?.focus();
      chip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

function DomainFixture() {
  const [destination, navigate] = useState('home');
  return <div className="ev-domain" data-hq-chrome=""><WorkDomain context={{ id: 'synthetic-layout', name: 'Synthetic layout' }}
    destination={destination} navigate={navigate} appearance={theme} desktop={{ platform: 'browser', versions: { electron: null } }}
    now={fixedNow} pollMs={3_600_000} /></div>;
}
const socialFixture = createFixtureWorkspace(params.has('empty') ? { seed: { brands: [{ id: 'default', name: 'Synthetic workspace' }], content: [], runs: [] } } : {});
function SocialFixture() {
  const [destination, navigate] = useState(params.has('empty') ? 'library' : 'calendar/2026-10');
  return <div className="ev-page"><SocialContent projectId="synthetic-calendar" port={socialFixture.port}
    destination={destination} navigate={navigate} now={fixedNow} /></div>;
}

async function main() {
  const root = createRoot(document.getElementById('root')!);
  if (params.has('domain')) {
    setWorkSessionPort(fixture(params.has('empty') ? [] : viewItems()).port);
    root.render(<DomainFixture />); return;
  }
  if (params.has('social')) { root.render(<SocialFixture />); return; }
  if (params.has('states')) {
    const stores = await Promise.all(STATES.map(async (name) => ({ name, ...(await stateStore(name)) })));
    root.render(
      <StrictMode>
        <main className="ev-page">
          <header className="ev-head"><h1 className="ev-title">Work views · state matrix</h1><span className="ev-meta">{theme} · fictional fixture · app CSP</span></header>
          <div className="ev-states">
            {stores.map(({ name, store, view, filters }) => (
              <section key={name} className="ev-state" data-ev-state={name}>
                <p className="ev-state-label">{name} · {view}</p>
                <PlanningViews store={store} view={view} filters={filters} now={fixedNow} pollMs={3_600_000} />
              </section>
            ))}
          </div>
        </main>
      </StrictMode>,
    );
    return;
  }
  const requested = params.get('view') as PlanningViewId | null;
  const view = requested && (PLANNING_VIEW_IDS as readonly string[]).includes(requested) ? requested : 'glance';
  const f = fixture();
  const store = createWorkStore(f.port, { now: ticking() });
  await store.load();
  root.render(
    <StrictMode>
      <main className="ev-page">
        <header className="ev-head"><h1 className="ev-title">Work · {view}</h1><span className="ev-meta">{theme} · fictional fixture · app CSP · today Wed, Oct 21 2026</span></header>
        <PlanningViews store={store} view={view} now={fixedNow} pollMs={3_600_000} openItem={() => {}} editDate={() => {}} navigate={() => {}} />
        {params.get('act') === 'move' && <MoveOnce />}
      </main>
    </StrictMode>,
  );
}

void main();
