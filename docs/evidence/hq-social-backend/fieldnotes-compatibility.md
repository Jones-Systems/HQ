# HQ Social bridge against a real Fieldnotes (B2, WS-F)

Authority effect: none. This is lane evidence for `spec.hq-social-backend` (findings B2-F2, B2-F3, B2-F4 and B2-F7 and the Fieldnotes contract in `ctx.fieldnotes.001`). It records how HQ's real main-process Social bridge and live port behave against a real, disposable, loopback-only Fieldnotes. It changes no product code.

## What was tested

| Item | Value |
| --- | --- |
| HQ branch | `work/hq-backend-social-fieldnotes-compat-20261103`, from `work/hq-backend-social-20261103` at `b7005de` |
| PR #166 | Head `992594a71968e312310e6bc62c4321abe543ac64` merged with `--no-ff` (`6abd7f5`), clean, no conflicts. Without it the desktop transport rejects `links`. |
| Harness revision | `26667d47ece760031feee4e1cee80afb0af52079` (`tools/social-compat/`) |
| Fieldnotes `main` | `9b6368934e9768517d319f6e7351a708dec46976`. Advertises `hq-editorial-timebox-v1`. |
| Fieldnotes PR #41 | Head `deaaec94610d15b05baa8d121715859a4184dce0`, a descendant of the `main` revision above. Advertises `hq-references-v1` and `hq-editorial-timebox-v1`. |
| Tooling | Linux, Node 26.13.0, Python 3.13.5, Vitest 5.0.5. `npm ci --ignore-scripts --no-audit --no-fund`; Electron was not downloaded. |
| HQ code under test | `createServices` and `sendHttp` (`apps/desktop/electron/services.ts`), `createLiveSocialPort` (`modules/social/live/port.ts`), `summarizeRun`, and `endpoint` and `openServiceConfig` (`apps/desktop/electron/service-config.ts`) |

**Method.** The harness starts Fieldnotes with `python3 -m apps.social_dashboard --host 127.0.0.1 --port <free> --data <temporary>/data` from the checkout. The service prints no startup line, so the harness picks a free port and waits for `GET /api/workspace`. HQ is driven as the app wires it: `createServices(config, sendHttp)` with a `ServiceConfig` stub that returns the loopback URL, then `createLiveSocialPort({ call: main.social })`. The real `sendHttp` is wrapped only to record each exchange's method, path, status and body, so a check can assert the exact wire sequence. Only the service's workspace API was used, with fictional drafts written for this check. Nothing from the Fieldnotes repository was copied into HQ. Each revision was a sparse checkout of `apps/`, `packages/` and the one fixtures directory that the dashboard's sample route reads, and the tracked tree has no `data/` directory. No data, records or state were opened. Only 127.0.0.1 was contacted.

## Command

```sh
HQ_FIELDNOTES_ROOT=/path/to/growth-intel \
  node_modules/.bin/vitest run --config tools/social-compat/vitest.config.ts
```

Run once per checkout: one at the `main` revision, one at the PR #41 head. Each run is one file with 25 checks and takes about 3.5 s. Typecheck: `node_modules/.bin/tsc --noEmit -p tools/social-compat/tsconfig.json`.

## Results

25 of 25 checks passed on each revision. "n/a" means the capability is not advertised, so the check asserts the absence instead.

| Check | `main` `9b63689` | PR #41 `deaaec9` |
| --- | --- | --- |
| Snapshot: guards accept the real workspace; eight tools; built-in brand; features equal the service's; `csrf` is stripped by the bridge | Pass. Features `[timebox]` | Pass. Features `[references, timebox]` |
| `addBrand` returns `{id, name}` (name trimmed); the next snapshot lists it by name | Pass | Pass |
| `saveDraft` create (version 1) and update (version 2); the snapshot returns an equal draft | Pass | Pass |
| Stale version, and an unknown `id`, map to `conflict` with the service text `This draft changed in another window. Close and reopen it before saving.`; the stored draft is unchanged | Pass | Pass |
| Unknown brand maps to `invalid` with `Unknown brand` | Pass | Pass |
| Service validation text equals HQ's local `checkDraft` text for 11 invalid drafts sent past the port (title, body, channel, date, five slot rules, slot without date) | Pass, with one text divergence (finding 1) | Pass, with the same divergence |
| Planning slots: set; replace; keep (service keeps an omitted slot, sent past the port); clear with `null` | Pass | Pass |
| Planning slots, port semantics: once features are known an omitted slot is sent as `null` and clears; a port that has not read the workspace sends nothing for it, so the service keeps it | Pass | Pass |
| Links: save two (one with `sourceRevision` and `workspaceId`); omitted keeps them (no `links` key on the wire); `[]` clears; a duplicate target is `invalid` with `Duplicate HQ reference target` | n/a | Pass |
| Links without `hq-references-v1`: the port refuses a link locally as `invalid` (HQ's `linksUnsupported` text) and sends no request; `links: []` is not sent. Sent past the port, the service answers 200 and silently drops the field | Pass | n/a |
| `example()` for all eight tools; an unknown tool is `invalid` locally and 400 `Unknown tool` on the wire | Pass | Pass |
| `submitRun` of each of the eight samples (`is_example: true`), polled with `run()` to a terminal state (limit 90 s; actual 254–278 ms each); `summarizeRun` classifies all eight as `result` | Pass, 8 of 8 `result`, none `failed` or `unrecognized` | Pass, 8 of 8 |
| Unknown run ID is `not_found`; a malformed ID is a 400 `Invalid run ID` | Pass | Pass |
| Queue full: 9 runs are accepted (one running, eight queued) and the next is `conflict` with `Run queue is full. Wait for a run to finish.` | Pass | Pass |
| After a restart (same port and data): the first `saveContent` goes `POST /api/content 403`, `GET /api/workspace 200`, `POST /api/content 200`, exactly one refresh; the next save needs none | Pass | Pass |
| After that restart: all nine queued or running runs are `interrupted` with `Service restarted before completion; run again explicitly.`, have no `output`, are not retried, and `summarizeRun` gives `failed` / `Run interrupted` | Pass, 9 of 9 | Pass, 9 of 9 |
| After a second restart: `submitRun` is `forbidden` (`POST /api/runs 403` only, no refresh, no resend, no run created); a workspace read refreshes the token and the next `submitRun` is `POST /api/runs 200` | Pass | Pass |
| Host check: `localhost:<port>` against the 127.0.0.1 binding is 403 `Unrecognized host`, and the port maps it to `forbidden` | Pass | Pass |
| `endpoint('http://100.64.0.1:8000')` is null; `openServiceConfig.set` returns `{configured:false, policy:'rejected'}`; the loopback URL is accepted | Pass | Pass |
| Response cap (extra): 45 drafts of 50,000 characters make a 2.27 MB workspace, and the port reports `unavailable` | Pass (2,269,100 bytes) | Pass (2,269,516 bytes) |

## Incompatibilities and findings

There is no blocking incompatibility. Both revisions interoperate with HQ's bridge and port for everything HQ sends. Four findings need a decision or a routed fix.

1. **Fieldnotes, both revisions, P3: out-of-range calendar date text.** For `planned_date: "2026-02-30"` the service returns 400 `day is out of range for month`, which is the language runtime's own message. HQ's local rule says `Use a YYYY-MM-DD planning date`. Users never see the service text, because the port rejects such a date locally first, and both are `invalid`. Smallest fix, in Fieldnotes: catch the date-parse error and raise the existing message. No HQ change is needed. The harness requires the 400 and logs this one text difference.
2. **Both sides, P2, B2-F4 reproduced with the real service: a large library makes the snapshot `unavailable`.** Fieldnotes returns every draft body in one `GET /api/workspace` (up to 50,000 characters each, unpaged), and `sendHttp` caps every response at 2,000,000 bytes. 45 full-size drafts exceed it, so the whole Social workspace reads as unreachable. Smallest fix: WS-D's per-route response cap for the `workspace` route, as planned. A durable fix needs a service that pages or omits bodies from the snapshot. Fieldnotes would need a change for that.
3. **HQ, P3, latent: an explicit clear is dropped on a port that has not read the workspace.** `saveDraft` pre-reads features only when `links` is non-empty or `planning_slot` is non-null (`modules/social/live/port.ts`). With features unknown, `planning_slot: null` and `links: []` are both normalized to "omitted", so the service keeps the stored values while the call resolves successfully. Minimal reproduction, against the PR #41 revision:

   ```ts
   const warm = createLiveSocialPort(bridge); await warm.snapshot();
   const stored = await warm.saveDraft({ ...fields, planned_date: '2026-11-10', planning_slot: slot, links: [reference] });
   const cold = createLiveSocialPort(bridge);          // has not read the workspace
   await cold.saveDraft({ ...fields, planned_date: '2026-11-10', id: stored.id, version: stored.version, planning_slot: null, links: [] });
   // Resolves at version 2. A later snapshot still shows the slot and the link.
   ```

   Smallest fix: treat the presence of `planning_slot` (including `null`) or of a `links` array (including `[]`) as capability-bearing, so the port reads the workspace first when its features are unknown. The app does not reach this as wired, because it caches one live port per renderer and an edit follows that port's snapshot. This was read from `domains.tsx` and `session.ts`, not exercised in the UI.
4. **Backends differ, observation: duplicate link text.** Fieldnotes says `Duplicate HQ reference target`, and spec `iface.service.001` gives the HQ Social service `Each HQ reference can be linked once`. HQ passes the service text through as `invalid`, so wording will differ by backend. Both texts are accepted. Parity is a lead decision.

Also observed:

- B2-F7 is confirmed as designed: after a restart the first `submitRun` is `forbidden` and creates nothing, and a workspace read recovers it.
- `main` ignores a `links` field it was sent and returns the draft without it. The port's local refusal is the only protection against silent loss on a revision without `hq-references-v1`.
- Nine concurrent `GET /api/runs/<id>` requests stalled for about 1 s in two of three early runs, and did not once they were serialized (14 ms). The cause was not isolated. It is consistent with a small listen backlog on the service. Nothing in these runs shows HQ's own polling being affected.

## Harness behavior (checked separately)

- Without `HQ_FIELDNOTES_ROOT` the run fails before anything starts, with a message naming the variable and the command.
- A checkout whose service exits at startup fails the file with the service's output and leaves no process or temporary directory.
- `SIGTERM` to the Vitest main process mid-run exits 143 and leaves no service and no temporary directory. A failing check also leaves none.
- The root `vitest list --filesOnly` shows 117 files and none under `tools/`, so the harness is not in default discovery and contains no skipped tests.

## Not verified

- Electron: the preload, IPC, sender-frame allowlist, the settings dialog and the renderer UI were not exercised. Only the main-process HTTP layer and the port were.
- The deployed Fieldnotes and its reachability. The endpoint check shows HQ's policy rejects a non-loopback HTTP address, not that any real address is unreachable. The deployed instance was not contacted.
- Real data and a real library. All drafts here are fictional, and the run inputs are the service's own samples.
- Native tool correctness: the checks prove only that each sample finishes and has a recognizable result shape.
- An HTTPS front, SSH tunnel or proxy, concurrent windows, other operating systems, and the `SIGKILL` case, which cannot be cleaned up in-process.

## Cleanup

Every service the harness started was stopped, and its temporary data directory removed, by the harness itself; none remained after any run. After the final runs, the scratch directory holding both Fieldnotes checkouts (and a throwaway fake used for the failure-path check) was removed, and its absence was checked. No process of this lane was left running, and no Fieldnotes instance other than the harness's disposable ones was contacted or touched.
