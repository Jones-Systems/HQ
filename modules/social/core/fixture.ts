import {
  FEATURE_HQ_BRAND_PROJECT, FEATURE_HQ_REFERENCES, FEATURE_HQ_EDITORIAL_TIMEBOX, PortFailure,
  type Brand, type Draft, type PortError, type PortMethod, type RunRecord,
  type SocialWorkspacePort, type ToolId, type WorkspaceSnapshot,
} from './port';
import { FIXTURE_EXAMPLES, FIXTURE_TOOLS, fictionalSeed, fixtureId, type FixtureRun, type FixtureSeed } from './fixtures/workspace';
import { MESSAGES, checkBrandName, checkDraft, checkRunSubmission, isRunId, isToolId } from './validate';

/**
 * In-memory Social workspace that behaves like the delivered service: same validation,
 * version conflicts, single-worker run lifecycle and restart interruption. It makes no
 * network, filesystem or account calls. Tests and demos drive it through `controls`.
 */

/** The service's worker queue holds at most this many queued runs. */
export const RUN_QUEUE_CAPACITY = 8;
const SNAPSHOT_RUN_LIMIT = 200;

export interface RunOutcome {
  readonly ok: boolean;
  readonly error?: string;
  readonly output?: Record<string, unknown>;
}

export interface FixtureOptions {
  /** Advertised capabilities. Defaults to `['hq-references-v1']`; pass `[]` for today's service. */
  readonly features?: readonly string[];
  readonly clock?: () => Date;
  readonly seed?: FixtureSeed;
  /** Awaited before every call, for loading-state demos. */
  readonly delay?: () => Promise<void>;
}

export interface FixtureControls {
  /** Another window (for example the service's own web UI) saves this draft, bumping its version. */
  editElsewhere(draftId: string, patch?: Partial<Pick<Draft, 'title' | 'body' | 'planned_date' | 'planning_slot'>>): Draft;
  /** The next `submitRun` response is lost. With `accepted` (default) the run was created anyway. */
  loseNextSubmitResponse(options?: { readonly accepted?: boolean }): void;
  /** The next call to `method` rejects with `error` and has no effect. */
  failNext(method: PortMethod, error: PortError): void;
  /** While unavailable, every call rejects `unavailable` with no effect. */
  setUnavailable(unavailable: boolean): void;
  /** One worker step: finish the running run, else start the oldest queued one. */
  advanceRuns(outcome?: RunOutcome): RunRecord | null;
  /** Service restart: queued and running runs become interrupted and are never retried. */
  restart(): void;
  /** Read-only copy of the stored state, for assertions. */
  inspect(): { brands: Brand[]; content: Draft[]; runs: RunRecord[] };
}

export interface FixtureWorkspace {
  readonly port: SocialWorkspacePort;
  readonly controls: FixtureControls;
}

/** Python `datetime.isoformat()` for a UTC instant, as the service stamps records. */
export function serviceTimestamp(date: Date): string {
  const iso = date.toISOString();
  const ms = date.getUTCMilliseconds();
  return `${iso.slice(0, 19)}${ms ? `.${String(ms).padStart(3, '0')}000` : ''}+00:00`;
}

function fail(error: PortError): never {
  throw new PortFailure(error);
}

export function createFixtureWorkspace(options: FixtureOptions = {}): FixtureWorkspace {
  const features = [...(options.features ?? [FEATURE_HQ_REFERENCES])];
  const references = features.includes(FEATURE_HQ_REFERENCES);
  const timeboxes = features.includes(FEATURE_HQ_EDITORIAL_TIMEBOX);
  const brandProjects = features.includes(FEATURE_HQ_BRAND_PROJECT);
  const clock = options.clock ?? (() => new Date());
  const now = () => serviceTimestamp(clock());
  const seed = structuredClone(options.seed ?? fictionalSeed());

  const brands: Brand[] = seed.brands.map(({ project_id, ...brand }) => (brandProjects ? { ...brand, project_id: project_id ?? null } : brand));
  const content: Draft[] = seed.content.map(({ links, planning_slot, ...draft }) => ({ ...draft,
    ...(references ? { links: links ?? [] } : {}), ...(timeboxes ? { planning_slot: planning_slot ?? null } : {}),
  }));
  const runs: FixtureRun[] = [...seed.runs];
  let counter = 0x1000;
  const failures = new Map<PortMethod, PortError>();
  let loseSubmit: { accepted: boolean } | null = null;
  let unavailable = false;

  async function enter(method: PortMethod): Promise<void> {
    await options.delay?.();
    if (unavailable) fail({ kind: 'unavailable' });
    const injected = failures.get(method);
    if (injected) {
      failures.delete(method);
      fail(injected);
    }
  }

  function snapshotRuns(): RunRecord[] {
    return runs
      .map((run, index) => ({ run: run.record, index }))
      .sort((a, b) => (a.run.created_at === b.run.created_at ? b.index - a.index : a.run.created_at < b.run.created_at ? 1 : -1))
      .slice(0, SNAPSHOT_RUN_LIMIT)
      .map(({ run }) => run);
  }

  function readRun(run: FixtureRun): RunRecord {
    const terminal = run.record.status === 'succeeded' || run.record.status === 'failed';
    return structuredClone(terminal && run.output !== undefined ? { ...run.record, output: run.output } : run.record);
  }

  const port: SocialWorkspacePort = {
    async snapshot(): Promise<WorkspaceSnapshot> {
      await enter('snapshot');
      return structuredClone({
        brands: [...brands].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
        content: [...content].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)),
        runs: snapshotRuns(),
        tools: [...FIXTURE_TOOLS],
        features: [...features],
        observedAt: now(),
      });
    },

    async saveDraft(draft): Promise<Draft> {
      await enter('saveDraft');
      // A JSON round trip models the wire: undefined keys vanish as they would in a request.
      const wire = JSON.parse(JSON.stringify(draft));
      // Older clients omit the slot: preserve it on dated edits, but clearing the date clears both.
      if (timeboxes && wire.planning_slot === undefined) {
        wire.planning_slot = wire.planned_date ? content.find((item) => item.id === wire.id)?.planning_slot ?? null : null;
      }
      const checked = checkDraft(wire, { features, brandIds: brands.map((brand) => brand.id) });
      if (!checked.ok) fail(checked.error);
      const { fields, target, links } = checked.value;
      const updatedAt = now();
      if (target) {
        const index = content.findIndex((item) => item.id === target.id && item.version === target.version);
        if (index < 0) fail({ kind: 'conflict', message: MESSAGES.conflict });
        const current = content[index]!;
        const next: Draft = { ...current, ...fields, version: current.version + 1, updated_at: updatedAt };
        // Proposed hq-references-v1 rule: a save without links preserves the stored links.
        if (references) next.links = links ?? current.links ?? [];
        content[index] = next;
        return structuredClone(next);
      }
      const created: Draft = { id: fixtureId('d', counter++), ...fields, version: 1, updated_at: updatedAt };
      if (references) created.links = links ?? [];
      content.push(created);
      return structuredClone(created);
    },

    async addBrand(name): Promise<Brand> {
      await enter('addBrand');
      const checked = checkBrandName(name);
      if (!checked.ok) fail(checked.error);
      const brand: Brand = { id: fixtureId('b', counter++), name: checked.value, ...(brandProjects ? { project_id: null } : {}) };
      brands.push(brand);
      return structuredClone(brand);
    },

    async example(tool): Promise<Record<string, unknown>> {
      await enter('example');
      if (!isToolId(tool)) fail({ kind: 'invalid', message: MESSAGES.unknownTool });
      return structuredClone(FIXTURE_EXAMPLES[tool]);
    },

    async run(id): Promise<RunRecord> {
      await enter('run');
      if (!isRunId(id)) fail({ kind: 'invalid', message: MESSAGES.runId });
      const found = runs.find((run) => run.record.id === id);
      if (!found) fail({ kind: 'not_found' });
      return readRun(found);
    },

    async submitRun(tool: ToolId, input, isExample): Promise<RunRecord> {
      const attemptedAt = now();
      await enter('submitRun');
      const accept = (): RunRecord => {
        const checked = checkRunSubmission(tool, input, isExample);
        if (!checked.ok) fail(checked.error);
        if (runs.filter((run) => run.record.status === 'queued').length >= RUN_QUEUE_CAPACITY) {
          fail({ kind: 'conflict', message: MESSAGES.queueFull });
        }
        const record: RunRecord = {
          id: fixtureId('e', counter++), tool: checked.value.tool, status: 'queued',
          is_example: checked.value.isExample ? 1 : 0, created_at: now(), finished_at: null, error: null,
        };
        runs.push({ record });
        return structuredClone(record);
      };
      const lost = loseSubmit;
      loseSubmit = null;
      if (lost) {
        if (lost.accepted) {
          try {
            accept();
          } catch {
            // The response carrying any rejection was lost too; the caller still sees unknown.
          }
        }
        fail({ kind: 'unknown', attemptedAt });
      }
      return accept();
    },
  };

  const controls: FixtureControls = {
    editElsewhere(draftId, patch = {}) {
      const index = content.findIndex((item) => item.id === draftId);
      if (index < 0) throw new Error(`No fixture draft ${draftId}`);
      const current = content[index]!;
      const next: Draft = { ...current, ...patch, version: current.version + 1, updated_at: now() };
      content[index] = next;
      return structuredClone(next);
    },
    loseNextSubmitResponse({ accepted = true } = {}) {
      loseSubmit = { accepted };
    },
    failNext(method, error) {
      failures.set(method, error);
    },
    setUnavailable(value) {
      unavailable = value;
    },
    advanceRuns(outcome = { ok: true }) {
      const running = runs.find((run) => run.record.status === 'running');
      if (running) {
        running.record = {
          ...running.record,
          status: outcome.ok ? 'succeeded' : 'failed',
          error: outcome.ok ? null : outcome.error ?? 'The fixture worker reported a failure.',
          finished_at: now(),
        };
        running.output = outcome.output ?? (outcome.ok ? { ok: true, summary: 'Fictional fixture result.' } : undefined);
        return structuredClone(running.record);
      }
      const queued = runs.filter((run) => run.record.status === 'queued')
        .sort((a, b) => (a.record.created_at < b.record.created_at ? -1 : a.record.created_at > b.record.created_at ? 1 : 0))[0];
      if (!queued) return null;
      queued.record = { ...queued.record, status: 'running' };
      return structuredClone(queued.record);
    },
    restart() {
      const finishedAt = now();
      for (const run of runs) {
        if (run.record.status === 'queued' || run.record.status === 'running') {
          run.record = { ...run.record, status: 'interrupted', error: MESSAGES.interrupted, finished_at: finishedAt };
        }
      }
    },
    inspect() {
      return structuredClone({ brands, content, runs: runs.map((run) => run.record) });
    },
  };

  return { port, controls };
}
