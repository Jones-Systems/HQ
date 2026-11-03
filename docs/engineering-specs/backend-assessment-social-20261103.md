# Social backend assessment and implementation spec (2026-11-03)

Artifact Type: engineering-spec

Artifact ID: `spec.hq-social-backend`

Purpose: Assess what HQ Social specifies, implements and tests today, identify the Fieldnotes contract it depends on, triage open Social PRs, and fix the contract and workstreams that make Social work end to end against a real, disposable backend.

Specification owner: HQ backend lane B2 (Social backend, desktop transport and Fieldnotes integration)

Decision owner: M Jones

Consumers: HQ integration owner (T1), frontend lane F3 (`work/hq-life-social-20261103`), B2 builders and reviewers

Authority effect: none

Status: progressive. Sections marked *target* describe work in flight on the B2 branches; the delivery record at the end names what actually landed.

## Summary

<!-- codex-section:begin id="spec.hq-social-backend#ctx.summary.001" -->
HQ Social has a mature client: pages, a session store that survives domain switches, a `SocialWorkspacePort` with fail-closed live guards, and a main-process HTTP bridge with workspace-token handling and endpoint settings. What it lacks is **a backend HQ can run**. The only implementation of the Social workspace API is Fieldnotes, a private service whose source HQ may not import. The deployed instance is unreachable from HQ as configured, and none of HQ's tests or CI touches a real Social service. With no configured endpoint, the desktop selects the fictional example workspace. That workspace keeps data in window memory only, and its runs never leave *queued*, which matches the banner "No Social service is connected yet, so nothing is sent anywhere and runs stay queued."

Work, by contrast, ships the real Planner in `services/planner` and exercises it through the actual desktop bridge in Foundation CI.

B2 closes that gap without importing private source:

1. An **HQ Social service** in `services/social`. It is a clean-room, stdlib-only Python service that implements the same wire contract HQ's adapter already speaks, plus the HQ extensions Fieldnotes lacks. It is loopback-only, keeps its data outside the repository, and runs eight deterministic offline reference analyzers in a network-denied worker.
2. **Desktop transport hardening.** It carries PR #166's link support, sets bounded per-route response caps and adds a typed error-presentation helper. A documented adapter contract keeps F3 stable.
3. **End-to-end tests** that start a disposable HQ Social service and drive it through the real main-process HTTP layer, the live port and the mounted Social UI.
4. A **Fieldnotes compatibility check.** The same desktop bridge runs against a disposable local Fieldnotes instance, and the results are recorded as evidence. Nothing is imported.
5. **Extensions** behind capability flags: the brand ↔ project write path, a supplied-data source registry, and account connection and publishing as a default-off **simulator only**. Real networks and credentials remain an owner decision.
<!-- codex-section:end id="spec.hq-social-backend#ctx.summary.001" -->

## Evidence read

- HQ `work/hq-foundation` at `0cd50abc974320771cc21145dc8a8fd58a3eb8b1`: `modules/social/**`, `apps/desktop/electron/{services,service-config,preload,main}.ts`, `apps/desktop/src/services/domains.tsx`, `apps/desktop/src/live-services.integration.test.tsx`, `packages/contracts/src/services.ts`, `services/README.md`, `docs/engineering-specs/hq-social-work.md` (`iface.social-port.001`, `iface.service-bridge.001`, `iface.service-reference-extensions.001`, RC/RR requirements), `docs/design/social/hq-social-design.md`, `docs/evidence/hq-social-work/{social-runtime,social-workbench,social-content}/README.md`, `.github/workflows/*.yml`.
- Open PRs on 2026-11-03: #166, #179 and every other open PR title and branch. No F3 branch or PR was published at assessment time.
- Fieldnotes interface research: private `Jones-Systems/growth-intel` at `9b6368934e9768517d319f6e7351a708dec46976`. Read: `apps/social_dashboard/{server,worker,catalog}.py`, `docs/engineering-specs/social-growth-dashboard.md`, `README.md` and open PR #41 metadata. No code, data, fixtures or captured payloads were copied into HQ. The repository has no license file.

## Fieldnotes: source and contract

<!-- codex-section:begin id="spec.hq-social-backend#ctx.fieldnotes.001" -->
There is no `Fieldnotes` repository in the Jones-Systems organization. Fieldnotes is the Social Growth workspace dashboard in private `growth-intel`, under `apps/social_dashboard`. It is Python 3.13 stdlib HTTP over SQLite with a static browser UI. Its server history includes `348bbe1` (dashboard, 2026-10-18) and `fd199cd` (versioned editorial timeboxes, 2026-10-20). Open growth-intel PR #41 (`deaaec9`) adds `hq-references-v1` draft links; its CI is green and it is unmerged.

Contract, as observed:

| Route | Behavior |
| --- | --- |
| `GET /api/workspace` | `{brands (by name), content (updated_at desc), runs (latest 200, no output), tools (8), csrf, features}`. `features` is `['hq-editorial-timebox-v1']` when time-zone data is available. With PR #41 it adds `hq-references-v1`. |
| `POST /api/content` | Saves a draft with optimistic `version`. A stale or unknown `id` returns 409 `This draft changed in another window. Close and reopen it before saving.` An absent `planning_slot` on an update keeps the stored slot. |
| `POST /api/brands` | `{name}` → `{id, name}` |
| `POST /api/runs` | `{tool, input, is_example}` → a queued run. The queue holds 8; a full queue is 409 `Run queue is full. Wait for a run to finish.` |
| `GET /api/runs/<32 hex>` | A run record, plus `output` (`{ok, result}` or `{ok:false, error}`) once it finishes. |
| `GET /api/sample/<tool>` | The tool's sample input. An unknown tool is 400 `Unknown tool`. |

The guards are an exact `Host` equal to the bound `host:port`, a same-origin `Origin`, a refusal of `Sec-Fetch-Site: cross-site`, an `X-Workspace-Token` on mutations (403 `Reload the workspace before saving`), `Content-Type: application/json`, and a body of 1–2,000,000 bytes. Every error is `{error: string}`: 400 validation, 403 guard, 404, 409 conflict, or 500 with a fixed message. Runs execute one at a time, each in a fresh subprocess with a 60 s timeout, resource limits and an audit hook that denies sockets and process launch. A restart marks queued and running runs *interrupted*, and nothing retries.

The tools are the native growth-intel applications, imported by the worker. HQ cannot run them without the private repository.

**Reachability.** The dashboard spec binds a private tailnet address over plain HTTP. HQ's endpoint policy (`apps/desktop/electron/service-config.ts`) accepts only HTTPS or loopback HTTP, so that address is rejected. Fieldnotes' exact `Host` check also refuses SSH tunnels and HTTPS proxies, because their Host header differs from the bound address. **HQ cannot reach the deployed Fieldnotes as configured.** A loopback-bound local instance is compatible.
<!-- codex-section:end id="spec.hq-social-backend#ctx.fieldnotes.001" -->

## Inventory: specified, implemented, tested

<!-- codex-section:begin id="spec.hq-social-backend#ctx.inventory.001" -->
In this table, "Tested" names the strongest existing evidence on the foundation branch. *Stub* means the fictional wire codec in `modules/social/live/test/wire-stub.ts` or the synthetic HTTP server in `live-services.integration.test.tsx`.

| Capability | Specified | Implemented in HQ | Tested | Backend reality |
| --- | --- | --- | --- | --- |
| Library and drafts: create, edit, filter, archive/restore, conflict, unsaved text kept across switches | RC-1/RC-2 | UI, session, port, fixture, live adapter, main transport | Fixture and stub conformance; synthetic HTTP wire | Fieldnotes only; never exercised for real |
| Brands: list, add | RC-3 | Yes | Fixture and stub | Fieldnotes only |
| Brand ↔ HQ project (`hq-brand-project-v1`) | Proposed | Read-only display and mismatch banner | Fixture only | **No write path anywhere**: no route and no port method; Fieldnotes holds it |
| Calendar: month and tray, versioned move, undo | RC-4 | Yes | Fixture and stub | Fieldnotes only |
| Timed planning (`hq-editorial-timebox-v1`) | Plan amendment | Yes (`core/timebox.ts`) | Fixture and stub, shared slot cases | Fieldnotes `fd199cd` |
| Draft links (`hq-references-v1`) | `iface.service-reference-extensions.001` | Port and UI. **The main transport rejects `links`** until #166 | Fixture and stub; #166 unit tests | Fieldnotes PR #41, open |
| Workbenches: eight tools, guided forms, explicit Run, polling, receipts, Start draft | RR-1..RR-7 | Yes | Fixture (test-only `settle`) and stub | Native tools in private growth-intel only. In desktop example mode, **runs stay queued forever**. |
| Run history: list, receipt, Unknown while unreachable, explicit re-run | RR-4/RR-5 | Yes | Fixture and stub | Fieldnotes only |
| Sources: supplied-data registry with provenance | SOC-6/SOC-7, held | Placeholder page, *Proposed* | Page test | **Absent everywhere** |
| Overview capability strip | RC-6 | Static: Live collection and Accounts & posting *Not available* | Page test | Honest, by design |
| Channels & accounts, connection and posting | SOC-8, static | Static page; *Connect account…* is inert | Page test | **Absent everywhere**. growth-intel has separate consent-gated publisher CLIs that are not in the dashboard. |
| Desktop bridge: closed routes, token cache and single 403 refresh, caps, timeouts, endpoint settings | `iface.service-bridge.001` | Yes | Unit tests; synthetic HTTP server | Never against a real Social service |
| Native Electron acceptance for Social | Reserved | None (scenarios: `sources`, `ui`, `work`) | — | — |
<!-- codex-section:end id="spec.hq-social-backend#ctx.inventory.001" -->

## Findings

<!-- codex-section:begin id="spec.hq-social-backend#ctx.findings.001" -->
| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| B2-F1 | P1 | HQ has no runnable Social backend. Live mode cannot be exercised in CI or locally without private source, and the owner sees only the example workspace. | Build `services/social` (WS-S, WS-T) |
| B2-F2 | P1 | HQ cannot reach the deployed Fieldnotes: non-loopback HTTP is rejected and the exact Host check refuses tunnels and proxies. | Record; owner decision D-B2-4 (growth-intel change plus a hosting action) |
| B2-F3 | P2 | The main transport rejects `links` on `saveContent`, so linked drafts fail as `unavailable` against any links-capable service. | Fixed by #166; B2 carries `992594a` as an ancestor |
| B2-F4 | P2 | One 2,000,000-byte response cap covers the whole workspace snapshot, which includes every draft body (up to 50,000 characters each). A large library fails as "unreachable". | WS-D: bounded per-route caps |
| B2-F5 | P2 | There is no write path for brand ↔ project. | WS-X: `POST /api/brands/<id>/project` behind `hq-brand-project-v1` |
| B2-F6 | P2 | There is no source registry, so Sources stays a placeholder. | WS-X: `hq-sources-v1` |
| B2-F7 | P3 | After a service restart, the first `submitRun` returns 403 (stale token) and shows as `forbidden`. By design, execution is never resent automatically. | Document; *Check again* refreshes the token |
| B2-F8 | P2/P3 | Carried from `social-runtime` F-1..F-3: the 5xx text is lost, features are learned only from snapshots, and an unknown tool fails the whole snapshot. | Unchanged; the HQ service never emits unknown tool IDs |
| B2-F9 | P3 | No native Electron Social acceptance scenario exists. | Follow-on; outside fast CI |
<!-- codex-section:end id="spec.hq-social-backend#ctx.findings.001" -->

## PR triage

<!-- codex-section:begin id="spec.hq-social-backend#ctx.triage.001" -->
- **#166, "Allow validated Social draft links through desktop transport"** (`992594a`, base `0b283c8`, mergeable, 25/25 checks green). **Verdict: correct and needed; accept as is.**
  - The main-process guard matches `parseReference`: required fields, optional `sourceRevision` and `workspaceId`, text bounds and destination rules. It enforces the 30-link maximum.
  - Omitted links stay omitted and `[]` clears them, which matches the HQ port and growth-intel #41.
  - It does not reject duplicate targets. Fieldnotes #41 and the HQ Social service do reject them, and that 400 surfaces as `invalid` with the service text. This is acceptable.
  - #166 is already composed, at its exact head, into #179. B2's desktop branch merges `992594a` as an ancestor so that B2 and #179 compose without conflict. No change is requested.
- **#179, "Compose accepted Design, Social and default-disabled backend source"** (`c83294b`). It contains #166 byte for byte, and its other paths do not touch Social. There is no conflict with B2. Its merge is held for the integration owner.
- **growth-intel #41** (external). Fieldnotes `hq-references-v1` is compatible with HQ's live port and #166. Merging or deploying it is outside HQ and belongs to the owner (D-B2-1).
- No other open HQ PR touches `modules/social`, `services/social` or the Social bridge.
<!-- codex-section:end id="spec.hq-social-backend#ctx.triage.001" -->

## Target design

<!-- codex-section:begin id="spec.hq-social-backend#ctx.design.001" -->
- **One wire contract, two servers.** HQ's adapter and bridge keep speaking the Fieldnotes contract. `services/social` is an HQ-owned implementation of that contract, and Fieldnotes remains a compatible alternative endpoint. Capabilities are negotiated only through `features`: an absent feature keeps its UI disabled, as today.
- **Clean room.** Fieldnotes informs only the interface: routes, shapes, guards and messages already mirrored in HQ's `core/validate.ts` and `core/timebox.ts`. The HQ service is written from HQ's own TypeScript rules and this spec. Its analyzers are HQ-authored deterministic reference implementations. They are not the native tools and they say so.
- **HQ stays a client.** The desktop never stores Social records. The service owns the data in a directory outside the repository, as Planner does. A run is the only execution-class call, made on an explicit Run.
- **Adapter stability for F3.** The `SocialWorkspacePort` methods, the `PortError` union, the feature names and the six bridge routes are unchanged. New capability goes in additive, feature-gated port methods and routes, described in the [stable adapter contract](#stable-adapter-contract).
<!-- codex-section:end id="spec.hq-social-backend#ctx.design.001" -->

## HQ Social service contract v1 (*target*)

<!-- codex-section:begin id="spec.hq-social-backend#iface.service.001" -->
**Location and launch.** Code lives in `services/social`, package `social_service`, written for Python 3.11+ with the standard library only. Foundation CI uses the runner's `python3`; the dedicated job uses 3.13.5.

```sh
python3 -m social_service --data /path/outside/HQ/social --host 127.0.0.1 --port 8766
```

- `--data` is a directory. It is created with mode 0700 when its parent exists. The service refuses a data directory inside `services/social` and warns when it is inside the repository. One process per data directory: an exclusive lock file refuses a second instance with exit code 2.
- `--host` must be loopback (`127.0.0.1`, `::1` or `localhost`); anything else exits 2. `--port 0` picks a free port.
- `--allowed-host HOST[:PORT]` may repeat. It is for a private HTTPS front that the owner sets up separately.
- `--publishing off|simulator` defaults to `off` (WS-X).
- At startup the service prints `Social service on http://<host>:<port>/  (data: <dir>)` and flushes. SIGINT and SIGTERM stop it gracefully.

**Guards** (on every request, in this order):

1. `Host` must equal `<bound host>:<port>` or a loopback alias (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`), or an `--allowed-host` value. Otherwise 403 `Unrecognized host`.
2. A present `Origin` must be `http://` or `https://` followed by an accepted Host. Otherwise 403 `Cross-origin request refused`.
3. `Sec-Fetch-Site: cross-site` gets 403 `Cross-site request refused`.

On POST, the guards continue:

4. `X-Workspace-Token` must equal the per-process token, compared in constant time. Otherwise 403 with **exactly** `Reload the workspace before saving` (the main-process refresh predicate).
5. `Content-Type` must be `application/json`. Otherwise 400 `JSON required`.
6. A `Transfer-Encoding` header gets 400 `Transfer encoding not supported`.
7. `Content-Length` must be 1–2,000,000. Otherwise 400 `Input must be 1–2,000,000 bytes`.
8. The body must decode as a JSON object. Otherwise 400 `JSON object required`.

Other methods get 405 `{error:'Method not allowed'}`.

**Responses.** Responses are UTF-8 JSON with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. There is no web UI. Every error is exactly `{"error": "<text>"}`:

- 400: validation.
- 403: guards.
- 404: `Route not found` or `Run not found`.
- 405: method not allowed.
- 409: stale version or full queue.
- 500: `The service could not complete this request. Your existing data is preserved.`

**Routes:**

| Route | Contract |
| --- | --- |
| `GET /api/workspace` | `{brands, content, runs, tools, features, csrf}`. Brands are ordered by name and the built-in `{id:'default', name:'My workspace'}` always exists. Content is ordered by `updated_at` desc. Runs are the latest 200 by `created_at` desc, without output. Tools are the eight in HQ `TOOL_IDS` order, with HQ categories. `features` lists `hq-editorial-timebox-v1` (when zoneinfo resolves `America/New_York`) and `hq-references-v1`. WS-X adds `hq-brand-project-v1`, `hq-sources-v1` and, when enabled, `hq-publishing-simulator-v1`. |
| `POST /api/content` | Accepts exactly the keys `title, body, brand_id, channel, planned_date, archived`, plus optional `id, version, planning_slot, links`. **Any other key** gets 400 `Unknown field: <key>`. Rules, order and messages follow `checkDraft` in `modules/social/core/validate.ts`: title, body, channel, date, archive, slot, brand, then ID and version. Slot rules and messages follow `checkSlot` in `core/timebox.ts`. Links follow `checkLinks` (`Links must be a list of 0–30 valid HQ references`), and a repeated `(domain, kind, entityId)` gets 400 `Each HQ reference can be linked once`. With no `id`, the service creates a draft with `id = uuid4().hex` and `version = 1`. With an `id`, it updates only when the id exists **and** the version matches; otherwise 409 `This draft changed in another window. Close and reopen it before saving.` A successful update adds 1 to `version`. Absent `links` preserves the stored links and `[]` clears them. Absent `planning_slot` on an update keeps the stored slot, revalidated against the new date and dropped when no longer valid; `null` clears it. The response is the stored Draft with `planning_slot` (object or null) and `links` (array) always present. `updated_at` is `datetime.now(timezone.utc).isoformat()`. |
| `POST /api/brands` | Accepts exactly `{name}`: 1–80 characters, stripped, with the message `Brand name must be text, 1–80 characters`. Returns `{id: uuid4().hex, name}`, plus `project_id: null` once WS-X lands. |
| `GET /api/sample/<tool>` | The tool's fictional sample input (`social_service.tools.SAMPLES`, which equals HQ's `WORKBENCH_EXAMPLES`). Unknown tool: 400 `Unknown tool`. |
| `POST /api/runs` | Accepts exactly `{tool, input, is_example}`. A known tool and an object input are required, else 400 `Choose a known tool and supply a JSON object`. `is_example` must be boolean (absent means false), else 400 `Example label must be boolean`. With 8 runs queued or running, 409 `Run queue is full. Wait for a run to finish.` Otherwise the service writes `runs/<id>/input.json`, inserts a `queued` row and returns the RunRecord. |
| `GET /api/runs/<id>` | The id must match `^[0-9a-f]{32}$`, else 400 `Invalid run ID`. A missing run is 404 `Run not found`. Returns `{id, tool, status, is_example: 0/1, created_at, finished_at, error}` and, once `succeeded` or `failed` with a result file, `output: {ok:true, result} | {ok:false, error}`. |

**Runs.**

- One serial worker thread. Each run is a fresh subprocess, `python3 -m social_service.worker <run_dir>`, with this environment:
  - environment variables: only `PATH=/usr/bin:/bin`, `HOME` and `TMPDIR` set to the run directory, `PYTHONDONTWRITEBYTECODE=1` and `PYTHONPATH=<services/social>`;
  - working directory: the run directory;
  - stdin: `/dev/null`;
  - output: `worker.log`;
  - timeout: 60 s.
- The worker applies, where available, `RLIMIT_CPU` 45 s, `RLIMIT_AS` 1 GiB and `RLIMIT_FSIZE` 32 MiB. It installs an audit hook that denies `socket.*`, `subprocess.Popen`, `os.system`, `os.exec*`, `os.posix_spawn` and `os.fork`. Then it calls `tools.execute(tool, input, now=<UTC datetime>)` and writes `result.json`.
- Status moves `queued → running → succeeded|failed`, where `failed` means `ok:false` or any worker failure. `error` is at most 4,000 characters and `finished_at` is set.
- The result must serialize to at most 1,500,000 bytes, so a run record fits HQ's transport cap. Otherwise the run fails with `Result is too large to return (limit 1,500,000 bytes)`.
- At startup, queued and running runs become `interrupted` with `Service restarted before completion; run again explicitly.` Nothing is retried.

**Storage.**

- Files: `<data>/hq-social.sqlite3`, versioned with `PRAGMA user_version` and forward-only additive migrations, plus `<data>/runs/<id>/`.
- Tables:
  - `brands(id PRIMARY KEY, name, project_id NULL)`;
  - `content(id PRIMARY KEY, title, body, brand_id, channel, planned_date, planning_slot TEXT NULL, links TEXT NOT NULL DEFAULT '[]', archived, version, updated_at)`;
  - `runs(id PRIMARY KEY, tool, status, is_example, created_at, finished_at, error)`.
- The service never opens a Fieldnotes database. Importing Fieldnotes data is owner decision D-B2-1.

**Analyzers** (`social_service/tools/<module>.py`, one module per tool):

- Interface: each module exports `run(data: dict, *, now: datetime) -> dict`.
  - Pure, deterministic and offline: stdlib only, no file, network or process access.
  - It raises `ValueError(<user-facing message>)` on invalid input.
- Registry: `tools/__init__.py` holds `CATALOG`, `SAMPLES` and `execute`.
- Output shapes satisfy HQ's summarizers in `modules/social/workbench/results.ts`:

  | Tool | Fields the summarizer reads |
  | --- | --- |
  | `x-studio` | `content.blocks[].text` |
  | `social-publisher` | `channels[].platform` and `findings[]{rule_id: '<platform>.caption'\|'.format'\|'.owner_scope', status}`, plus `qualification` |
  | `x-intelligence` | `counts` and `evidence[]{title, text}` |
  | `creator-relationships` | `creators[]{handle\|name, status, niche_matches, missing_evidence, age_days}` |
  | `seo-studio` | top-level `ok` |
  | `reddit-opportunities` | `profile` |

  The other two tools produce meaningful top-level facts.
- Every result states its basis (supplied data, as of a date) and never claims collection, posting or account access.
<!-- codex-section:end id="spec.hq-social-backend#iface.service.001" -->

## Stable adapter contract

<!-- codex-section:begin id="spec.hq-social-backend#iface.adapter.001" -->
F3 and any other view consumer may rely on the following. B2 changes them only additively.

- `SocialWorkspacePort` methods (`snapshot`, `saveDraft`, `addBrand`, `example`, `run`, `submitRun`) and their call classes. New methods are added only for new capabilities and are callable only when `snapshot().features` advertises their flag.
- `PortError` kinds: `invalid` and `conflict` (with `message`), `not_found`, `forbidden`, `unavailable`, and `unknown` (with `attemptedAt`). The mapping from HTTP and transport outcomes is unchanged ([social-runtime evidence](../evidence/hq-social-work/social-runtime/README.md)).
- Feature names: `hq-editorial-timebox-v1`, `hq-references-v1` and `hq-brand-project-v1`. WS-X adds `hq-sources-v1` and `hq-publishing-simulator-v1`.
- The `window.hqServices.social.call(route, params)` routes. New routes are added only alongside a new feature.
- *Target (WS-D):* `portErrorNotice(error, action)` in `modules/social/core` returns the surface (`inline`, `toast` or `banner`), tone, text and allowed recovery (`fix-input`, `reload-latest`, `check-again` or `none`), so every page presents errors the same way. `unknown` after a run submission is never offered as *Run again*.
<!-- codex-section:end id="spec.hq-social-backend#iface.adapter.001" -->

## Accounts and publishing (*design; default off*)

<!-- codex-section:begin id="spec.hq-social-backend#iface.publishing.001" -->
HQ must never post to a real account or handle real credentials without a separate owner decision. WS-X implements the shape, but only with a local **simulator**:

- **Activation.** Publishing is off unless the service starts with `--publishing simulator`. While it is off, the service advertises nothing, every publishing route returns 404 `Route not found`, and HQ shows today's *Not available* copy.
- **Simulator.** Channel "connections" are simulated records with no credentials and no network. A publish request snapshots the exact draft version and its content and is created `pending_approval`. It is delivered only after an explicit approval call that names that request and version. "Delivery" appends to a local outbox and returns a receipt marked `simulated: true`. A changed draft invalidates a pending request. Nothing is ever retried automatically, and an unconfirmed outcome is `unknown`.
- **Provider seam.** Providers sit behind one interface: connect, prepare, deliver and read back. Only `simulator` exists. A real network provider needs owner decision D-B2-3: networks, credential custody outside the HQ window, the approval model and platform readback.
- **Copy.** The UI may say *Simulated* and must not say *posted*, *published*, *live* or *connected* for simulator results.
<!-- codex-section:end id="spec.hq-social-backend#iface.publishing.001" -->

## Workstreams (*target*)

<!-- codex-section:begin id="spec.hq-social-backend#plan.workstreams.001" -->
| ID | Scope (sole writer) | Base | Depends on |
| --- | --- | --- | --- |
| WS-S | `services/social/**` except the analyzer modules: server, store, validation, runner, worker, registry, launcher, service tests, golden contract exchanges, README; `services/README.md`; the CI job | B2 service base | — |
| WS-T | `services/social/social_service/tools/<module>.py` and their `tests/test_tools_*.py` | B2 service base | — |
| WS-F | Fieldnotes compatibility harness (opt-in, no default-discovery skips) and evidence | foundation + #166 | — |
| WS-D | `apps/desktop/electron/services*.ts` (#166 ancestor, response caps), the `modules/social/core` error helper, the `modules/social/live` contract README, and real-service E2E in `apps/desktop/src/social-live.integration.test.tsx` | WS-S + WS-T | S, T |
| WS-X | Extensions: brand project, sources registry, publishing simulator. Service, contracts, main, port, fixture and conformance. | WS-D | D |

Each builder is reviewed by the lead, and each PR gets an independent Sonnet review first. PRs target `work/hq-foundation`, and an upper PR states which lower commits it contains. Merge is held for the integration owner.
<!-- codex-section:end id="spec.hq-social-backend#plan.workstreams.001" -->

## Owner decisions

<!-- codex-section:begin id="spec.hq-social-backend#ctx.owner-decisions.001" -->
- **D-B2-1. Authoritative Social store.** The options are: keep the Fieldnotes deployment (fix its reachability per D-B2-4 and merge growth-intel #41); adopt the HQ Social service (needs an explicit, approved import of Fieldnotes records); or run both, with the HQ service for local and disposable use. Until the owner decides, B2 ships the HQ service and changes no deployment.
- **D-B2-2. Native tools.** The choice is between importing Fieldnotes' native tool implementations into public HQ, which needs a licensing and publication decision (growth-intel has no license), and keeping HQ's reference analyzers.
- **D-B2-3. Real networks.** Account connection and posting need decisions on which networks, credential custody, the approval model and readback. B2 holds this and ships only the simulator.
- **D-B2-4. Fieldnotes reachability.** The fix is a growth-intel Host allowlist plus a private HTTPS front, and it is a hosting action. B2 does not perform it.
- **D-B2-5. Required checks.** The new `services/social` CI job changes root workflow configuration and needs integration-owner acceptance before it becomes required.
<!-- codex-section:end id="spec.hq-social-backend#ctx.owner-decisions.001" -->

## Delivery record

<!-- codex-section:begin id="spec.hq-social-backend#ctx.delivery.001" -->
In progress. Exact PRs, heads and check results are recorded here when they land.
<!-- codex-section:end id="spec.hq-social-backend#ctx.delivery.001" -->
