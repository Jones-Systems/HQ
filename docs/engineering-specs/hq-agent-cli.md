# Engineering Spec — HQ Planner service and agent CLI

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.artifact-header.002" -->
Artifact Type: `engineering-spec`

Artifact ID: `spec.hq-agent-cli`

Purpose: Establish the HQ-owned Planner service, complete its agent CLI and live Work adapter, and retire the prior executable copy.

Governing artifact: none

Specification owner: HQ Planner extraction coordinator

Integration owner: HQ root coordinator

Consumers: HQ root, service/CLI/Work builders, verifier, planning compiler

Authority effect: none
<!-- codex-section:end id="spec.hq-agent-cli#ctx.artifact-header.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.project-summary.002" -->
## Project Summary

HQ becomes the canonical source owner of the Planner backend in `services/planner`, with the existing legacy web UI, the agent CLI in `tools/hq-cli`, and a feature-gated Work adapter in `modules/work/live`. Agents call a child-process CLI and observe one JSON document; Work uses a typed transport. HTTP, synthetic golden exchanges and shared reference vectors join independently owned domains; there is no universal backend process, config platform or shared state store. The CLI never opens the Design store.

One editable backend copy exists at a time: import the selected MIT app source, freeze the prior copy to a pointer, and delete its executable tree only under the retirement sequence. No data moves, deployed service changes, installation or live record access occur. This HQ artifact supersedes the prior repository's plan ownership after transfer; private continuity stays private.

Source completion includes B1/F/C publication, D publication if custody clears, composite evidence I through CLI→backend→Work port→mounted Work UI, R1 integration and supersession of the prior candidate, and publication of R2. HQ-main integration and installation remain separate and unclaimed; I remains blocked if D custody is unresolved. Shared desktop bridge/session/settings work E is explicitly held.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.project-summary.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#req.requirements.002" -->
## Requirements

1. Import exactly the selected 41 app files from the named source revision, excluding its historical provenance JSON; preserve full MIT notice and prove byte/blob equality before adaptation. Keep SQLite schema version 1, export `jones-planning-export` v1, existing routes/guards/history/ordering/backups and external `--data` ownership.
2. Preserve the accepted CLI discovery, schema/output/exit, date, batch and retention-aware replay contracts. Retain all 70 existing CLI test cases and extend them. `planned` means `target`; `due` means `deadline`. Single board `planner:main` stays truthful; dates never launch execution.
3. Add `hq-references-v1` using unchanged ReferenceEnvelope/parseReference semantics, existing JSON persistence without DDL, lossless wire/read/write/import/export roundtrip, and a non-link legacy UI rendering. The feature is advertised only when persistence works. Do not edit the pinned upstream ordering/dates/model JS files.
4. Provide golden synthetic exchanges from the real disposable backend and reference accept/reject vectors as shared contracts, with regeneration drift proof and SHA-pinned adapter copies. No live endpoints, private records, host addresses, session history or credentials enter source or evidence.
5. Implement Work live adapter only in its owned cone and only after explicit custody. Preserve Work core; hold desktop bridge/session/settings changes for a separately accepted shared-file claim. Prove identical IDs, distinct target/deadline dates and a subsequent CLI write through the Work port and mounted module.
6. Coordinate publication and retirement with exact revisions and direct readback. HQ merges remain integration-owner held; R2 merge requires proof HQ main contains the imported service. No root config/lockfile/CI/catalog adoption or deployment is included.
<!-- codex-section:end id="spec.hq-agent-cli#req.requirements.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.acceptance.002" -->
## Acceptance

Each task's addressable acceptance below is required on its exact candidate. Source implementation, published candidate, HQ-main integration and installation are reported separately. Existing 70 CLI cases survive; imported backend baseline is expected to retain 61 Python and 27 Node cases. Those counts are accepted-plan expectations until measured, not evidence produced by this spec. Any blocked gate, skipped opt-in test, unavailable compiler or absent CI is reported plainly. HQ's candidate baseline has no configured checks; never describe that as green.
<!-- codex-section:end id="spec.hq-agent-cli#ac.acceptance.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.research-decision-basis.002" -->
## Research And Decision Basis

Accepted substantive and material-reframing judgments are owner-private coordination records, identified only by SHA-256:

| Record | SHA-256 |
| --- | --- |
| Initial CLI plan | `39dd24985ce5f8cb7096931539e8dc728d071f7af60f6d449ab1e031955b613b` |
| Focused replay correction | `3cedd5caecbd6c48e5e6a22c49756a40e3ae7d5888f071fa67c8952dea04fcb0` |
| Service extraction plan | `bfbc3fae70f94d125731b33dd600474d02d27b156832de4cc753768e87a5f90d` |

Mode is explicit `claude_frontier`; substantive judgment is accepted Opus 5.5/high. This document is deterministic encoding. Policy normalizes R2 building to Astra medium and composite verification I to Astra high; no architectural decision changes. B1/C/R1 use Astra medium; F/D/E use Astra high.

Evidence basis: selected app source `abfa34ce793a738b436ff857dfe695a2e13ef2c3`, equal app bytes at `1fd72c79fbfb53ed6b30edab8bc9197dbecd3a78`; CLI candidate `3a15d664ca1abe822f7231c997a63df7d9f8e38d`; Work candidate `562986d` is a supplied abbreviated source locator and must be resolved to an exact current commit before D binding. The root's initial HQ branch was clean at `3a15d664ca1abe822f7231c997a63df7d9f8e38d`. Accepted source inspection covered the single prior app, HQ root config explicit roots, Work PlannerPort/bridge contract, and PR overlap at planning time; publication must refresh collisions. No shared-guidance bridge exists in the supplied HQ instructions checkout: enrollment is unavailable and no replacement is installed.

Partial impact coverage: the named app source tree, current CLI tree and supplied Work contract at the cited revisions, discovered by direct source inspection. External/runtime consumers, deployed health, future shared-shell decisions and later branch movement are excluded or unknown. HTTP hides SQLite from the CLI and Work; Work's renderer has no direct service URL. Reference providers/backlinks are future-owned, not invented here. The service stores outgoing references only; each domain keeps its own state. No additional public research is needed to encode these accepted source-bound decisions.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.research-decision-basis.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.service-layout.001" -->
## Service Layout And Configuration

- `services/README.md` indexes HQ backend services, launch commands, features, contract locations and the external-data rule; Fieldnotes is listed as external, never imported.
- `services/planner` is stdlib Python plus legacy UI, not an npm app. Launch `python3 -m planning` from that directory with `--data` outside the repository. Existing explicit root TypeScript/Vitest config does not discover services or tools; adoption is held.
- `tools/hq-cli` remains dependency-free native Node TypeScript (Node ≥22.18), with no CLI config file. `--planner-url` overrides `HQ_PLANNER_URL`; HTTPS or loopback HTTP only.
- `modules/work/live` is the Work-owned live port. A shared bridge and endpoint settings belong to held E, with main-process configuration outside the repo.

A shared `hq.endpoints/v1` config is a follow-on proposal, not a prerequisite or implementation. No universal process, cross-domain database, cache, migration service or authentication platform is introduced.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.service-layout.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.change-surface.002" -->
## Exact Change Surface And Ownership

Root is sole Git owner of the plan/import lane. Every later lane receives an isolated non-main worktree, exact repository/revision, one Git owner and its declared cone before mutation. Machine paths are repository-relative to the prose target; they do not bind a runtime or grant shared ownership.

| Task | Repository target and write cone | Consumer/ownership boundary |
| --- | --- | --- |
| B1 | HQ `services/planner`, `services/README.md` | Selected source import; root commits verbatim baseline before adaptation |
| F | HQ service validation/store/server, `planning/__main__.py` only if port-print repair needed, `public/js/detail.js`, `tests`, `contract`, README | Python owns validation/persistence; legacy UI remains compatible |
| C | HQ `tools/hq-cli` | Includes common `src/schema.ts` and `src/commands.ts` for advertised input/output reference capability, not write-schema alone |
| D | HQ `modules/work/live` | Work-stack base then-current exact PR36 descendant; no Work core edits; custody gate |
| I | HQ `docs/evidence/hq-agent-cli/integration.md` | Verifier writes synthetic evidence only on root-prepared composite |
| E | HQ named contracts, Electron bridge, session, endpoint-settings UI and shell test files | Shared custody held; exact new UI/test filenames fixed by shared owner before binding |
| R1 | Codex-V3 app README plus named operations/historical-pointer/private continuity docs | Public spec carries only retirement summary; no private text copied to HQ |
| R2 | Codex-V3 app executable directories, `.gitignore`, historical provenance JSON | Retain README pointer; source deletion only, merge held until HQ-main proof |

F and C are independent after B1 acceptance; C's runtime reference tests require accepted F for final composite proof. D can build from this contract once custody clears; acceptance of copied exchanges binds F's final contract in I. Root config, lockfiles, workflow, shared catalog, pinned upstream files and Work core are outside unheld cones. E's broad desktop directories in machine paths are containment bounds, not permission to edit unnamed files.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.change-surface.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#iface.contracts.002" -->
## Interface Contracts



**Discovery:**
- `hq capabilities` lists each domain with an availability of `live | unconfigured | unreachable | unavailable | not_exposed`, a reason, and the server's features.
- `hq schema [command-id]` returns JSON Schema for each command's input, output and errors.
- `hq commands` lists commands.
- Stable IDs: command IDs like `planner.items.create_batch`, board ID `planner:main`, and Planner item and date IDs passed through unchanged.

**Output:**
- stdout is always exactly one JSON document: `{schema:"hq.cli.result/v1", ok, command, effect: none|applied|replayed|unknown|partial, data|error:{code,message,details}, request_id?, replay?}`.
- stderr is for human diagnostics only and is never needed for parsing.

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | ok, or replayed |
| 1 | internal error |
| 2 | usage or schema error (local, no effect) |
| 3 | Planner validation rejected (no effect) |
| 4 | conflict: `revision_conflict` (includes `current`), `order_conflict`, `request_id_reused` |
| 5 | not found |
| 6 | unavailable, known no effect (connection refused, DNS failure, 421/403 access refused, capability missing, unconfigured) |
| 7 | **unknown effect** (timeout, reset or bad response after sending a write; 5xx on a write) |
| 8 | partial (sequential batch) |

**Dates:**
- `--due D` means `deadline`.
- `--planned D` means **`target`**, the accepted default. It matches the calendar's default when dropping an item onto a day, and Review prompts when a target passes.
- `--date kind:value[@HH:MM[-HH:MM]][~TZ]` is the general form.
- Relative tokens are limited to `today`, `tomorrow` and `+Nd`. They resolve in the Planner's `settings.default_tz` (or `--tz`), and the output echoes `{input, resolved, tz, today}`.
- Weekday names are rejected with a pointer to `hq planner now`. Reading "Friday" out of natural language is the calling agent's job.
- Resolved values are fixed into the request body before it is sent.

**Batch spec (`hq.planner.batch-create/v1`):** `{board:"planner:main", items:[{client_key?, title, status?, kind?, area?, horizon?, priority?, motivation?, notes?, dates:[{kind,value,...}]}]}`, up to 50 items.

- **Atomic mode (default):** requires the `items.batch_create` feature.
  1. Validate the shape locally.
  2. Server dry run: errors are indexed like `items[2].dates.value`.
  3. One commit under one request ID.
  4. Output lists items in input order with their `client_key`. The column order, top to bottom, equals input order.
- **Sequential mode (`--mode sequential`):** must be chosen explicitly, and remains the compatibility option for services without atomic batch capability.
  - Per-item request IDs are `<rid>-<i>`, so the caller's base ID can be at most 60 characters.
  - It stops at the first non-success and reports each item as `created | replayed | failed | unknown | not_attempted`.
  - Resume only with `--resume-from PRIOR_RESULT`: retain the resolved spec, base request ID, per-item statuses and V0. Skip completed `created`/`replayed` items by recorded IDs. Remaining items follow the retention-aware service-specific resume rules below; rerunning the raw spec is not a resume.
  - Its dry run is a local shape check only, reported as `validation:"client_shape_only"`.

**Idempotency and reconciling unknown outcomes:**
- `--request-id` is optional; otherwise the CLI generates a UUID. It is reported either way.
- On exit 7, emit `hq.planner.replay/v1` with `{request_id,method,path,body_b64,sent_after_version,planner_url,created_at}`. Preserve exact original bytes as base64 and the exact endpoint. No automatic resend, force option, or retry under a new ID is allowed.
- `hq planner replay --request-file F [--check]` uses the retention-aware replay route when advertised. Old-service fallback is limited to revision-guarded writes; create, batch and settings recovery requires readback. Detailed accepted contract follows below.

**Access:**
- The URL comes from `--planner-url` or `HQ_PLANNER_URL`. Plain `http` is accepted only for loopback; anything else must be `https`.
- The CLI sends no `Origin`. It holds no secrets.
- A 421 response includes a hint to use the service's `--allowed-host`.



Planner batch contract: `POST /api/items/batch` takes `{items:[fields…],dry_run?:bool}` in one `_mutate`, without a DB schema-version bump (SCHEMA_VERSION remains 1; add only the eviction-floor meta row). All mutation guards apply (`Content-Type: application/json`, `X-Planning-Request:1`, same-origin if Origin exists, allowed Host). Request IDs match `[A-Za-z0-9-]{8,64}`. CLI sends no Origin. Aggregate validation errors are indexed; dry-run records no request ID. Existing frontend tolerance of additive fields must be directly checked. Rollback is source revert; the additive meta row is tolerated by existing schema-version-1 stores.

Native Node ≥22.18 strips supported TypeScript syntax; no runtime/dev dependencies or lockfile. `bin/hq` resolves its own path and invokes `src/main.ts`. Symlink-to-checkout installation is required because Node does not strip types under node_modules; npm global installation is unsupported. Optional standalone local tsc is a bounded additional check if available; root integration remains held.
### Retention-aware replay protocol

#### How the server proves "not applied": the eviction floor

- `meta` gets a new key, `request_evicted_through_version`. It holds the highest `state_version` of any request record ever evicted. The value only goes up. This is a meta row, so there is no schema change and `SCHEMA_VERSION` stays 1.
- **During eviction in `_mutate`:** before the existing `DELETE`, read `MAX(CAST(json_extract(response,'$.state_version') AS INTEGER))` over the rows about to be evicted. Then set the floor to `MAX(floor, that)`. Every stored response already carries `state_version`.
- **First open of an existing store:** if the key is missing and the store holds fewer than `MAX_REMEMBERED_REQUESTS` records, the floor is `0`, because eviction only ever trims down to the cap. Otherwise the floor is the current `state_version`, which is conservative.
- **Any other code path that deletes request records** (check replace-import and backup restore) must raise the floor to the highest version it removed. Builder assertion: no path ever lowers `state_version`.

**The proof:** the client reads `V = state_version` before its first send. If the original write committed, its version is greater than V. So if the record is missing and `floor ≤ V`, the write never committed. In every other case the outcome is **indeterminate**.

#### 2. New route: `POST /api/requests/replay` (feature `requests.replay`)

**Guards:** the existing mutation guards apply (JSON content type, `X-Planning-Request: 1`, Host, Origin). An `X-Request-Id` header on this route is rejected with 400 `bad_request_id`; the original ID goes in the body.

**Request body:**
```json
{"mode":"lookup|resend","request_id":"<original>","method":"POST","path":"/api/items",
 "body_b64":"<exact original bytes>","sent_after_version":123}
```

**Validation:**
- Only these method and path pairs can be replayed: `POST /api/items`, `POST /api/items/batch`, `PATCH /api/items/:id`, `POST /api/items/:id/{move,archive,restore,reviewed}` and `PUT /api/settings`. Anything else returns 400 `not_replayable`.
- The decoded inner body must be at most 256 KiB (`MAX_BODY`) and must be a JSON object. A malformed envelope or bad base64 returns 400 `invalid` or `bad_json`.
- The envelope itself is capped at `REPLAY_MAX_BODY = 352 KiB`. That cap must be added both to the handler's length check in `make_handler` and to `_check_mutation`; above it, the route returns 413.

**Fingerprint:** computed exactly as the original route does, `sha256(f"{method} {path}\n" + inner_bytes)`, using the path as originally sent with no query string.

**Store method `replay_request(request_id, fingerprint, sent_after_version, mode, apply)`**, run while holding the store's reentrant lock:
1. If a record exists and its fingerprint differs, return 422 `request_id_reused`.
2. If a record exists and matches, return 200 `{outcome:"replayed", status, response}` with `X-Replayed: 1`.
3. If there is no record and either `sent_after_version` is missing or `floor > sent_after_version`, return 409 `replay_indeterminate` `{sent_after_version, evicted_through_version}`. Nothing changes.
4. If there is no record and `floor ≤ V`:
   - `lookup` returns 200 `{outcome:"not_applied"}`.
   - `resend` calls `apply()`, which is the normal `_dispatch` with the **original** request ID and fingerprint. It returns 200 `{outcome:"applied_now", status, response}`.
   - If `apply()` fails (`invalid`, `revision_conflict`, `order_conflict`, `not_found`), the normal error comes back and the transaction has rolled back.

**Why there is no race:** the floor check and the apply happen under one lock. If the original request arrives later, it carries the same ID, so the normal route replays it instead of applying it twice. A `lookup` result of `not_applied` is only true at that moment. The CLI never follows a lookup with a normal-route send; only `resend` applies. This depends on the store's existing single-process lock contract, which should be documented.

**Advertising:** `/api/version` and `/api/state` add `"requests.replay"` to `features`, plus `request_retention: {max: 2000, evicted_through_version: F}`.

#### CLI replay contract

- **Every write reads `/api/version` first** to get V. For an atomic batch, the dry-run response can supply it instead. If that read fails, the CLI exits 6 and sends nothing. V goes into the replay document.
- **Replay document `hq.planner.replay/v1`:** `{request_id, method, path, body_b64, sent_after_version, planner_url, created_at}`.
- **`--intent-file PATH` (optional):** written atomically (temp file, then rename) before the first send and updated after each item. This covers a crashed CLI process. The caller owns the path.
- **On unknown outcome:** exit 7 with the replay document. The CLI never resends on its own.

**`hq planner replay --request-file F [--check]`:**

| Service | Route | Behaviour |
|---|---|---|
| Has `requests.replay` | any | `--check` uses `lookup`; the default uses `resend`. `replayed` → exit 0, effect `replayed`. `applied_now` → exit 0, effect `applied`. `not_applied` → exit 0, effect `none`. `replay_indeterminate` → exit 7 with readback guidance. |
| Old service | PATCH, move, archive, restore, reviewed | Resend the exact bytes with the same ID through the normal route. This is safe because the revision guard makes a second apply impossible. A 409 `revision_conflict` → exit 4 with `current` and the note "possibly already applied". |
| Old service | create, batch, settings | `replay_unsupported`, exit 7, no write. The output includes readback guidance (`items list` by title and an `updated` window, `items get`). |

**Sequential batch resume (`--resume-from PRIOR_RESULT`):** the prior result carries the resolved spec, `request_id`, per-item statuses and `sent_after_version` V0. Items marked `created` or `replayed` are skipped and reported with their IDs. For the rest:
- **New service:** each remaining item goes through `resend` with its own ID `<rid>-<i>` and V0. The run stops at the first `replay_indeterminate` and exits 7.
- **Old service:** `not_attempted` items are sent through the normal route, since they were never sent. A no-effect `failed` item needs an edited spec and a new run. Any `unknown` item stops the run with exit 7 and requires manual reconciliation.
- Because finished items are skipped, it does not matter if their replay records have been evicted.


Additional envelope invariant: `sent_after_version`, when supplied, must be a valid integer (not a Boolean), nonnegative and no greater than the current source state_version. Invalid/future values are rejected before any apply; a missing value can only yield indeterminate when no matching record exists. CLI replay must reject an endpoint override differing from the document-bound planner_url before sending.
<!-- codex-section:end id="spec.hq-agent-cli#iface.contracts.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#iface.hq-references.001" -->
## HQ Reference Contract

Planner outgoing references extend the source item's existing list with `{id,kind:'hq',label,target:ReferenceEnvelope}` and forbid `url` on this variant. Retain other reference kinds unchanged. Validate target exactly like unchanged `parseReference`: closed key allowlist, `version === 1`, domain design/social/work, trimmed nonempty text without controls, default limit 160, title/sourceRevision ≤300, destination ≤512 without scheme or leading `//`; label ≤200. Reject duplicates on `(domain,kind,entityId)` using Work semantics. Preserve optional fields and reject malformed envelopes; roundtrip through create, patch, get/state, import/export v1 and backup/restore.

No new DDL. Saving without a references patch preserves existing references. Legacy `detail.js` displays `Linked in HQ: <title>` through textContent as a non-link, and remove/re-save echoes target unchanged. Ordering/dates/model JS files remain byte-pinned. Runtime reference availability is computed by future providers and never written into Planner item status; no backlink store or target-item copy exists.

For a Work target, proposed Work-owned constant is `domain:'work',kind:'item'`, entityId is the item ID, projectId is the HQ ProjectContext ID, returnDestination is domain work/destination `item/<id>`, and sourceRevision is string(item.revision). Work root retains constant/provider acceptance; ReferencePort/provider work is out of scope.

Advertise `hq-references-v1` on version/state only with working persistence. CLI gates HQ-reference writes on this feature (missing feature → local exit2/no write) and advertises matching input/output schemas in common schema.ts/commands.ts as well as write-schema.ts. Work writes likewise require the feature. Read/schema roundtrip tests prove that a returned target is preserved, not stripped or rejected.
<!-- codex-section:end id="spec.hq-agent-cli#iface.hq-references.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#iface.wire-contract.001" -->
## Wire Exchanges And Shared Vectors

Service `contract/reference-vectors.json` owns synthetic accept/reject cases. `contract/exchanges/*.json` records synthetic state/version/create/patch/move/archive/restore/reviewed/settings/batch/replay, revision/order409, validation/request_id_reused422, and X-Replayed behavior. A stdlib generator captures exchanges from a disposable actual service; drift regeneration is a failing check. Preserve native error status codes and include the accepted validation and request-ID-reuse cases in the exchange contract.

Work live test copies pin exchange SHA-256 values. Integrity skips explicitly when the service tree is absent; it fails on drift when present. Future final candidate evidence must identify exact service/adapter/exchange hashes. Shared vectors/exchanges are contracts, not a shared runtime package or synthetic QA history import.
<!-- codex-section:end id="spec.hq-agent-cli#iface.wire-contract.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#iface.work-live-transport.001" -->
## Work Live Transport

`createPlannerLivePort(transport)` implements the existing PlannerPort without editing core. `PlannerTransport.call(route,params)` uses exactly state, version, item, history, create, patch, move, archive, restore, reviewed, settings. Every received HTTP response including 4xx returns `{ok:true,status,body,replayed}` with a capped body; transport failure returns `{ok:false,kind:'unavailable'|'unknown'}`.

Map state_version→stateVersion, server_time→observedAt, missing features→[], X-Replayed→replayed. Map409 to revision_conflict with current or order_conflict;422 errors to invalid, request_id_reused to defect;404 to not_found. Failed read→unavailable; write failure after send or write5xx→unknown with requestId. Strip derived date fields before writing and gate HQ references by feature. Do not automatically retry unknown writes.

D's test-only Node transport is not shipped. Module UI proof mounts @hq/work using a stub ModulePort, selects `setWorkSessionPort(port,{example:false})`, and refreshes via the existing poll/refresh seam. Shell-level App connection belongs to E/assembly.

Held E proposes `packages/contracts/src/services.ts` with a package subpath, fixed Electron routes and typed preload, main-only endpoint config outside the repo, additive replayed, and 4xx-as-ok:true preserving current/errors. A replay route is a later optional proposal. No generic URL/method/header fetch capability, renderer secrets, bridge bypass or autonomous work launch. Production session lazily selects live when window.hqServices.work is configured, otherwise a labelled example. Shared owner must resolve custody and exact settings/shell-test files before implementation.
<!-- codex-section:end id="spec.hq-agent-cli#iface.work-live-transport.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.provenance.001" -->
## Provenance And Licensing

Source selected-file extraction is authorized by the owner's directive of 2026-10-20 for this app only. Import source is Jones-Systems/Codex-V3 (private, MIT) `abfa34ce793a738b436ff857dfe695a2e13ef2c3`, through its source candidate ref; app bytes are equal at `1fd72c79fbfb53ed6b30edab8bc9197dbecd3a78`. Do not include unrelated repository history. The approved source file list is reproduced as the B1 capsule input and deterministic import manifest; historical `provenance.json` is excluded because its QA/coordinator/session context is not public import material.

Root sequence: first commit the 41 files verbatim and prove each SHA-256 and Git blob against `git show <source>:apps/manual-planner/<relative-file>`, plus byte-equivalence of app trees at the two source revisions. Then adapt only README title/paths, remove the private hosting link, state deployment held, and add cone-local LICENSE, PROVENANCE.md and `import-manifest.json`. Then add `services/README.md`. Preserve full root-source MIT text including Copyright (c) 2026 Malcolm Jones. Do not invent a repo-root licence.

`hq.planner-import/v1` entries contain source_path,dest_path,git_blob,sha256,bytes,adapted. Manifest hashes describe the import baseline, not later F changes. PROVENANCE.md states the selected extraction decision, exact commits, file table and excluded provenance JSON, full MIT notice, and equality of public/js/ordering.js, dates.js and model.js to Work's existing upstream copies. Resolve full hashes from the imported source; supplied research prefixes abf141…,390c39…,fb2463… are locators, not full digest proof. Repointing Work upstream provenance is a proposal to its owner only.

Never import session/continuation records, host paths/addresses, private QA, provider-account identities or original provenance JSON. This public artifact cites owner-private plan records by digest only; no private Work Note is copied.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.provenance.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.legacy-retirement.001" -->
## Legacy Source Retirement

R1 targets Codex-V3 origin/main in a separately bound lane. Its app README freezes the old source and points to HQ services/planner at the exact published commit; operations hosting source binding points to HQ with deployment re-binding held; historical QA receives only a historical-pointer line. The private continuity owner appends its transfer record privately. This public HQ spec becomes canonical; the former spec does not remain the current owner after transfer.

Before closing the prior source candidate as superseded, root preserves its outstanding scoped documentation commits by normal fast-forward publication, then links HQ import and retirement candidates. Do not merge the superseded source candidate or delete its branch. R1 publication waits for the accepted B1 result and exact HQ import publication readback; its integration follows Codex-V3 policy.

R2 follows R1, deletes only the old app executable planning/public/tests directories, .gitignore and historical provenance JSON, and keeps README. Publish R2 but hold merge until exact direct readback proves HQ main contains the service. Check dangling app-path links. No live service, database, units or immutable installed release changes; this is source migration only.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.legacy-retirement.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.check-catalog.001" -->
## Projection Check Catalog

`docs/planning-evidence/hq-agent-cli/projection-catalog.toml` is private-free proposal/projection input, SHA-256 `5fe6644e9f99408509588dc450ab257af829a795a080300584fbf1c852f287f3`. Groups: planner-service,hq-cli,work-live,repository-integrity. It uses actual codex.v3-check-groups/v1 group keys summary,covers,direct_surfaces,tests. It does not write HQ tests/check-groups.toml, change CI, register package discovery or qualify a test runner.

The released AffectedCheckCatalogBinding fixes manifest_path to the logical tests/check-groups.toml name; projection binding uses that required logical name and the actual proposal bytes' digest/evidence_ref. This is a projection-only logical binding, not a claim the canonical file exists or is adopted. The released Codex-V3 run_checks parser accepts only tests/test_*.py modules and nonempty arrays; mixed Python/Node HQ checks and not-yet-authored Work modules are not executable through it. The work-live tests list starts with the existing Work conformance module; D adds its real new module paths to the group contract in the same change. Explicit commands below own execution. Do not fill unresolved paths with invented modules.

Repository-integrity refers to the existing Codex-V3 group and is not an HQ test-suite claim. Root resolves its actual current module list before retirement checks. Canonical catalog/runner integration remains with its owner; no absence, skip or projection constitutes passing CI.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.check-catalog.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.test-plan.002" -->
## Test Plan

All inputs/data are synthetic. CPU-admit checks, run one process at a time, and name exact candidate revisions plus custom command outcomes and group contracts. Source import is behavior preservation, not a defect requiring manufactured red evidence; new feature tests use deterministic local seams. No tests execute during plan encoding.

B1: exact 41-file SHA/blob equality before adaptation; compare source app bytes at both revisions. From services/planner run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -t tests` (expected61) and `node --test --test-concurrency=1 'tests/*.test.mjs'` (expected27), serially. Confirm port0 prints actual bound port. If absent, F adds only the needed __main__ fix and test.

F: same suites plus exact parseReference vector parity, lossless feature roundtrip, import/export v1 with/without HQ refs, omitted-reference preservation, malformed envelope rejection, feature advertisement only with persistence, exact backup restoration, textContent XSS guard, regeneration drift, and regression of batch/replay/limits/floor/late-original invariants. Do not edit pinned ordering/dates/model JS. Any DDL/schema bump is a stop.

C: `npm test` from tools/hq-cli retains all70 cases and extends common schema/commands + writes feature gates. Update its existing test/manifest.json and projection group with new test modules. `HQ_CLI_E2E=1 npm test` launches the in-tree services/planner relative to repository paths; no external source-path env. Without opt-in, report skipped. Use absolute synthetic dates for five-item owner example; separately prove relative-token echo input/resolved/tz/today equals server today. Test board/time discovery, filtered target/deadline windows, sequential compatibility, known-applied replay, fresh-unsent --check, feature absent local exit2/no-write and full reference read/write schema roundtrip. Optional already-available standalone tsc may run; otherwise report unavailable, not install it.

D: exact root Vitest selection for modules/work/live and existing Work groups, `npm run typecheck`, and `HQ_LIVE_E2E=1` opt-in actual disposable backend. New modules are recorded in group contract, not invented before implementation. Seven existing port conformance cases survive: use exported upstream suite if present, otherwise mirror and propose factoring without core edits. Test-only Node transport, SHA-pinned exchanges, explicit missing-service skip/drift fail, derived-date stripping, features, unknown outcomes and mounted @hq/work using stub ModulePort/setWorkSessionPort(port,{example:false}). No shell integration claim from this module proof.

E: shared owner supplies exact endpoint-dialog/shell-test filenames and accepted bridge tests before binding. Verify fixed routes, capped 4xx bodies preserving errors/current, replayed mapping, unconfigured labelled fixture fallback, main-only config and mounted production selection. Held custody means no E test pass is claimed.

I: root prepares a local unpublished composite of exact Work stack, CLI, B1,F,C,D heads; verifier records composite hash and each included head. Run deduplicated relevant union, then show the five items share exactly the same IDs across CLI/backend/Work port/mounted UI, have distinct target and deadline dates, and reflect a later CLI write after refresh. Evidence at docs/evidence/hq-agent-cli/integration.md is appended through C's delivery lane. E shell proof stays separate.

R1/R2: Codex-V3 current repository-integrity group plus bounded dangling-link search. R2 merge readback proves exact HQ-main imported bytes before deletion integrates. No full-suite substitution for bounded selection.

Scratch belongs to its creating layer under task/workspace storage, exact path cleanup on pass/failure/cancel, with child-service termination before removal. Caller-requested intent files retain caller ownership. Temporary fixtures must not enter public evidence. Preserve required native evidence, then clean only owned scratch. Skipped/failed/unavailable/partial evidence is explicit.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.test-plan.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.operator-interaction-inventory.002" -->
## Operator Interaction Inventory

| Phase / operation | Exact owner action | Frequency / class | Executing capability | Allowed / forbidden scope | Readback | Stop / fallback |
| --- | --- | --- | --- | --- | --- | --- |
| Source bootstrap, synthetic startup/diagnostics | none | per use / none | rootless Git owner and local child services | named task cones, synthetic records; no root/shared-file expansion | exact revision, check and cleanup evidence | stale identity/collision holds |
| Normal local development | none | per use / none | scoped service/CLI/adapter commands | no TTY/password, no live/private service | JSON output and synthetic item readback | report capability gap |
| Unknown synthetic write recovery | none within approved exact operation | as needed / none | bound retention-aware replay | same ID/body/endpoint/version; no blind retry/new ID/force | replayed/applied_now/not_applied/indeterminate | readback-and-ask on indeterminate |
| Source upgrades/rollback | none within assigned source work | per revision / none | bounded source revert by Git owner | preserve import baseline; no history rewrite or data migration | byte/blob identity and check readback | stop missing rollback |
| Live deployment/rollback and private records | separate exact envelope bound to HQ revision and target | future / approval, held | separately selected operator route | no live effect here; older releases may reject re-saving HQ refs | installed revision, health, data compatibility | no inferred deployment authority |
| CLI install/global skill activation | separate exact user-symlink/adoption authorization | future / approval, held | unprivileged install route | source-local skill now; no global changes now | target/revision/synthetic smoke | preserve previous target |
| Credential enrollment/rotation | none required | exceptional / native auth separately | credential owner only | no secret access/storage/propagation | no credential evidence claimed | stop if required |
| Work-live custody / bridge custody | HQ root/lane acceptance of exact claim | once per claim / judgment, held | coordination issue and named shared owner | D cone only after G-D; E only after G-B; no bypass | exact accepted target/cone/revision | conflicting claim → proposal only |
| Publication and prior candidate supersession | none beyond accepted bounded assignment | once / ordinary Git owner mechanics | normal fast-forward/CAS publication and direct readback | named candidates only; no branch deletion | published heads, links and supersession state | stop variance/unknown effect |
| HQ integration and retirement merge | HQ integration-owner agreement; R2 exact HQ-main import readback | each merge / held | authorized native merge route | no merge bypass; source retirement only | exact merged revision and hashes | hold failed integration condition |
| Destructive/forced runtime effects | none exposed or required | never normally / exact future confirmation | no current runtime capability | source R2 is named scope; no runtime deletes/force | named source postcondition only | reject scope expansion |
| Rare unmodeled recovery | bounded diagnosis then exact decision if outside coverage | exceptional / judgment | no universal executor | no sudo, credentials or unrelated effects | direct bounded readback | preserve evidence, stop unknown/lost rollback |

No owner command, TTY or password is required for source work and synthetic post-bootstrap paths. Existing exact authority never expands from this inventory. Recurring manual recovery becomes recorded debt; install/deploy/data access stays held.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.operator-interaction-inventory.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.task-plan.002" -->
## Parallelization And Task Plan

Eight implementation/verification tasks: B1,F,C,D,I,E,R1,R2. Root plan encoding S is coordination, not an implementation task. B1 has no predecessor. F and C depend on accepted B1 and can run concurrently; C's final runtime feature checks consume F through I. D requires explicit G-D custody and a verified current Work-stack base. E requires explicit G-B shared-file custody. R1 depends on B1 acceptance plus explicit exact HQ-import publication readback. R2 depends on R1 acceptance; publication may proceed, merge still waits for HQ main. I depends on accepted F,C,D and a root-prepared exact composite.

R2 uses Astra medium under current building policy; I uses Astra high for ordinary verification judgment. All other accepted task tuples remain B1/C/R1 medium and F/D/E high. Coordinating root owns Git, acceptance/fan-in, collision refresh and delivery. Zero independent reviewers by default. Rolling refill, no scheduling wave barrier; only the real compiler derives readiness from accepted results and activation evidence. Projections use hypothetical labelled fixtures, never live custody or runtime bindings.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.task-plan.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ctx.stop-recovery-delivery.002" -->
## Stop, Recovery, And Delivery Boundaries

Stop on import mismatch, public-bound private/session/host data, DDL/schema bump, edits to pinned upstream JS/Work core, held shared files without custody, overlapping writers, stale identity, dropped CLI cases, unknown prior effect or missing rollback. No live endpoint/private data/authentication, installation, deployment, sudo, root config, workflow/catalog adoption or branch/worktree deletion occurs. Unknown writes require exact bound retention-aware replay or readback; never automatic retry, new request ID or force. Source rollback is a bounded revert, not history rewriting; deployment rollback needs a future envelope acknowledging old-release HQ-reference re-save rejection.

Publication order: root refreshes collisions; import/spec PR based on CLI candidate; independent F/C sibling candidates based on accepted B1; R1 links published import and supersedes prior source candidate after preserving its scoped doc commits without rewriting; D starts on verified Work stack only if custody clears; I uses exact unpublished composite and delivers evidence through C; R2 publishes after R1 but integrates only after exact HQ-main import hash proof. No runtime change is implied by moving source.

HQ merges remain integration-owner held; no configured checks is not green. Root config/lockfile/CI/catalog integration, shared bridge/session/settings custody, Work upstream-provenance retargeting, provider/ReferencePort, install/global skill, live-data access and deployment remain follow-ons or held boundaries. D/I blocked status remains visible rather than substituting fixture-only proof. Canonical ownership transfers to this HQ spec; private continuity remains outside public source.
<!-- codex-section:end id="spec.hq-agent-cli#ctx.stop-recovery-delivery.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.b1.001" -->
## B1 Acceptance

All 41 selected files match source SHA/blob before any adaptation; original provenance JSON excluded; app equality at named source revisions proven; exact MIT preserved; separate verbatim/adaptation/index commits; synthetic backend baseline checks recorded and port0-print status established.
<!-- codex-section:end id="spec.hq-agent-cli#ac.b1.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.f.001" -->
## F Acceptance

hq-references-v1 persists and roundtrips without DDL, matches shared reference vectors, preserves omitted refs/exportv1/backup, renders non-link text safely, and regenerates golden exchanges without drift; pinned upstream JS unchanged; batch/replay invariants retained.
<!-- codex-section:end id="spec.hq-agent-cli#ac.f.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.c.001" -->
## C Acceptance

All 70 existing CLI cases retained plus in-tree opt-in E2E, common input/output schema+commands HQ-reference support and missing-feature local rejection, deterministic owner-example/readbacks/replay, updated test group contract and source-local README.md plus skills/hq-cli/SKILL.md.
<!-- codex-section:end id="spec.hq-agent-cli#ac.c.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.d.001" -->
## D Acceptance

Existing PlannerPort implemented only in owned live cone after custody; seven conformance cases and SHA-pinned exchanges, no-core-edit mapping and mounted-module backend items with synthetic local E2E verified; unknown writes never retried.
<!-- codex-section:end id="spec.hq-agent-cli#ac.d.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.i.001" -->
## I Acceptance

Exact root-prepared composite proves same five IDs and separate target/deadline dates across CLI, backend, Work live port and mounted UI; subsequent CLI write appears on refresh; bounded cumulative evidence records all included heads and unavailable/skipped results.
<!-- codex-section:end id="spec.hq-agent-cli#ac.i.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.e.001" -->
## E Acceptance

Only after shared custody and exact filename binding: production bridge preserves 4xx bodies and replayed, main-only endpoint config, lazy live session/labelled fixture fallback, accepted settings UI and shell integration test; no generic fetch capability.
<!-- codex-section:end id="spec.hq-agent-cli#ac.e.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.r1.001" -->
## R1 Acceptance

Exact published HQ service commit linked from frozen prior-source README; operations source binding and historical pointer updated; private transfer record appended privately; prior candidate superseded after its scoped doc history is preserved; no executable source edits.
<!-- codex-section:end id="spec.hq-agent-cli#ac.r1.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.r2.001" -->
## R2 Acceptance

Only named prior executable app source removed, README pointer retained, repository-integrity and dangling-link checks recorded; candidate may publish, merge remains held until HQ-main imported-source hash proof.
<!-- codex-section:end id="spec.hq-agent-cli#ac.r2.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.work-live-custody.001" -->
## Activation Predicate

G-D: the HQ root/lane has accepted the exact modules/work/live claim and the then-current Work-stack target/base; actual custody remains held until native evidence is supplied.
<!-- codex-section:end id="spec.hq-agent-cli#ac.work-live-custody.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.bridge-custody.001" -->
## Activation Predicate

G-B: the shared owner has accepted all named bridge/session/settings files and exact new UI/test filenames; actual custody remains held until native evidence is supplied.
<!-- codex-section:end id="spec.hq-agent-cli#ac.bridge-custody.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#ac.import-publication.001" -->
## Activation Predicate

The accepted B1 service bytes have a verified published HQ commit/candidate and direct readback; this external effect is not implied by task completion or a projection fixture.
<!-- codex-section:end id="spec.hq-agent-cli#ac.import-publication.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#plan.implementation.002" -->
```json
{
  "schema_version": 1,
  "default_context_refs": [
    "spec.hq-agent-cli#ctx.project-summary.002",
    "spec.hq-agent-cli#ctx.change-surface.002",
    "spec.hq-agent-cli#ctx.service-layout.001",
    "spec.hq-agent-cli#iface.contracts.002",
    "spec.hq-agent-cli#iface.hq-references.001",
    "spec.hq-agent-cli#iface.wire-contract.001",
    "spec.hq-agent-cli#iface.work-live-transport.001",
    "spec.hq-agent-cli#ctx.test-plan.002",
    "spec.hq-agent-cli#ctx.stop-recovery-delivery.002"
  ],
  "deferred_findings_sink_ref": null,
  "artifact_path_hints": {
    "spec.hq-agent-cli": "docs/engineering-specs/hq-agent-cli.md"
  },
  "launch_policy": "start_all_currently_launchable_with_rolling_capacity_refill",
  "machine_block_source_rendering": "deterministic_two_space_json",
  "runtime_rendering": "canonical_compact_json",
  "fan_in_owner": "hq-root",
  "additional_final_check_groups": [],
  "delivery_boundary": "Planning projection only. No runtime binding, custody, Git publication/integration, install, live data access or deployment authority is created."
}
```
<!-- codex-section:end id="spec.hq-agent-cli#plan.implementation.002" -->

<!-- codex-section:begin id="spec.hq-agent-cli#task.b1.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Import selected MIT Planner app bytes verbatim, then HQ adaptation/provenance and service index.",
  "context_refs": [
    "spec.hq-agent-cli#ctx.provenance.001"
  ],
  "read_scope": [
    "services/planner",
    "services/README.md"
  ],
  "write_scope": [
    "services/planner",
    "services/README.md"
  ],
  "requires": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-agent-cli#ac.b1.001"
  ],
  "test_refs": [
    "spec.hq-agent-cli#test.b1.001"
  ],
  "affected_check_groups": [
    "planner-service"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Named repository/cone only; runtime binding is separate from this plan.",
    "Synthetic data only; no install/deploy/private-data/auth/sudo effects.",
    "Preserve pinned upstream bytes, Work core and all 70 CLI cases."
  ],
  "stop_conditions": [
    "Stale identity, overlapping writer, unknown prior effect or missing rollback.",
    "Private data/publication or shared scope/custody variance."
  ]
}
```
<!-- codex-section:end id="spec.hq-agent-cli#task.b1.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#test.b1.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "scenario": "Import selected MIT Planner app bytes verbatim, then HQ adaptation/provenance and service index. All 41 selected files match source SHA/blob before any adaptation; original provenance JSON excluded; app equality at named source revisions proven; exact MIT preserved; separate verbatim/adaptation/index commits; synthetic backend baseline checks recorded and port0-print status established.",
  "evidence": {
    "predicate": "Exact candidate native evidence satisfies task acceptance and test plan; hypothetical projections do not count.",
    "invalid": "Dropped cases, weakened checks, private/live data, stale bindings, missing custody or fixture results counted as acceptance.",
    "unknown": "Unbound target/base, absent shared custody, unavailable check tool, unrun opt-in proof or missing cleanup evidence."
  },
  "environment": [
    "Synthetic local fixtures; CPU-admitted serial process; task-owned cleanup."
  ],
  "obligation_owner_task": "spec.hq-agent-cli#task.b1.001",
  "evidence_executor_task": "spec.hq-agent-cli#task.b1.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "services/planner",
    "services/README.md"
  ],
  "affected_check_groups": [
    "planner-service"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-agent-cli#test.b1.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#task.f.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Add HQ references and wire vectors/golden exchanges while preserving backend/replay contracts.",
  "context_refs": [],
  "read_scope": [
    "services/planner/planning/validation.py",
    "services/planner/planning/store.py",
    "services/planner/planning/server.py",
    "services/planner/planning/__main__.py",
    "services/planner/public/js/detail.js",
    "services/planner/tests",
    "services/planner/contract",
    "services/planner/README.md"
  ],
  "write_scope": [
    "services/planner/planning/validation.py",
    "services/planner/planning/store.py",
    "services/planner/planning/server.py",
    "services/planner/planning/__main__.py",
    "services/planner/public/js/detail.js",
    "services/planner/tests",
    "services/planner/contract",
    "services/planner/README.md"
  ],
  "requires": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-agent-cli#task.b1.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-agent-cli#task.b1.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-agent-cli#ac.f.001"
  ],
  "test_refs": [
    "spec.hq-agent-cli#test.f.001"
  ],
  "affected_check_groups": [
    "planner-service"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Named repository/cone only; runtime binding is separate from this plan.",
    "Synthetic data only; no install/deploy/private-data/auth/sudo effects.",
    "Preserve pinned upstream bytes, Work core and all 70 CLI cases."
  ],
  "stop_conditions": [
    "Stale identity, overlapping writer, unknown prior effect or missing rollback.",
    "Private data/publication or shared scope/custody variance."
  ]
}
```
<!-- codex-section:end id="spec.hq-agent-cli#task.f.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#test.f.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "scenario": "Add HQ references and wire vectors/golden exchanges while preserving backend/replay contracts. hq-references-v1 persists and roundtrips without DDL, matches shared reference vectors, preserves omitted refs/exportv1/backup, renders non-link text safely, and regenerates golden exchanges without drift; pinned upstream JS unchanged; batch/replay invariants retained.",
  "evidence": {
    "predicate": "Exact candidate native evidence satisfies task acceptance and test plan; hypothetical projections do not count.",
    "invalid": "Dropped cases, weakened checks, private/live data, stale bindings, missing custody or fixture results counted as acceptance.",
    "unknown": "Unbound target/base, absent shared custody, unavailable check tool, unrun opt-in proof or missing cleanup evidence."
  },
  "environment": [
    "Synthetic local fixtures; CPU-admitted serial process; task-owned cleanup."
  ],
  "obligation_owner_task": "spec.hq-agent-cli#task.f.001",
  "evidence_executor_task": "spec.hq-agent-cli#task.f.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "services/planner/planning/validation.py",
    "services/planner/planning/store.py",
    "services/planner/planning/server.py",
    "services/planner/planning/__main__.py",
    "services/planner/public/js/detail.js",
    "services/planner/tests",
    "services/planner/contract",
    "services/planner/README.md"
  ],
  "affected_check_groups": [
    "planner-service"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-agent-cli#test.f.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#task.c.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Complete CLI common schemas/commands, feature-gated HQ reference roundtrip, in-tree E2E and source guide.",
  "context_refs": [],
  "read_scope": [
    "tools/hq-cli"
  ],
  "write_scope": [
    "tools/hq-cli"
  ],
  "requires": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-agent-cli#task.b1.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-agent-cli#task.b1.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-agent-cli#ac.c.001"
  ],
  "test_refs": [
    "spec.hq-agent-cli#test.c.001"
  ],
  "affected_check_groups": [
    "hq-cli"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Named repository/cone only; runtime binding is separate from this plan.",
    "Synthetic data only; no install/deploy/private-data/auth/sudo effects.",
    "Preserve pinned upstream bytes, Work core and all 70 CLI cases."
  ],
  "stop_conditions": [
    "Stale identity, overlapping writer, unknown prior effect or missing rollback.",
    "Private data/publication or shared scope/custody variance."
  ]
}
```
<!-- codex-section:end id="spec.hq-agent-cli#task.c.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#test.c.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "scenario": "Complete CLI common schemas/commands, feature-gated HQ reference roundtrip, in-tree E2E and source guide. All 70 existing CLI cases retained plus in-tree opt-in E2E, common input/output schema+commands HQ-reference support and missing-feature local rejection, deterministic owner-example/readbacks/replay, updated test group contract and source-local README.md plus skills/hq-cli/SKILL.md.",
  "evidence": {
    "predicate": "Exact candidate native evidence satisfies task acceptance and test plan; hypothetical projections do not count.",
    "invalid": "Dropped cases, weakened checks, private/live data, stale bindings, missing custody or fixture results counted as acceptance.",
    "unknown": "Unbound target/base, absent shared custody, unavailable check tool, unrun opt-in proof or missing cleanup evidence."
  },
  "environment": [
    "Synthetic local fixtures; CPU-admitted serial process; task-owned cleanup."
  ],
  "obligation_owner_task": "spec.hq-agent-cli#task.c.001",
  "evidence_executor_task": "spec.hq-agent-cli#task.c.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "tools/hq-cli"
  ],
  "affected_check_groups": [
    "hq-cli"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-agent-cli#test.c.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#task.d.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Implement custody-gated Work live port and conformance/mounted-module proof without core edits.",
  "context_refs": [],
  "read_scope": [
    "modules/work/live"
  ],
  "write_scope": [
    "modules/work/live"
  ],
  "requires": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-agent-cli#ac.work-live-custody.001"
  },
  "acceptance_refs": [
    "spec.hq-agent-cli#ac.d.001"
  ],
  "test_refs": [
    "spec.hq-agent-cli#test.d.001"
  ],
  "affected_check_groups": [
    "work-live"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Named repository/cone only; runtime binding is separate from this plan.",
    "Synthetic data only; no install/deploy/private-data/auth/sudo effects.",
    "Preserve pinned upstream bytes, Work core and all 70 CLI cases."
  ],
  "stop_conditions": [
    "Stale identity, overlapping writer, unknown prior effect or missing rollback.",
    "Private data/publication or shared scope/custody variance."
  ]
}
```
<!-- codex-section:end id="spec.hq-agent-cli#task.d.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#test.d.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "scenario": "Implement custody-gated Work live port and conformance/mounted-module proof without core edits. Existing PlannerPort implemented only in owned live cone after custody; seven conformance cases and SHA-pinned exchanges, no-core-edit mapping and mounted-module backend items with synthetic local E2E verified; unknown writes never retried.",
  "evidence": {
    "predicate": "Exact candidate native evidence satisfies task acceptance and test plan; hypothetical projections do not count.",
    "invalid": "Dropped cases, weakened checks, private/live data, stale bindings, missing custody or fixture results counted as acceptance.",
    "unknown": "Unbound target/base, absent shared custody, unavailable check tool, unrun opt-in proof or missing cleanup evidence."
  },
  "environment": [
    "Synthetic local fixtures; CPU-admitted serial process; task-owned cleanup."
  ],
  "obligation_owner_task": "spec.hq-agent-cli#task.d.001",
  "evidence_executor_task": "spec.hq-agent-cli#task.d.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "modules/work/live"
  ],
  "affected_check_groups": [
    "work-live"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-agent-cli#test.d.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#task.i.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "hq-root",
  "objective": "Verify exact composite CLI/backend/Work-port/mounted-UI identity, dates and refresh; write synthetic evidence only.",
  "context_refs": [],
  "read_scope": [
    "docs/evidence/hq-agent-cli/integration.md"
  ],
  "write_scope": [
    "docs/evidence/hq-agent-cli/integration.md"
  ],
  "requires": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-agent-cli#task.f.001",
    "spec.hq-agent-cli#task.c.001",
    "spec.hq-agent-cli#task.d.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-agent-cli#task.f.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    },
    {
      "task_ref": "spec.hq-agent-cli#task.c.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    },
    {
      "task_ref": "spec.hq-agent-cli#task.d.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-agent-cli#ac.i.001"
  ],
  "test_refs": [
    "spec.hq-agent-cli#test.i.001"
  ],
  "affected_check_groups": [
    "planner-service",
    "hq-cli",
    "work-live"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Named repository/cone only; runtime binding is separate from this plan.",
    "Synthetic data only; no install/deploy/private-data/auth/sudo effects.",
    "Preserve pinned upstream bytes, Work core and all 70 CLI cases."
  ],
  "stop_conditions": [
    "Stale identity, overlapping writer, unknown prior effect or missing rollback.",
    "Private data/publication or shared scope/custody variance."
  ]
}
```
<!-- codex-section:end id="spec.hq-agent-cli#task.i.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#test.i.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "scenario": "Verify exact composite CLI/backend/Work-port/mounted-UI identity, dates and refresh; write synthetic evidence only. Exact root-prepared composite proves same five IDs and separate target/deadline dates across CLI, backend, Work live port and mounted UI; subsequent CLI write appears on refresh; bounded cumulative evidence records all included heads and unavailable/skipped results.",
  "evidence": {
    "predicate": "Exact candidate native evidence satisfies task acceptance and test plan; hypothetical projections do not count.",
    "invalid": "Dropped cases, weakened checks, private/live data, stale bindings, missing custody or fixture results counted as acceptance.",
    "unknown": "Unbound target/base, absent shared custody, unavailable check tool, unrun opt-in proof or missing cleanup evidence."
  },
  "environment": [
    "Synthetic local fixtures; CPU-admitted serial process; task-owned cleanup."
  ],
  "obligation_owner_task": "spec.hq-agent-cli#task.i.001",
  "evidence_executor_task": "spec.hq-agent-cli#task.i.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/evidence/hq-agent-cli/integration.md"
  ],
  "affected_check_groups": [
    "planner-service",
    "hq-cli",
    "work-live"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-agent-cli#test.i.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#task.e.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Implement shared production bridge/session/settings and shell proof only after exact shared-file custody.",
  "context_refs": [],
  "read_scope": [
    "packages/contracts/src/services.ts",
    "packages/contracts/package.json",
    "apps/desktop/electron/services.ts",
    "apps/desktop/electron/services.test.ts",
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.cts",
    "apps/desktop/src",
    "modules/work/nav/session.ts"
  ],
  "write_scope": [
    "packages/contracts/src/services.ts",
    "packages/contracts/package.json",
    "apps/desktop/electron/services.ts",
    "apps/desktop/electron/services.test.ts",
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.cts",
    "apps/desktop/src",
    "modules/work/nav/session.ts"
  ],
  "requires": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "produces": [],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-agent-cli#ac.bridge-custody.001"
  },
  "acceptance_refs": [
    "spec.hq-agent-cli#ac.e.001"
  ],
  "test_refs": [
    "spec.hq-agent-cli#test.e.001"
  ],
  "affected_check_groups": [
    "work-live"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Named repository/cone only; runtime binding is separate from this plan.",
    "Synthetic data only; no install/deploy/private-data/auth/sudo effects.",
    "Preserve pinned upstream bytes, Work core and all 70 CLI cases."
  ],
  "stop_conditions": [
    "Stale identity, overlapping writer, unknown prior effect or missing rollback.",
    "Private data/publication or shared scope/custody variance."
  ]
}
```
<!-- codex-section:end id="spec.hq-agent-cli#task.e.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#test.e.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "scenario": "Implement shared production bridge/session/settings and shell proof only after exact shared-file custody. Only after shared custody and exact filename binding: production bridge preserves 4xx bodies and replayed, main-only endpoint config, lazy live session/labelled fixture fallback, accepted settings UI and shell integration test; no generic fetch capability.",
  "evidence": {
    "predicate": "Exact candidate native evidence satisfies task acceptance and test plan; hypothetical projections do not count.",
    "invalid": "Dropped cases, weakened checks, private/live data, stale bindings, missing custody or fixture results counted as acceptance.",
    "unknown": "Unbound target/base, absent shared custody, unavailable check tool, unrun opt-in proof or missing cleanup evidence."
  },
  "environment": [
    "Synthetic local fixtures; CPU-admitted serial process; task-owned cleanup."
  ],
  "obligation_owner_task": "spec.hq-agent-cli#task.e.001",
  "evidence_executor_task": "spec.hq-agent-cli#task.e.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "packages/contracts/src/services.ts",
    "packages/contracts/package.json",
    "apps/desktop/electron/services.ts",
    "apps/desktop/electron/services.test.ts",
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.cts",
    "apps/desktop/src",
    "modules/work/nav/session.ts"
  ],
  "affected_check_groups": [
    "work-live"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-agent-cli#test.e.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#task.r1.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Freeze prior app source to exact published HQ pointer and update retirement documentation privately.",
  "context_refs": [
    "spec.hq-agent-cli#ctx.legacy-retirement.001"
  ],
  "read_scope": [
    "apps/manual-planner/README.md",
    "docs/operations/manual-planner-hosting.md",
    "docs/verification/manual-planner-historical-qa.md",
    "docs/work-notes/hq-agent-cli.md"
  ],
  "write_scope": [
    "apps/manual-planner/README.md",
    "docs/operations/manual-planner-hosting.md",
    "docs/verification/manual-planner-historical-qa.md",
    "docs/work-notes/hq-agent-cli.md"
  ],
  "requires": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-agent-cli#task.b1.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-agent-cli#task.b1.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-agent-cli#ac.import-publication.001"
  },
  "acceptance_refs": [
    "spec.hq-agent-cli#ac.r1.001"
  ],
  "test_refs": [
    "spec.hq-agent-cli#test.r1.001"
  ],
  "affected_check_groups": [
    "repository-integrity"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Named repository/cone only; runtime binding is separate from this plan.",
    "Synthetic data only; no install/deploy/private-data/auth/sudo effects.",
    "Preserve pinned upstream bytes, Work core and all 70 CLI cases."
  ],
  "stop_conditions": [
    "Stale identity, overlapping writer, unknown prior effect or missing rollback.",
    "Private data/publication or shared scope/custody variance."
  ]
}
```
<!-- codex-section:end id="spec.hq-agent-cli#task.r1.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#test.r1.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "scenario": "Freeze prior app source to exact published HQ pointer and update retirement documentation privately. Exact published HQ service commit linked from frozen prior-source README; operations source binding and historical pointer updated; private transfer record appended privately; prior candidate superseded after its scoped doc history is preserved; no executable source edits.",
  "evidence": {
    "predicate": "Exact candidate native evidence satisfies task acceptance and test plan; hypothetical projections do not count.",
    "invalid": "Dropped cases, weakened checks, private/live data, stale bindings, missing custody or fixture results counted as acceptance.",
    "unknown": "Unbound target/base, absent shared custody, unavailable check tool, unrun opt-in proof or missing cleanup evidence."
  },
  "environment": [
    "Synthetic local fixtures; CPU-admitted serial process; task-owned cleanup."
  ],
  "obligation_owner_task": "spec.hq-agent-cli#task.r1.001",
  "evidence_executor_task": "spec.hq-agent-cli#task.r1.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/manual-planner/README.md",
    "docs/operations/manual-planner-hosting.md",
    "docs/verification/manual-planner-historical-qa.md",
    "docs/work-notes/hq-agent-cli.md"
  ],
  "affected_check_groups": [
    "repository-integrity"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-agent-cli#test.r1.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#task.r2.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Retire prior executable app source after R1; retain README and hold merge for HQ-main import proof.",
  "context_refs": [
    "spec.hq-agent-cli#ctx.legacy-retirement.001"
  ],
  "read_scope": [
    "apps/manual-planner/planning",
    "apps/manual-planner/public",
    "apps/manual-planner/tests",
    "apps/manual-planner/.gitignore",
    "apps/manual-planner/provenance.json"
  ],
  "write_scope": [
    "apps/manual-planner/planning",
    "apps/manual-planner/public",
    "apps/manual-planner/tests",
    "apps/manual-planner/.gitignore",
    "apps/manual-planner/provenance.json"
  ],
  "requires": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-agent-cli#task.r1.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-agent-cli#task.r1.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-agent-cli#ac.r2.001"
  ],
  "test_refs": [
    "spec.hq-agent-cli#test.r2.001"
  ],
  "affected_check_groups": [
    "repository-integrity"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "produced_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "Named repository/cone only; runtime binding is separate from this plan.",
    "Synthetic data only; no install/deploy/private-data/auth/sudo effects.",
    "Preserve pinned upstream bytes, Work core and all 70 CLI cases."
  ],
  "stop_conditions": [
    "Stale identity, overlapping writer, unknown prior effect or missing rollback.",
    "Private data/publication or shared scope/custody variance."
  ]
}
```
<!-- codex-section:end id="spec.hq-agent-cli#task.r2.001" -->

<!-- codex-section:begin id="spec.hq-agent-cli#test.r2.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-agent-cli#req.requirements.002"
  ],
  "scenario": "Retire prior executable app source after R1; retain README and hold merge for HQ-main import proof. Only named prior executable app source removed, README pointer retained, repository-integrity and dangling-link checks recorded; candidate may publish, merge remains held until HQ-main imported-source hash proof.",
  "evidence": {
    "predicate": "Exact candidate native evidence satisfies task acceptance and test plan; hypothetical projections do not count.",
    "invalid": "Dropped cases, weakened checks, private/live data, stale bindings, missing custody or fixture results counted as acceptance.",
    "unknown": "Unbound target/base, absent shared custody, unavailable check tool, unrun opt-in proof or missing cleanup evidence."
  },
  "environment": [
    "Synthetic local fixtures; CPU-admitted serial process; task-owned cleanup."
  ],
  "obligation_owner_task": "spec.hq-agent-cli#task.r2.001",
  "evidence_executor_task": "spec.hq-agent-cli#task.r2.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "apps/manual-planner/planning",
    "apps/manual-planner/public",
    "apps/manual-planner/tests",
    "apps/manual-planner/.gitignore",
    "apps/manual-planner/provenance.json"
  ],
  "affected_check_groups": [
    "repository-integrity"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-agent-cli#test.r2.001" -->
