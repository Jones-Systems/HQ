# Social compatibility check

An opt-in check that drives HQ's real desktop Social bridge against a real, disposable, loopback-only
Fieldnotes (the private Social workspace service). It exists because none of HQ's default tests or CI touch a
real Social service.

It exercises two HQ layers exactly as the app wires them:

- the main-process HTTP layer, `createServices` with `sendHttp` from `apps/desktop/electron/services.ts`, given
  a `ServiceConfig` that returns the loopback URL;
- the live port, `createLiveSocialPort({ call: main.social })` from `modules/social/live`, with
  `summarizeRun` for run results and `endpoint()` / `openServiceConfig` from `service-config.ts`.

## Run it

You need a local checkout of the Fieldnotes repository and Python 3.13. Nothing is installed or downloaded.

```sh
npm ci --ignore-scripts --no-audit --no-fund
HQ_FIELDNOTES_ROOT=/path/to/growth-intel \
  node_modules/.bin/vitest run --config tools/social-compat/vitest.config.ts
```

| Variable | Meaning |
| --- | --- |
| `HQ_FIELDNOTES_ROOT` | Required. A Fieldnotes checkout (the one containing `apps/social_dashboard`). Unset or wrong, the run fails before anything starts and says what to set. |
| `HQ_FIELDNOTES_PYTHON` | Optional. The interpreter to use. Default `python3`. |

The check starts Fieldnotes itself, on `127.0.0.1` and a free port, with a fresh temporary data directory. Run it
once per revision you care about; the links checks follow the features the service advertises, so a revision with
`hq-references-v1` and one without are both covered by the same file.

To typecheck it: `node_modules/.bin/tsc --noEmit -p tools/social-compat/tsconfig.json`.

## What it checks

The workspace snapshot guards and features; `addBrand`; `saveDraft` create, update, stale-version conflict and
unknown-brand rejection; whether the service's validation text matches HQ's local rules; planning slots (set,
replace, keep, clear); draft links (save, preserve when absent, clear with `[]`, duplicate rejection) or, without
`hq-references-v1`, that the port refuses them locally; `example()` for all eight tools; `submitRun` of each
sample with `is_example: true`, polled to a terminal state and classified with `summarizeRun`; a full run queue;
after a Fieldnotes restart, the token refresh on the first `saveContent`, `submitRun` returning `forbidden` until
a workspace read, and queued or running runs becoming `interrupted`; the exact `Host` check; HQ's endpoint policy
rejecting a non-loopback HTTP address; and the 2,000,000-byte response cap against a large library.

## Safety and cleanup

- Loopback only. It never contacts a deployed instance or a tailnet address.
- It reads no Fieldnotes data. The only things it asks the service for are the workspace API and the fictional
  sample inputs the service itself serves. Fixtures in the test are written here; nothing is copied from the
  service's repository.
- It sets no environment for the service beyond `PATH`, a temporary `HOME` and `TMPDIR`, and
  `PYTHONDONTWRITEBYTECODE`, so it writes nothing under your home or your checkout.
- The service runs in its own process group. On success, failure, `SIGINT`, `SIGTERM` and `SIGHUP`, it stops the
  group and removes the temporary directory. A `SIGKILL` of the test process cannot be handled and can leave a
  service and a `hq-fieldnotes-compat-*` directory in your temporary directory.

## What it proves, and what it does not

It proves how HQ's bridge and port behave against the real service's HTTP contract on the revision you point it
at: statuses, shapes, error texts and the token, queue and restart behavior.

It does not prove anything about Electron (the preload, IPC, sender checks or the renderer UI), the deployed
Fieldnotes or its reachability from a real HQ install, real data, or the correctness of the native tools beyond
their fictional sample inputs finishing and having a recognizable result shape. It is not part of CI or the
default test discovery, and it records no results on its own: copy what you need from the verbose output.
