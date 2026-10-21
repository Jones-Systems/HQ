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


## Work calendar and planning screenshot pass

The owner requests short-event title visibility, month→week→day double-click navigation, one coherent calendar view control, cleaner Work chips/toolbar/Glance/timeline, eight-second notifications, and priority setup of real projects and Wiki. The new isolated task branch starts at foundation `3e76fb24d35ac9883f2da0e3b0ab26d47f8cf116`; UI #116 is already merged and is not repeated. The coordinator is sole Git/check owner. Existing review branches and accepted Integration continuity holds remain separate.

Baseline production typecheck/build passed. Collaborative browser at 1280×800 with synthetic Work examples reproduced the 30-minute block's zero-height title and inert month day-header double-click. Private evidence records the source/output correspondence and screenshot. No protected or live source was used. The existing laptop setup prompt was clarified to create/link real workspace projects after discovery, use approved service origins and existing Wiki profiles, and distinguish native setup from browser preview.

The app-owned read-only Opus framing is accepted with one source correction: Social's Undo inverse exists only in its toast, unlike Work's core stack. Keep that inverse reachable independently when the notification expires. Four disjoint builders implement the shared kit, calendar consumers, Work presentation and toolbar/notifications. They do not run shared checks or mutate Git. No new reviewer, shared source writer, service activation or host operation is implied. The existing root hq-ui, Work runtime and Social groups discover the affected tests. Final verification and source landing follow fan-in.

Registration `hq-work-calendar-polish-20261020-registration-1` returned `registration_unavailable`, effect `none`, reason `endpoint_unavailable`; no repair or retry. Pre-implementation Work presentation regressions failed on all three expected seams: missing Overdue heading, missing timeline navigation/range, and visible clipped edge-date text.


Combined verification exercised 84 root files / 1,602 tests. The first run passed 1,600; two old timeline-label assertions failed because the axis intentionally changed to `2026 · Q4`. After updating those literals, the affected 42-test view group passed. The other 83 files passed unchanged. Production typecheck/build passed, and the shared kit's focused 56 tests passed. Existing asynchronous React act warnings and bundle-size advisory remain reported; no checks were skipped to obtain a pass.

Actual production-browser evidence used the matching bundle and synthetic service doubles. At 15/30/45 minutes, titles have positive line height rather than zero, including seven-column Week and dark appearance. Work and Social month→week→day drill-down keep exact dates, including a Social adjacent-month transition; one checked view menu reaches Agenda directly. Toolbar controls fit 1600/1280/760px viewports without document overflow. Glance rows retain title/next-step/trailing boundaries and Overdue heading bounds lie inside its container. Review pills have no bottom border/shadow in light/dark, and selected motivation retains filled state. Timeline navigation shifts four quarters and Today sits below the quarter label with no header pseudo-line. A real routine notification appeared after an example mutation and disappeared after nine seconds while the saved selection remained. Fake timer tests additionally prove pause conditions and Undo persistence.

Only renderer behavior changed in this pass; no native bridge/protocol/host surface changed. No new full-native qualification or personal connection success is claimed. The existing VPS font fallback and installed laptop setup limitations remain. The coordinator inspected the combined diff; no independent review was required. Held review fixes and Integration release/flag gates remain unchanged.


## Populated References alignment pass

The owner reports disorganized header/search/import, collection controls and populated cards. Read-only framing and current source inspection identify a specificity conflict that overrides card-open/quiet/graph buttons, separate header/import rows, unbounded source descriptions, stretched badge rows, duplicate body layouts and a provenance list missing grid display. A production-browser baseline using normally imported synthetic images confirms a 1px inner card border, collection content 32px below the grid and unequal badge heights.

The isolated References branch starts at calendar-polish head `fdbd0da5c7f0477cbd7e2c5c80b73b77cac9bfb4`, preserving the evolving specification and pending parent delivery. Root is sole Git/check owner; one builder owns the bounded References view/styles/checks plus graph header/close and import wrapper. The accepted framing uses one responsive toolbar, an aligned collection/results strip, compact card sources with full details, shared controls and scoped container-responsive panels. Existing import/search/collection/use, rights/caveat, storage and collapse behavior remain required. No shared panel implementation or service/host change is scheduled.

Registration `hq-references-alignment-20261020-registration-1` returned `registration_unavailable`, effect `none`, reason `endpoint_unavailable`; no repair or retry. The inherited specification uses historical markers rejected by the current section parser, so exact heading line ranges were read without relabelling the artifact.

Verification passed: References rendered checks 10, sections rendered checks 3, affected References/sections Node checks 179 with no skips, both Design typechecks and production typecheck/build. A final CSS-only build covers the last scoped control-height correction. Existing bundle-size advisory remains. Browser uses normally imported generated images, including a long app source; six window widths from 768px to 1920px pass in light/dark without document or References overflow. Card titles/source/status/footer coordinates align within each row, inner open-button borders are zero, search/Import are both 30px, and new-collection input/Add are both 24px. Search, create collection, Use, detail focus/return, collapse/restore, complete provenance, narrow/wide import form and invalid-raster feedback were exercised. The final one-line CSS correction was loaded from its freshly built stylesheet into the existing candidate runtime; the unchanged JSX bundle and exact style URLs are recorded in private evidence.

This remains renderer verification with synthetic data. Browser-only fake storage resets on reload; persistence and live/native connections are not inferred. No native bridge, service, host or installation changed, and the existing full-native holds remain. Private screenshots/evidence stay outside publication. No independent review was required for this bounded presentation pass.

## Insets and selection-stability correction

The assigned builder is sole Git owner of `work/hq-ui-insets-stability-20261021`, based on foundation `f59f666dae511cf9abb826f68e5ad719eb8afd12`. Root retains continuity and delivery. The accepted existing-system correction covers rail label space, continuous Design panel drag, References image lifecycle, Interactive control grouping, Work edge gutters/empty state/full-height board scroll, and separate Agenda plus Month→Week→Day controls in both Work and Social. The 120px sidebar floor and existing medium spacing token are bounded layout choices; no tokens, storage shapes, services or execution behavior change.

The ready framing uses Codex-V3 `ecf72e1c8d165ea60f4ae947ec5fe560f05c4f8e` and Frontend-Development `76c9d22500ad81624eb3d06c78e822aabdf32a14`, with the canonical edge-gutter update at `9a01d7131a057aee382c78485a2610eeba689b54`. HQ shared-guidance enrollment remains unavailable at this base. Runtime evidence identifies Astra/high for this implementation; inherited mode is Claude Frontier temporary personal revision 3. Shared CSS and state effects require one cohesive writer; no children or reviewers are launched.

PR #105 retains its original source/finding owner. This correction changes Calendar presentation directly on the verified foundation, with no cherry-pick, adoption or transfer of that review candidate, and no changes to raw Area, unknown-save, link or store fields. The root recorded the overlap and retained holds in issue #50. No old owner wake or reassignment is requested.

Baseline production typecheck/build passed. A synthetic production-harness render reproduces zero Work top/right insets and a 188px board scroller above unused viewport space; the Interactive heading and toolbar gaps also reproduce. Deterministic regressions fail before the corrections for the sidebar's 180px clamp and thumbnail-node removal on selection. After implementation, Design panel Node checks (47) and chrome rendered checks (14, including continuous pointer samples, release/cancel/restore) pass. Candidate-wide verification and final evidence follow below; this is not an integration or installed-app claim.

Final affected verification: 234 Design UI/References/sections/Interactive Node tests; 14 Design chrome, 14 References and 4 sections rendered tests; 399 Work navigation/board/views, Social content and shared-kit tests. All passed. The final enlarged-calendar control change passed its 186-test affected subset; the final CSS-only tray wrapping repair passed production typecheck/build and browser geometry. All three affected Design typechecks and both static evidence builds passed. Tests/builds ran serially after fresh capacity admission; no admission sample exceeded the 85% stop threshold. Existing React act diagnostics and bundle-size advisories remain, without failing checks. Diff whitespace validation passed.

Browser evidence uses the matching production renderer/static fixtures. Work keeps 12px gutters at 760/1280/1440 with the toolbar both visible and hidden, including the bottom endpoint. The blank board at 25/50/90% height hits the full-height horizontal scroller; actual horizontal wheel and keyboard movement passed. Real lanes retain their natural heights. Shared StateView grouping was inspected in Work and empty Social Library; source discovery found no direct Design/Wiki StateView consumers at this base. Their custom states and other shared consumers remain unverified.

References initially retained image nodes but still moved cards by 392.8px below the 1100px breakpoint because detail height and repeated focus scrolling changed. Bounding the narrow details body and scrolling only on first open corrected it. The 1099/1100/1440 light/dark matrix shows zero card movement, removed images or repeated reads. Both the three-card final fixture and a four-card fixture with an explicitly imported synthetic image were inspected. 320px References reflow and 760px text-spacing overrides have no horizontal overflow. Its 200% text details endpoint remains reachable.

Primary rail keyboard widths from compact 64 through expanded 280 keep the correct track geometry. Design pointer rendering and deterministic release/cancel/restore checks pass. Interactive groups wrap at the requested wide/intermediate/narrow widths without stretching or horizontal overflow. Work and Social calendar buttons cycle through Month/Week/Day and return from Agenda to the selected grid/date. 200% text exposed fixed-height clipping in the new buttons and intrinsic-width overflow in Work's calendar tray; scoped height/wrapping corrections address those observed cases. The checked scroll endpoints remain reachable. Broader enlargement of unchanged compact controls, physical shift-wheel/touchpad hardware, all native DnD combinations, installed Electron, private sources and live-service journeys remain unverified. No gallery export applies; no private capture is published.

Registration request `hq-ui-insets-stability-20261021-registration-1`, expected revision 0, submitted the specification digest `265c59a3b915ccbc41b76d389f2675915bdefa607e5be12e39bd45f7401c3811`. The private route returned `registration_unavailable`, effect `none`, reason `endpoint_unavailable`. No repair or retry occurred. Exact invocation identity, source/build hashes and evidence remain private. Source publication is authorized; qualifying merge stays with root. This lane performs no merge, installation, release or deployment, and stops only its own temporary preview processes at handoff.

Published as open, non-draft [PR #127](https://github.com/Jones-Systems/HQ/pull/127) against `work/hq-foundation`, with native thread linkage. Runtime source is recorded by `defbe35`; the initial source/docs candidate is `58876be`. Foundation advanced through #126 during verification; its preview-host and integration-note paths are disjoint from this candidate. No rebase, adoption or merge occurred. Root receives the exact published head and retains CI qualification/merge; this record is a source-publication claim only.

### Same-source enlarged-calendar follow-up

Root's visual inspection identified an overlooked overlap in the saved 200% calendar capture. That capture followed the tray-wrapping build; the published candidate still reproduced the left Agenda/period content extending about 81px into the Unscheduled tray. The earlier zero-document-overflow result did not prove column separation, and its broader visual conclusion is superseded here.

The bounded correction constrains the left calendar, period and Agenda grid tracks to their allocated widths and wraps Agenda title/time content. It retains the existing columns, splitter, spacing and all actions. The rebuilt synthetic fixture at 760/1280px and normal/200% text has a 10px gap between the main column and tray, zero descendant-element or text-range intersections with the tray, zero tray overflow and 24px outer fixture gutters. Long titles, relative dates, 10:30/18:00 time labels and both unscheduled items are included. Fresh normal and enlarged screenshots were actually inspected; private artifacts retain source/build hashes and the full rectangle measurements. Browser cycling and Agenda return preserve the selected grid. Work-view tests pass 110/110, production typecheck/build and static harness build pass after fresh capacity admission, one serial process. No merge/install or additional lane is involved; root retains current-head CI qualification.

## Dark palettes and shared control styling

The owner chose all four theme-study palettes as switchable, editable Settings presets and Warm Graphite's control styling as the one standard for every palette, light and dark; Slate's side stripe is rejected. The palette implementation lane is sole Git owner of `laptop/hq-palette-settings-20261021` from `716e2845a720faf129ad209afa3c4a81438d193a`; a parallel lane separately owns flows, references and compact rail sizing, and root owns integration, checks, native verification, publication and install.

Decisions are in [the specification](../engineering-specs/hq-ui-modernization.md#dark-palettes-and-shared-control-styling). Only first-party palette hex values entered public source; the study's website capture, page and private paths did not. Guidance used: Codex-V3 snapshot `2586105d5448cc0406305112773bc9f2` and the cached Frontend-Development guides at `9a01d7131a057aee382c78485a2610eeba689b54`; HQ shared-guidance enrollment is unavailable at this base.

Under root's host coordination, this lane ran only the stdlib token generator/check and static inspection. Unit, App journey, typecheck, build and headless capture checks are deferred to root's integrated candidate and are not claimed here.
