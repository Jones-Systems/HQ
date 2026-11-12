# Dev preview and local checks

`tools/dev-preview/` launches the real, built HQ desktop app, seeds it with synthetic example data,
lets you drive it, and saves PNG screenshots. Linux uses a virtual display; Darwin opens a native Electron window.
It adds no dependencies: it uses Node's built-in WebSocket and the repository's own acceptance runtime
(`tests/acceptance/runtime.mjs` and its fixtures), imported read-only. The approach comes from lane F7's
exploration driver.

## Prerequisites

Use CI-pinned Node 24.19.0 and Python 3.13.5 (`live` mode needs `python3`). Linux also needs `Xvfb` and `bwrap` (bubblewrap) on `PATH`. Darwin uses the existing acceptance runtime with owned process groups and requires a graphical login session; it does not require Linux display tools. The Darwin route is source-only and awaits native qualification.
Then, in the checkout whose build you want to look at:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node tools/dev-preview/capture.mjs --install-electron   # first run only
```

`npm ci --ignore-scripts` skips Electron's download. If the platform Electron binary (`node_modules/electron/dist/electron` on Linux, `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` on Darwin) is missing the
tools stop and print the fix. `--install-electron` runs the package's own installer
(`node node_modules/electron/install.js`) with the default shared download cache and the package's checksum
verification. It needs no sudo and installs nothing global. Run `npm run build` again after you change source:
the tools warn when a source file is newer than the build.

## One command: capture every domain

```sh
node tools/dev-preview/capture.mjs                                   # light and dark, 1440x900
node tools/dev-preview/capture.mjs --sizes 1440x900,760x560          # also the minimum window size
node tools/dev-preview/capture.mjs --mode live --reduced-motion --out /tmp/my-shots
```

It starts a session, visits Design, Social, Work, Wiki and Settings in each theme and size, waits for fonts,
animations and "Loading…" indicators to settle (bounded), writes the PNGs and a `manifest.json`, prints the
output directory on stdout, and always cleans up. The retained Linux handoff records roughly 5 to 10 seconds; current-head timing and Darwin behavior are unverified.

Files are named `NN-<domain>-<theme>-<size>.png`. The manifest records, per shot: file, domain, theme, size,
mode, git HEAD and a dirty flag, timestamp, what the page actually showed (theme, viewport, current item),
settle details, warnings, and any console errors, warnings or exceptions that appeared since the previous shot.
A step that fails (for example a renamed button) is recorded in the manifest and the tour continues. The exit
status is 1 if any shot or step failed, 0 otherwise.

Options: `--repo <dir>`, `--mode`, `--size WxH`, `--sizes <list>` (the full list to capture),
`--themes light,dark`, `--out <dir>`, `--reduced-motion`, `--no-settings`, `--no-wiki`,
`--steps <file.json>`, `--install-electron`.

### Custom steps

`--steps` replaces the domain tour with your own sequence. Each step is `{ "do": <action>, ...fields }` using the
same fields as `ctl` commands below:

```json
[
  { "do": "domain", "name": "Work" },
  { "do": "click", "text": "Calendar" },
  { "do": "media", "features": { "prefers-color-scheme": "dark" } },
  { "do": "shot", "name": "work-calendar-dark" }
]
```

Actions: `domain`, `settings`, `click`, `key`, `type`, `eval`, `window`, `media`, `wait`, `settle`, `shot`, `restart`,
`svc`. A `shot` step needs a `name`.

## Interactive loop: serve and ctl

```sh
node tools/dev-preview/serve.mjs --name mine &     # prints one READY line, then waits
node tools/dev-preview/ctl.mjs --session mine domain Work
node tools/dev-preview/ctl.mjs --session mine click --text Calendar
node tools/dev-preview/ctl.mjs --session mine shot work-calendar        # prints the PNG path
node tools/dev-preview/ctl.mjs --session mine media prefers-color-scheme=dark
node tools/dev-preview/ctl.mjs --session mine shot work-calendar-dark
node tools/dev-preview/ctl.mjs --session mine quit                      # always finish with this
```

`ctl` prints JSON (`{ "ok": true, "value": ... }`) and exits nonzero on failure (1 for a failed command, 2 for a
usage mistake). `--raw` prints string results as plain text.

| Command | What it does |
| --- | --- |
| `status` | mode, size, services, build freshness, Electron version |
| `shot [name] [--no-settle]` | save a PNG into the session's evidence directory and print its path |
| `domain <name>` / `settings` | open Design, Social, Work or Wiki / Settings |
| `click --text <label> [--contains] [--nth N]`, `--selector <css>`, `--x N --y N` | real mouse click; refuses a covered or disabled target unless `--force` |
| `key <key> [--mods ctrl,shift] [--repeat N]` | key press (`Enter`, `Escape`, `Tab`, arrows, `PageDown`, a single character, ...) |
| `type <text>` | insert text into the focused field |
| `eval <expression>` | evaluate JavaScript in the renderer |
| `window <w> <h>` or `<WxH>`, `window reset` | resize the viewport; `reset` returns to the session size |
| `media <feature>=<value> ...`, `media reset` | emulate e.g. `prefers-color-scheme=dark`, `prefers-reduced-motion=reduce`; settings accumulate until `reset` |
| `wait <ms>`, `wait --text <text>`, `wait --selector <css> [--timeout ms]` | pause, or wait until the text is visible anywhere on the page (case-insensitive substring) or a visible element matches the selector |
| `settle [--timeout ms]` | wait for fonts, animations and loading indicators |
| `errors [--since N] [--clear]` | console errors, warnings and exceptions seen so far |
| `svc down\|up [work\|social]` | make the fixture services refuse connections (`live` mode) |
| `ledger` | requests the fixture services have received |
| `log` | tail of the Electron stderr |
| `restart` | restart the app with the same profile, size and media |
| `quit` | close the app and fixtures and remove all scratch; returns after cleanup finishes |

`serve` accepts `--repo`, `--mode`, `--size`, `--no-wiki`, `--name` (default `default`), `--out` (where `shot` writes),
`--idle-timeout <minutes>` (default 90, `0` disables) and `--install-electron`. Clicking uses accessible names
(`aria-label`, then text, then `title`), searching the navigation rail first and then the whole page.

## Modes and the data each shows

| Mode | Work | Social | Wiki | Use it for |
| --- | --- | --- | --- | --- |
| `example` (default) | the app's built-in example data | the app's built-in example data | synthetic corpus | most UI work; nothing is configured |
| `live` | the real stdlib Planner from `services/planner`, seeded through `POST /api/examples`, behind a recording proxy | a read fixture returning an empty workspace, behind a proxy | synthetic corpus | Work behaviour against a real service; `svc down` for outage states |
| `offline` | endpoint configured but nothing listens | endpoint configured but nothing listens | synthetic corpus | the "unreachable" states |

The Wiki corpus comes from `modules/wiki/app/fixtures/corpus`; `--no-wiki` leaves Wiki unconfigured. All data is
synthetic and lives in a per-session profile that is deleted on exit.

## Targeting another worktree

The tool imports its helpers from the checkout it lives in, but runs the build of whichever checkout `--repo` names,
so you can use it before it merges into your branch:

```sh
node /path/to/a/checkout/with/the/tool/tools/dev-preview/capture.mjs --repo /path/to/your/worktree
```

`--repo` supplies the Electron binary, the built app (`apps/desktop/dist` and `dist-electron`), the Planner and the
Wiki corpus, falling back to the tool's checkout when your worktree lacks the Planner or corpus.

## Where things go

Everything is under `<repo>/.t3/dev-preview/` (git-ignored through `.t3/`):

- `shots/<UTC timestamp>/` for `capture`, and `shots/<UTC timestamp>-<name>/` for `serve` (override with `--out`).
  `capture` refuses a non-empty `--out` unless an earlier capture's `manifest.json` is there.
- `sessions/<name>/session.json` (control port, token, pid, evidence directory), mode 0600; removed on exit.
- `scratch/run-*` for the profile, fixtures and sandbox files; removed on exit. A killed session leaves its scratch,
  and the next session start removes scratch whose owning process is gone.

The control API listens on `127.0.0.1` only and requires the token from the session file.

## Cleanup and etiquette

Follow the active host admission and serial-verifier allocation before any session, build or test. Keep one admitted session at a time, and always end with `ctl quit`
(or Ctrl-C / SIGTERM on `serve`, which does the same). `capture` always cleans up, including on a failed step or a
signal. `serve` quits by itself after 90 idle minutes. Screenshots are yours to delete when you no longer need
them: disk is tight.

## Known limits

- Screenshots are of the renderer only: no native window frame, menus or OS dialogs. Native Electron journeys are
  not covered here.
- Window sizes are emulated viewports. The real window's minimum is 760×560, which `--sizes` can still go below.
- Linux uses Xvfb and bubblewrap. Darwin uses native windows and owned process groups, without Linux PID/user namespaces. Both retain Electron sandboxing. Other platforms stop with a clear message.
- Fonts on the original Linux host: it maps `sans-serif` and `system-ui` to a monospace face, so the sandbox's private fontconfig maps
  them (and the app's `IBM Plex Sans`, which is not installed) to Liberation Sans. Shots show a proportional
  stand-in, not the shipped typeface. The alias never touches the host's fonts.
- Endless animations (spinners) are noted, not waited for; use `--reduced-motion` for steadier shots.
- Domain navigation depends on accessible names, with the selectors in one table (`NAV` in
  `tools/dev-preview/config.mjs`). If the shell is redesigned, a failed lookup is recorded in the manifest and
  that table is the place to adjust.
- Unit tests cover the pure parts (`tools/dev-preview/test/`). The Electron path needs a built app and an admitted Linux virtual-display or Darwin graphical session. Unit discovery alone does not qualify that path.


## Local mirror of required checks

```sh
node tools/ci/local-checks.mjs --list
node tools/ci/local-checks.mjs
node tools/ci/local-checks.mjs --only cli,planner
node tools/ci/local-checks.mjs --only design --design canvas,flows --timeout 120
```

The default selects Foundation, CLI, Planner and Design. `--list` plans and prints commands without executing them.
`--only` narrows the groups; `--design` narrows Design sections, while retaining the complete inventory coverage
and duplicate-ownership validation. Empty group/section selections refuse. A subset is partial verification.

Foundation, CLI and Planner single-line commands and job environment come from the checked-out workflows.
Dependency/setup actions and `npm ci` are excluded: prepare the locked dependencies and exact CI runtime versions
separately, under host admission. The CLI command retains `HQ_CLI_E2E=1`. Foundation retains its npm build,
full Vitest, Wiki, acceptance and storage discovery. No storage policy, test filter or evidence control is bypassed.

Design runs the workflow inventory test command and complete inventory shell block, then uses the existing
`design-sections.mjs` commands for selected rows, serially. This mirrors check commands rather than hosted
matrix scheduling, cancellation or the fan-in job. Workflow edits outside the supported parser shape require
maintainer review; this is a narrow parser, not a general YAML/Actions interpreter. New unsupported multiline
Foundation/CLI/Planner steps refuse. The hosted jobs remain the required merge evidence.

Design requires Bash 4+ on PATH for associative arrays, `mapfile` and `globstar`; macOS's bundled Bash 3.2
cannot run it. Use an already authorized compatible Bash or report this prerequisite missing. The launcher does
not install a shell. `--timeout` is a per-command timeout (default 600 s), not the hosted job timeout or a
host-wide descendant controller. A failed command suppresses remaining commands in its group, continues other
groups and yields a nonzero result. Temporary output is cleanup-owned; the summary prints command durations.
Run only under the serial verifier's qualified controller and lock. Do not interpret this tool as host admission.

The recovery checkpoint has static syntax/diff evidence only. No current-head unit suite, full mirror, Darwin
launch, lifecycle/signal/idle-timeout check, cold Electron install or concurrent-session check has run. Existing
Linux evidence belongs to the retained handoff. Workflow hooks for the two tooling suites are proposed to INT
in the B4 recovery receipt; until integrated, the current Foundation workflow does not discover dev-preview tests.
