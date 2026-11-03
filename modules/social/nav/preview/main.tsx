import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ModulePort, ReferenceEnvelope } from '@hq/contracts';
import { ToastViewport, toastStore, type ReferencePort } from '@hq/ui';
import {
  DEFAULT_BRAND_ID, FEATURE_HQ_BRAND_PROJECT, FEATURE_HQ_EDITORIAL_TIMEBOX, FEATURE_HQ_REFERENCES, FIXTURE_IDS, FIXTURE_PROJECT_ID, fictionalSeed, socialSession, workspaceSnapshot,
  type Channel, type Draft, type FixtureOptions, type FixtureRun, type FixtureSeed,
} from '../../core';
import { createWorkbenchFixture, type WorkbenchFixture } from '../../workbench/fixtures/examples';
import { createSocialReferenceProvider } from '../../references';
import { SocialDomain, setSocialWorkspacePort, socialWorkspacePort } from '..';
import './preview.css';

/**
 * Fixture-only evidence views: `?theme=light|dark&view=<name>`. The domain mounts on the module-level
 * workspace port, as the registry entry does, with a fixed clock so captures are repeatable. Each view
 * reaches its state with fictional data and real DOM events, so a headless capture needs no automation protocol.
 */
const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const view = params.get('view') ?? 'overview';
document.documentElement.dataset.theme = theme;

const NOW = () => new Date('2026-10-20T12:00:00Z');
const CONTEXT = { id: FIXTURE_PROJECT_ID, name: 'Larkspur project' };
const never = () => new Promise<void>(() => undefined);
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const LINKED = [FEATURE_HQ_REFERENCES, FEATURE_HQ_BRAND_PROJECT];

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

/** Sets a React-controlled field's value the way user input would. */
function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, event: 'input' | 'change' = 'input') {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event(event, { bubbles: true }));
}

let holdSaves = false;
const composerBody = () => document.querySelector<HTMLTextAreaElement>('.soc-cmp .soc-field--body textarea');
const composerChannel = () => document.querySelector<HTMLSelectElement>('.soc-cmp-details select[id$="-channel"]');
const OVER_LIMIT = 'Most bitterness is a timing problem, not a leaf problem. Start at two minutes, taste, and only then decide whether a third '
  + 'steep is worth the wait. #tea #steeping We tested six blends over three weekends and wrote down every minute, because guessing '
  + 'is how a good leaf gets a bad name. Read the full notes at https://example.invalid/steeping and tell us which cup surprised you.';
/** A run citation as a workbench result hands it over. */
const RUN_CITATION: ReferenceEnvelope = {
  version: 1, domain: 'social', projectId: FIXTURE_PROJECT_ID, kind: 'run', entityId: 'a'.repeat(32), title: 'Signal inbox run · 2026-10-18 · example',
  returnDestination: { domain: 'social', destination: 'library' }, sourceRevision: '2026-10-18',
};

const brandSelect = () => document.querySelector<HTMLSelectElement>('.sd-brand select:not([disabled])');
const chooseBrand = async (brandId: string) => setValue(await until(brandSelect), brandId, 'change');

const fixtureDraft = (n: number, title: string, channel: Channel, brand: string, date: string, slot: Draft['planning_slot'] = null): Draft => ({
  id: `d${(100 + n).toString(16).padStart(31, '0')}`, title, body: '', brand_id: brand, channel, planned_date: date, planning_slot: slot,
  archived: 0, version: 1, updated_at: '2026-10-18T09:00:00+00:00',
});
const at = (start: string, duration_minutes = 30): Draft['planning_slot'] => ({ start, duration_minutes, timezone: 'UTC' });

/** A planned fortnight: several channels, a busy day, a long title, timed and untimed entries, and two undated drafts. */
function plannedSeed(): FixtureSeed {
  const seed = fictionalSeed();
  const { larkspur, harbor } = FIXTURE_IDS;
  seed.content.push(
    fixtureDraft(1, 'Cupping hour: three steeping times, one leaf, and what each cup teaches us about bitterness', 'X', larkspur, '2026-10-20', at('09:00', 60)),
    fixtureDraft(2, 'Wholesale price list refresh', 'LinkedIn', larkspur, '2026-10-20', at('13:30')),
    fixtureDraft(3, 'Behind the blend: sourcing notes', 'Article', larkspur, '2026-10-20'),
    fixtureDraft(4, 'Autumn window display', 'Instagram', harbor, '2026-10-22', at('11:00', 45)),
    fixtureDraft(5, 'Saturday market reel', 'TikTok', harbor, '2026-10-24', at('08:30', 60)),
    fixtureDraft(6, 'Market day thread', 'Reddit', larkspur, '2026-10-27', at('10:00')),
    fixtureDraft(7, 'Loyalty card update', 'Facebook', harbor, '2026-10-28'),
    fixtureDraft(8, 'Starter jar reminder', 'General', harbor, '2026-10-30', at('16:00')),
  );
  seed.content.push(fixtureDraft(9, 'Gift box idea list', 'LinkedIn', larkspur, ''));
  return seed;
}

/** Two runs from today and one from yesterday, so the timeline opens with a Today group and an active run. */
function recentRuns(): FixtureRun[] {
  const done = (n: number, tool: FixtureRun['record']['tool'], created: string, finished: string): FixtureRun => ({
    record: { id: `e${(100 + n).toString(16).padStart(31, '0')}`, tool, status: 'succeeded', is_example: 0, created_at: created, finished_at: finished, error: null },
  });
  return [
    { record: { id: `e${(100).toString(16).padStart(31, '0')}`, tool: 'x-studio', status: 'running', is_example: 0, created_at: '2026-10-20T11:48:00+00:00', finished_at: null, error: null } },
    done(1, 'seo-studio', '2026-10-20T09:15:00+00:00', '2026-10-20T09:15:07+00:00'),
    done(2, 'x-intelligence', '2026-10-19T08:30:00+00:00', '2026-10-19T08:32:05+00:00'),
  ];
}

/** A missing comma after the first item: the check reports line 5, column 5. */
const BROKEN_FEED = `{
  "version": "https://jsonfeed.org/version/1.1",
  "items": [
    { "id": "example-item-1", "title": "A line that forgets its comma" }
    { "id": "example-item-2", "title": "So the file stops here" }
  ]
}
`;

/** Reads every link as unreachable, as the shell does while its reference providers have no live service to read. */
const UNREACHABLE_REFERENCES: ReferencePort = {
  find: async () => [],
  resolve: async () => ({ status: 'unavailable', observedAt: '2026-10-20T12:00:00Z' }),
  open: () => undefined,
};


const loadExampleButton = () => button(/^Load example$/u);
const runButton = () => document.querySelector<HTMLButtonElement>('.sw-run .sw-run-row button');
const lastRunId = (fixture: WorkbenchFixture) => fixture.controls.inspect().runs.at(-1)!.id;
const labelled = (text: string) => [...document.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(text));
const controlOf = <T extends HTMLElement>(text: string) => {
  const label = labelled(text);
  return label ? document.getElementById(label.getAttribute('for') ?? '') as T | null : null;
};

/** Loads the tool's example and presses Run, as a person would; the run is created by the fixture, not by the harness. */
async function runExample() {
  (await until(loadExampleButton)).click();
  await until(() => document.querySelector('.sw-source:not(.sw-hint)'));
  (await until(runButton)).click();
  await until(() => document.querySelector('.sw-stepper'));
}

/** Brings the results panel to the top of the view, as a person scrolling to a finished run would. */
const showResultsPanel = () => document.querySelector('.sw-results')?.scrollIntoView({ block: 'start' });

/** Sets a file on a typed import slot the way the browser's file picker would. */
function chooseFile(input: HTMLInputElement, name: string, text: string) {
  const data = new DataTransfer();
  data.items.add(new File([text], name, { type: 'application/json' }));
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

interface Scenario {
  readonly caption: string;
  readonly destination: string;
  readonly options?: FixtureOptions;
  /** Runs before the first render, for state another page would have left behind. */
  readonly prepare?: () => void;
  /** The domain's clock, when the view needs a different day from the default. */
  readonly now?: () => Date;
  /** A reference service, or 'fixture' for one backed by the fixture workspace, for views that show what Open does or list a draft's links; the others run without one, as a standalone mount does. */
  readonly references?: ReferencePort | 'fixture';
  readonly drive?: (fixture: WorkbenchFixture) => Promise<void>;
}

const SCENARIOS: Record<string, Scenario> = {
  overview: { caption: 'Overview, all brands', destination: 'home' },
  'overview-brand': {
    caption: 'Overview for a brand whose proposed project link matches this HQ project', destination: 'home', options: { features: LINKED },
    drive: () => chooseBrand(FIXTURE_IDS.larkspur),
  },
  mismatch: {
    caption: 'Project mismatch: HQ does not switch; Switch HQ project disabled with its reason', destination: 'home', options: { features: LINKED },
    drive: () => chooseBrand(FIXTURE_IDS.harbor),
  },
  'overview-past': {
    caption: 'Overview with nothing planned from today on: the nearest past dates, labelled Past', destination: 'home',
    now: () => new Date('2026-12-01T12:00:00Z'),
  },
  'overview-attention': {
    caption: 'Overview with an unsaved draft above the failed and interrupted runs', destination: 'home',
    drive: async () => {
      const session = socialSession(CONTEXT.id);
      await session.load(socialWorkspacePort());
      const draft = (await until(() => workspaceSnapshot(session.getState().workspace))).content.find((item) => item.id === FIXTURE_IDS.steepingThread);
      if (!draft) throw new Error('The fixture draft is missing');
      session.openEditor(draft.id, draft);
      session.editDraft(draft.id, { body: `${draft.body}\n2/ Start at two minutes and taste.` });
    },
  },
  sources: { caption: 'Sources: the import desk, with saved sources proposed', destination: 'sources' },
  'sources-imported': {
    caption: 'Sources: a fictional file checked on this device, not saved, with the workbench that reads it', destination: 'sources',
    drive: async () => {
      (await until(() => button(/^Use fictional example$/u))).click();
      await until(() => document.querySelector('.sd-detail'));
    },
  },
  'sources-error': {
    caption: 'Sources: a broken file dropped on the desk, the error named by line and column, focus on the message', destination: 'sources',
    drive: async () => {
      // The product has no broken-file button: the harness drops a file with a missing comma, as a person would.
      const zone = await until(() => document.querySelector('.sd-drop'));
      const data = new DataTransfer();
      data.items.add(new File([BROKEN_FEED], 'example-broken-feed.json', { type: 'application/json' }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      await until(() => document.querySelector('.sd-problem'));
    },
  },
  'overview-links': {
    caption: 'Overview: a link whose owner can\'t be reached keeps Open disabled, with the reason beside it', destination: 'home',
    references: UNREACHABLE_REFERENCES,
  },
  'sources-dragging': {
    caption: 'Sources: a file held over the drop zone', destination: 'sources',
    drive: async () => {
      const zone = await until(() => document.querySelector('.sd-drop'));
      const data = new DataTransfer();
      data.items.add(new File(['{}'], 'feed.json', { type: 'application/json' }));
      zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }));
    },
  },
  channels: {
    caption: 'Channels & accounts: honest capability page; Connect account changes nothing', destination: 'channels',
    drive: async () => (await until(() => button(/^Connect account…$/u))).click(),
  },
  library: {
    caption: 'Library mounted in the domain, with unsaved text', destination: `library/${FIXTURE_IDS.steepingThread}`,
    drive: async () => {
      const body = await until(() => document.querySelector<HTMLTextAreaElement>('textarea'));
      setValue(body, `${body.value}\n2/ Start at two minutes and taste.`);
    },
  },
  'library-open': { caption: 'Library: a saved draft open beside the list', destination: `library/${FIXTURE_IDS.autumnBlend}` },
  'library-over': {
    caption: 'Composer: past the illustrative X limit; the preview marks the overflow and nothing blocks saving', destination: `library/${FIXTURE_IDS.steepingThread}`,
    drive: async () => {
      setValue(await until(composerChannel), 'X', 'change');
      setValue(await until(composerBody), OVER_LIMIT);
    },
  },
  'library-saved': {
    caption: 'Composer: after Save, the bar reads Saved with the new version and time', destination: `library/${FIXTURE_IDS.openDay}`,
    drive: async () => {
      const text = await until(composerBody);
      setValue(text, `${text.value} Bring a friend.`);
      (await until(() => button(/^Save draft/u))).click();
      await until(() => [...document.querySelectorAll('.soc-save-status')].find((node) => /Saved v2/u.test(node.textContent ?? '')));
    },
  },
  'library-saving': {
    caption: 'Composer: Saving…, with the fields read-only while the save is in flight', destination: `library/${FIXTURE_IDS.openDay}`,
    options: { delay: () => (holdSaves ? never() : Promise.resolve()) },
    drive: async () => {
      const text = await until(composerBody);
      setValue(text, `${text.value} Bring a friend.`);
      holdSaves = true;
      (await until(() => button(/^Save draft/u))).click();
    },
  },
  'library-conflict': {
    caption: 'Changed elsewhere: nothing overwritten, text kept, choices in the save bar', destination: `library/${FIXTURE_IDS.autumnBlend}`,
    drive: async (fixture) => {
      setValue(await until(composerBody), 'My rewrite: four cups, and the fourth is a surprise.');
      fixture.controls.editElsewhere(FIXTURE_IDS.autumnBlend, { body: 'Their rewrite from another window.' });
      (await until(() => button(/^Save draft/u))).click();
      await until(() => button(/^Save mine as a copy$/u));
    },
  },
  'library-invalid': {
    caption: 'Validation: the service message sits on the field, focus moves to it and the text is kept', destination: 'library/new',
    drive: async () => {
      setValue(await until(composerBody), 'A body without a title yet.');
      (await until(() => button(/^Save draft/u))).click();
      await until(() => document.querySelector('.hq-field-error'));
    },
  },
  'library-empty': {
    caption: 'Empty library', destination: 'library',
    options: { seed: { brands: [{ id: 'default', name: 'My workspace' }], content: [], runs: [] } },
  },
  'library-filtered': {
    caption: 'Filters narrowed to nothing: one way back', destination: 'library',
    drive: async () => {
      const search = await until(() => document.querySelector<HTMLInputElement>('.soc-lib-search input'));
      setValue(search, 'no such draft');
    },
  },
  'library-handoff': {
    caption: 'Start draft from a run result: the composer opens prefilled, with the run it came from in view', destination: 'library/new',
    prepare: () => {
      socialSession(CONTEXT.id).openEditor('new', null, {
        title: 'EXAMPLE — Signal inbox findings · 2026-10-18',
        body: 'Signal inbox findings · 2026-10-18\n\nThree neighbourhood groups asked about seed swaps this month. A short post asking which seeds people would bring could start the thread.\n\nSource: Signal inbox run, example data as of 2026-10-18.',
        brand_id: 'default', channel: 'General', planned_date: '', archived: 0, links: [RUN_CITATION],
      });
    },
    options: { features: LINKED },
    references: 'fixture',
  },
  'library-links': {
    caption: 'Links in plain words: title, where it lives and its status; the paste tool stays behind Advanced', destination: `library/${FIXTURE_IDS.steepingThread}`,
    options: { features: LINKED }, references: 'fixture',
  },
  'library-advanced': {
    caption: 'Advanced (opened): the paste tool and each link’s raw record', destination: `library/${FIXTURE_IDS.steepingThread}`,
    options: { features: LINKED }, references: 'fixture',
    drive: async () => (await until(() => button(/^Advanced$/u))).click(),
  },
  'library-offline': {
    caption: 'Service unreachable while writing: the page and the text stay, saving is paused with its reason', destination: `library/${FIXTURE_IDS.openDay}`,
    drive: async (fixture) => {
      const text = await until(composerBody);
      setValue(text, `${text.value} (edited while offline)`);
      fixture.controls.setUnavailable(true);
      await socialSession(CONTEXT.id).load(socialWorkspacePort());
    },
  },
  calendar: { caption: 'Calendar mounted in the domain', destination: 'calendar/2026-10' },
  'calendar-planned': {
    caption: 'Calendar with a planned fortnight and timed entries', destination: 'calendar/2026-10',
    options: { features: [FEATURE_HQ_REFERENCES, FEATURE_HQ_EDITORIAL_TIMEBOX], seed: plannedSeed() },
  },
  'calendar-offline': {
    caption: 'Calendar inside the frame while the service is unreachable: the frame bar says changes are paused; chips are disabled', destination: 'calendar/2026-10',
    options: { features: [FEATURE_HQ_REFERENCES, FEATURE_HQ_EDITORIAL_TIMEBOX], seed: plannedSeed() },
    drive: async (fixture) => {
      await until(() => document.querySelector('.cal-chip'));
      fixture.controls.setUnavailable(true);
      await socialSession(CONTEXT.id).load(socialWorkspacePort());
    },
  },
  workbenches: { caption: 'Workbenches mounted in the domain, with the delivered limits', destination: 'workbenches' },
  'workbench-tool': {
    caption: 'A workbench page: the tool rail, the example loaded, nothing run yet', destination: 'workbenches/x-intelligence',
    drive: async () => { (await until(loadExampleButton)).click(); await until(() => document.querySelector('.sw-source:not(.sw-hint)')); },
  },
  'workbench-running': {
    caption: 'An example run in progress: the stepper at Running', destination: 'workbenches/x-intelligence',
    drive: async (fixture) => {
      await runExample();
      fixture.controls.advanceRuns(undefined, lastRunId(fixture));
      await until(() => document.querySelector('.sw-stepper [data-step="running"][data-state="active"]'));
      showResultsPanel();
    },
  },
  'workbench-results': {
    caption: 'A finished example run: the stepper at Succeeded, summary tiles and the results table, labelled Example data', destination: 'workbenches/x-intelligence',
    drive: async (fixture) => {
      await runExample();
      fixture.settle(lastRunId(fixture));
      await until(() => document.querySelector('.sw-result .sx-table'));
      await until(() => toastStore.getSnapshot().length > 0);
      // The finish toast is covered by its own view; clear it so the receipt reads in full here.
      toastStore.dismiss();
      showResultsPanel();
    },
  },
  'workbench-finish-toast': {
    caption: 'The toast raised when a run finishes while its receipt is open, with View results', destination: 'workbenches/x-intelligence',
    drive: async (fixture) => {
      await runExample();
      fixture.settle(lastRunId(fixture));
      await until(() => document.querySelector('.sw-result .sx-table'));
      showResultsPanel();
    },
  },
  'workbench-waits-here': {
    caption: 'A run on your own input in the example workspace: it waits here, nothing sent, with Set up Social service', destination: 'workbenches/x-studio',
    drive: async () => {
      setValue(await until(() => controlOf<HTMLTextAreaElement>('Rough notes')), 'A note about the Saturday cupping hour, in my own words.');
      (await until(runButton)).click();
      await until(() => button(/^Set up Social service$/u));
      showResultsPanel();
    },
  },
  'workbench-validation': {
    caption: 'Run blocked by validation: a problem summary with focus, and the fields it names', destination: 'workbenches/creator-relationships',
    drive: async () => { (await until(runButton)).click(); await until(() => document.querySelector('[role="alert"]')); },
  },
  'workbench-import-error': {
    caption: 'A file that is not valid JSON: the error names the file, and focus returns to the slot', destination: 'workbenches/search-visibility',
    drive: async () => {
      chooseFile(await until(() => controlOf<HTMLInputElement>('Query panel')), 'panel.json', '{ "queries": [');
      await until(() => document.querySelector('.hq-field-error'));
    },
  },
  'workbench-unknown': {
    caption: 'A lost response: the outcome stays Unknown with possible matches and no Run again', destination: 'workbenches/x-studio',
    drive: async (fixture) => {
      (await until(loadExampleButton)).click();
      await until(() => document.querySelector('.sw-source:not(.sw-hint)'));
      fixture.controls.loseNextSubmitResponse();
      (await until(runButton)).click();
      await until(() => document.querySelector('.sw-unknown-outcome'));
      showResultsPanel();
    },
  },
  'workbench-conflict': {
    caption: 'Start draft with unsaved text already in the Library composer: the user chooses, nothing is overwritten', destination: 'workbenches/x-intelligence',
    drive: async (fixture) => {
      const session = socialSession(CONTEXT.id);
      session.openEditor('new', null, { title: 'My half-written post', body: 'Notes I have not saved yet.', brand_id: DEFAULT_BRAND_ID, channel: 'X', planned_date: '', archived: 0 });
      await runExample();
      fixture.settle(lastRunId(fixture));
      (await until(() => button(/^Start draft$/u))).click();
      await until(() => document.querySelector('.sw-start [role="status"], .sw-start [role="alert"]'));
      document.querySelector('.sw-start')?.scrollIntoView({ block: 'center' });
    },
  },
  'workbench-offline': {
    caption: 'A finished receipt while the service is unreachable: the frame bar says changes are paused', destination: 'workbenches/x-intelligence',
    drive: async (fixture) => {
      await runExample();
      fixture.settle(lastRunId(fixture));
      await until(() => document.querySelector('.sw-result .sx-table'));
      fixture.controls.setUnavailable(true);
      await socialSession(CONTEXT.id).load(socialWorkspacePort());
      window.scrollTo({ top: 0 });
    },
  },
  'workbench-offline-run': {
    caption: 'The same page further down: Run is disabled with its reason, and the finished result stays readable', destination: 'workbenches/x-intelligence',
    drive: async (fixture) => {
      await runExample();
      fixture.settle(lastRunId(fixture));
      await until(() => document.querySelector('.sw-result .sx-table'));
      fixture.controls.setUnavailable(true);
      await socialSession(CONTEXT.id).load(socialWorkspacePort());
      await until(() => document.querySelector('.sw-run-row button:disabled'));
      document.querySelector('.sw-run')?.scrollIntoView({ block: 'center' });
    },
  },
  runs: { caption: 'Run history mounted in the domain', destination: `runs/${FIXTURE_IDS.failedRun}` },
  'runs-list': { caption: 'Run history, no receipt open', destination: 'runs' },
  'runs-today': {
    caption: 'Run history with runs from today and an active run', destination: 'runs',
    options: { seed: (() => { const seed = fictionalSeed(); seed.runs.unshift(...recentRuns()); return seed; })() },
  },
  'runs-offline': {
    caption: 'Run history inside the frame while the service is unreachable: runs last seen active read Unknown', destination: 'runs',
    options: { seed: (() => { const seed = fictionalSeed(); seed.runs.unshift(...recentRuns()); return seed; })() },
    drive: async (fixture) => {
      await until(() => document.querySelector('[data-run-row]'));
      fixture.controls.setUnavailable(true);
      await socialSession(CONTEXT.id).load(socialWorkspacePort());
    },
  },
  offline: {
    caption: 'Service unreachable: last synced data labelled Offline, active runs Unknown', destination: 'home',
    drive: async (fixture) => {
      await until(() => document.querySelector('.sd-overview-grid'));
      fixture.controls.setUnavailable(true);
      await socialSession(CONTEXT.id).load(socialWorkspacePort());
    },
  },
  loading: { caption: 'Loading', destination: 'home', options: { delay: never } },
  error: { caption: 'Service unreachable with no data', destination: 'home' },
  'not-found': { caption: 'Unknown destination', destination: 'brands' },
  brands: {
    caption: 'Manage brands from the switcher', destination: 'home',
    drive: async () => (await until(() => button(/^Manage brands$/u))).click(),
  },
};

const scenario = SCENARIOS[view] ?? SCENARIOS.overview!;
scenario.prepare?.();
const fixture = createWorkbenchFixture({ ...scenario.options, clock: NOW });
if (view === 'error') fixture.controls.setUnavailable(true);
setSocialWorkspacePort(fixture.port);
// Captures drive later states (another window's edit, a lost connection, a new run) through the fixture's own controls.
(window as unknown as { evidence: WorkbenchFixture }).evidence = fixture;

const libraryReferences: ReferencePort = (() => {
  const provider = createSocialReferenceProvider(socialWorkspacePort(), FIXTURE_PROJECT_ID);
  return { find: provider.find, resolve: provider.resolve, open: () => undefined };
})();

function Page() {
  const [destination, setDestination] = useState(scenario.destination);
  const port: ModulePort = {
    context: CONTEXT, destination, appearance: theme, desktop: { platform: 'browser', versions: { electron: null } }, navigate: setDestination,
  };
  return (
    <main className="preview" data-view={view}>
      <p className="preview-caption">Fictional fixture · {theme} · {scenario.caption}</p>
      <SocialDomain {...port} port={socialWorkspacePort()} example now={scenario.now ?? NOW} {...(scenario.references ? { references: scenario.references === 'fixture' ? libraryReferences : scenario.references } : {})} />
      {/* The shell mounts the one toast viewport. */}
      <ToastViewport />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);

void (async () => {
  if (scenario.drive) await scenario.drive(fixture);
  await tick();
  document.documentElement.dataset.ready = 'true';
})().catch((error: unknown) => {
  document.body.dataset.evidenceError = String(error);
});
