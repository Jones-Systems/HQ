# HQ shared foundation

<!-- codex-section:begin id="brief.hq-shared-foundation#ctx.artifact-header.001" -->
Artifact Type: `design-brief`

Artifact ID: `brief.hq-shared-foundation`

Purpose: Give the HQ shell and independently owned Design, Social and Work domains one shared product and integration baseline.

Governing artifact: none

Decision owner: M Jones; domain integration agreement by the HQ and Design lane owners

Consumers: HQ shell/Social/Work lanes, Design lanes, implementation planners

Authority effect: none
<!-- codex-section:end id="brief.hq-shared-foundation#ctx.artifact-header.001" -->

## Version and copy provenance

<!-- codex-section:begin id="brief.hq-shared-foundation#ctx.copy-provenance.001" -->
This is the **public-safe copy of working foundation v0.3**. The accepted source is an uncommitted HQ-lane worktree file with SHA-256 `a0d4e6789b2549ce9cb828f02babfca5c3a11238d9f832c7c9040c89e8e33271`; existing lane acceptances remain bound to that digest. This copy changes only:

1. **Redaction.** Private host addresses, local filesystem paths, native thread identifiers and private worktree locations are removed or replaced with role names. No product requirement changed.
2. **Bootstrap ownership delta.** v0.3 assigned the initial repository/root scaffold to the Design coordinator. The later published assignment `spec.hq-bootstrap` (`docs/engineering-specs/hq-bootstrap.md`) gives that scaffold, root manifests/lockfile/configuration, `apps/desktop/` and `packages/contracts/` to a separate **T0 foundation lane** until custody is explicitly transferred. This copy states the published assignment. It is the only semantic delta and was already governing through that spec.

Every other paragraph preserves v0.3 meaning. Lanes consuming this copy cite its committed blob identity. A later material revision receives a new version and digest with an explicit delta, never silent edits.
<!-- codex-section:end id="brief.hq-shared-foundation#ctx.copy-provenance.001" -->

## Product direction

<!-- codex-section:begin id="brief.hq-shared-foundation#dec.product.001" -->
The parent product is **HQ**. Design Studio becomes its **Design** domain. A slim mode rail places **Design above Social**. Add task tracking with Trello-style movable cards and lists. Dark mode is required. Each domain retains its own navigation and working surfaces. The HQ lane owns the HQ shell/shared structure, Social and the task/board domain; the Design coordinator keeps Design-only ownership. These reflect M Jones's current direction.

Working defaults: name the third domain **Work**, presenting Manual Planner's existing Glance, Board, List, Calendar, Timeline and Review views. Custom lists/multiple boards remain a requested experience extension to evaluate. Rail order is Design, Social, Work. First use opens Design; subsequent use restores the last active domain and its location. Theme choices are Light, Dark and System, initially System. These defaults do not equate the owner's rail-order preference with an instruction to discard session memory.

Design's spatial Board/comparison canvas and Work's task board remain distinct objects. Use qualified labels in shared navigation and search; do not rename Design internals without its owner. This brief is the HQ parent baseline; the separate Design PRD/spec remain the feature/detail owners for Design.
<!-- codex-section:end id="brief.hq-shared-foundation#dec.product.001" -->

## Shell and module boundary

<!-- codex-section:begin id="brief.hq-shared-foundation#iface.shell.001" -->
HQ owns app bootstrap, the slim rail/order, global appearance preference and shared chrome tokens, visible workspace/project context, cross-domain navigation/reference resolution and shared service composition. The T0 foundation lane alone owns the initial Jones-Systems/HQ Electron root scaffold, configuration, dependency locks, `apps/desktop/` and `packages/contracts/` until it publishes the baseline and custody is explicitly transferred. HQ retains shared shell product ownership; later root changes require an explicit single-writer assignment. No lane creates a competing repository or scaffold. Physical paths are bound to the delivered baseline in the implementation plan; logical ownership here does not reserve or authorize edits in another worktree.

Design owns its internal navigation, references, canvas/flow state, drafts, annotations, taste/evaluation tools and preview → frozen request → qualified Jones thread → returned candidate loop. Social owns its research/content/drafts/voice/channel planning and future account services. Work owns manual planning items and views, beginning with evaluation/adaptation of the existing Manual Planner.

Each domain exposes destinations and supported actions through a narrow integration port. Domain models, validation and persistence remain with their owner. This does not require a plugin runtime, microfrontends, separate processes/databases, a universal task schema or an immediate source/repository merger. No existing store is migrated merely to satisfy the common shell.

Logical destinations use distinct `design`, `social` and `work` namespaces, such as `/design/*`, `/social/*` and `/work/*`. The shell restores the previous destination per domain; the domain restores its own selection, canvas/filters and unfinished work. A mode switch never submits a draft or starts a run.

Workspace/project context is visible. Cross-domain links preserve the source and return route. A destination may belong to another project or no project; show that context explicitly and resolve an actual project change visibly. Do not silently match records by title or create competing project registries.
<!-- codex-section:end id="brief.hq-shared-foundation#iface.shell.001" -->

## Appearance

<!-- codex-section:begin id="brief.hq-shared-foundation#iface.appearance.001" -->
HQ is the single owner of the `light | dark | system` appearance choice. Use a per-device persisted preference initially. An explicit Light/Dark choice survives restart and ignores OS theme changes; System follows OS changes. The mode value already encodes explicit-versus-system behavior, so no extra conflicting preference flag is needed. Cross-device preference sync is not required by this baseline.

Shared semantic roles cover base/raised surfaces, primary/muted text, borders, accent and accent text, focus, success, warning and danger. The shell supplies light/dark values; modules consume them for chrome and may add domain-specific roles. Exact code token names/palette values will be fixed with the implementation stack. Keep contrast, keyboard focus and non-color state labels usable in both themes.

Captured screenshots, exported evidence, artwork and runnable producer previews retain their own intended theme/colors. Changing HQ chrome does not recolor captured bytes or implicitly change the target preview theme. Explicitly testing another target theme belongs to Design's separate preview controls.
<!-- codex-section:end id="brief.hq-shared-foundation#iface.appearance.001" -->

## Linked records and execution truth

<!-- codex-section:begin id="brief.hq-shared-foundation#iface.references.001" -->
Cross-domain references identify the owning domain/system, object kind and opaque stable identifier, with a version or immutable source reference when the handoff depends on exact content. Carry relevant workspace/project identity, a readable title snapshot and a return destination. The owner alone interprets and validates its identifiers. Missing/unavailable targets keep the readable reference and its provenance; references neither grant access nor copy a second editable authoritative record into another domain. This is a semantic envelope, not a frozen wire protocol.

There are three different kinds of state:

| Record | Owner and meaning |
| --- | --- |
| Planning item/card | Work/Manual Planner owns the user's intent, manual status, priority, order, horizon and planning dates. |
| Design or Social artifact | Its domain owns editable content and any frozen source revision used for a handoff. An annotation or draft need not become a planning card. |
| Jones/external execution | The executing system owns requests, run identities, observed status and returned results. A planning item may link one or more such records. |

Keep native execution status, source/target and observation freshness visible. A terminal agent turn alone does not prove that a deliverable is accepted or the user's planning card is done. An unavailable host or uncertain dispatch remains unknown/unresolved; absence from a search does not prove no effect. Reconcile an uncertain request before retrying it using the executing system's supported identity/readback mechanism.

Card capture, drag, reorder, list/status/horizon change, mode switch and merely following a reference make **zero execution calls**. If explicit execution is later added, it must use the separately qualified request/destination/receipt contract. The existing Design connector's existing-thread queueing does not establish external host/model/new-thread launch support. Do not add a competing global task store or execution ledger that overwrites source truth.
<!-- codex-section:end id="brief.hq-shared-foundation#iface.references.001" -->

## Work and Manual Planner

<!-- codex-section:begin id="brief.hq-shared-foundation#dec.work-foundation.001" -->
Use the delivered **Manual Planner** as Work's planning authority and adaptation base, preserving its records/service rather than creating a parallel task store. Its source lives in a separate private repository (`apps/manual-planner/`, verified at that repository's HEAD `4beb491c44551b6e4207adcc7459c4b11407bcbc`). It has Board, List, Calendar, Timeline, Glance and Review views of shared planning items; checklists, notes, links, accessible movement, undo, durable saving and export/restore. It already supports light/dark/system appearance. Its README and provenance have been inspected; existing live data has not been opened or changed for this concept. This decision does not itself authorize source adoption, a backend rewrite, data movement or service changes.

Its fixed manual statuses (Inbox, Considering, Next, Active, On hold, Done, Dropped), horizons (Now, Soon, Later, Someday) and precise planning dates are different axes. The owner's reference screenshot shows Today/This Week/Later lists that illustrate desired planning buckets; they are not an automatic rename or migration of those existing fields. Do not invent due dates for undated items or reinterpret Now/Soon as Today/This Week. Multiple boards, editable lists, tags and deeper cross-domain links are desired extensions to evaluate, not existing Planner capabilities asserted here.

Initial product scope to explore: quick capture, boards and editable lists, ordered movable cards, card detail with notes/checklist/labels/dates/references, and drag alternatives using keyboard/menu plus undo. Reuse existing useful planning views rather than creating a separate reminder/calendar product. Work's planning dates and Social's editorial calendar remain domain-owned until an explicit link/sync meaning is agreed; do not copy them into independently editable duplicates.

The current Planner's references are static links and cannot start Jones work. A later private deployment report exists for the Planner service; its availability was not retested and its address is intentionally omitted from this public copy. Older README/provenance hosting statements are stale relative to that report. Physical-phone acceptance remains unverified. Adaptation scope, source ownership transfer and any data migration require a separately bound implementation assignment.

Use the owner's screenshot and official Trello Mac screenshots for interaction reference. This does not request actual Trello account access, import, synchronization, copying the supplied task contents or executing the tasks visible in the screenshot. No Trello plugin or installation is required to design the pattern.
<!-- codex-section:end id="brief.hq-shared-foundation#dec.work-foundation.001" -->

## Packaging decision and capability gate

<!-- codex-section:begin id="brief.hq-shared-foundation#dec.packaging.001" -->
**Electron is the owner-selected host for the whole HQ desktop app**, directly accepted twice in the Design thread and confirmed by its coordinator. The earlier browser-first preference was provisional and is superseded. There is one HQ host, not a separate Design-only scaffold. Keep domain code browser-compatible where practical without imposing a second browser/PWA delivery or reopening framework selection.

Design's S2 supplies evidence for faithful isolated previews, element/text picking with correct geometry, capture and module-state retention against this shell boundary. This is a capability qualification of the selected host, not a pending framework vote. Missing capability evidence holds only the dependent behavior; it does not block independent product design or overwrite the owner's Electron selection.

Desktop quick capture, global shortcuts, notifications and multiple windows are useful candidates supported by Trello's official Mac product. Desktop packaging does not itself supply offline sync, local data ownership or remote execution. Keep service/data lifetime separate from UI lifetime: closing a Mac window must not unintentionally kill a remote job or make an existing remote planning store disappear. No installation, host-route change or runtime capability is authorized here.
<!-- codex-section:end id="brief.hq-shared-foundation#dec.packaging.001" -->

## Cross-lane agreement and future acceptance evidence

<!-- codex-section:begin id="brief.hq-shared-foundation#ac.integration.001" -->
The HQ lane (root continuity owner) owns the v0.3 source and this public copy. The Design lane owns its Design PRD/spec; its shared-boundary locator is `spec.design-studio#iface.hq-shell.001`. Implementation target is the public Jones-Systems/HQ repository; source implementation lanes need its exact baseline, their own native-bound worktree and published plan before mutation. Design page implementation remains with the Design coordinator; the HQ Social/Work campaign styles shared chrome and implements Social/Work without launching competing Design feature lanes. Read each source directly; do not mutate another lane's worktree.

Each lane records acceptance of **HQ foundation v0.3 plus exact SHA-256** in its own continuity artifact. A receipt is not acceptance. Disputed fields stay pending; preserve the agreed owner requirements and unaffected Design feature scope. Any material foundation revision gets a new version/digest and explicit delta acknowledgement rather than silently changing accepted bytes.

Future implementation acceptance should demonstrate: Design → Social/Work → Design restores draft/canvas state; explicit theme choice survives reload and System follows OS changes; HQ theme changes leave captured bytes intact; references preserve source/version/context/return route; drag and keyboard/menu moves agree and support undo; moving a Work card makes zero execution calls; stale/unknown execution never appears as verified success; adaptation preserves existing Planner records and export/restore. These are future evidence requirements, not claims of implemented integration.
<!-- codex-section:end id="brief.hq-shared-foundation#ac.integration.001" -->
