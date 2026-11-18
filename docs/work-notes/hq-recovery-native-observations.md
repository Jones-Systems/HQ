# HQ recovery native observations

Artifact type: work-note
Artifact ID: work.hq-recovery-native-observations
Purpose: Record the finite native observations needed to qualify the recovered user flows.
Owner: HQ recovery coordinator
Consumers: Acceptance executor and integration owner
Authority effect: none

## Evidence and execution boundary

Section ID: work.hq-recovery-native-observations#evidence

This sheet prepares observations; it records no execution or passing result.
Its source references were inspected at `81b12a976f659e00194a828891b5100d1991ea94`.
The executor must bind results to the actual assembled commit and fresh Apple
Silicon Mini build inventory. Changed source makes prior observations historical.
Hosted source checks, mockups, renderer captures and source-authored tests do
not establish native process, preload, storage, focus or overlay behavior.

Use only owned synthetic profiles, committed invented Wiki fixtures and the
existing disposable Planner/Social services. Execute after current admission
and controller/native prerequisites are satisfied. Retain the first failure;
do not rerun until green without a recorded correction or changed prerequisite.
This sheet grants no permission to enable a capability. Preserve the original
twelve reserved acceptance rows, their subset/full outcome meanings, HQ07's
image/native chooser hold and HQ09H's distinct-host hold.

Signing, installation, deployment, private Wiki access, live posting, export
enablement, generation and component execution retain their existing holds.
Settings Updates is a presentation observation only; do not download, schedule,
activate or restart an installed application. A missing permitted native preview
holds M12 alone. Browser evidence may supplement these rows but cannot pass M12.

## Record required for every observation

Section ID: work.hq-recovery-native-observations#record

Store detailed evidence privately outside public source. Public summaries must
contain no machine addresses, account/session identifiers or private content.
Expand a row into named sub-observations when its routes or states differ.
For every row and sub-observation record:

| Field | Required value |
| --- | --- |
| Identity | Row ID, requirement and exact assembled commit; fresh build inventory identifier/digest |
| Setup | Actual route and initial state; synthetic profile/corpus/service fixture IDs and relevant item/request versions |
| Geometry | Actual outer window **and** content/container sizes in CSS pixels; display scale/zoom |
| Preferences | Text scale/spacing, Light/Dark/System and resolved theme, reduced-motion media and shell override |
| Procedure | Actual native input/action, expected result and observed result |
| Evidence | Private screenshot/interaction/ledger references; exact mockup pair where applicable |
| Timing | Execution duration and queue-inclusive elapsed time separately; observation time with Eastern abbreviation |
| Custody | Observer, owned process/profile/scratch identities, cleanup outcome and retained evidence |
| Disposition | UNRUN, PASS, FAIL, HELD or INCONCLUSIVE, with limitation and prerequisite/cause |

Use UNRUN until attempted. HELD identifies an unmet named prerequisite, not
passing behavior. FAIL retains the actual mismatch; INCONCLUSIVE records why
the evidence could not establish the result. No row inherits PASS from another
shared consumer. An overall AC2 claim requires N01–N03 as well as the existing
integration evidence. Individual useful rows do not imply full acceptance.

## UI observation matrix

Section ID: work.hq-recovery-native-observations#ui

All rows start **UNRUN**, including their unvisited entry points. M12 becomes
HELD if the already permitted native preview binding is unavailable.

| ID / requirement | Route, fixture and reference | Action and expected observation |
| --- | --- | --- |
| M01 · F1/F7, AC5 | Fresh owned profile; shell onboarding in every domain. [Getting started](../ui-map/getting-started.md). | Observe expanded panel, fold to pill, Hide with Undo, hidden-state process restart, palette reopen and narrow initial pill with explicit reopen. Source links open the intended Settings category. Service ledger has no writes from navigation/onboarding. |
| M02 · F1/F7, AC5 | Design, Social, Work and Wiki; [UI index](../ui-map/README.md), [Work](../ui-map/work.md), [Wiki](../ui-map/wiki.md). | Choose a distinct valid nondefault destination in each domain, switch among all four, then restart the process. Inspect actual mounted destinations and domain context, including Work `board/week` and a logical Wiki search/page. Reading stored destination strings is insufficient. No work launches. |
| M03 · F6/F7, AC1/AC5 | Existing [Planner–Wiki scenario](../../tests/acceptance/scenarios/references.mjs), committed synthetic corpus and captured Work item. | Save one reference PATCH, open its available title/status and return to the originating item. Exercise long readable targets, Back label/focus and permitted unavailable fallback. Opening/return changes no item and creates no Social writes; shell return and module history retain their separate ownership. |
| M04 · F1/F2/F6/F7, AC6 | Every domain, Work board/detail/capture, Wiki history edge, Settings, active toast. [Work](../ui-map/work.md), [Wiki](../ui-map/wiki.md), [Settings](../ui-map/settings-data-sources.md). | Use native Cmd+K in each domain, Cmd+1–4, Cmd+, and eligible Cmd+[. Verify typing, modal and already-handled event guards. Exercise Work Alt+arrows including Inbox Alt+Left without unrelated navigation/write; Wiki Alt+history edge leaves shell return available. Observe Escape/focus restoration, Tab order and F8 active-toast focus. Calling handlers alone does not prove native shortcuts. |
| M05 · F1/F6, AC6 | Settings Appearance and rail cycle, then shell, Design, Social, Work and Wiki. [Appearance](../ui-map/settings-appearance.md), [Settings design](../design/settings/hq-settings-design-20261103.md). | Light/Dark/System selection and rail cycle agree; System follows both actual light and dark settings across restart. Test reduced-motion media plus shell override; specified transitions become instant/nonmoving. Tokens update shared consumers while artwork retains its own colors. |
| M06 · F1–F6, AC6 | Every unique layout below; long synthetic titles, paths, references, source names and dates. [UI index](../ui-map/README.md). | Observe 1440×900, 1280×800 and 1024×768 Design windows plus measured container breakpoint neighbors. Apply 200% text and spacing stress; check Wiki 320 CSS-pixel reflow, first/last gutters, scroll endpoints, focused controls and overlay reachability. Record the representative shared consumer and each unique layout; do not imply a full Cartesian matrix. |
| M07 · F2, AC7 | Work capture/frame/Glance; `board`, `board/by-date`, `list`, `item/<id>`, Calendar Month/Week/Day/Agenda, Timeline, `board/week`, Review and Archive. [Work map](../ui-map/work.md), [flow assessment](../design/work/flow-assessment-20261103.md), [mockups 01–13](../design/work/mockups/evidence/). | Compare each named family with an exact mockup/current capture pair. Include populated/empty and pending/error/unknown states, date mapping, drag/cancel, keyboard/menu equivalents and one Undo per action. Use the real synthetic Planner for service effects. All listed routes remain individually unverified until observed. |
| M08 · F3, AC3/AC7 | Social Overview, Sources `sources[/<id>]`, workbench `workbenches[/<tool>]`, results, `library/new` composer, `calendar[/<YYYY-MM>]`, `runs[/<id>]` receipt and catalog. [Social map](../ui-map/social-calendar.md), [flow assessment](../design/social/flow-assessment-20261103.md), [mockups](../design/social/screenshots/). | Complete Sources → workbench → result → Library composer → Calendar → run receipt using permitted example/synthetic methods. Check counted Library navigation, empty/loading/error, calendar keyboard/drag, unknown read-only reconciliation and narrow rail/list/composer/receipt. Observe existing [save/failure/unknown scenario](../../tests/acceptance/scenarios/social.mjs) without real posting. |
| M09 · F4/B3, AC6 | Design Projects → version → Canvas → Compare → Annotations → Requests → Runs → Returned/review. [Core map](../ui-map/design-core.md), [core handoff](../handoffs/hq-life-20261103/f4-design-core.md). | Inspect active project/version switching, exact selected target, failed-read Try again, unavailable reasons, source details and keyboard divider. Inspect ready/loading/empty/error states where supported. Record held send/generation actions; do not enable them to fill the sheet. |
| M10 · F5/B3, AC6 | Design Sources: References, Imports, Flows, Discovery, Components and Taste Sources. [References](../ui-map/references.md), [graph](../ui-map/reference-graph.md), [Sources composition](../../modules/design/app/compose/sources/README.md). | Visit all six families and supported ready/empty/error states. Verify explicit Imports rights/unknown Check, canonical Taste subject, labelled example-only Discovery and Components capability refusals. Exercise References graph and shared details panels. Missing authorized fixtures are explicit row gaps. |
| M11 · F6/B5, AC4/AC6 | Wiki Home/topics/search/reader/backlinks/session history/setup/unavailable recovery; Settings Data Sources, Appearance and Updates. [Wiki map](../ui-map/wiki.md), [Wiki design](../../modules/wiki/ui/design-20261103.md), [Data Sources](../ui-map/settings-data-sources.md), [Updates](../ui-map/settings-updates.md). | Use committed invented corpus and existing [Wiki scenario](../../tests/acceptance/scenarios/wiki.mjs). Check configured/unavailable/restored state, page equality after source restoration/restart, backlinks/status, logical destination, keyboard/focus and long titles. Settings links choose the proper category. Observe Updates presentation only. No private corpus, revision history or operational update. |
| M12 · F4/F7, AC7 | Actual already permitted synthetic native Design preview plus active toast, wide and narrow. [Interactive map](../ui-map/design-chrome-interactive.md), [core map](../ui-map/design-core.md). | Trigger a supported notice while native content is present. Screenshot plus interaction must show bounds/z-order, visible reachable action, focus, dismissal, F8 and reduced motion. No native surface means HELD; renderer-only capture cannot pass this row. |

### Layout boundaries and shared consumers

Section ID: work.hq-recovery-native-observations#layouts

Measure the named container, not an inferred window width. Check both sides of
each boundary relevant to these changed families:

- Onboarding: 899/900px workspace; Work detail: 719/720px work area;
  Work Plan week: 759/760px content.
- Social sidebar around 1000px; composer 779/780px content; run receipt around
  34rem (record resolved pixels). Cover rail, list/composer replacement, compact
  month chips and receipt peek separately.
- Settings navigation: 599/600px and rows 479/480px; Updates metadata 359/360px.
- References import 599/600px, collections 759/760px and details 1099/1100px
  of the References container; graph details also 1099/1100px.
- Interactive preview: record actual panel, frame and native bounds with review
  beside/stacked, scroll pause/Show preview and narrow chrome. Do not cause an
  unauthorized source launch. A missing permitted state remains held.

Shared consumers include Dialog/Menu, toast viewport and list motion in Work;
Social PageHeader/InlineNotice/StateView/SaveIndicator/TimeGrid; Settings rows
and feedback; Design SectionFrame/ProjectScope/SectionErrorBoundary; References
and graph details, Canvas inspector and Components panels using SecondaryPanel.
Name every consumer actually inspected. Components panels, custom Wiki states
and other unvisited consumers do not inherit coverage from References or Social.
Screen-reader, forced-colors and other assistive-technology certification are
not established by this finite matrix.

## Native persistence observations

Section ID: work.hq-recovery-native-observations#restart

The existing real-Planner [integration tests](../../apps/desktop/src/work-live.integration.test.ts)
already cover fresh persistence/core/live-adapter objects for offline edit and
lost request/answer recovery. Reuse that evidence; these rows add actual
Electron process, preload and UI observations. Wait for genuine persisted state
with read-only load, never seed a document to manufacture a passing result.

| ID / status | Procedure | Exact oracle |
| --- | --- | --- |
| N01 · UNRUN | Before the first explicit Check in [work scenario](../../tests/acceptance/scenarios/work.mjs), wait for the real persisted unconfirmed entry, then stop/relaunch Electron with the same owned profile. | Same request ID, body, exported intent and baseline; Unconfirmed restored. Launch/navigation/state reads issue no create/resend. One explicit lookup confirms the existing single item and unchanged version. Preserve HQ02's body/ID/no-resend assertions and later HQ03's confirmed-only restart. Arm initial response loss only once. |
| N02 · UNRUN | After original HQ03, stop only owned Planner, edit an existing item through UI, wait for persisted queue, restart Electron while offline, then restart the same service DB behind the same proxy origin. | Queue/request identity restored; exactly one PATCH and one revision advance on reconnect. Subsequent refresh/navigation adds no mutation. Compare real service state. Offline create is not an edit queue entry. Preserve first failure and owned cleanup. |
| N03 · UNRUN | While owned Planner is unavailable, type a distinct capture, choose Keep as HQ draft, wait for device-save confirmation and persistence, restart Electron, then reconnect/navigate. | Same kept draft restored; reconnect/navigation send nothing. Explicit Send drafts creates once and clears saved draft only after success. Unkept input durability and quit-during-save/crash races are not claimed. |

N02/N03 are supplemental named results, not replacements for any original
reserved row. Execute them before the terminal unavailable-service scenario.
No new production repair or retained save-failure, wording, cleanup or final
PATCH-ledger finding is selected by this coverage work.

## Index rebuild and final reconciliation

Section ID: work.hq-recovery-native-observations#reconcile

WIKI-UPGRADE starts **UNRUN**: use an owned synthetic stored v1 index snapshot,
observe the first applicable v2 rebuild and subsequent warm load, and record
fixture size, exact source/build, rebuild/load duration and main-thread
responsiveness. Follow [index lifecycle](../../modules/wiki/core/README.md);
do not introduce a worker architecture before measured need.

Before claiming the recovered flows accepted, reconcile AC1–AC8 with individual
row results, exact-head required checks, native build inventory, all gaps/holds
and cleanup. Required CI for a newly committed head is separate from these
observations. Registry compatibility belongs to the packaging owner; its
read-only check is outstanding, with no drift inferred and no preemptive refresh.
HQ07/HQ09H and the remaining original qualification rows retain their actual
dispositions. Partial completed rows can be useful while aggregate acceptance
remains held.
