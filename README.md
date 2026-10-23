# HQ

One Electron desktop workspace for Design, Social, Work and Wiki. The shared shell mounts each independently owned domain module through the module ports below. Backend service source lives in [`services/`](services/README.md) (Planner) and the agent CLI in [`tools/hq-cli`](tools/hq-cli/README.md); neither is installed or started by the desktop commands here.

UI contributors: start with the [partial UI map](docs/ui-map/README.md) for known view entry points, synthetic verification recipes and the maintained shared guidance route.

Requires Node.js 22.18+ (the `engines` floor; CI uses Node 24.19) and npm. Run all commands from the repository root; there is one npm workspace install and lockfile.

```sh
npm install
npm run dev          # Vite + sandboxed Electron; close Electron to stop both
npm run dev:web      # renderer only at http://127.0.0.1:5173
npm run typecheck
npm test
npm run build        # typecheck + production renderer + Electron JavaScript
npm start            # launch the built desktop app
npm run preview      # serve the built renderer at http://127.0.0.1:4173
```

`npm ci` reproduces the committed lockfile. Electron's npm dependency downloads its development runtime; this does not install a system service or a signed application. Electron requires a graphical session and the platform's Chromium sandbox prerequisites. Never disable the sandbox to bypass missing host support. No packaging, installer, signing or notarization is supplied yet. Changes to Electron/preload source require restarting `npm run dev`; renderer edits reload through Vite.

The slim domain rail preserves a separate destination per domain and project. Light, Dark and System appearance persist locally; System follows live OS color changes. The visible initial project is the public-safe `hq-local` / “HQ workspace” context. Project selection belongs to later integration. Storage failure leaves the shell usable with a session-only notice.

Module integration lives at `apps/desktop/src/modules.tsx`: each domain registry entry is a `ComponentType<ModulePort>` from the independently owned module. Module implementations live outside the shell (Design lanes own `modules/design/<section>`); they do not edit root configuration, dependencies or shared contracts. The root owner coordinates those changes.

`packages/contracts/src/index.ts` exports the React-free `@hq/contracts` boundary:

- `DomainId`: `design | social | work | wiki`; `Appearance`: `light | dark | system`.
- `ProjectContext`: stable public `id` and readable `name`.
- `ModulePort`: `context`, module-local `destination`, resolved `appearance`, read-only `desktop` metadata, and `navigate(destination)`. Navigation only updates shell state. A domain switch remounts the module; modules own durable product state and background-work lifecycle.
- `ReferenceEnvelope`: `version: 1`, `domain`, `projectId`, `kind`, `entityId`, readable `title` snapshot and `returnDestination: { domain, destination }`; optional immutable `sourceRevision` and known `workspaceId`. Preserve the envelope when a target is unavailable. Parsing validates data and never resolves or executes a target.
- `parseProjectContext` and `parseReference` reject malformed and unexpected fields. Reference/context data must remain public-safe; no host identifiers, paths, credentials or private imports.

Electron explicitly enables context isolation and renderer sandboxing, disables Node integration/webviews, rejects renderer navigation, redirects, new windows, downloads and permissions, and serves a restrictive production CSP. The preload exposes only `window.hqDesktop` platform/version metadata. Browser mode uses an equivalent capability-free fallback. There is no generic IPC, filesystem, shell, provider or job-dispatch API. Remote previews require a separately qualified surface. Closing HQ has no cancellation path for remote jobs.

Source layout: `apps/desktop/electron` is the desktop host; `apps/desktop/src` is the browser-capable React renderer; `packages/contracts` is the shared contract package. Build outputs are ignored at `apps/desktop/dist` and `apps/desktop/dist-electron`. `@hq/contracts` deliberately exports TypeScript source for workspace bundler/typechecker consumers; it is not a standalone Node runtime package.

Bootstrap Task Text: deliver a runnable minimal shell, narrow contracts and explicit unavailable slots; accept when install, typecheck, focused state/contract tests and build pass. UI checks exercise domain switching and appearance persistence when a Browser panel is available. These checks do not establish native desktop behavior, Mac installation or signing. Repository-specific GitHub Actions in `.github/workflows/` run the foundation, Design section and CLI/Planner checks; shared reusable workflows are deferred until the repository's shared workflow policy is established.

Primary implementation guidance: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), [sandboxed preloads](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload), [React from scratch](https://react.dev/learn/build-a-react-app-from-scratch), and [Vite production builds](https://vite.dev/guide/build).
