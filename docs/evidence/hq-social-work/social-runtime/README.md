# Social live runtime adapter (`task.social-live-adapter.001`, module source readiness)

Authority effect: none. This is the lane evidence for the module-source portion of `spec.hq-social-work#task.social-live-adapter.001`, against `spec.hq-social-work#ac.live-adapters.001` and `spec.hq-social-work#test.social-live-adapter.001`. It covers source over an **injected, closed transport** only. The shared bridge (`packages/contracts`, preload, main, IPC, settings) is not part of it.

## Binding and preflight

| Item | Value |
| --- | --- |
| Repository | `Jones-Systems/HQ` (origin verified) |
| Branch | `t3/social-live-runtime-adapter`, a generated, isolated linked worktree with one Git owner (this lane) |
| Start and PR base | `562986d1852d7b4ef101ff6d4c9340c3751c727a`: head of `t3/social-work-domain-assembly` (PR #36). Status was clean at start. |
| Plan | `docs/engineering-specs/hq-social-work.md`, blob `8442f086…`, unchanged in this branch. Sections read: `task.social-live-adapter.001`, `ac.live-adapters.001`, `iface.service-bridge.001`, `iface.social-port.001`, `req.safety.001` and `test.social-live-adapter.001`. The assignment brief and the seam corrections below supersede these sections where they differ. |
| Codex V3 guidance | Root `AGENTS.md` at commit `4beb491c44…`: blob `3402719bc3…`, 30,716 bytes, SHA-256 `1238a90adb…87ce6`. Triggered guides applied: CPU telemetry and delivery. The builder profile is prompt-carried guidance only, a disclosed fallback. |
| HQ rules | Root `AGENTS.md`/`CLAUDE.md`. `.agents/shared-guidance.md` is absent, so shared enrollment is unavailable; nothing was installed. |
| Install | `npm ci` against the unchanged lockfile, with lockfile SHA-256 `9d388b16…a994bbc994` before and after. No manifest or lockfile changed. |
| Model | `claude-opus-5-5` at high effort, fast mode off; no descendants |
| Contributing T3 threads | Social runtime builder, role builder (native ID withheld from this public repository). Coordination: T1 Social/Work coordinator and the portfolio root. |

**Guidance conflicts.** V3 defaults to delegating qualifying work and to delivering through merge. The no-descendants rule and the root's ownership of merge and topology override both.

## Writer cone

Only `modules/social/live/**`, `modules/social/nav/workspace.ts`, `modules/social/index.tsx`, the new `modules/social/nav/test/source.test.tsx` and this directory. Per the root's scope delta, `modules/social/nav/test/registry.test.tsx` is excluded (Design's sole writer owns it) and is unchanged. `modules/social/{core,content,workbench}`, `modules/work`, `packages/`, `apps/` and root files are unchanged.

## Accepted transport seam

The envelope in the original `iface.service-bridge.001` (`{ok:false,kind:'unavailable'|'unknown'|'http',status?}`) is **superseded**. Sources:

1. T1 contract correction, citing the accepted backend plan `523104b#iface.work-live-transport.001`.
2. The root's settled seam (Design's shared writer), applying to both domains:

```ts
{ ok: true; status: number; body: B; replayed: boolean }   // any HTTP response received, including 4xx/5xx
| { ok: false; kind: 'unavailable' | 'unknown' }            // transport failure only; no HTTP response
```

- `ok: true` means only that a response arrived; the adapter always branches on `status`.
- `body` is null when the response was empty, and `replayed` is false when the header is absent.
- `replayed` is required in the local interface and ignored by Social. As a tolerance, the guard accepts an absent `replayed` but rejects one that is not a boolean.
- There is no `kind: 'http'` and no body on `ok: false`. Main handles the exact 403 token refresh predicate.

No canonical shared type exists yet. The mirror is local: `modules/social/live/transport.ts`.

## What it provides

- **`createLiveSocialPort(transport, { now? })`** implements `SocialWorkspacePort` over `transport.call(route, params)`. The routes are closed: `workspace`, `sample`, `run`, `saveContent`, `addBrand` and `submitRun`.
- **Request bodies.** Mutation parameters are the exact JSON body the service reads: the draft fields with `id`/`version` for an update, `{name}` and `{tool, input, is_example}`.
- **No transport details.** The renderer passes no URL, method, header or token.
- **Validation before sending.** `checkDraft`, `checkBrandName` and `checkRunSubmission` run first, and so do the run-ID and tool checks. An invalid call makes zero transport calls.
- **Links.** `links` are sent only when the last snapshot advertised `hq-references-v1`. If no snapshot has been read and a draft carries links, one `workspace` read learns the capability first.
- **Status mapping (`ok: true`).**
  - 2xx passes through fail-closed guards. A malformed 2xx result is `unknown`.
  - 400/422 → `invalid`; 409 → `conflict`, for example `Run queue is full. Wait for a run to finish.`; 403 → `forbidden`; 404 → `not_found`.
  - Each of these requires the body to be exactly `{error: string}` and shows that text. Otherwise the result is `unknown`.
  - 5xx and any unmapped status → `unknown` (see deferred finding F-1).
- **Transport failures.** A thrown transport call, a malformed envelope or `ok:false kind:'unknown'` → `unknown`. `ok:false kind:'unavailable'` → `unavailable`.
- **Guards.** They check every promised field and drop the rest. The workspace token (`csrf`) never leaves the adapter, and no csrf token reaches the session. `features` defaults to `[]` when absent. `observedAt` and `attemptedAt` are client stamps.
- **`submitRun`.** Exactly one transport call; the adapter never retries.
- **Production source selection** (`nav/workspace.ts`, `index.tsx`).
  - The source is chosen **once per window**: live when `window.hqServices.social` is structurally valid (an object with a `call` function), otherwise the fixture.
  - The example banner derives from the chosen source. A later bridge change never switches it, so fixture and live sessions never mix.
  - An unavailable live service shows the existing unreachable state. It never falls back to the fixture.
  - No endpoint-settings action or status method is added.
  - `setSocialWorkspacePort(port | null, source = 'fixture')` keeps the harness API, and the existing real-shell tests pass unchanged.

## Research basis

Git objects only, from `growth-intel` at `3f647dac`. The two paths were `apps/social_dashboard/` and `docs/social-growth-dashboard.md`; nothing from `data/` or private records was read. No code was copied. Recorded facts:

- **Workspace.** `GET /api/workspace` returns `brands`, `content`, `runs` (latest 200), `tools` and `csrf`, with no `features` key.
- **Raw bodies.** `GET /api/sample/<tool>` returns a raw object (an unknown tool is 400 `Unknown tool`). `GET /api/runs/<id>` returns a raw record. The content, brand and run POSTs return a raw record.
- **Error envelopes.** Every error is `{error: string}`: `PermissionError` → 403, `Conflict` → 409 (a full queue is `Run queue is full. Wait for a run to finish.`), `FileNotFoundError` → 404, validation → 400, otherwise 500 with a fixed message.

## Checks

Each check started after a fresh `collect_work_capacity.py --format admission` reading. All readings were below 85% CPU, allowing one serial test process. One fully used core is 6.25% of capacity.

| Check | Telemetry (UTC) | Result |
| --- | --- | --- |
| `npm ci` | 07:16:46, CPU 20.89%, 41.05 GiB available | 149 packages; lockfile unchanged |
| `vitest run modules/social/live modules/social/nav/test/source.test.tsx` | 07:16:57, CPU 24.53%, 40.60 GiB | 2 files, 175 tests passed |
| `npm run typecheck` | 07:17:06, CPU 22.40%, 40.86 GiB | clean |
| `vitest run modules/social apps/desktop` (social-module + shell-integration) | 07:17:12, CPU 20.82%, 40.83 GiB | 19 files, 470 tests passed |
| `npm run build` | 07:17:23, CPU 22.05%, 41.02 GiB | built; the existing >500 kB chunk warning only |
| `vitest run modules/social/live` (after a test rename) | 07:18:31, CPU 43.48%, 40.50 GiB | 166 tests passed |

Coverage:

- **Conformance.** The same shared suite (`core/test/port-conformance.ts`) runs against the live port through the fictional wire-codec bridge stub (`live/test/wire-stub.ts`), with and without `hq-references-v1`.
- **Exact synthetic exchanges.**
  - The native workspace body, including the token and with no features.
  - 409 for a full queue and for a stale draft; 400; 422; 403; 404; 500; 503; 418; 302.
  - Malformed error bodies: null, non-string, list, missing or bare string.
  - `ok:false` unavailable and unknown, on every method; a transport exception.
  - Malformed envelopes, including the retired `kind:'http'`.
  - Malformed 2xx results for runs, drafts, brands, workspace and sample.
- **One submit call.** Exactly one transport call and one execution-class port call after a throw, unknown, malformed result, 500, unavailable and 409. A lost result is `unknown`, and the stub service holds exactly one new run.
- **Zero execution.** Navigation across every section plus remounts, with the live source: zero `submitRun`, `saveContent` or `addBrand` calls, and one `workspace` read.
- **Source selection and banner.** Absent and malformed bridges, a valid bridge, select-once, unavailable-with-no-fallback and the harness API.

## Deferred findings (original severity; not implemented)

- **F-1 (P2).** `PortError` (owned by `core`) has no server-error kind carrying a message. A 5xx therefore maps to `unknown`, and the service's 500 text (`The service could not complete this request. Your existing data is preserved.`) is not shown. Showing it needs a `core` port change, so it is proposed to T1 rather than widened here.
- **F-2 (P3).** The adapter learns `features` only from a snapshot. A capability change after the last snapshot is seen at the next snapshot.
- **F-3 (P3).** An unknown future tool ID or category in `workspace.tools` fails the whole snapshot closed (`unknown`), rather than hiding that one tool.

## Unverified

**UNVERIFIED:** Electron, the real preload/main bridge (`window.hqServices`), the real Social service, token refresh in main, timeouts and size caps in main, and persistence. The only bridge exercised is the fictional stub. No live endpoint was contacted, and no live or private data was read.
