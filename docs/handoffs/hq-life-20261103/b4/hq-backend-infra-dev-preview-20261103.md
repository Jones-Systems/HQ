# Handoff: HQ lane B4, headless dev-preview launcher and screenshot capture

Paused at the owner's request on 2026-11-03. Nothing is mid-edit: every code change is committed and pushed, and all sessions, test runs and `/tmp` scratch started by this lane are stopped and removed.

## Where it stands

| Area | State |
| --- | --- |
| `tools/dev-preview/` library, `capture.mjs`, `serve.mjs`, `ctl.mjs` | Done and exercised on this host |
| Modes `example`, `live`, `offline` | Done and exercised |
| `docs/dev-preview.md` and the pointer line in `docs/design/hq-visual-system/README.md` | Done |
| Unit tests (63) and the `foundation.yml` glob | Done; passing locally |
| `--install-electron` | Done; exercised with a warm download cache only |
| CI result on the PR | Not known: checks were still pending when work paused |
| Idle timeout expiry, SIGINT/SIGTERM paths, two concurrent sessions | Written, not exercised (see "What is left") |
| PR body | Written early; needs a final update with the verification numbers below |

- Branch: `work/hq-backend-infra-dev-preview-20261103` (based on `work/hq-foundation`)
- Worktree: `~/.t3/worktrees/HQ/work-hq-backend-infra-dev-preview-20261103`
- Head before this handoff commit: `215dc68` (the final head is the one reported with this handoff)
- PR: https://github.com/Jones-Systems/HQ/pull/191, non-draft, base `work/hq-foundation`, mergeable, no review. Merge is held for the integration owner. It is linked to the owning thread and was never watched from here.

## What was built

`tools/dev-preview/` runs the built HQ desktop app under Xvfb inside bubblewrap, drives it over CDP, and saves PNGs. It adds no dependencies and edits nothing under `tests/acceptance/`, `tools/storage/` or any product source. The only workflow change is the one-line test glob. Lane F7's exploration driver was the starting point (Xvfb + bubblewrap + CDP, the fontconfig alias, the service modes).

| File | Role |
| --- | --- |
| `session.mjs` | `startSession(options)`: sandbox, fixtures, Electron, CDP, all operations, `close()` |
| `capture.mjs` | One-command tour (Design, Social, Work, Wiki, Settings; light and dark; one or more sizes), `manifest.json`, `--steps file.json` |
| `serve.mjs`, `ctl.mjs`, `control.mjs` | Named long-running session, token-protected loopback control API, CLI client |
| `config.mjs` | Modes, sizes, the `NAV` selector table, `BUSY` loading-indicator table, keys, media features, font alias |
| `steps.mjs`, `args.mjs` | Validation shared by the API, the CLI and `--steps` files; CLI parsers and help |
| `files.mjs`, `prereq.mjs` | Names and path safety, session files, stale-scratch removal; prerequisite detection with exact fix commands, Electron installer |
| `page.mjs` | Functions that run inside the page (find, settle, state), serialized through CDP |
| `test/*.test.mjs` | 63 dependency-free `node:test` tests |

Usage, modes, outputs, cleanup and limits are in `docs/dev-preview.md`.

## Decisions and why

- **Repo split.** The tool imports acceptance modules from the checkout it lives in. `--repo` only chooses the build, Electron binary, Planner and Wiki corpus to run, falling back to the tool's checkout for the Planner and corpus. This lets other lanes use the tool before it reaches their branch without touching `tests/acceptance/`.
- **`live` mode uses its own Planner launch and a permissive recording proxy**, not `startPlanner` from `tests/acceptance/fixtures/planner.mjs`. That fixture 404s every route except a few, including `POST /api/examples`, and does not expose its upstream. The contract for seeding is `POST /api/examples` with `Content-Type: application/json`, header `X-Planning-Request: 1`, and a Host matching the upstream port; 201 means created, 409 means already loaded and is treated as fine. The Planner runs inside bubblewrap with `--die-with-parent` so a killed session cannot leave an orphan.
- **Viewport sizes are emulated** with `Emulation.setDeviceMetricsOverride`, as in F7, because Electron's browser endpoint has no window-bounds call. Output PNGs were exactly the requested size, including 760x560 (below the default window's 1280x820).
- **Console capture uses a second, listen-only CDP connection** (`Runtime.enable` and `Log.enable`), so the page is never modified and earlier messages are replayed on enable. Absolute paths in entries are replaced with placeholders because lanes may paste manifests into PRs.
- **Settle waits for fonts, finite animations and loading indicators** (bounded). This was added after the first capture showed Design still saying "Loading Projects…" and "Checking…". Endless animations are counted, not waited for.
- **Navigation by accessible name, selectors in one table.** Lane F1 is redesigning the rail. Lookups search the `NAV` scopes first, retry with substring matching, then fall back to any visible button, link or tab with that name. A click is refused if the target is covered or disabled (unless `--force`). Confirmation uses `aria-current`, falling back to "main has content"; an unconfirmed landing is a warning, not a failure.
- **Per-step failure never aborts the tour.** Failures and warnings go in the manifest; the exit status is 1 if any shot or step failed. `capture` always closes the session.
- **`--sizes` is the complete list**, defaulting to `--size` alone. The brief said "extra sizes"; the example listed the default explicitly, so it was read as a full list. Easy to change.
- **Control API security.** Loopback only, bearer token held only in the 0600 session file, Host and Origin checks, one request at a time. `serve` quits itself after 90 idle minutes (`--idle-timeout 0` disables) as a safety net for forgotten sessions on the shared host.
- **Linux only.** Other platforms stop with a clear message rather than shipping an untestable macOS path.
- **Font alias** picks the first installed of Liberation Sans, DejaVu Sans, Noto Sans or Arimo, written to the sandbox's private fontconfig only. Screenshots use a proportional stand-in, not the shipped IBM Plex Sans.
- **A build-freshness warning** compares source mtimes to the build, so a lane that forgot `npm run build` is told rather than shown old code.

## Verification actually run (this host, Node 26.13.0, Electron 44.9.0)

- `npm ci --ignore-scripts --no-audit --no-fund` (12 s) and `npm run build`: passed.
- Missing-binary path: `capture.mjs` printed the exact fix and exited 2. Then `capture.mjs --install-electron` installed and captured in one run (the download cache was already warm).
- `capture.mjs` example mode, `--sizes 1440x900,760x560 --reduced-motion`: 20 of 20 shots in about 7 s; both themes; observed theme equal to requested for every shot; PNG sizes exactly as requested; no pending loading indicators. Opened Design, Work, Wiki, Settings and the 760x560 Work shot: proportional fonts, real content.
- `capture.mjs --mode live --themes light`: 5 of 5; the real Planner was seeded with 8 `Example:` items and the Work board showed them.
- `serve.mjs` then `ctl.mjs`, offline mode: status, click, shot, `media prefers-color-scheme=dark`, shot, eval, key, wait, window and reset, restart (profile, size and media kept), errors, log, ledger, failure exit codes (command failure 1, usage error 2). An injected console error, warning, exception, unhandled rejection and CSP violation were all captured.
- Live-mode outage flow: `svc down work`, restart, "Planner service unreachable" shown and the proxy ledger recorded a `down: true` request; `svc up`, "Try again", the examples returned. `wait --text` on a heading worked after the fix described below.
- `capture.mjs --steps` with a deliberately failing step: the failure was recorded, the next steps still ran, exit status 1.
- Cleanup after every session: `quit` returned only after the process was gone; no processes under the worktree, no `scratch/run-*`, no session directory. A `python3 -m planning` that was running on the host belonged to something else and was not touched.
- `node --test --test-concurrency=1 'tools/dev-preview/test/**/*.test.mjs'`: 63 of 63.
- Full CI portable step `node --test --test-concurrency=1 'tests/acceptance/**/*.test.mjs' 'tools/storage/test/**/*.test.mjs' 'tools/dev-preview/test/**/*.test.mjs'`, run under `(umask 022; ...)` because `tools/storage/test` fails and hangs under this host's default `umask 0002` (another builder owns that): 110 of 110, about 26 s.

## Findings

- The first Design shot caught a loading state: the shell mounts before Design and the Data sources rail finish loading. Fixed by watching loading indicators in the settle step. Other lanes' own harnesses may share this trap.
- `wait --text` originally matched only clickable elements, so waiting for a heading failed. Fixed to match any visible text.
- An explicitly empty `--out ""` would have resolved to the current directory and an empty `--sizes ""` silently used the default. Now rejected.
- Baseline console output is empty in all three modes: no errors or warnings during the domain tour.
- In every mode the rail's Data sources show "Set up · not checked" for Work and Social; the app seems to check a source only on an explicit "Check connection". Not investigated.
- The Social fixture in `live` mode is the acceptance suite's empty workspace, so Social looks empty there. A richer synthetic workspace would need the Social module's schema.
- Design's `aria-current` appears on several items at once (domain, tab, sidebar), which is why confirmation matches by name rather than taking the first.
- The `dcg` hook on this host blocks `rm -r` and `find -delete` even inside the worktree's git-ignored `.t3/`, and blocks heredocs containing template-literal syntax. Use the Edit and Write tools for those.

## What is left, in priority order

1. **Read the CI result on PR #191** (checks were pending at the pause) and fix any failure without weakening a test. The foundation job now runs the dev-preview tests under Node 24.19.0 (local runs used Node 26). Likeliest differences to look at: file-mode assertions in `test/files.test.mjs` and `test/prereq.test.mjs`, and the `acceptance-api` test, which pins `createWikiCorpus` and `startReadFixture` argument counts on purpose so signature drift fails there.
2. **Update the PR body** with the final verification above (it still says tests and CI arrive in follow-up commits).
3. **Exercise the unverified lifecycle paths**, one Electron session at a time: `serve --idle-timeout 1` left idle until it quits itself; SIGTERM and SIGINT on `serve` and on `capture` mid-tour (cleanup should complete, `capture` should write a manifest with `cancelled: true` and exit 130; a second signal forces exit 130).
4. **Re-run `capture.mjs` against a branch with F1's new shell rail.** If lookups fail, adjust the `NAV` table in `config.mjs` (only app-selector location), not the callers.
5. **Run a first `--install-electron` with a cold download cache** to confirm the install and checksum path; only a warm-cache run was seen.
6. **Try two lanes' sessions at once** when capacity allows. Isolation rests on a per-session `/tmp`, `Xvfb -displayfd` (which skips a display number already in use, including its abstract socket) and per-session profiles, but two live Electron sessions were never run together here.
7. Optional improvements: a richer Social fixture; Settings sub-pages (Appearance, Updates) in the default tour; a `--domains` filter; a CDP screencast or video mode.

## Open questions and risks

- Should `--sizes` also include the default size when the default is not listed? Currently it does not.
- Screenshots use a stand-in typeface. Judging type metrics from them is unsafe; spacing and layout are fine.
- The tool depends on the exports of `tests/acceptance/runtime.mjs`, `fixtures/http.mjs` and `fixtures/wiki.mjs`. Other open PRs own those files; if one changes a signature, the `acceptance-api` test is the early warning.
- Window sizes are emulated, so a native window-minimum behaviour (for example a resize that the real window refuses) is not reproduced.
- Merge is held for the integration owner, and the PR touches `.github/workflows/foundation.yml` (one line only).

## What exists only outside git

- Nothing uncommitted: `git status` was clean before this file was added.
- This lane's `/tmp/hq-b4b-*` scratch is removed.
- In the worktree's git-ignored `.t3/dev-preview/shots/` (4.3 MB, six sets): `20261103T145126Z` (example, two sizes, 20 shots), `20261103T145147Z` (live, light), `20261103T145846Z-outage` (Work up, down, recovered) are worth keeping as samples. `20261103T145002Z` (first run, shows the loading defect), `20261103T145205Z-b4` (offline) and `20261103T145822Z` (custom steps) are superseded and safe to delete; the host hook blocked their deletion from here.
- `node_modules/electron/dist` in the worktree (git-ignored) holds the installed Electron binary; the shared download cache under the user's home predates this lane.
- No decisions live only in conversation; the ones above are the complete list.
