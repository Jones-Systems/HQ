# HQ consistent interface and timed planning

Artifact Type: engineering-spec
Artifact ID: spec.hq-ui-modernization
Purpose: Apply the owner's screenshot corrections consistently across HQ and persist timed Social planning through its owning service.
Governing artifact: spec.hq-bootstrap
Specification owner: HQ UI modernization coordinator
Consumers: Shared shell, Design, Social, Work, Wiki and Social service implementation lanes
Authority effect: none

<!-- codex-section:begin id="spec.hq-ui-modernization#ctx.outcome.001" -->
## Project summary

HQ uses one modern application visual language based on the existing Design surface: cool neutral surfaces, restrained blue selection/accent, compact sans-serif interface text, and consistent fields/buttons with accessible states. Extend `@hq/ui`; do not create another component system. Captured artwork, producer previews and exports retain their own appearance.

The oversized repeated domain/project header is removed. Main navigation remains available, can be dragged down to icons, and keeps connection status/settings/appearance visible in a viewport-bound footer. A compact workspace footer replaces the hard-coded header context. Design's top tab row remains compact and fixed. Every other secondary sidebar/inspector can be dragged fully closed and restored. Scrollbars are visually hidden while all scrolling methods continue to work.

Month, Week and Day calendars support planning. Work uses its existing planning-date contract; Social gains an explicitly advertised service capability for persisted times. Assigning a time starts with a 30-minute block. Moving and edge/corner resizing commit only on drop; resize is available in Week and Day. Calendar actions never post content, dispatch a request or launch a run.

Source delivery ends in checked PRs. Integration and installed application verification remain distinct. No live service deployment, OS administration, credential handling or private-data publication is granted by this specification.
<!-- codex-section:end id="spec.hq-ui-modernization#ctx.outcome.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#ctx.research.001" -->
## Research and decision basis

Direct source and owner screenshots establish three competing existing palettes: shell/Design, `@hq/ui` Social/Work, and Wiki. The documented visual-system proposals were not fully connected to shell code. The owner explicitly prefers Design over the older warm, monospace-heavy direction; that later instruction controls the shared token update. Fonts use available system fallbacks; no new bundled font dependency is required.

The shell's generic `main` padding produces the large Social/Work top gaps; its minimum-height layout lets the rail footer leave the viewport. Native controls also escape styling inside Design because its reset reverts select styles. The production-source audit found native control sites across every domain; a scoped common baseline prevents omissions, while important actions use existing shared primitives. Specialized cards/chips/toggles keep their own semantics.

`SectionFrame` currently exposes development lane/source paths. Replace those with concise truthful non-real-data badges and an optional data-details disclosure. Do not present fixtures as real data or hide held capabilities. Requests and Runs retain all no-send, simulation, busy and unknown-result behavior.

Native project catalog IPC and a renderer adapter already exist. Bridged composition incorrectly uses a fake catalog. Wire native selected-root discovery and catalog caching; never seed personal project names into public source. Source cards open read-only detail rather than pretending to contain captured workspace versions. Browser examples stay explicitly synthetic.

Social currently persists only `planned_date`. Client validators/response guards strip additional fields and main validates closed keys. The owning service must advertise complete timed-planning support before HQ sends timeboxes; unsupported service versions must not silently accept and discard them. Work's distinct planning-date model stays Work-owned; neither calendar copies the other's data.

Wiki's unavailable-index screenshot is not network-connectivity evidence. Current Wiki sources are explicit local bare-repository profiles, and reader methods cannot configure or refresh them. Connection UI must distinguish service configuration, service reachability, local source/index state, and unconfigured remote hosts. Management belongs behind separate closed native capabilities; reader methods remain unchanged. The accepted refinement adds feature-negotiated service slots and separate native Wiki administration; neither changes the reader API or adds SSH.
<!-- codex-section:end id="spec.hq-ui-modernization#ctx.research.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#req.interface.001" -->
## Interface and compatibility requirements

- Preserve `hq.appearance.v1`, cycle Light → Dark → System → Light, and keep live OS-following in System mode.
- Preserve the local context identity and existing storage keys; display a plain label such as Local projects instead of implying a shared project registry.
- Primary rail compact width is 64px, with accessible names and tooltips. Width and restore size persist safely. Secondary panels retain their compatible state shapes and remembered expanded width when collapsed.
- Shared `Splitter` accepts `label`, `value`, `min`, `max`, `onResize`, optional `onToggle` and `side: start|end`. It emits widths, supports pointer cancellation, keyboard arrows/Home/End/Enter and double-click restore. Collapsed grips remain focusable.
- Ordinary native form controls receive consistent modern styling without leaking into preserved/captured content. Disabled, invalid, focus and busy states remain visible and accessible.
- Service URLs are entered explicitly. Existing saved endpoint values never need to be exposed to renderer code. Color-coded status also includes words and accessible labels; recheck/reconnect uses icon controls with tooltips.
- Real project enrollment starts only with a native chooser. Forgetting a root removes enrollment, never source files. Missing preload/root/read failures show truthful unavailable/empty states, not synthetic fallback.
- Service-backed Social slots, capability negotiation, additive migration, date/slot atomicity, timezone validation, stale-version protection and old-client omission behavior must agree across the HQ and service PRs. The owner-selected default is 30 minutes; no local-only timebox overlay is accepted.
- Mutations retain version/revision conflicts, explicit Undo and unknown-result reconciliation. No automatic resend or second mutation occurs after an uncertain outcome.

Social advertises `features: ['hq-editorial-timebox-v1']` only when timezone data is available. `planning_slot` is null or exactly `{start: HH:mm, duration_minutes: integer, timezone: IANA}`. Start and duration snap to 15 minutes, duration is at least 15 and ends by midnight. The service validates the start and final occupied minute for skipped/repeated times and offset changes. Date and slot save in one version-guarded update. Explicit null clears; old-client omission preserves an unchanged-date slot, clears with an empty date, and preserves a changed-date slot only if still valid. New clients never send timeboxes to unsupported services. Unknown saves compare the canonical slot during a read-only reconciliation. The synthetic conformance fixture is shared as authored data only. Python rejects a JSON `30.0` duration; JavaScript has already normalized it to integer 30 when parsing and sends canonical 30. The fixture records that lexical representation difference explicitly.

Wiki administration uses the same sender gate on a separate closed channel. Native choosers issue single-use tokens held in main; renderer payloads cannot provide paths. Config writes use a revision digest and uniquely created atomic temp file, with exact owned cleanup. Runtime recovery retries rejected opens, retains usable stale indexes, and serializes reopen with reader calls. Importing a source profile and explicit reindex/recheck never claims VPS/Mini transport. Social/Work reachability requires an explicit read-only check; passive sanitized configuration status says configured, not checked. Checks time out after 10 seconds and never persist endpoint values into the renderer.
<!-- codex-section:end id="spec.hq-ui-modernization#req.interface.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#impl.ownership.001" -->
## Exact change surface and ownership

One coordinator is sole Git owner of the HQ implementation worktree. Disjoint source writers share that worktree under these explicit assignments; only the coordinator runs installation, tests/builds, generators outside a writer's cone, staging and publication.

| Lane | Owned source surface | Consumer and indirect effects |
| --- | --- | --- |
| Shared system/shell | `packages/hq-ui` tokens/components excluding references; desktop App/state/styles/module/service wrappers | All mounted domains consume the shared styling; root coordinates generated-token documentation copies and integration tests |
| Design | Design UI chrome/panel model, composition frames except Projects, request/run presentation, assigned section controls | Preserves existing session shape and captured content; avoids run pipeline and project controller review branches |
| Domain presentation | Social nav/layout and assigned CSS; Wiki UI/domain CSS | Shared Splitter and palette; no Social calendar/core or Wiki management writes |
| Work | Work presentation, calendar/time-grid/move helpers and focused tests | Existing Work store and date validation own persistence/recovery; no protocol changes |
| Real projects | Bridged discovery/workspace composition, Projects view/gallery read-only detail, minimal registry wording | Native catalog routes and allowed persistent cache; no renderer filesystem path input or source modification |
| Connections/Wiki management | Desktop Connections/ServiceSettings, closed wiki-admin contract/IPC, wiki runtime recovery and tests | Native configuration/index state; separate from unchanged reader API |
| Social timed planning | Social core/live/content calendar and desktop Social slot allowlist; private service State/server and tests | Shared TimeGrid, versioned service-backed slots; owning service remains in its own repository |
| Secondary panels | Internal Design Canvas/Components/References/project detail/Compare, Social Library/workbench, Wiki secondary search/filter controls | Shared Splitter, zero-width restore grips, mounted editor buffers |

No writer changes root manifests, dependency locks, CI or unrelated source. New tests use existing discovery patterns/check-group membership; any needed catalog change returns to the coordinator. The coordinator preserves non-overlapping source changes and reconciles shared type/stylesheet effects before final checks.
<!-- codex-section:end id="spec.hq-ui-modernization#impl.ownership.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#test.acceptance.001" -->
## Acceptance and verification

1. Appearance cycle, persisted layout, short/tall-page footer visibility and icon-only rail work with mouse and keyboard. No oversized redundant header or Social/Work top gap remains.
2. Secondary panels drag fully closed and restore their widths; collapsed grips and existing shortcuts remain usable. Hidden scrollbar chrome does not disable scrolling.
3. Every mounted domain has consistent controls in light/dark. Requests/Runs empty and selected states are clear; developer source paths do not appear. Synthetic and unavailable states remain truthful.
4. A native bridge double proves real catalog selection/refresh/forget and read-only source detail. Personal root enumeration is runtime evidence only and is not committed. Browser-only limitations are explicit.
5. Calendar tests prove 30-minute assignment, day/week navigation, move/resize/Undo, one atomic save on drop, conflict refusal, unknown recovery, no execution, zone/DST boundaries and service persistence across restart. Old date-only records remain valid; unsupported service capabilities cannot fake a timed save.
6. Connection tests distinguish configured from reachable and index-ready from host-connected. Native source setup/refresh respects selection, privacy, concurrency and close lifecycle. Failures provide useful recovery actions without claiming unproved VPS/Mini connectivity.

Run the deduplicated affected checks on the final candidate, including root typecheck, root tests/build, Design section check groups, Wiki and Social service focused suites. One serial process runs after fresh capacity admission. Changed test scratch uses task-owned roots with success/failure/cancellation cleanup; no shared `/tmp` accumulation. Preserve evidence outside scratch before cleanup. The initial baseline root typecheck passed.

Use the collaborative browser for actual interaction and screenshots, with synthetic evidence only. Check themes, compact/wide layouts and meaningful flows. Native Electron capture and installed laptop operation remain separate claims and use their qualified routes when available.
<!-- codex-section:end id="spec.hq-ui-modernization#test.acceptance.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#ops.delivery.001" -->
## Delivery and operational boundary

The desktop exists on the integration foundation, not on main. HQ changes use a scoped dependent PR against that foundation. The owner explicitly authorized merging the green UI and Social service PRs and directed future green task PRs to proceed without another confirmation, subject to native protections and readiness checks. The Social service source extension is published in its owning repository. Preserve exact head/check evidence and register the PRs with the native thread. Foundation-to-main integration and installed rollout retain their own readiness requirements.

Source compatibility does not prove that either installed runtime supports the feature. Service activation, app installation and remote host setup require their existing separately authorized routes. If those are unavailable, report the exact remaining effect and source capability honestly; do not replace service-backed storage with a local overlay or call an unconfigured host connected.
<!-- codex-section:end id="spec.hq-ui-modernization#ops.delivery.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#impl.refinement.001" -->
## Calendar, Settings and real-reference refinement

Owner follow-up screenshots establish two distinct calendar defects: both production example selectors omit the existing editorial-timebox feature, while stretched grid tracks distribute the undated tray across the full height. Advertise the capability explicitly for fictional window-local examples only; preserve legacy/live capability gating and service-backed saves. Keep storage clocks in HH:mm while displaying 12-hour labels, cycle Month → Week → Day through one button, retain separate Work Agenda access, and verify scrolled drag assignment/movement, resize and Undo without execution.

Settings becomes a full workspace page with category navigation, compact header, responsive shared rows and a return action. Preserve the mounted domain and its drafts, destination and reference context while hidden. Initial categories are Data sources and Appearance; existing privacy, explicit connection checks, endpoint reload guidance and Wiki confirmation/CAS remain in force. Source rows explain application-data connectivity rather than implying device or environment connections. The rail uses one aligned row geometry, a compact source summary and side-by-side Settings/Appearance actions when wide.

References presents one useful empty state and a real selected-raster import. The existing sandboxed file chooser and closed blob storage suffice; no new IPC, host privilege or network acquisition is needed. Validate actual PNG/JPEG/WebP bytes, bounded dimensions/size and decode before import, retain provenance and unknown rights, and verify persisted digests before data-URL previews. Library persistence and graph adoption are separate effects: a failed graph update after a saved screenshot is reported as partial success. Native source catalog cards, saved design screenshots and interactive applications remain distinct. A private laptop-agent handoff covers owner-selected source folders, genuine captures and explicit service setup; no personal data enters this public repository.

Current source findings correct two framing assumptions: catalog thumbnails live under `.hq/preview.*`, and direct raster import can reuse existing blob routes without the proposed new packet IPC. The accepted full-page Settings/rail direction came from a read-only Opus contribution; these corrections come from direct source investigation. Shell, calendar and References writers have disjoint cones under one coordinator/Git owner. Only the coordinator runs tests/builds or updates root artifacts.

Acceptance adds full-page Settings/return-focus/draft retention, matching rail bounds at compact/wide sizes, source status truthfulness, 12-hour/cycling calendar controls, actual selected-image persistence across environment rebuild and browser interaction. Run root tests/build plus affected References, sections and composition checks serially after admission. Capture the production renderer using synthetic test data; personal project enrollment and installed laptop verification remain separate.
<!-- codex-section:end id="spec.hq-ui-modernization#impl.refinement.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#impl.work-calendar.001" -->
## Work calendar and planning polish

The next owner screenshot pass prioritizes real laptop setup alongside bounded renderer fixes. The existing native project/source and Wiki administration routes suffice for the documented setup sequence; source discovery alone does not create workspace projects. The private laptop handoff now explicitly creates and links the genuine workspace projects and verifies selected captures. No service activation, private-source import, host mutation or installed-app success is implied by this renderer pass.

Direct production-renderer evidence reproduces two defects: a 24px, 30-minute event gives its title zero height while the time consumes 16px, and a month day-header double-click leaves the month unchanged. Short event density will use each visible segment's duration: tiny segments prioritize the title alone, compact segments prioritize the title before optional time, and taller segments retain stacked title/time. Full labels and moving-time previews remain available. Month header strips drill to the selected week; week headers drill to that day. Pointer single clicks remain inert, keyboard activation provides the same navigation, and capture buttons/all-day drop lanes stay independent. Navigation never writes planning data.

One checked view menu replaces the adjacent cycling/Agenda controls. Work offers Month, Week, Day and Agenda; Social offers Month, Week and Day. Switching preserves the selected date, remembered Work view and narrow-screen default. Current-month selection uses the remembered day, then today, then the first of the month. Calendar headings receive focus after drill-down. Menu radio semantics are additive to the shared kit.

Work chip groups use separate soft filled choices with visible pressed/focus states; remove nested borders, inset bottom lines, dashed motivation borders and off-state strikethrough. Preserve kind shapes, meaningful color, accessible words and forced-color affordances. Keep the board layout and both board modes. The toolbar uses inline filter labels, an accessible compact collapse action and container-based rows/grid; capture behavior remains unchanged. Glance rows group each title, secondary next step and trailing metadata coherently, with distinct day headings and a contained Overdue group. Grouped dates display kind/time without repeating their day; overdue dates retain their full value.

Timeline quarter labels and Today occupy separate header bands. Row tracks carry a faint Today line; clipped edge markers retain date meaning in accessible labels/tooltips and the date column. Earlier/Today/Later navigate by four quarters through a remembered view offset. Stored precision, horizon patches and the rule that bars require explicit start/end bounds are unchanged.

Routine success notifications dismiss after eight seconds, pausing independently for hover, focus within and hidden documents. Shared Toast defaults remain persistent; errors, refusals, unknown outcomes and store notices do not expire. Work's core Undo and keyboard shortcut survive notification dismissal. Social has no equivalent core Undo stack: preserve its latest inverse separately and expose a compact calendar toolbar Undo action after the notification disappears. Each inverse remains bound to the saved revision and existing conflict/unknown guards. Correct the previous categorical Toast timing comment without asserting accessibility certification.

The accepted read-only Opus framing supplies the visual direction. Direct source evidence corrects its assumption that Social shares Work's keyboard Undo. Four writers have non-overlapping cones under one coordinator/Git owner: shared kit; Work/Social calendar consumers; Work Glance/timeline/chip CSS; Work toolbar/notification consumers. The coordinator owns artifacts, check-group metadata, test/build execution and delivery. Preserve the root Calendar drag-end guard, the separate Timeline root guard proposal, raw Area semantics and all existing integration holds; this pass does not adopt competing review fixes.

<!-- codex-section:end id="spec.hq-ui-modernization#impl.work-calendar.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#test.work-calendar.001" -->
## Work polish acceptance

Production browser confirms readable titles at 15/30/45 minutes in seven-column Week, exact month→week→day drill-down and no capture-button navigation, one view control with stable anchors, wide/narrow toolbars and Glance rows, clear timeline labels/offset navigation, and light/dark chips without heavy bottom edges. Fake timers prove eight-second expiry, overlapping pause conditions, cleanup and persistent errors; consumer tests prove Undo after notification expiry. Run the deduplicated root affected test union, typecheck and build serially, then capture the actual served production bundle with synthetic fixtures only. Personal laptop connectivity and full-native acceptance retain their separate gates.
<!-- codex-section:end id="spec.hq-ui-modernization#test.work-calendar.001" -->


<!-- codex-section:begin id="spec.hq-ui-modernization#impl.references-alignment.001" -->
## Populated References alignment

The populated-library pass aligns the heading, search and import trigger in one responsive toolbar. Import feedback and its metadata form expand below the toolbar without squeezing its controls. Collections receive a labelled collapse strip aligned with the results summary; collection creation, selection, deletion, resizing and remembered collapse remain compatible. Narrow layouts move secondary content into full-width rows instead of compressing the cards.

Reference cards use a consistent image, two-line title, compact source, evidence/rights, caveat and footer hierarchy. Long source descriptions remain fully available in the detail panel and accessible labels; card actions share a baseline. Shared controls replace mismatched local buttons. The existing generic button selector must not override card-open, quiet or graph-row styling. Remove duplicate dead body-layout rules and make provenance a real grid. All rights/caveats, reload/fenced state, no-project state, import mutation guards and full provenance remain intact.

The source cone is the References view/stylesheet/rendered checks, graph header/close control, and an import workflow wrapper. Shared panels, shell, protocols and services remain owned by their existing lanes. The coordinator owns the worktree, documents, checks and publication. This slice starts at the exact calendar-polish parent head because it continues this evolving specification; it lands after that parent and does not repeat its source changes. No native installation or live connection setup is implied.

Verification uses synthetic references with short and long titles/source text, generated image bytes, expanded/collapsed collections, details and import states, light/dark appearance and wide/narrow content widths. Browser measurements must show no unintended inner card border, readable provenance, consistent title/action rows and no page overflow. Focused References/sections checks and production typecheck/build cover the final candidate. Actual owner screenshots and project metadata are not test fixtures or public evidence.
<!-- codex-section:end id="spec.hq-ui-modernization#impl.references-alignment.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#impl.insets-stability.001" -->
## Insets and selection stability correction

This accepted existing-system correction supersedes the earlier checked-menu requirement: both Work and Social now have separate Agenda (left) and Month → Week → Day cycle (right) buttons, with the existing small spacing token between them. The cycle returns from Agenda to its last grid without advancing. Work keeps its existing persisted mode and date keys; Social keeps its existing in-session grid state. View changes never write planning data or launch work.

The primary rail reserves only its actual icon and label tracks; compact mode remains at widths up to 95px. Design's secondary sidebar rests at 120px or wider. Pointer movement is transient and continuous; release below 60px collapses while retaining the previous open size, and release between 60px and 120px settles at 120px. Keyboard shrinking stops at the floor; Home collapses and Enter restores. Inspector bounds and persistence shapes are unchanged.

Reference preview identity follows asset metadata, with bounded caching, deduplicated pending reads and stale-completion guards. Selecting another card retains loaded image elements. Genuine media replacement reloads, and deleted/unavailable media cannot publish late. Below the existing 1100px container breakpoint, the details body uses a bounded scroll region so different detail lengths cannot move the card grid; first-open movement is retained, subsequent selection does not scroll the outer page.

Interactive source, viewport and actions form compact wrapping groups using existing tokens. Work owns a medium gutter on all four content edges, including the bottom at the scroll endpoint. Empty-state glyph/title/description form one group with a larger action separation; Work removes redundant inline state padding. Status columns own the remaining board height for horizontal wheel/keyboard access while visible lanes keep their natural height. Navigation, drag/drop, scroll restoration and backend contracts remain intact.

Guidance pins: Codex-V3 `ecf72e1c8d165ea60f4ae947ec5fe560f05c4f8e`; Frontend-Development `76c9d22500ad81624eb3d06c78e822aabdf32a14`; canonical website edge-gutter update `9a01d7131a057aee382c78485a2610eeba689b54`. Gallery/export is not applicable. The single assigned writer owns this correction on the verified foundation; PR #105's separate source/finding ownership and holds remain. Its raw Area, unknown-save, link and store behavior are outside this correction.

Acceptance uses deterministic pointer/cache/calendar regressions and actual production-renderer synthetic fixtures. Record light/dark, breakpoint widths, selection geometry, blank-board scroll and 200% text observations per entry in the partial UI map. Native Electron, private data, live services and installed rollout are separate gates. Root retains qualifying merge; this implementation lane publishes an open source candidate only.
<!-- codex-section:end id="spec.hq-ui-modernization#impl.insets-stability.001" -->

<!-- codex-section:begin id="spec.hq-ui-modernization#impl.dark-palettes.001" -->
## Dark palettes and shared control styling

The owner selected all four theme-study palettes (Slate, Warm Graphite, Harbor, Sage) as switchable, editable Settings presets, and Warm Graphite's control styling as the single standard. Every palette shares one geometry: filled selection with selected text and weight, an 8px control radius (`--hq-radius-control`), secondary controls with their own fill, edge, hover, pressed, focus and flat disabled states. No palette carries its own radius, stripe, outline or other geometry. The selected-domain inset stripe and Design section stripe are removed; tabs, segmented toggles, Settings categories and pressed buttons use the same fill. Light, Dark and System remain an independent mode; a palette applies only while the resolved theme is dark, and light mode keeps the generated light tokens with the same control styling. Warm Graphite is the initial dark palette; a stored appearance mode is never changed.

`@hq/ui` owns preset values, labelled editable roles, deterministic derived roles (hover/pressed overlays, skeletons, soft tints, text selection, scrim) and the role-to-`--hq-*` mapping. The desktop appearance module owns the `hq.palette.v1` local preference (`{version, preset, overrides}`), Settings › Appearance and application. Only validated canonical `#RRGGBB` overrides are stored, separately per preset; reading is tolerant per field, and the preference is written only after an explicit change, so a malformed or older value is never overwritten implicitly. A failed write keeps the change for the session and is reported beside the editor. Values reach the page only through CSSOM on `<html>` (no stylesheet text, no user CSS) and are removed in light mode. Low-contrast custom colours stay as entered with an adjacent ratio and target; presets meet every declared text (4.5:1) and control/focus (3:1) pair.

Architecture and hidden-impact screen. New persisted shape: one versioned local key owned by the appearance module; existing appearance, rail and navigation keys and `state.ts` logic are unchanged. Cross-module boundary: modules continue to consume only `--hq-*` roles, so Social, Work and Design follow the palette without new imports; Design chrome's kit mode already reads the kit roles. Component roles resolve where declared, so the generated tokens also re-declare them under `[data-hq-token-scope]` for the Settings preview. Inline roles on `<html>` replace the `light-dark()` pairs there, so nested light subtrees are unsupported (already a kit limitation). Preserved content keeps its invariant `--hq-artwork-*` matte and scheme rules; embedded documents do not inherit custom properties, and no filter, forced colour or script reaches captures or previews. Module-owned selection treatments outside this cone (References cards, project versions, compare toolbar, Work segmented and pill toggles, Interactive modes, request steps) keep their accent outlines until their owners adopt the shared fill; Social and Work navigation lose their visible stripe because their indicator role now equals the selected fill.

Affected checks: `hq_tokens.py check`; `hq-ui` (tokens, contrast, styles, palettes); `hq-root-build` (appearance unit and App journeys, existing App/Settings tests); `design-ui` (stylesheet scope); typecheck and production build; synthetic headless captures of four palettes and the editor at normal and narrow widths. Native Electron, installed app and owner-profile verification remain root gates.
<!-- codex-section:end id="spec.hq-ui-modernization#impl.dark-palettes.001" -->
