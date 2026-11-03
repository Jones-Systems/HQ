import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  FIXTURE_IDS, createFixtureWorkspace, socialSession, useSocialSession, workspaceSnapshot,
  type FixtureOptions, type SocialWorkspacePort,
} from '../../core';
import { BrandManager, SocialContent } from '..';
import './preview.css';

/**
 * Fixture-only evidence views: `?theme=light|dark&view=<name>`. Each view reaches its state
 * with fictional data and real DOM events, so a headless capture needs no automation protocol.
 */
const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const view = params.get('view') ?? 'library';
document.documentElement.dataset.theme = theme;

const NOW = () => new Date('2026-10-20T12:00:00Z');
const never = () => new Promise<void>(() => undefined);
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

async function until<T>(find: () => T | null | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = find();
    if (found) return found;
    await tick();
  }
  throw new Error(`Evidence view ${view} did not reach its state`);
}

function button(name: RegExp): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((item) => name.test(item.getAttribute('aria-label') ?? item.textContent ?? ''));
}

/** Sets a React-controlled field's value the way typing would. */
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

interface Scenario {
  readonly caption: string;
  readonly destination: string;
  readonly options?: FixtureOptions;
  readonly brands?: boolean;
  /** Drives the page into its state after the first render. */
  readonly drive?: (fixture: ReturnType<typeof createFixtureWorkspace>, port: SocialWorkspacePort) => Promise<void>;
}

const body = () => document.querySelector<HTMLTextAreaElement>('textarea')!;

const SCENARIOS: Record<string, Scenario> = {
  library: { caption: 'Library with a saved draft open', destination: `library/${FIXTURE_IDS.autumnBlend}` },
  unsaved: {
    caption: 'Unsaved changes, with links shown read-only', destination: `library/${FIXTURE_IDS.steepingThread}`,
    drive: async () => type(await until(body), `${body().value}\n2/ Start at two minutes and taste.`),
  },
  saving: {
    caption: 'Saving', destination: `library/${FIXTURE_IDS.openDay}`,
    drive: async () => {
      type(await until(body), `${body().value} Bring a friend.`);
      holdSaves = true;
      (await until(() => button(/^Save$/u))).click();
    },
  },
  conflict: {
    caption: 'Changed elsewhere: text kept, nothing overwritten', destination: `library/${FIXTURE_IDS.autumnBlend}`,
    drive: async (fixture) => {
      type(await until(body), 'My rewrite: four cups, and the fourth is a surprise.');
      fixture.controls.editElsewhere(FIXTURE_IDS.autumnBlend, { body: 'Their rewrite from another window.' });
      (await until(() => button(/^Save$/u))).click();
      await until(() => button(/^Save mine as a copy$/u));
    },
  },
  invalid: {
    caption: 'Validation message from the service rules', destination: 'library/new',
    drive: async () => {
      type(await until(body), 'A body without a title yet.');
      (await until(() => button(/^Save$/u))).click();
      await until(() => document.querySelector('[role="alert"]'));
    },
  },
  offline: {
    caption: 'Service unreachable: stale data labelled, saving paused, text kept', destination: `library/${FIXTURE_IDS.openDay}`,
    drive: async (fixture, port) => {
      type(await until(body), `${body().value} (edited while offline)`);
      fixture.controls.setUnavailable(true);
      await socialSession('preview').load(port);
    },
  },
  empty: { caption: 'Empty library', destination: 'library', options: { seed: { brands: [{ id: 'default', name: 'My workspace' }], content: [], runs: [] } } },
  loading: { caption: 'Loading', destination: 'library', options: { delay: never } },
  error: { caption: 'Service unreachable with no data', destination: 'library', drive: async () => undefined },
  calendar: { caption: 'Editorial calendar, October 2026, with the No date yet tray', destination: 'calendar/2026-10' },
  'calendar-move': {
    caption: 'Keyboard move dialog (Move to date / Clear date / Open draft)', destination: 'calendar/2026-10',
    drive: async () => {
      (await until(() => button(/^Steeping times thread/u))).click();
      await until(() => document.querySelector('[role="dialog"] input[type="date"]'));
    },
  },
  'calendar-moved': {
    caption: 'After a move: one versioned save, with Undo', destination: 'calendar/2026-10',
    drive: async () => {
      (await until(() => button(/^Steeping times thread/u))).click();
      type(await until(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="date"]')), '2026-10-15');
      await tick();
      (await until(() => button(/^Move to date$/u))).click();
      await until(() => button(/^Undo$/u));
    },
  },
  brands: {
    caption: 'Brands: the built-in brand is present, not created; an empty name gets the service message', destination: 'library', brands: true,
    drive: async () => {
      (await until(() => button(/^Add brand$/u))).click();
      await until(() => document.querySelector('.soc-brands [role="alert"]'));
    },
  },
};

let holdSaves = false;
const scenario = SCENARIOS[view] ?? SCENARIOS.library!;
const fixture = createFixtureWorkspace({
  ...scenario.options,
  delay: scenario.options?.delay ?? (() => (holdSaves ? never() : Promise.resolve())),
});
if (view === 'error') fixture.controls.setUnavailable(true);

function Page() {
  const [destination, setDestination] = useState(scenario.destination);
  const { state, session } = useSocialSession('preview');
  const snapshot = workspaceSnapshot(state.workspace);
  return (
    <main className="preview" data-view={view}>
      <p className="preview-caption">Fictional fixture · {theme} · {scenario.caption}</p>
      {scenario.brands && snapshot && <BrandManager session={session} port={fixture.port} snapshot={snapshot} />}
      <SocialContent port={fixture.port} projectId="preview" destination={destination} navigate={setDestination} now={NOW} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);

void (async () => {
  if (scenario.drive) {
    if (view !== 'error' && view !== 'loading') await until(() => document.querySelector('.soc-content'));
    await scenario.drive(fixture, fixture.port);
  }
  await tick();
  document.documentElement.dataset.ready = 'true';
})().catch((error: unknown) => {
  document.body.dataset.evidenceError = String(error);
});
