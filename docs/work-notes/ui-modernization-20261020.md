# HQ UI modernization

Artifact Type: work-note
Artifact ID: work.hq-ui-modernization
Purpose: Carry the owner's screenshot corrections through coherent source changes and UI verification.
Owner: HQ UI modernization coordinator
Consumers: Assigned UI, calendar and project lanes; HQ integration owner
Authority effect: none

## Identity and delivery

Implementation target: `Jones-Systems/HQ`. Native task identity is retained privately in the owning thread.
The coordinator is sole Git owner of the isolated `work/hq-ui-modernization-20261020` worktree. Base: `54b380428f3ee2e5889851e4bf0778a98f27609a`, verified head of `work/hq-foundation` / PR #2. This is a real prerequisite: main does not contain the desktop application. Publish a scoped child PR against that foundation branch; preserve HQ's integration-owner merge hold. No installation, deployment, sudo, private-data publication or shared-service changes are authorized by this work.

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

Private service source is published as `Jones-Systems/growth-intel#38`, commit `fd199cd53ef72208bc1dfb7c7ef6e5879d8366a9`; its tests CI is green. No live activation occurred. HQ source remains dependent on the integration foundation and held for integration-owner merge agreement. Existing review branches #105 and #106 remain separate; this candidate does not merge or replace them. Native project chooser and read-only discovery are implemented, but personal project enrollment needs the owner to choose a folder in the installed runtime. Remote Wiki SSH/VPS/Mini transport is unsupported; the implemented manager handles explicit local Git sources and index recovery.

No independent review was required for this bounded source candidate. Coordinator self-review, source invariants and actual runtime evidence are reported separately. No installation, shared-service deployment or elevated command was performed.
