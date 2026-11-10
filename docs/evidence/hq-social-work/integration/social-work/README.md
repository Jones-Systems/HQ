# Social+Work assembly evidence (`task.domain-integration.001`)

Evidence for the Social+Work assembly of the HQ Social/Work campaign (`docs/engineering-specs/hq-social-work.md`,
`ac.sw-assembly.001`, `ac.integration.001`, `test.domain-integration.001`). All data shown is the fictional example
data built into each domain. No endpoint, credential or private record is read or written.

This is combined verification by the assembly owner, not an independent review. The exact check commands and results,
and the test-file discovery list from the actual `npm test` run, are recorded in the assembly PR body. They were taken
once, on the exact final head that contains this file.

## Binding

| Item | Value |
| --- | --- |
| Repository | `Jones-Systems/HQ` |
| Branch | native `t3/social-work-domain-assembly` (logical name `work/hq-sw-assembly`) |
| Start | `a385a6f875a0d0749e795e21cc8233023b388267` (published plan head of `work/hq-social-work-plan`) |
| Merge 1 | `dc6402c0ecace2a47b685dabf726825772be8522`: normal `--no-ff` merge of exactly `9735b741e94baad83d9f7dc5f3bb8ce9c3778b2d` (accepted Social domain, PR #29). It contains core `83dafc5`, content `5f5df2a`, workbench `bffd433` and UI kit `935dedf`. No conflicts. |
| Merge 2 | `55b751ba96936631e6302811eed9cf81ea904db3`: normal `--no-ff` merge of exactly `3426da769ca6a5cf1ba561859039b14fc745457a` (accepted Work domain, PR #31). It contains board `3ca74d7`, views `8a3261d`, core `a8c791a` and UI kit `935dedf`. No conflicts. |
| Integration test commit | `719b71d931d19a3b6fd47e800567b851068e80e2` |
| Model | `claude-opus-5-5`, high effort, fast mode off. No descendants were launched. |
| Guidance | Codex V3 `AGENTS.md` at `4beb491c`: 30,716 bytes, SHA-256 `1238a90a…7ce6`, verified and read in full. HQ `AGENTS.md` and `CLAUDE.md` were also read. `.agents/shared-guidance.md` is absent, so shared enrollment is **unavailable** and the HQ local agreements apply. The capsule's file SHA-256 (`f0428932…77fc`) and its `capsule_sha256` (`3d935de4…402d`) were verified. No material guidance conflict was found. |

**Byte identity at merge 2.** Each of these diffs is empty:

- `git diff --stat 9735b741 55b751b -- modules/social`;
- `git diff --stat 3426da76 55b751b -- modules/work`;
- `git diff --stat 935dedf7 55b751b -- packages/hq-ui`;
- `git diff --stat a385a6f 55b751b -- package.json package-lock.json tsconfig.json vitest.config.ts apps/desktop packages/contracts docs/engineering-specs docs/work-notes docs/design docs/evidence/hq-social-work/integration`.

Every other path the merges brought in is lane evidence under `docs/evidence/hq-social-work/{social-content,social-workbench,ui,work-planner,work-board,work-domain}/`. Each of those directories is byte-identical to its source head.

## Authored scope

- `apps/desktop/src/social-work.integration.test.tsx`: new. No open PR or remote branch carries this path.
- `docs/evidence/hq-social-work/integration/social-work/**`: this directory.
- `apps/desktop/src/modules.tsx` is **unchanged**. R1 already registers the named `SocialModule` and `WorkModule`, and T0's Design placeholder slot stays as it was.

## Integration test: `apps/desktop/src/social-work.integration.test.tsx`

The test renders the real `App` with `MODULES` (Design placeholder, `SocialModule`, `WorkModule`). It replaces every method of both domain ports with a forwarding `vi.fn` spy:

- Social: `snapshot`, `saveDraft`, `addBrand`, `example`, `run` and the execution-class `submitRun`;
- Work: all nine `PLANNER_PORT_KEYS`.

Only `Date` is faked, at the fixtures' fixed day `2026-10-21`.

| Scenario | What it proves |
| --- | --- |
| Registry | `MODULES.social` and `MODULES.work` are the accepted named and default exports, and Design is still the placeholder. |
| Labelled fictional data | Both domains mount in the shell with their "Fictional example" labels, one snapshot each, no write and no execution. |
| Round trip Design → Social → Work → Social → Work → Design | Every switch really remounts. **Social** restores its section, brand, channel and search filters, selected draft and unsaved body text. **Work** restores its view, Kind and Search filters, selected card, scroll position (180/24) and unsaved capture text. Across the whole sequence no port is called at all: no read, no write, no execution. |
| Page and domain switches | Every Social and every Work navigation item, then three full rail cycles, make zero writes and zero execution. |
| Execution spy is live (positive control) | Only the explicit **Run Writing studio** calls `submitRun`, once. Five later domain switches and a Run history visit add no call. |
| WD-1/WD-2 disclosure | A dirty card-detail title, left by a domain switch, sends exactly one `patch` with the user's own edit. Social sees no write and nothing executes. |
| Card move | Alt+← on a board card sends one `move`; its toast **Undo** sends one more. No execution. |
| Date move | Alt+→ on a Calendar chip sends one `patch` of `{ dates }` with only that date's value changed (24 → 25 Oct); **Undo** restores it. |
| Horizon move | Alt+↓ on a Timeline row sends `patch(id, 1, { horizon: 'soon' })`; **Undo** sends `{ horizon: 'now' }`. |
| One keypress, one undo | After two moves, Ctrl+Z in Social leaves Work's two-entry undo stack and every port untouched. Back in Work, one Ctrl+Z consumes exactly one entry, and one ⌘+Z consumes the other. That is two writes in total, and no execution. |
| Explicit theme survives reload | Dark, and then Light, survive unmounting and re-rendering `App`, through the shell's `hq.appearance.v1`. |
| System follows the OS | A controllable `matchMedia` stub flips dark and light, and `data-theme` follows it. An explicit choice then overrides the OS. |
| Theme leaves captured content intact | After light ↔ dark changes, Social's unsaved draft text and Work's capture text, filters and selection are unchanged. The planning items are deep-equal to before, and no port is called. |

### Accuracy boundary: WD-1/WD-2

Accepted Work-domain findings WD-1 and WD-2 (P3, PR #31) mean that leaving a dirty card-detail field commits that one pending explicit edit, through the accepted save-on-leave and notes flush. **Zero-write navigation is proven for clean paths with no pending edit.** It is not claimed universally. The assembly does not change this behaviour.

## Browser evidence

**Route.** The renderer is the production build of commit `719b71d`. That commit differs from the final head only in files under `docs/`. The build was made with `vite build --config apps/desktop/vite.config.ts`:

- `index.html`: SHA-256 `2dbadc9b…32b1`;
- `assets/index-C8sxxicc.js`: SHA-256 `7264405e…c278`;
- `assets/index-ByJbOc-C.css`: SHA-256 `9eef4842…b518`.

It was served by `vite preview` on `127.0.0.1:4195` and opened in a T3 Browser tab with the Incognito profile. The page carries the app's own production CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; …`. The dev-only CSP relaxation in `vite.config.ts` applies only to `serve`, not to `preview`.

**Readback.**

- **Console errors:** 0. The tool's console log was empty before and after the reload, and an in-page `console.error` hook, installed for the session before the reload, recorded none.
- **CSP violations:** 0, from an in-page `securitypolicyviolation` listener installed after load and again after the reload.
- **Requests:** only same-origin. Resource entries were `http://127.0.0.1:4195/assets/index-C8sxxicc.js` and `…/index-ByJbOc-C.css`, plus the document itself.

**Viewports.** 1280×800 captures are at device scale 1, so the PNG is 1280×800. The 1024×768 captures came from a device scale of 1.25, so the PNG is 1280×960 for a 1024×768 CSS viewport.

| Capture | Viewport and theme | Shows |
| --- | --- | --- |
| `social-overview-1280-light.png` | 1280×800, Light | Social Overview with the example-data label |
| `roundtrip-1-social-arranged-light.png` | 1280×800, Light | Social Library: brand Larkspur, Channel LinkedIn, Search "autumn", draft selected, body edited, "Unsaved changes" |
| `roundtrip-2-work-arranged-light.png` | 1280×800, Light | Work List: Kind Chore, Search "the", card "Repaint the garden shed" open, capture text typed |
| `roundtrip-3-design-placeholder-light.png` | 1280×800, Light | T0's Design placeholder |
| `roundtrip-4-social-restored-light.png` | 1280×800, Light | Social after its remount: all of the above restored (DOM readback matched) |
| `roundtrip-5-work-restored-light.png` | 1280×800, Light | Work after its remount: all of the above restored (DOM readback matched) |
| `work-list-detail-1280-dark.png` | 1280×800, Dark | The same Work state after switching to Dark: capture text, filters and card unchanged |
| `social-library-editor-1280-dark.png` | 1280×800, Dark | The same Social state in Dark: unsaved text unchanged |
| `social-overview-1280-dark.png` | 1280×800, Dark | Social Overview |
| `work-board-1280-light.png`, `work-board-1280-dark.png` | 1280×800 | Work Status board |
| `work-board-filtered-1280-dark.png` | 1280×800, Dark | Board with the Work filters carried from the List view |
| `work-board-1024-dark-after-reload.png` | 1024×768, Dark | After a full page reload: Dark persisted, and the shell returned to Work › Status board |
| `social-overview-1024-light.png`, `social-overview-1024-dark.png` | 1024×768 | Social Overview |
| `work-board-1024-light.png` | 1024×768, Light | Work Status board |
| `work-board-1024-system-os-dark.png` | 1024×768, System | Appearance System with the OS emulated as dark resolves to dark. Emulating light then resolves to light (readback only). |

**Limits.**

- **Scroll in the browser.** In this build at 1280×800, the filtered Work list fits its scroller (`scrollHeight == clientHeight`). Browser scroll restoration therefore could not be shown here. It is proven by the integration test and the accepted Work-domain test.
- **Session state across a reload.** Each domain session is held in memory for the window only (G-3). A reload keeps the appearance and the shell's per-domain destination. It does not keep the unsaved text, which is accepted behaviour.
- **Fonts.** The font provenance gate remains open, and these captures use the host's fallback fonts.

## Electron

**Unverified.** The read-only `jones-code-ui-evidence doctor --source <this worktree>` probe returned `rejected` (code 2). Its platform, node, Xvfb, bwrap, user-namespace and font checks passed. It failed on:

- `electron-source-pin`: Electron is not an exact source pin;
- missing `apps/desktop/dist-electron/boot.cjs`, `apps/server/dist/bin.mjs` and `apps/server/dist/client/index.html`;
- missing `scripts/lib/desktop-external-packages.ts`.

That harness is qualified for the Jones Code repository layout, not for HQ, so this is a harness layout mismatch rather than an HQ source defect. No other qualified, HQ-compatible Electron route exists on this host. Nothing was installed, no elevation was used and no sandbox was disabled.

## Observations recorded, not fixed (P2–P4)

These are inherited from the accepted lanes or the T0 shell. None is fixed here.

| ID | Severity | Observation | Owner |
| --- | --- | --- | --- |
| SWA-1 | P3 | Social Overview capability cards overflow at 1280 and 1024: the status text and the "Linked across HQ" column extend past their card or region edges. See `social-overview-1280-light.png` and `social-overview-1024-light.png`. | Social (SOC-C) |
| SWA-2 | P3 | The Social Edit draft field row is cramped at 1280. The Brand and Channel selects truncate, and the Planned date input runs past its column. See `roundtrip-1-social-arranged-light.png`. | Social (SOC-C) |
| SWA-3 | P3 | With the card detail open, the Work List table is clipped: the Status column shows "Inb", "Nex" and "Act". See `roundtrip-5-work-restored-light.png`. | Work (WRK-P / WRK-B) |
| SWA-4 | P3 | Both domains render inside a centred, width-capped column about 100 px below the context bar. At 1024 the Status board shows about 1.5 columns, scrolling horizontally. | Shell or domains (layout owner to decide) |
| SWA-5 | P4 | At 1024×768 the rail's Appearance control sits below the fold and needs a page scroll. | T0 shell (`App.tsx` / `styles.css`, unassigned) |
| WD-1, WD-2 | P3 (inherited, accepted) | A switch commits an already-pending explicit card-detail edit through save-on-leave and the notes flush. | Work domain |
