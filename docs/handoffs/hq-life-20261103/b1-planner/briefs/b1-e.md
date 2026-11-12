# B1-E: real-Planner end-to-end tests for Work

You are a builder in lane B1 (HQ backend: Planner service and Work live connection). The lead (Opus) reviews your
branch and opens the pull request. Your worktree is on new branch `work/hq-b1-e2e-20261103`, created from
`origin/work/hq-backend-planner-20261103` (expected `7818059…`; record what you get).

## Read first

- `docs/engineering-specs/backend-assessment-planner-20261103.md`: "Gaps" (G6, G9) and "Test plan".
- `apps/desktop/src/live-services.integration.test.tsx`: how a real disposable Planner is started inside the root
  Vitest run and driven through the actual main-process HTTP layer (`createServices`, `sendHttp`).
- `apps/desktop/electron/services.ts`, `service-config.ts`; `modules/work/live/{adapter,transport,wire}.ts`;
  `modules/work/core/{port,store}.ts`; `services/planner/README.md` (flags: `--data`, `--host`, `--port`,
  `--allowed-host`).
- Root `vitest.config.*`: `.test.ts` runs in Node, `.test.tsx` in happy-dom. CI runs the whole root suite on
  ubuntu-24.04 with Node 24.19.0 and Python 3 under a 6-minute job timeout, so keep the new tests fast (seconds).

## Tasks

1. **Shared helper** `apps/desktop/src/test/planner.ts` (test-only):
   `startPlanner(options?: { host?: string; port?: number; allowedHosts?: string[]; root?: string })` →
   `{ url: URL; port: number; root: string; dataPath: string; stop(): Promise<void>; start(): Promise<void>;
   dispose(): Promise<void> }`. It spawns `python3 -m planning --data <root>/planning.sqlite3 --host … --port …` from
   `services/planner` with `PYTHONDONTWRITEBYTECODE=1`, reads the URL from stdout (port 0 on first start), and keeps
   the chosen port for a later `start()` on the same data. Scratch comes from `mkdtemp(join(os.tmpdir(),
   'hq-planner-'))`, never the checkout. `stop()` sends SIGTERM and waits for exit (SIGKILL after a short grace);
   `dispose()` stops and removes exactly its root. Startup failures and timeouts reject with stderr included.
2. **G9.** Switch the existing real-Planner test in `live-services.integration.test.tsx` to the helper so nothing is
   written under `.t3/` in the checkout. Its assertions stay exactly as they are.
3. **New suite** `apps/desktop/src/work-live.integration.test.ts`, through the real stack: a real
   `openServiceConfig(<tmp userData>)` with `config.set({ domain: 'work', baseUrl })`, `createServices(config,
   transport)` with `sendHttp` (optionally wrapped to drop answers), `createPlannerLive(bridgeTransport({ call:
   services.work }))`, and `createWorkStore(live.port, { recovery: live.recovery })`. Cover:
   - every port route against the Planner: `snapshot`, `version`, `create`, `patch` (several field kinds including
     dates and references when the Planner advertises `hq-references-v1`), `move` with `top`, `bottom`, `after_id` and
     `before_id`, `setArchived` both ways, `markReviewed`, `history`, `updateSettings`; read back each effect;
   - a second client (a second `createPlannerLive` over its own `createServices`, or raw HTTP with the Planner's
     required headers) changing the same item: the first store's write gets `revision_conflict` with the current item
     in `conflicts`; an anchor moved by the second client gives `order_conflict` with a notice and a refresh;
   - polling: the second client creates an item; `store.poll()` picks it up; an unchanged version does not refetch;
   - the Planner stopped: `poll()` leaves the board loaded and `save.kind === 'offline'`; a write fails `unavailable`
     and changes nothing; the Planner started again on the same data: `poll()` is back online with every item intact;
   - a write whose answer is lost after the Planner applied it: `unconfirmed`, then `checkUnconfirmed` confirms it
     from the replay record, and the item exists exactly once;
   - a write lost before it reached the Planner (the wrapper answers `unknown` without sending): Check answers
     `not_applied`, Apply applies it once, a second Apply is refused, and the item exists exactly once;
   - the Planner restarted on a fresh, empty data file at the same port with an unconfirmed write whose baseline is
     above the new store's version: record what Check answers today (the lead is adding a `store_changed` reason in
     parallel; assert today's behaviour and note it in your report).
   Each test starts its own Planner (or shares one per `describe` with clean data), and always disposes it.
4. **Defects.** If a scenario fails because of production code, do not change production code: keep the test, mark
   it `it.fails(…)` with a one-line comment naming the defect, and report it with the evidence. Never weaken an
   existing assertion.

## Checks

`npm run typecheck`; `node_modules/.bin/vitest run --maxWorkers=4 apps/desktop/src/work-live.integration.test.ts
apps/desktop/src/live-services.integration.test.tsx` three times in a row (report each duration and any flake);
then the full root `node_modules/.bin/vitest run --maxWorkers=4` once.

## Boundaries

Edit only `apps/desktop/src/test/planner.ts`, `apps/desktop/src/work-live.integration.test.ts` and
`apps/desktop/src/live-services.integration.test.tsx`. No production code, `services/**`, `tools/**`, or Work UI
directories. A later phase (queue, durable restore and health against the real Planner) will be sent to you after the
lead integrates those features, so structure the suite to make adding scenarios easy.
