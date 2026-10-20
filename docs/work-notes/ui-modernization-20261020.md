# HQ UI modernization

Artifact Type: work-note
Artifact ID: work.hq-ui-modernization
Purpose: Carry the owner's screenshot corrections through coherent source changes and UI verification.
Owner: HQ UI modernization coordinator
Consumers: Assigned UI, calendar and project lanes; HQ integration owner
Authority effect: none

## Identity and delivery

Implementation target: `Jones-Systems/HQ`. Native task identity is retained privately in the owning thread.
The coordinator is sole Git owner of the isolated `work/hq-ui-modernization-20261020` worktree. Base: `54b380428f3ee2e5889851e4bf0778a98f27609a`, verified head of `work/hq-foundation` / PR #2. This is a real prerequisite: main does not contain the desktop application. HQ #114 is the scoped child PR against that foundation branch. The owner subsequently authorized merging the green task PRs and directed future green task PRs to proceed without another confirmation, subject to native protections and readiness checks. This supersedes the earlier integration-owner hold for this candidate. No sudo, private-data publication or unbounded deployment is authorized.

Inherited model mode: Claude Frontier, temporary personal preference revision 2. Initial framing uses Opus 5.5/high through the app-owned child route; account allowance is unavailable (`fleet_managed_allowance_unsupported`), with a verified deterministic account route permitting dispatch. Investigation uses Sol/medium. Native V3 profiles apply where supported; generic T3 roles are not profile enforcement.

HQ shared-guidance enrollment is unavailable: the baseline has no `.agents/shared-guidance.md`. Its local AGENTS.md, bootstrap and integration campaign still apply. Graphify has no selected HQ snapshot; direct source is the navigation fallback. `rg` is unavailable; native grep/find are used.

## Owner requirements

- Use the established modern visual system consistently across shell, Design, Social, Work and Wiki. Remove exposed unstyled controls, especially Service settings, Requests and Runs.
- Appearance is one button cycling Light → Dark → System → Light, retaining persistence and live System behavior.
- Keep service settings and appearance visible at the foot of a viewport-height primary rail. Drag that rail down to icons; drag secondary panels fully closed and allow restoration.
- Remove the oversized, hard-coded context header; preserve meaningful project context compactly. Remove user-facing development entry paths and confusing WORKSPACE diagnostics.
- Hide scrollbar chrome throughout the app while preserving wheel, touch, keyboard and programmatic scrolling.
- Show real projects through the existing supported catalog path, with accurate provenance and no synthetic records represented as real.
- Calendar supports Month, Week and Day, drag/drop dates and time slots, and duration-based timeboxing. Calendar planning must never post content or launch work.

The supplied thirteen screenshots are owner evidence retained in the private native thread attachment store; do not copy desktop surroundings or personal data into this public repository.

## Research and current work

Repository research is required to find the existing design contracts, catalog route and calendar storage limits. No speculative framework replacement is needed. A read-only Opus specialist owns initial design/technical synthesis, with independent read-only calendar and project source investigations. Builders wait for the relevant findings and accepted framing; no competing design system will be created.

Known evidence: `docs/design/hq-visual-system/` already defines tokens and component states; `packages/hq-ui` consumes tokens and supplies accessible primitives. The desktop shell still uses its own palette, raw settings controls, a 76px hard-coded header and page-height layout. The Social calendar currently saves `planned_date` via versioned writes.

## Verification and lifecycle

Run focused behavior tests for state persistence, appearance cycling, resize/collapse restoration and calendar mutations. Check the final combined candidate with affected type/build/tests and live browser evidence in light/dark at relevant viewport sizes. Native Electron and installed laptop behavior remain distinct evidence. Only one serial test process runs after fresh host admission. Dependencies and durable evidence stay inside task/workspace storage, never shared `/tmp`; temporary previews are stopped at handback.

Registration attempt `hq-ui-modernization-20261020-registration-1` returned `registration_unavailable`, effect `none`, reason `endpoint_unavailable`. No enrollment or permission repair was attempted. The evolving implementation root is `docs/engineering-specs/hq-ui-modernization.md`. This note contains no permission grant.

## Owner corrections and implementation continuity

The later screenshots explicitly prefer Design's cool-neutral/blue styling over the older warm, monospace-heavy look, including Wiki. All secondary panels are collapsible; the Design top tabs and primary rail stay available. Connection status/manage actions belong above settings/appearance in the lower-left rail, with icon recheck/reconnect controls. The Wiki error is an unavailable local source index, not proof of a disconnected remote host.

The owner selected service-backed Social timed planning, a 30-minute default and edge/corner resizing in Week/Day only. Source implementation in the owning Social service is covered; live activation/deployment remains separate. The accepted Opus refinement established feature-negotiated versioned slots and closed native Wiki administration. Builders implemented those contracts alongside the shared calendar and secondary-panel work.

Initial Opus framing completed and was incorporated into the Engineering Spec. Direct source investigations additionally established that native catalog composition still uses synthetic entries, Social validates only date strings, and Wiki has no management IPC. Builders have explicit disjoint write cones and no Git/test/build authority; the coordinator owns those shared effects. Baseline `npm run typecheck` passed before implementation.

## Candidate verification

Private Social service failing-before reproduction confirmed the missing migration, slot persistence, capability and validation. The complete offline Social dashboard/growth check passes: 34 tests and 54 subtests on Python 3.13. Service source is a separate owning-repository candidate, not activated. HQ Social focused checks pass: 8 files, 580 tests. Final combined checks and browser evidence are recorded after fan-in.

The Social content test file contains independent calendar and Library panel blocks integrated by the coordinator; both scopes were preserved. The coordinator owns the final combined test file. Known false Wiki host commentary was corrected without changing its reader implementation.

## Verification result and delivery holds

- Root test union: 79 files, 1,535 tests passed; the final Work calendar side-tray change passed its 23-test affected module. Wiki's complete source/build checks: 509 tests passed.
- Design's full serial section sweep exercised every cone's typecheck, Node and Vitest checks. Repairs were verified by the focused Projects/compose boundary union (54 tests) and Design UI runner (13 tests); all other commands passed in the final sweep. Boundary scanners now traverse the shared kit and retain prohibited Node/storage checks.
- Production typecheck/build passed. Generated token files match source; all 104 contrast pairs pass.
- Native Electron 44.9.0 shell checkpoint passed: all four domains, isolated preload/CSP, and appearance/navigation across process restart. Owned fixture/cleanup checks passed (7 tests); native scratch cleanup passed. This is the shell checkpoint, not the separate full application acceptance catalog.
- Collaborative-browser checks used the production build, synthetic examples and an explicit sanitized configuration double for Social/Work. Checked light/dark, 760/1280 widths, appearance cycling, primary-rail drag to icons/restore, pinned footer bounds, hidden scrollbar chrome, service settings and hourly calendar scrolling, keyboard time moves/resizes and Undo. Browser checks caught and corrected rail-footer grid overflow and time-grid control minimum sizes. The hour region opens at 07:00 and remains independently scrollable.
- The VPS's installed font configuration resolves even generic sans-serif to Liberation Mono. CSS selects the shared sans-serif stack correctly; these Linux screenshots do not prove the intended macOS font appearance. No global font changes were made.

Private service source is published as `Jones-Systems/growth-intel#38`, commit `fd199cd53ef72208bc1dfb7c7ef6e5879d8366a9`; its tests CI is green. No live activation occurred. HQ source remains dependent on the integration foundation; the owner's later merge instruction covers the task candidate once its current head is green. Existing review branches #105 and #106 remain separate; this candidate does not merge or replace them. Native project chooser and read-only discovery are implemented, but personal project enrollment needs the owner to choose a folder in the installed runtime. Remote Wiki SSH/VPS/Mini transport is unsupported; the implemented manager handles explicit local Git sources and index recovery.

No independent review was required for this bounded source candidate. Coordinator self-review, source invariants and actual runtime evidence are reported separately. No installation, shared-service deployment or elevated command was performed.

## Follow-up refinement

The next isolated candidate starts at foundation merge `214c884319cd4783da266fcc6124112f59cdd2db` on `work/hq-calendar-settings-refinement-20261020`; the coordinator remains sole Git owner. Prior UI #114 and Social service #38 are merged in their respective target branches. Existing updater PR #115 and review-fix branches remain outside this writer scope. Owner authorization to merge green task PRs persists. Source registration remains unavailable through the previously observed endpoint; no enrollment repair is authorized.

New owner screenshots request working timed example dragging, compact undated layout, 12-hour labels, one cycling calendar view control, full-page Settings inspired by the existing Jones Code settings layout, aligned responsive rail actions, clearer source connections, real design examples and a laptop setup handoff. The read-only source investigations found both desktop and fallback example selection omit the timed capability. Regression checks failed before implementation on both exact seams. The initial calendar affected union passes: five files, 80 tests. A selected-image References regression also failed before implementation because no import operation was exposed. Final combined checks follow source fan-in.

Opus framing completed through the app-owned child route using the policy-selected Claude Frontier account, with allowance unknown (`fleet_managed_allowance_unsupported`). Its Settings/rail direction is adopted. Direct source evidence supports genuine raster import through the existing blob bridge and corrects the catalog thumbnail path to `.hq/preview.*`; no new shared IPC or renderer Node capability is needed. The separate source catalog does not run an iOS application or website. The laptop prompt is retained privately with this thread rather than publishing personal project paths or captures. No live activation, private configuration read, SSH or elevated command has occurred.

Refinement registration `hq-calendar-settings-refinement-20261020-registration-1` returned `registration_unavailable`, effect `none`, reason `endpoint_unavailable`. The protocol was not repaired or retried. The existing thread also accepted preserved Integration coordination/continuity in its private custody receipt; no source/Git ownership or operational authority transferred, and the active refinement finish line remains first.


Follow-up verification: root production typecheck/build passed; root Vitest passed 81 files / 1,554 tests. Affected Design sections, compose and References Node union passed 348 tests; References rendered checks passed 8 tests and sections rendered checks passed 3 tests. All three affected Design typechecks passed. Focused Settings checks exposed an ambiguous selector and a fixture literal type, both repaired before this full union. Connection-check timeout recovery now releases controls and ignores stale completions. Native Electron 44.9.0 shell checkpoint passed with scratch cleanup; this remains a checkpoint, not the 12 held full-native scenarios.

Collaborative browser used this candidate’s fresh production bundle with synthetic Social/Work transports only. Settings hides the mounted domain correctly, supports shared appearance and Back/Escape focus, fits a 760px viewport, and aligns wide/64px compact rail controls. Calendar all-day drag assigns a 30-minute slot; pointer drag moved 10:30 a.m. to 12:30 p.m. on the scrolled grid; lower-edge drag expanded it to 60 minutes and Undo restored 30. One tool timeout was reconciled by snapshot to the successful move before continuing. Single-button Week/Day/Month cycling and compact tray geometry passed. Real generated raster bytes imported and decoded in-browser; card/detail previews appeared. Persistent bridge-backed reopening is separately covered by the compose test. A malformed scratch PNG was correctly rejected before replacing it with a valid generated fixture. Browser evidence exposed References pane overflow; responsive wrapping and width constraints corrected it. A fresh production build and the 8-test affected References rendering group passed after that CSS repair. At 1440px and 760px viewports, measured References scroll width equals client width, search/detail bounds stay inside the pane, and collection collapse/restore remains usable. The VPS font limitation and real laptop/service activation limits remain unchanged.
