# R1 workspace skeleton (`task.workspace-skeleton.001`)

Authority effect: none. This is the evidence for `ac.workspace-skeleton.001`.

**Source.** Commit `cfdab378e28940662ddb6e731264afca164a1957` on `work/hq-social-work-plan`. Its first parent is merge `ff5ad79`, a normal non-rewriting merge of the accepted foundation `35f9a3e` into the plan branch.

**Changed paths.** All are within the R1 assignment:

- root `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`;
- `apps/desktop/package.json`, `apps/desktop/src/modules.tsx`;
- `modules/social/{package.json,tsconfig.json,index.tsx,skeleton.test.ts}`;
- `modules/work/{package.json,tsconfig.json,index.tsx,skeleton.test.ts}`;
- `packages/hq-ui/{package.json,tsconfig.json,src/index.ts,skeleton.test.ts}`.

**Untouched:** `App.tsx`, `styles.css`, Electron main and preload, `@hq/contracts`, Design, and `tests/check-groups.toml`.

## What lanes get

| Workspace | Package | Entry | Depends on |
| --- | --- | --- | --- |
| `packages/hq-ui` | `@hq/ui` | `src/index.ts` (RS-2 marker constants) | `@hq/contracts`, React |
| `modules/social` | `@hq/social` | `index.tsx` (`SocialModule`, an available no-data stub) | `@hq/contracts`, `@hq/ui`, React |
| `modules/work` | `@hq/work` | `index.tsx` (`WorkModule`, an available no-data stub) | `@hq/contracts`, `@hq/ui`, React |

- **Registry.** `MODULES.social` is `SocialModule` and `MODULES.work` is `WorkModule`. The Design placeholder slot is unchanged.
- **Tests.**
  - Vitest `projects`: `node` runs `**/*.test.ts` under the five workspace roots, and a file may opt into `// @vitest-environment happy-dom`; `dom` runs `**/*.test.tsx` in happy-dom.
  - Pinned devDependencies, so lanes need no lockfile change for component tests: `happy-dom` 21.0.3 (engines `>=20`, compatible with root `>=22.12`), `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.8.
- **TypeScript.** The root `include` covers the three workspaces. Each workspace `tsconfig.json` extends the root and typechecks on its own.

## Checks

Telemetry admission was taken before install, and again before the dependency change: CPU 15.89% used, 39.04 GiB RAM available, broad tests allowed, serial ceiling 1.

| Check | Result |
| --- | --- |
| `npm ci` from the regenerated lockfile (fresh `node_modules`) | 149 packages |
| `npm audit` | 0 vulnerabilities |
| `npm run typecheck` | Pass |
| `npm test` | 30 tests in 6 files pass: T0's 25 tests in 3 files, plus 5 skeleton tests in 3 files |
| `npm run build` | Pass: Vite renderer plus Electron `tsc` |
| `tsc -p <workspace>/tsconfig.json --noEmit` for each new workspace | Pass |
| `.tsx` DOM project probe: a temporary JSX test rendering `WorkModule` under `vitest --project dom`, deleted after the run | Pass |
| Lockfile workspace links (`node_modules/@hq/{ui,social,work}`) | Present |
| Built bundle contains "Social is available.", "Work is available." and "A place for Design." | Yes |
| Browser check of the built renderer (loopback `vite preview`, 1280×800) | Social stub in System/light; Work stub in Dark; Design placeholder unchanged. No console entries. Only three same-origin GETs. |

**Not covered.** No CI runs on this base, so these local results are not reported as green CI. Native Electron launch has not been checked. The affected-check catalog is unchanged: it is Design-owned, and the T1 delta is proposed on issue #1. Lane-level affected-check claims stay a projection until it merges.
