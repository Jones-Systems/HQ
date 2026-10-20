# Engineering Spec — HQ Social and Work

<!-- codex-section:begin id="spec.hq-social-work#ctx.artifact-header.001" -->
Artifact Type: `engineering-spec`

Artifact ID: `spec.hq-social-work`

Purpose: Implementation-ready plan for HQ shared chrome styling and the Social and Work domains inside the single HQ Electron app.

Governing artifact: `brief.hq-shared-foundation#iface.shell.001`

Specification owner: HQ Social/Work planner lane (T1), under the HQ root coordinator

Integration owner: HQ root coordinator (launch, shared contracts, fan-in and merge custody)

Consumers: HQ root coordinator, T0 foundation lane, Social/Work/UI implementation lanes, reviewers, verifier

Authority effect: none
<!-- codex-section:end id="spec.hq-social-work#ctx.artifact-header.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.launch-preflight.001" -->
## Mandatory launch preflight

Every lane, including reviewers and the root integration tasks, does all of the following **before its first decision or mutation**. A capsule that omits this preflight is incomplete.

1. **Read the full Codex V3 root guidance.** Read all of `AGENTS.md` in `Jones-Systems/Codex-V3` at commit `4beb491c44551b6e4207adcc7459c4b11407bcbc`: blob `3402719bc3a09e7e08ed113425d7137818eda25c`, 30,716 bytes, SHA-256 `1238a90adbf10ea8f2359f90ed0c7bf99fc1121589dcde5b99881fd247e87ce6`. Tool output must contain the entire file, in bounded chunks if needed; headings or a link are not enough. Resolve its relative links against that same checkout. Load only the workflows your next effect triggers. Usual triggers for these lanes are research-first, affected checks, temporary test scratch, CPU telemetry, delivery and merge, commit granularity, the T3 thread skill and the frontend home pointer. The root supplies the local checkout path in the native launch message; this public document does not copy the private guidance.
2. **Read the HQ target rules.** Read `AGENTS.md` at your HQ worktree root, plus any nested `AGENTS.md` on paths you touch. HQ target rules and your task restrictions take precedence over broader Codex V3 defaults. Reading broader defaults never widens your writer cone.
3. **Read the governing documents** at the pinned plan commit: this spec, `docs/design/hq-shared-foundation.md` and `docs/engineering-specs/hq-bootstrap.md`.
4. **Verify the source binding.** Check repository `Jones-Systems/HQ`, worktree path, branch (never `main`), HEAD, a clean or owned-only status, and the accepted T0 baseline commit that your branch starts from.
5. **Take fresh bounded CPU/memory telemetry** before tests or batches, using the Codex V3 Linux telemetry admission collector. No tests start at 85% CPU or higher.
6. **Record** the guidance source identity and any material conflict in your lane-local continuity: the PR body or `docs/evidence/hq-social-work/<lane>/README.md`.

Model routing for this campaign is the explicit owner override: every lane runs `claude-opus-5-5` at `high` effort. Workstream mode is Claude Frontier. Lanes launch **no descendants** and do not switch models.
<!-- codex-section:end id="spec.hq-social-work#ctx.launch-preflight.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.project-summary.001" -->
## Project Summary

**Outcome.** HQ gains:

- a styled shared chrome and UI kit;
- a **Social** domain that is a usable desktop client for the existing Social workspace ("Fieldnotes"): drafts, brands, editorial calendar and eight offline tool workbenches, with form-first inputs in place of today's JSON-heavy recipes;
- a **Work** domain that presents the existing Manual Planner's records through Board, List, Calendar, Timeline, Glance and Review, plus card detail, quick capture and accessible movement.

Both domains run against synthetic fixture adapters first. Each later connects to its existing authoritative service through one narrow, separately approved desktop bridge. HQ never becomes a second task store or a second Social store.

**Delivered today vs proposed here.** Status is source-read evidence at the named revisions. Nothing was re-run for this plan.

| Capability | Delivered status | This plan |
| --- | --- | --- |
| HQ Electron shell, rail, appearance, contracts | Assigned to T0; source not yet published or accepted | Consumed, never re-implemented |
| Design domain | Separate Design coordinator and lanes | Out of scope except shared visual integration |
| Social workspace (Fieldnotes): drafts, brands, planning date, run receipts | Delivered in a private repository (Python 3.13 stdlib HTTP + SQLite) | HQ client UI and port; service unchanged |
| Eight offline Social tools | Delivered; JSON-first browser recipes, three with simple fields | Form/file-import workbenches over the same native inputs |
| Live collection, posting, account connections, scheduled dispatch | **Absent** by design | Remain absent; no UI implies them |
| Manual Planner (items, 7 statuses, 4 horizons, typed dates, checklist, references, undo, export/restore) | Delivered in a private repository (vanilla JS + Python stdlib + SQLite) | TypeScript domain core plus React views over the same records and API semantics |
| Multiple boards, editable manual lists, multi-labels | **Not** Planner capabilities | Rule-based Lists view and per-device board presets; schema extension stays deferred (D-3) |
| First-class cross-domain links (Work card ↔ Social draft ↔ Design item) | **Not** delivered anywhere. T0 ships only the `ReferenceEnvelope` type and parser. | Planned under owner decision D-4 (`req.references.001`, `iface.references.001`). Persisted by each source record's owning service through a minimal additive, capability-gated extension. |

**Materially distinct shapes that stay distinct:**

- Work planning item: Planner-owned.
- Social draft/brand: Fieldnotes-owned.
- Social tool run: Fieldnotes-owned execution of a local offline tool.
- Design artifact: Design-owned.
- Jones/external execution: owned by the executing system.

A Social tool run is the only execution-class call in this plan. It happens only on an explicit **Run** action. Work has no execution-class call at all.

**System shape.** Each domain is browser-compatible React/TypeScript under `modules/<domain>/`:

- `core/`: port interface, validation, pure logic, fixture adapter and a state hook;
- feature sections;
- a domain descriptor `index.tsx` that mounts through T0's module registry.

Shared presentation lives in `packages/hq-ui/`. Live service access goes through the main process via a root-owned, typed desktop capability (`iface.service-bridge.001`). The T0 candidate's CSP sets `connect-src 'none'`, so the renderer cannot fetch directly. The renderer never receives a service address or token and cannot name arbitrary URLs.

**Non-goals:** a Design feature; a replacement of Fieldnotes or the Planner service; data migration; service/schema changes in either private repository; posting, collection or account connection; a task scheduler or execution from cards; Trello import; CI workflows; signing, installation or deployment.

**Finish line for this campaign.** Every lane publishes its candidate PR with checks and visual evidence. Root integrates, but merge is held for integration-owner agreement. Installed-app acceptance is a separate later stage.
<!-- codex-section:end id="spec.hq-social-work#ctx.project-summary.001" -->

## Requirements

<!-- codex-section:begin id="spec.hq-social-work#req.foundation-binding.001" -->
- **RF-1.** Lanes consume T0's published, root-accepted baseline. The published candidate is `33dfe44d6786b40ac8a5dcb5442d85c20da38c67` (draft PR #2, not yet accepted). It provides:
  - an explicit npm workspaces list;
  - the registry `apps/desktop/src/modules.tsx`, a `MODULES` record of `ComponentType<ModulePort>`;
  - `@hq/contracts` exports `DomainId`, `Appearance`, `ResolvedAppearance`, `ProjectContext`, `DomainDestination`, `ReferenceEnvelope`, `DesktopPort`, `ModulePort`, `parseReference` and `isDestination`.

  No lane edits root manifests, the lockfile, configuration, `apps/desktop/` or `packages/contracts/` without explicit single-writer custody.
- **RF-2.** Literal paths in this plan are bound to the T0 candidate `33dfe44`. The root rebinds them mechanically if the accepted commit differs. The root records the rebind as a versioned plan delta before dependent lanes mutate.
- **RF-3.** No duplicate contracts. Domain-specific types stay inside the domain. Shared-contract additions go through the root as a proposal.
<!-- codex-section:end id="spec.hq-social-work#req.foundation-binding.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.shell.001" -->
- **RS-1.** `packages/hq-ui` ships T2's published visual-system tokens (`ctx.visual-system-binding.001`): 39 colour roles as `light-dark()` pairs, 4 theme-invariant artwork tokens, and type, space, radius, size, breakpoint, motion, layering and component roles, all `--hq-*`. The scheme is selected by the shell's `data-theme` attribute on `document.documentElement`, which T0 sets to `light` or `dark`. Before it is set, `:root { color-scheme: light dark }` follows the OS. Modules use only these roles plus documented domain roles (`--social-*`, `--work-*`). Status colour is always paired with a word and a shape.
- **RS-2.** Tokens never apply to preserved content.
  - **Marking.** A preserved-content well carries `data-hq-content="captured"`, `"producer"` or `"export"`. It may add `data-hq-matte="checker"` for a fixed transparency grid. It sits on the constant artwork matte.
  - **Scheme pin.** The well's `--hq-content-scheme` is **pinned to the content's recorded theme** (`light` or `dark`), set through CSSOM (`element.style.setProperty`), which the existing CSP allows.
  - **Why the pin is required.** T2's Chromium 155 probe found that an embedded iframe's `prefers-color-scheme`, and an SVG used as `<img>`, follow the owner element's used `color-scheme`. Without the pin, switching HQ's appearance would silently re-theme a preview.
  - **No alteration.** No filter, blend mode, opacity or recolour is ever applied to preserved content. Global appearance changes chrome only.
- **RS-3.** `packages/hq-ui` provides accessible primitives: Button, IconButton, Menu with roving focus, Dialog with focus trap and Escape, Toast with an action (Undo), Tabs, StatusChip with a text label (never color alone), SaveIndicator (saved / saving / unsaved / failed with retry / offline, kept on this device / unknown result with check; local persistence only, never execution) and StateView (empty / loading / error / offline / unavailable / unknown). All are keyboard operable with a visible focus ring in both themes and respect reduced motion.
- **RS-4.** After a named UI owner is explicitly assigned, the shell chrome (`apps/desktop/src/App.tsx`, `apps/desktop/src/styles.css`, released by T0 but **unassigned**) adopts T2's tokens. It loads `hq-tokens.css` and then T2's `t0-bridge.css`, and retires T0's palette blocks. It covers: the 40px titlebar with project context and the Light/Dark/System radio group (a menu button below 960px), the 64px rail Design → Social → Work with T0's unavailable slots as `aria-disabled`, and the compact secondary-nav drawer below 960px. Rail order, per-domain destination restoration and appearance persistence keep T0's behavior.
<!-- codex-section:end id="spec.hq-social-work#req.shell.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.social-content.001" -->
- **RC-1.** Social content library: create, edit, filter (brand, channel, planned/unplanned, archived), archive and restore drafts. Fields mirror Fieldnotes exactly:
  - title: 1–200 characters;
  - body: 0–50,000 characters;
  - brand: an existing brand;
  - channel: one of General, X, LinkedIn, TikTok, Instagram, Facebook, Reddit, Article;
  - planned date: `YYYY-MM-DD` or empty;
  - archived flag;
  - integer version.
- **RC-2.** Saves send the record's current version. A version conflict shows "Changed elsewhere" and lets the user reopen the latest copy or copy their text out. The draft is never silently overwritten. Unsaved editor text survives domain switches. T0 remounts the module on every switch (`<main key=…>`), so this state lives in a module-level store outside React components (see `iface.domain-module.001`).
- **RC-3.** Brands: list and add (name 1–80 characters). The built-in default brand is shown as present, not created.
- **RC-4.** Editorial calendar: a month view of drafts by planned date, plus an undated tray. Moving a draft changes only its planned date, through one versioned save, with undo. The planned date is labeled as a planning label, never "scheduled" or "approved". It is independent of Work planning dates.
- **RC-5.** Social secondary navigation, reconciled with T3 (`ctx.social-design-reconciliation.001`): Overview, Sources, Workbenches, Library, Calendar, Run history, and Channels & accounts under *Later*, with a brand switcher. It restores its last page, filters, selection and unsaved text after a domain switch.
- **RC-6.** **Overview:** a capability strip, Coming up, Needs attention, Recent research, and Linked across HQ (outgoing links of this brand's drafts with freshness). **Channels & accounts:** a static, honest capability page; no control has an external effect. **Sources:** a reserved destination that shows *Proposed — needs the Social service source registry (SOC-6)*. It is not built on fixtures as if it were delivered.
- **RC-7.** Brand ↔ HQ project: proposed as Social-owned and keyed by the opaque HQ project ID; pending a persisted Social contract. Fixtures may demonstrate the mismatch banner. HQ never switches project silently and never claims a saved mapping. The *Switch HQ project* action stays disabled with a reason until a project registry exists, because T0 has one fixed context.
- **RC-8.** Draft states and channel variants are SOC-6 proposals. Until the Social service owner ships them, a draft keeps one body, as today.
<!-- codex-section:end id="spec.hq-social-work#req.social-content.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.social-research.001" -->
- **RR-1.** Tool catalog for the eight delivered tools, grouped by their delivered categories (Discover, Create, Measure, Plan, Connect). Each shows its actual limit text, for example "No TikTok access or live discovery".
- **RR-2.** Form-first inputs:
  - **Simple fields:** Writing studio (notes, format short_post/thread/article, audience, intent), Channel preview (caption, format text) and Signal inbox (topic, terms, items).
  - **Typed file import with shape preview** for the structured tools: TikTok batches, SEO config/packets, Search visibility panel/entities/inventory/answers, Reddit bundle, Creator batch with topic chips.
  - An **Advanced JSON** mode remains available for every tool.
  - Load Example fetches the service's example and marks the run as an example.
- **RR-3.** A run is submitted **only** by an explicit Run action, with the tool, the input object and the example flag. Navigation, domain switch, form edits, example loading and file import never submit.
- **RR-4.** Run history and receipts show the run statuses queued, running, succeeded, failed and interrupted, with times and errors. Result views are tool-specific summaries plus a raw JSON disclosure and a receipt download. Polling runs only while a run is active and the page is visible.
- **RR-5.** Uncertain submission: a lost response or timeout shows the outcome as **unknown**, never as success or failure. The UI refreshes run history and shows runs created since the attempt as possible matches. It never resubmits automatically. Fieldnotes has no client request identity, so matching cannot be proved.
- **RR-6.** *Start draft* on a result, including a Writing studio result, creates an **unsaved** draft carrying a citation: a `ReferenceEnvelope` of kind `run`, with the run ID, the tool, the as-of date as `sourceRevision`, and the title snapshot. Saving persists the citation only when the service advertises `hq-references-v1`. Otherwise the citation is shown as *not saved — needs Social service support* and is never silently dropped.
- **RR-7.** Every surface states the delivered limits: no account connection, posting, live collection or scheduling.
<!-- codex-section:end id="spec.hq-social-work#req.social-research.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.work-core.001" -->
- **RW-1.** The Work domain core mirrors the Planner item model exactly:
  - id; revision; title (1–200 characters, one line);
  - kind: project / idea / goal / chore;
  - status: inbox / considering / next / active / on_hold / done / dropped;
  - motivation: need / want / exploring / null;
  - horizon: now / soon / later / someday / null;
  - priority: high / normal / low / null;
  - area: up to 40 characters, or null; notes: up to 20,000 characters;
  - next_steps: up to 100 entries of {id, text up to 300 characters, done};
  - references: up to 30 entries of {id, kind: url/doc/repo/pr/project/workstream/other, label up to 200 characters, http(s) url up to 2,000 characters};
  - dates: up to 20 entries of {id, kind: target/deadline/start/event, precision: day/week/month/quarter/year, value, time, end_time, tz, note up to 120 characters}; time requires day precision and an IANA tz;
  - position; is_example; created_at, updated_at, archived_at, reviewed_at.

  Status, horizon and dates stay separate axes.

  **Proposed additive reference entry (D-4; T4 option B):** `{id, kind: 'hq', label, target: ReferenceEnvelope}`, with no `url`.
  - It is stored losslessly by the Planner after the explicit schema phase. It is accepted only when the service advertises `hq-references-v1` (`iface.references.001`).
  - Ordinary URL references stay unchanged and compatible.
  - There is no HQ-side link or task store (T4 option C is rejected).
  - The fixture adapter implements the entry as labeled proposed-schema behavior.
  - Design annotations and Jones requests stay distinct `kind` values inside the envelope. A target's observed state is never written to the item's status.
- **RW-2.** Client validation mirrors the service rules for immediate feedback. The authoritative service, or the fixture adapter standing in for it, remains the validator and returns `[{field, message}]`.
- **RW-3.** Pure logic is reused **verbatim** from the three D-1-approved Planner files. The mapping is in `ctx.d1-import.001`. The logic is: ordering and drop anchors (`before_id` / `after_id` / top / bottom; renumber within the target status), period bounds and ISO weeks, primary date, date state, review buckets, filters. Week grouping honors the Planner `week_start` setting.
- **RW-4.** The `PlannerPort` (`iface.work-port.001`) has two implementations:
  - An in-memory fixture adapter with:
    - revision guards, and `revision_conflict` and `order_conflict` (409 semantics);
    - request-ID idempotency: the same ID with the same body returns the recorded result with `replayed: true`; the same ID with a different body returns `request_id_reused`. The record holds a bounded 2,000 IDs, as in the Planner.
    - synthetic fictional examples.

    T4's mockup fixture lacks replay and `request_id_reused`. HQ's fixture **must** implement both, and the conformance suite tests both.
  - later, a live adapter over the bridge.
- **RW-5.** The state hook keeps its state in the module-level store, so it survives T0's remount on every domain switch. It provides:
  - snapshot load and version polling while visible;
  - optimistic projection with rollback;
  - an unconfirmed queue;
  - save states Saving… / Saved · time / N unconfirmed / Offline · not saving;
  - a client undo stack of up to 40 entries through the normal port.
- **RW-7. Move-only status changes (T4 P-1).** Every status change goes through `move(id, rev, status, {place: 'top'})`. That includes the detail panel's status pills and the List view's status select. Undo then restores the exact neighbor anchor. `ItemPatch` excludes `status` at the type level.
- **RW-8. Compare-and-swap field undo (T4 P-2).** An undo entry for a patch records each patched field's post-action value. On undo, if the current value of every field equals that value, the inverse patch is sent at the current revision. Otherwise nothing is written, and the toast says *"Not undone: … was changed again since; the newer value was kept."* This preserves concurrent edits, deliberately unlike the Planner's own client. Undo of a create archives the item. Each entry is consumed **once**: the toast action and Ctrl/⌘+Z share it and remove it.
- **RW-9. Unknown-mutation reconciliation.** A lost or timed-out mutation is `unknown` and stays *Unconfirmed*. It is reconciled only by re-sending the **same request ID and body**:
  - replay (`replayed: true`) confirms it;
  - `request_id_reused` is a defect and holds the queue;
  - a revision or order conflict is shown truthfully.

  Similar-looking items, such as a create with the same title, may be **flagged** as *Possibly already saved*, but they are never proof that the write happened or did not happen.

  If the replay record may have been evicted (a create older than the session), HQ never auto-resends: the user decides.

  The queue is in-session only, and says so, until a G-3 storage member exists.
- **RW-10. HQ drafts are HQ's own (T4 P-5).** Offline captures are HQ device drafts, labeled *not in the Planner* and sent only by an explicit **Send drafts**. HQ never reads the Planner's per-origin drafts.
- **RW-6.** Export, import and restore stay with the Planner service and its existing format (`jones-planning-export` v1), as in T4 P-7.
  - Phase 1 shows Export as a pointer to the Planner's own tools.
  - After the bridge, read-only `exportJson`/`exportMarkdown` bytes are written unmodified through a native save dialog.
  - **Import and replace-restore stay in the Planner's own tools.** HQ re-implements no destructive guard.
<!-- codex-section:end id="spec.hq-social-work#req.work-core.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.work-views.001" -->
- **RV-1.** Board: seven status columns in fixed order, collapsible, with cards in position order.
  - **Drag:** pointer and touch hold.
  - **Keyboard:** Alt+←/→ changes status, Alt+↑/↓ reorders, M opens the move menu.
  - **Menu:** every status plus up, down, top and bottom.

  Drag, keyboard and menu all call the same `move` with identical anchors. Each move offers Undo.
- **RV-2.** Quick capture: title-only capture into Inbox from the Work toolbar and a keyboard shortcut scoped to the focused Work domain. The default status is inbox. No date is invented.
- **RV-3.** Card detail panel: title, kind, status, why, horizon, priority, area (shown as a label), notes autosave after 1,200 ms, checklist with reorder, typed date editor, references as plain links that open externally and never start anything. It handles the conflict states Keep mine / Use theirs.
- **RV-4.** Views with Planner behavior parity:
  - **Glance:** Now, the next 21 days, Inbox, Worth a look, Recently changed.
  - **List:** sortable, with inline status and horizon.
  - **Calendar:** month and agenda; an unscheduled tray that asks which date kind to create; day-precision chip moves keep kind, time and zone; ±1 day and +1 week.
  - **Timeline:** horizon lanes across quarters.
  - **Review:** one-tap prompts.
  - **Archive:** restore.
- **RV-5.** The **By date** board (T4; the earlier "Lists" name is kept as an alias destination) illustrates the owner's Today / This week / Later reference. Groups are derived from the items' actual dates only:
  - **Today:** a day-precision date today, or an overdue deadline;
  - **This week:** a day or week date later in the current week, bounded by the Planner's `week_start`;
  - **Later:** a later date, or a month, quarter or year period;
  - **Undated:** everything else.

  Each group shows its rule. Done and Dropped are hidden.

  By date is **read-only**:
  - Drag and keyboard moves are inert, with an explanation.
  - The move menu offers status moves only.
  - It never writes a date and never relabels a horizon.

  Board presets are saved filters by area, kind or status, stored per device. Weekly plan (editable lists) stays unbuilt: D-3 is deferred.
- **RV-7. Working defaults** (reversible, without a further owner question):
  - Work `home` is the Board.
  - Weeks honor the Planner's `week_start`.
  - Work shows all items, with a quiet note: *"Planner items aren't project-scoped · showing all planning"*. That holds until an owned project mapping exists. `area` is never treated as project identity, and Work never switches project.
- **RV-6.** Work secondary navigation restores its view, filters, scroll and selection after a domain switch. Mode switch, drag, reorder, status/horizon/date changes, link following and navigation make zero execution calls. They never resubmit Jones work and never change a source-owned status.
<!-- codex-section:end id="spec.hq-social-work#req.work-views.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.safety.001" -->
- **RX-1.** Public repository content uses fictional fixtures only. It contains no private records, brand names, screenshots of owner content, internal addresses, credentials or session history.
- **RX-2.** Private source (Fieldnotes and Manual Planner) informs interfaces only. The single exception is the three files cleared by owner decision D-1 (`ctx.d1-import.001`). No other file is imported.
- **RX-3.** The renderer gets no generic network, filesystem or shell access. Service access is main-process only. Each domain uses an enumerated route allowlist. Endpoints are user-configured at runtime and never committed. Tokens stay in the main process.
- **RX-4.** Agents never read live Social or Planner data. Live adapters are verified against hand-written synthetic HTTP exchanges and, optionally, a task-owned scratch service instance with synthetic data.
- **RX-5.** Every observed external state shows its freshness: last synced, offline, unknown. Stale or unknown state never renders as verified success.
<!-- codex-section:end id="spec.hq-social-work#req.safety.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.references.001" -->
- **RL-1. Ownership.** A link is part of its **source record** and is persisted by that record's owner:
  - a Work item, by the Planner service;
  - a Social draft, by the Social service;
  - a Design item, by Design's own store.

  HQ adds no global link table, index, task store or generic reference platform.
- **RL-2. Shape.** A link is T0's existing `ReferenceEnvelope`, unchanged:
  - `version`, `domain`, `projectId`, `kind`, `entityId`;
  - `title`: the readable snapshot taken at link time;
  - `returnDestination`;
  - optional `sourceRevision` (the target revision observed at link time);
  - optional `workspaceId`.

  Duplicates (same `domain`/`kind`/`entityId` on one source record) are rejected. At most 30 links per record, shared with Planner's existing reference limit.
- **RL-3. Creation.** *Link to…* opens a picker that searches through each target domain's provider (`find`), scoped to the current project. Paste or drop of a serialized envelope is validated with `parseReference`. Creation is a normal versioned mutation of the source record. A version conflict uses that record's existing conflict UI. Undo removes the link.
- **RL-4. Resolution and freshness.** Each target domain's provider resolves envelopes to one of these statuses:
  - `available`;
  - `changed` (latest revision ≠ `sourceRevision`);
  - `archived`;
  - `missing` (not found; deleted where deletion exists);
  - `moved` (the target's project ≠ `projectId`);
  - `forbidden`;
  - `unavailable` (owner service unreachable or not connected);
  - `unknown`.

  Every status carries `observedAt`. The latest title, revision and destination are carried when known. The readback cache is **HQ-local and per device**, never written back to the source record, so reading never mutates. Unresolved, stale and unknown states never render as available. The snapshot title and provenance always stay readable.
- **RL-5. Navigation and return.** Opening a link calls the shell's `open(envelope, returnTo)`. The shell switches to the target domain and that provider's destination, and gives the target module a return context: label and source `DomainDestination`. *Back to <title>* restores the source domain, its destination and its module state.
  - For `moved`, or another project, the shell shows the project context and does not navigate silently. With T0's single fixed context, it shows the reference read-only.
  - For `missing` and `unavailable`, it shows the snapshot, with Unlink available.
- **RL-6. Revision semantics.** `sourceRevision` records what was linked: a Social draft `version`, a Planner item `revision`, a Social run's as-of date, or a Design `VersionId`. Opening goes to the latest target, unless the provider offers a revision-pinned destination (Design versions are immutable). *Update snapshot* is an explicit user mutation that rewrites the title and `sourceRevision`. Nothing updates snapshots automatically.
- **RL-7. Unlink.** Unlink removes the envelope from the source record only, through a versioned mutation with Undo. It never touches the target.
- **RL-8. Capability gating and compatibility.**
  - Link creation for a source domain is enabled only when its persistence owner advertises `hq-references-v1`. Fixture adapters do advertise it.
  - The Social service today **ignores unknown save fields**. Writing links to a service without the flag would silently lose them, so it is forbidden.
  - Records without links load unchanged.
- **RL-9. Export and restore.** Planner export/import (`jones-planning-export` v1) carries links verbatim inside `references`. A round trip preserves every envelope byte-for-byte. An older Planner rejects such an import before any write, which is acceptable and documented. HQ adds no export format.
- **RL-10. Zero dispatch.** Searching, resolving, linking, unlinking, opening, returning, dragging a linked card and following a citation make **zero execution calls**. Provider and port interfaces contain no execution members. Tests assert this with the Social call recorder and the Work port surface. Design's connector spy is requested from the Design owner for Design targets.
- **RL-11. Not granted.** D-4 does not grant D-3 boards, lists or labels. It does not grant backlinks or "linked from" queries across domains, since that would need a global index. It does not grant automatic snapshot refresh, service schema mutation or publication without the gates in `ctx.operator-interaction-inventory.001`.
<!-- codex-section:end id="spec.hq-social-work#req.references.001" -->

## Acceptance

<!-- codex-section:begin id="spec.hq-social-work#ac.foundation-baseline.001" -->
The root has recorded the accepted T0 commit, the actual workspace globs, the module registry mechanism and path, the `@hq/contracts` export names, the test runner and the scripts (`typecheck`, `test`, `build`, dev). It has published any path rebind as a plan delta. Until then, implementation lanes do only reversible preparation.
<!-- codex-section:end id="spec.hq-social-work#ac.foundation-baseline.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.workspace-skeleton.001" -->
`modules/social`, `modules/work` and `packages/hq-ui` exist as workspaces, each with a package manifest, a TypeScript configuration and a passing empty test. The root makes these changes:

- Add the three workspaces to the root workspaces list.
- Add their sources to the root `tsconfig.json` `include`.
- Extend `vitest.config.ts` to `modules/**/*.test.{ts,tsx}` and `packages/hq-ui/**/*.test.{ts,tsx}`, with a DOM environment for `.tsx` tests.
- Add the batched DOM-testing devDependencies.
- Add `@hq/social` and `@hq/work` as `apps/desktop` dependencies.

These come from one root-owned commit with one lockfile regeneration. Fresh `npm install`, `npm run typecheck`, `npm test` and `npm run build` pass. Each module renders an "available, no data" stub through `MODULES`.
<!-- codex-section:end id="spec.hq-social-work#ac.workspace-skeleton.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.ui-kit.001" -->
The kit consumes T2's tokens at `f3c1daff`. The integrity test passes.

- **Tests and contrast.** Token and primitive tests pass in light and dark. All 104 of T2's contrast pairs are recomputed and meet T2's thresholds: text at least 4.5:1, focus at least 3:1.
- **Preserved content.**
  - Every `PreservedContent` kind keeps its pixels and computed colours across Light, Dark and System changes.
  - Its computed `color-scheme` equals the **recorded** scheme, not the chrome's. This is checked for an `<img>`, an SVG-as-`<img>` and a same-origin `srcdoc` iframe whose `prefers-color-scheme` probe reports the recorded scheme.
  - No filter, blend or opacity is computed on the well.
- **Keyboard and evidence.** Every primitive is operable by keyboard alone. Light and dark evidence of the kit page is attached.
- **Gaps stay visible.** T2's unverified surfaces stay listed as gaps, not passes: Electron, macOS, SF fallback, screen readers, forced colours and 2×.
<!-- codex-section:end id="spec.hq-social-work#ac.ui-kit.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.custody-transfer.001" -->
Explicit activation predicate: the root has transferred named `apps/desktop` shell-chrome paths to the HQ-UI lane in writing, with T0's agreement, after T0 acceptance.
<!-- codex-section:end id="spec.hq-social-work#ac.custody-transfer.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.shell-chrome.001" -->
The rail order is Design, Social, Work, with an accessible name and a non-color selected state. The project context is visible. The Light/Dark/System control persists, and System follows OS changes. Per-domain destination restoration is unchanged from T0's tests. Light and dark screenshots are attached.
<!-- codex-section:end id="spec.hq-social-work#ac.shell-chrome.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.social-core.001" -->
The fixture `SocialWorkspacePort` reproduces Fieldnotes' validation messages, conflict (409), unknown-brand and channel errors, and run lifecycle including interrupted. It runs the unknown-submit path. It exposes a call recorder distinguishing `execution` (`submitRun`) from `content` calls.
<!-- codex-section:end id="spec.hq-social-work#ac.social-core.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.social-content.001" -->
Library, editor, brands and calendar work against the fixture with empty, loading, error, saving and conflict states. A calendar move produces exactly one versioned save and can be undone. Switching domains preserves unsaved editor text. The recorder shows zero `execution` calls for all content interactions. Light and dark evidence is attached.
<!-- codex-section:end id="spec.hq-social-work#ac.social-content.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.social-workbench.001" -->
Each of the eight tools builds the exact native input object from its form or import. The recorder shows exactly one `submitRun` per explicit Run and zero for every other interaction. A fault-injected lost response renders unknown with possible matches and never resubmits. Results render for every tool's synthetic example. Save-to-library creates one draft. Light and dark evidence is attached.
<!-- codex-section:end id="spec.hq-social-work#ac.social-workbench.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.social-domain.001" -->
The Social descriptor mounts in the T0 registry. Secondary navigation restores section, filters and selection across Design → Social → Work → Social. The limits banner is present. The Social module imports only `@hq/contracts` and `@hq/ui` across package boundaries.
<!-- codex-section:end id="spec.hq-social-work#ac.social-domain.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.service-bridge-approval.001" -->
Explicit activation predicate. Owner direction for D-2 was recorded on 2026-10-20. The remaining conditions are:

- single-writer custody of `packages/contracts/`, `apps/desktop/electron/` and `apps/desktop/src/environment.d.ts` has actually been accepted;
- cross-owner compatibility of the additive contract has been confirmed by T0 and the Design coordinator.

Real-service use additionally requires verified user-entered endpoints and an exact access scope (`ctx.operator-interaction-inventory.001`).
<!-- codex-section:end id="spec.hq-social-work#ac.service-bridge-approval.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.service-bridge.001" -->
Bridge conformance passes:

- Only enumerated domain routes are callable, and an unknown route is rejected before any network I/O.
- The renderer cannot supply a host, path outside the allowlist, header or method.
- Endpoints come only from main-process configuration.
- The Fieldnotes workspace token and Planner request headers are added in main.
- Responses are size-capped.
- Timeouts surface as `unknown` for mutations and as `unavailable` for reads.
<!-- codex-section:end id="spec.hq-social-work#ac.service-bridge.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.live-adapters.001" -->
Each live adapter passes the same port conformance suite as its fixture against synthetic recorded exchanges. The Planner adapter:

- reuses the same `X-Request-Id` and body on retry, and surfaces `X-Replayed: 1` as `replayed`;
- maps 409 `revision_conflict` and `order_conflict`;
- treats 422 `request_id_reused` as a defect;
- sends `Content-Type: application/json` and `X-Planning-Request: 1` on mutations;
- disables redirects and maps a mutation timeout to `unknown`.

Origin and Host protections are preserved: main-process requests send no `Origin`, the endpoint host is loopback or the Planner's `--allowed-host`, and no protection is weakened. The Fieldnotes adapter refreshes the token on 403, maps 409 conflicts and never retries `submitRun`. No live data is read by agents.
<!-- codex-section:end id="spec.hq-social-work#ac.live-adapters.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.work-core.001" -->
**Parity and logic.** Validation parity table tests pass for every enum and limit, every date precision, time and timezone rule (including the DST-gap rejection), and the URL rule. Ordering, period (with `week_start`), review-bucket and filter tests pass.

**Conformance suite.** It includes T4's seven cases:

1. Each anchor form, a missing anchor (`order_conflict`), a stale revision (`revision_conflict` returning the current item), and a cross-status move that renumbers only the target status.
2. **Actual replay:** the same ID and body returns `replayed: true`. The same ID with a different body returns `request_id_reused`.
3. A create lands at the top and keeps its date kind and precision exactly.
4. The types reject `patch({status})`.
5. CAS undo refuses after a concurrent same-field change and succeeds after a different-field change.
6. The port key set has no execution member.
7. By date grouping at fixed dates.

**State hook.**

- An unconfirmed write is reconciled only by the same request ID and body.
- A same-title match is reported as *possibly saved*, never as proof.
- Undo restores exact anchors and is consumed once.
- The undo stack survives a module remount.
<!-- codex-section:end id="spec.hq-social-work#ac.work-core.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.work-board.001" -->
Board drag, keyboard and menu moves produce identical `move` calls and agree after Undo. Status changes from the detail pills and the List select are `move` calls whose Undo restores the exact position. Quick capture creates one inbox item with no dates. A date-like word only offers a suggestion, and the title is unchanged. Offline capture creates labeled HQ drafts that are sent only explicitly. Detail autosave and conflict states work. Zero execution-class calls exist because the port has none, and a test asserts the port surface. Empty, loading, error, offline and saving states are covered. Light and dark evidence is attached.
<!-- codex-section:end id="spec.hq-social-work#ac.work-board.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.work-views.001" -->
Glance, List, Calendar, Timeline, Review, Archive and By date render the synthetic fixture. Calendar and Timeline moves produce the documented patch with Undo. By date classifies only by actual dates, honors `week_start`, keeps undated items in Undated, and never writes: drag is inert and the menu has no reorder items. The project note is shown and nothing filters by `area` as a project. Light and dark evidence is attached.
<!-- codex-section:end id="spec.hq-social-work#ac.work-views.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.work-domain.001" -->
The Work descriptor mounts in the T0 registry. View, filters, scroll and selection restore across a domain round trip. Quick capture is scoped to Work focus. The Work module imports only `@hq/contracts` and `@hq/ui` across package boundaries.
<!-- codex-section:end id="spec.hq-social-work#ac.work-domain.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.integration.001" -->
On the integrated candidate:

- Design → Social → Work → Design restores each domain, with Design's own tests unchanged.
- An explicit theme survives reload, and System follows OS changes.
- A theme change leaves captured content intact.
- A domain switch, card move or reference follow makes zero execution calls.
- The deduplicated union of affected checks passes on the exact head.
- A cumulative light and dark evidence set is attached.
<!-- codex-section:end id="spec.hq-social-work#ac.integration.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.reference-contract-custody.001" -->
Explicit activation predicate: the root has actually accepted single-writer custody of `packages/contracts/src/` and `apps/desktop/src/App.tsx` for the reference additions, and the Design coordinator has confirmed the additive optional `ModulePort` members are source-compatible with Design's consumers.
<!-- codex-section:end id="spec.hq-social-work#ac.reference-contract-custody.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.reference-contract.001" -->
`@hq/contracts` exports `ReferenceStatus`, `ReferenceResolution`, `ReferenceProvider`, `ReferencePort` and `ReturnContext`. The new `ModulePort` members are optional. Existing T0 tests and the Design placeholder compile unchanged. Contract tests cover status parsing, the closed status set and the fact that provider and port types have no execution members.
<!-- codex-section:end id="spec.hq-social-work#ac.reference-contract.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.reference-shell.001" -->
The shell aggregates registered providers. `open(envelope, returnTo)` switches domain and destination and passes the return context. *Back* restores the source destination. A project mismatch never navigates silently. Unknown domains or kinds render read-only. Shell tests cover each status path and assert zero calls to any non-reference port.
<!-- codex-section:end id="spec.hq-social-work#ac.reference-shell.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.reference-ui.001" -->
`@hq/ui` ReferenceChip, LinkList and LinkPicker render every RL-4 status with a text label and freshness, in light and dark and by keyboard alone. Snapshot titles stay readable for missing or unavailable targets. Unlink and Update snapshot are explicit actions with Undo.
<!-- codex-section:end id="spec.hq-social-work#ac.reference-ui.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.social-references.001" -->
The Social provider resolves drafts, runs and brands on the fixture. Draft links and run citations persist only with `hq-references-v1`; without it they show *not saved — needs Social service support* and are never dropped. Link, unlink, conflict and Undo paths pass. The recorder shows zero `execution` calls for every reference interaction.
<!-- codex-section:end id="spec.hq-social-work#ac.social-references.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.work-references.001" -->
The Work provider resolves items, including archived and missing. The card detail's Links section adds and removes `kind: 'hq'` entries only with `hq-references-v1`, using revision guards, conflict handling and Undo. Fixture export/import preserves envelopes byte-for-byte. Dragging a linked card makes zero execution calls.
<!-- codex-section:end id="spec.hq-social-work#ac.work-references.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.reference-integration.001" -->
On the integrated head with fixtures:

- A Social draft links to a Work card, and the Work card links back.
- Opening each link navigates and returns with the source state intact.
- `changed`, `archived`, `missing`, `moved` and `unavailable` render truthfully.
- Unlink leaves the target untouched.
- An export/import round trip preserves the links.
- All execution spies read zero.
- Light and dark evidence is attached.
<!-- codex-section:end id="spec.hq-social-work#ac.reference-integration.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.research-decision-basis.001" -->
## Research And Decision Basis

### Evidence read for this plan (2026-10-20, read-only)

| Source | Identity | Finding used |
| --- | --- | --- |
| HQ bootstrap assignment | `Jones-Systems/HQ` `work/hq-foundation` at `aab225bcbb49968fec97dc71bbc20caf21fe8d1d`, `docs/engineering-specs/hq-bootstrap.md` | T0 owns root, `apps/desktop`, `packages/contracts`. Social/Work are explicit unavailable slots. Strict Electron security. |
| HQ shared foundation v0.3 | Uncommitted source, SHA-256 `a0d4e678…e33271`; public copy at `docs/design/hq-shared-foundation.md` | Domain boundaries, appearance, references and the three state kinds. Zero execution calls from cards. Planner is the authority. |
| HQ Design PRD | `work/hq-design-plan` at `149d84377ef1e7b72d9df92189f6f9bf83801898`, `docs/prds/design.md` | Design scope and its separate owner. |
| Design lane draft (uncommitted, read-only) | Design plan worktree `docs/design-lanes.json` | Design uses `modules/design/<section>/`, `packages/design-store/`, `ShellContextPort`, `StoragePort`, renderer-glob registration. Social/Work mirror the `modules/<domain>/` layout. |
| HQ T0 candidate | `work/hq-foundation` at `33dfe44d6786b40ac8a5dcb5442d85c20da38c67`, draft PR #2 (unaccepted), read back after first plan publication | Contracts, registry, shell, state, styles, Electron security and the scripts quoted in `req.foundation-binding.001` and `iface.*`. |
| Root instruction | Root coordinator message | T0 is expected to provide npm workspaces `apps/desktop` + `packages/contracts`, the registry `apps/desktop/src/modules.tsx`, and `@hq/contracts` domain/theme/project/ModulePort plus read-only platform/version. Not yet accepted or frozen. |
| Manual Planner | Private `Jones-Systems/Codex-V3` at `4beb491c44551b6e4207adcc7459c4b11407bcbc`, `apps/manual-planner/` (MIT licensed, private repository) | Model, API, conflict/idempotency, save states, undo, views, keyboard model and tokens summarized in `req.work-*`. Pure logic lives in `public/js/ordering.js`, `dates.js` and `model.js`. The authoritative validation is Python `planning/validation.py` and `dates.py`. |
| Social workspace (Fieldnotes) | Private Social tools repository at merged `main` `3f647daced7fa12f4885222a22ec542bbae6d4e1`: `apps/social_dashboard/`, `docs/social-growth-dashboard.md` | SQLite tables brands/content/runs. JSON routes `GET /api/workspace` (includes `csrf`), `GET /api/sample/<tool>`, `GET /api/runs/<id>`, `POST /api/content`, `POST /api/brands`, `POST /api/runs`. Same-origin Host/Origin checks and an `X-Workspace-Token` header on mutations. One queued worker with resource limits. Interrupted on restart, never retried. |
| Social delivery thread (inspected, not messaged) | Native thread readback, positions 620–632 | Delivered account-free tools and dashboard. The next useful phase is ordinary forms/file imports, clearer results and smoother research-to-draft flow. |

T3 contributors to this plan:

- T1 planner (this lane), `claude-opus-5-5`/high;
- one read-only Manual Planner source-inventory sub-agent (Explore type, launched by T1 before the no-descendant restriction was noticed; result reused, nothing mutated).

The parallel mockup lanes T2 (visual system), T3 (Social) and T4 (Work) had published no artifacts at plan time. Their dependency points are listed below.

### Hidden-impact screen (applied; triggers: cross-owner/cross-process/cross-language boundaries, persisted shapes owned elsewhere, a shared contract amendment)

1. **Caller view and rationale.**
   - Users reach Social and Work through the rail, then domain navigation.
   - Domain code calls only its own port.
   - Fixture adapters live in the renderer. Live adapters call `window.hqServices.<domain>.call(route, params)`, which is main-process IPC alongside T0's `window.hqDesktop`.
   - The present boundary exists because both authorities are private Python services with same-origin HTTP guards. A Node main-process request sends no Origin or `Sec-Fetch-Site` header and a correct Host, so it passes the existing guards. Neither service needs to change for read/write parity. This is an inference from source; it is proved only by the live-adapter tests in a scratch instance.
2. **State and ownership.**
   - Planner items, settings, history and backups: the Planner service.
   - Drafts, brands, runs and receipts: Fieldnotes.
   - UI state (view, filters, selection, unsaved editor text, board presets): the HQ domain module. The candidate `ModulePort` has no storage, so the module holds this state in an in-memory store until G-3 is resolved.
   - Invalid states rejected client-side and again by the authority: a date precision/time mismatch, a non-http reference, an unknown channel or brand, a stale version.
3. **Consumers and hidden impact.**
   - Direct: the shell registry, `@hq/contracts`, `packages/hq-ui`, and both services' HTTP APIs.
   - Indirect: the existing Fieldnotes browser UI and the Planner web UI, which keep working and share the same data, so concurrent edits are real. HQ must honor version and revision conflicts rather than assume exclusivity.
   - Design is unaffected except for the optional adoption of `hq-ui` tokens.
   - Coverage is **partial**: the universe is the HQ public tree at `aab225b` plus the two private sources at the revisions above, discovered by reading the route and handler source. Excluded: T0 code (unpublished), the hosting configuration of the live services (not read, by design), and the physical-device touch drag (unverified upstream).
4. **Interface depth.** Ports sit at the domain-operation level: `saveContent`, `move`, `patch`. They do not expose HTTP routes, so fixture and live adapters are interchangeable. The bridge sits one level lower, with enumerated routes, because it is a shared security boundary that must be reviewable as a fixed list. Exposing generic `fetch` is rejected.
5. **Compatibility and migration.** HQ source work needs none. Records keep their identity, format and export. HQ adds no field the services would reject. Planner card references to HQ objects (`hq:` URLs) would fail the Planner's http(s) rule. Stored references therefore wait for the Planner-owned `hq-references-v1` schema phase that D-4 plans (`iface.service-reference-extensions.001`), behind its Operator Interaction Inventory gates.
6. **Load-bearing safety claims.**
   - Zero execution calls from Work (the port has no such method; tested).
   - Social runs only on explicit Run, with no automatic retry of an unknown (recorder tests).
   - The renderer cannot reach arbitrary hosts (CSP plus bridge conformance).
   - No private data in the public repository (fixtures are authored fictional content; reviewed in the diff).
7. **Verification consequences.** The `test.*` intents below.
8. **References addendum (D-4).**
   - **Callers.** Users link from Social drafts and Work cards (and later Design). Modules call `ModulePort.references` (`find`, `resolve`, `open`). Providers are registered by the integration owner.
   - **Ownership.** Links live in their source records (RL-1). The readback cache is device-local.
   - **Hidden impact, Social.** The live Social service ignores unknown save keys, so an unflagged write would silently lose links (RL-8).
   - **Hidden impact, Planner.** Validation rejects unknown fields and non-http URLs, so links fail loudly without the extension.
   - **Hidden impact, existing web UIs.** The Planner and Social web UIs will see links they cannot render. The Planner UI would show `kind: hq` entries with no URL; its owner must render them as labels.
   - **Compatibility.** Additive fields default to empty. Old exports import unchanged. New exports fail visibly on old services.
   - **Safety.** Zero dispatch (RL-10), no write-on-read, and no silent project switch. Each live adapter shares its fixture's conformance suite. The visual evidence covers both themes.

### Decisions

- **DEC-1 (working default).** Five implementation lanes plus root-owned serialized shared tasks. Rationale is in `ctx.task-plan.001`.
- **DEC-2.** Fixtures first, live later. Each domain is useful for review and tests without the bridge. Live connection is held behind D-2.
- **DEC-3.** No new runtime dependencies by lanes. Drag uses pointer events, following the Planner's proven engine design. Validation is hand-written TypeScript. Any devDependency need (for example a DOM test environment) is proposed to the root, which batches it into the skeleton task.

### Owner decisions (defaults allow progress)

| ID | Decision | Default until decided | Recommendation |
| --- | --- | --- | --- |
| D-1 | Publish selected Manual Planner pure modules into public HQ with provenance? | **Approved by M Jones (2026-10-20)** for exactly `ordering.js`, `dates.js` and `model.js`, after exact-file checks. The checks passed; see `ctx.d1-import.001`. No other private file is cleared. | Import verbatim, with provenance |
| D-2 | Connect HQ to the existing Fieldnotes and Planner services through a main-process bridge with user-entered endpoints? | **Owner selected this as next (2026-10-20).** Source planning for the narrow preload/main bridge and adapters is approved. Root accepts the narrow preload approach as the development direction. Still gated: single-writer custody and cross-owner compatibility for contracts/IPC files; real-service access requires verified user-entered endpoints and an exact access scope. No live-data access, credentials, service mutation or deployment. | Proceed under those gates |
| D-3 | Extend the Planner schema for editable manual lists, multiple boards and multi-labels? | **Deferred** by the owner (2026-10-20). Rule-based Lists view and per-device board presets; area shown as a label. Not granted by D-4. | Defer |
| D-4 | Cross-domain references | **Owner: likely core; plan now (2026-10-20).** Planned in `req.references.001` and `iface.references.001`. Any service schema change or live activation stays behind the Operator Interaction Inventory gates. | Build the HQ side on fixtures now; propose the service extensions |

### Gaps that hold only their dependents

- **G-1.** T0 code is published as candidate `33dfe44` but not accepted or frozen. The plan is bound to it; acceptance and any delta are confirmed in `task.bind-foundation.001`. No compiler-validated runnable implementation is claimed for module code.
- **G-2.** T2 is published and accepted (`ctx.visual-system-binding.001`). T3 is preliminary (`ctx.social-design-reconciliation.001`). T4 is unpublished. Remaining layout gaps block visual acceptance, not core start.
- **G-3.** UI-state storage. `ModulePort` has no storage member, and T0 remounts modules on every domain switch.
  - **Default:** a module-level in-memory store that survives remounts within the session, plus destination strings for restorable location.
  - **Proposed to the root:** a namespaced `storage` member on `ModulePort`, needed for restoration across restarts.
- **G-4.** HQ has no `tests/check-groups.toml`. The catalog in `ctx.check-catalog.001` is proposed bytes for the root to adopt.
<!-- codex-section:end id="spec.hq-social-work#ctx.research-decision-basis.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.foundation-binding-record.001" -->
## Foundation binding record (R0, `task.bind-foundation.001`)

**Read-only binding, 2026-10-20.**

- **Candidate:** `Jones-Systems/HQ` `work/hq-foundation` at `33dfe44d6786b40ac8a5dcb5442d85c20da38c67`, draft PR #2. The remote branch is unchanged since the first readback.
- **Tree:** 26 files. Root: `package.json`, `package-lock.json` (v3), `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `README.md`, `AGENTS.md`. Plus `apps/desktop/{package.json,index.html,vite.config.ts,tsconfig.electron.json}`, `apps/desktop/electron/{main.ts,preload.cts,security.ts,security.test.ts}`, `apps/desktop/src/{App.tsx,main.tsx,modules.tsx,state.ts,state.test.ts,styles.css,environment.d.ts}` and `packages/contracts/{package.json,src/index.ts,src/index.test.ts}`.
- **Workspaces:** an explicit list, `apps/desktop` and `packages/contracts`. The lockfile has the same two workspace packages.
- **Scripts:** `dev`, `dev:web`, `typecheck` (`tsc --noEmit` plus the Electron tsconfig), `test` (`vitest run`), `build:electron`, `build` (typecheck, `vite build`, Electron tsc), `start`, `preview`.
- **Pinned toolchain:** TypeScript 7.0.2, Vite 8.3.4, Vitest 5.0.5, Electron 44.9.0, React and React DOM 19.3.1, Node ≥22.12.
- **Tests:** vitest includes `apps/desktop/**/*.test.ts` and `packages/contracts/**/*.test.ts` only. There is no DOM environment.
- **Contracts and registry:** exactly as recorded in `req.foundation-binding.001` and `iface.domain-module.001`.
- **Security:** CSP `default-src 'none'; … connect-src 'none'`. The preload exposes only `hqDesktop` (platform and Electron version). The window has `contextIsolation`, `sandbox` and no `nodeIntegration`, and denies navigation, windows, permissions and downloads.
- **`.gitignore`:** `node_modules/`, `dist/`, `dist-electron/`, `.t3/`, `*.tsbuildinfo`, `*.log`.

**T0's reported evidence** (PR #2 and its native result; not re-run here): fresh install, typecheck, 25 tests in 3 files and build pass; zero npm vulnerabilities. Browser-panel checks at 1280×800 covered destination restoration, reload persistence, light and dark, and live System following. Native Electron launch and Mac packaging/signing are **unverified**.

**Outcome.** The binding read confirms the recorded contract and scripts, with no rebind. The root accepts this exact candidate for bounded development. That is neither a merge nor native-runtime acceptance.

**Shared-path custody (released 2026-10-20).** T0 completed its custody handoff in issue #1 (comment 6279970589), and the root verified it directly. T0 releases `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `apps/desktop/package.json` and `apps/desktop/src/modules.tsx` for `task.bind-foundation.001` and `task.workspace-skeleton.001`, and the root assigned these paths to T1 in its own worktree. Creating the `modules/social`, `modules/work` and `packages/hq-ui` manifests, tsconfigs, minimal stubs and tests has no conflict.

Still outside this transfer:

- `apps/desktop/src/App.tsx` and `apps/desktop/src/styles.css` are released by T0 but **unassigned**; a later named UI owner only.
- Shared contracts, preload, main and the service bridge.
- `tests/check-groups.toml`, below.

**RF-2 baseline delta (2026-10-20).** PR #2 now heads at `35f9a3e1fd0561335737ea47f6a680e74a5ad0e7`. That is the merge of PR #5, whose first parent is `33dfe44` and whose second is `79ad2520`. Direct readback of `git diff 33dfe44..35f9a3e` shows exactly four changed paths, all guidance: `AGENTS.md` (+2, a shared-guidance route), `CLAUDE.md` (new, routes to `AGENTS.md`), `.gitignore` (+3 shared-role ignores) and `docs/shared-agent-guidance.md` (new). **No source, manifest, lockfile, config, contract or test path changed**, so every binding above holds unchanged at `35f9a3e`.

The root accepts `35f9a3e` for bounded development; that is neither a merge nor native-runtime acceptance. The updated `AGENTS.md` routes startup to `.agents/shared-guidance.md`. That file is **absent** in this checkout, so shared enrollment is reported as unavailable, and the local agreements plus the Codex V3 `AGENTS.md` read recorded in the work note apply. `task.workspace-skeleton.001` integrates `35f9a3e` by a normal merge.

**Collision.** Design's plan branch (PR #4, stacked on `work/hq-foundation`) already creates `tests/check-groups.toml` with 14 `design-*` groups in the Codex V3 trusted-group schema. This plan preserves that file and its owner. It proposes an additive, disjoint group delta (`ctx.check-catalog.001`) on the coordination channel, and does not write or duplicate the catalog.
<!-- codex-section:end id="spec.hq-social-work#ctx.foundation-binding-record.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.d1-import.001" -->
## D-1 selected-file import record

M Jones approved (2026-10-20) reuse of exactly three files from private `Jones-Systems/Codex-V3` at `4beb491c44551b6e4207adcc7459c4b11407bcbc`. That repository is MIT-licensed with "Copyright (c) 2026 Malcolm Jones". The files were last changed in commit `41503af8f1d143de54063ee70effb00ffdd399b1` (Malcolm Jones). The checks were done on 2026-10-20:

| Source path | Git blob | SHA-256 | Bytes | Checks |
| --- | --- | --- | --- | --- |
| `apps/manual-planner/public/js/ordering.js` | `0415a2103a33f79679284e19c09fbf5a911ae5a5` | `abf14154…57d868b` | 2,759 | SHA-256 matches `provenance.json`. No imports. No URLs, hosts, credentials, names or records. |
| `apps/manual-planner/public/js/dates.js` | `8932be4def432eec59b60427741a08ee4fe66db7` | `390c39e8…54b903` | 12,752 | Matches provenance. No imports. Only notable value: the generic default display zone `America/New_York`. |
| `apps/manual-planner/public/js/model.js` | `926a54e980b384901e50bcd7a20c488fca01ba2a` | `fb24638a…41f80` | 6,575 | Matches provenance. Imports only `./dates.js` and `./ordering.js`. Only vocabulary and pure helpers. |

**Import mapping** (WRK-P, inside `task.work-core.001`):

- **Files.** Copy each file **byte-for-byte** to `modules/work/core/upstream/manual-planner/{ordering,dates,model}.js`. Add hand-written sibling declarations `{ordering,dates,model}.d.ts`. With them, strict TypeScript needs no `allowJs` and no root config change.
- **`PROVENANCE.md`.** Record the source repository, commit, path, blob and SHA-256 per file, plus the MIT notice and copyright line.
- **Integrity test.** It recomputes each SHA-256 and fails on drift.
- **Local changes.** None in the upstream copies. Adaptations go in TypeScript wrappers under `modules/work/core/`. The display zone is passed from Planner settings, never assumed.

No other private file is cleared. In particular, `state.js`, `actions.js`, views, Python validation and the README are not. The Planner's Python validation rules stay interface research, mirrored in hand-written TypeScript.
<!-- codex-section:end id="spec.hq-social-work#ctx.d1-import.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.social-design-reconciliation.001" -->
## Social design reconciliation (T3 preliminary mockup)

**Evidence.** `docs/design/social/hq-social-design.md`, `hq-social-mockup.html` and 19 PNGs (1280×800) at commit `8f91f6b203bb1f4e3b08185343264debae77d179` (PR #9, base `work/hq-foundation`). Read 2026-10-20. This is preliminary mockup evidence, not integrated source proof. The limitations T3 itself reported remain visible: no narrow layout, no axe audit, no screen reader, no real Electron, and a font fallback.

**Destinations (module-local strings; supersede the earlier list):**

- `home` → Overview;
- `overview`;
- `sources`, `sources/<sourceId>` (reserved; SOC-6 held);
- `workbenches`, `workbenches/<toolId>`;
- `library`, `library/<draftId>`;
- `calendar`, `calendar/<YYYY-MM>`. This uses the path form instead of T3's `?month=` so destinations stay path-like; both pass `isDestination`.
- `runs`, `runs/<runId>`;
- `channels`.

The earlier `brands` destination is dropped. Brands are managed from the brand switcher.

**How T3's slices map to plan tasks:**

| T3 slice | Plan task |
| --- | --- |
| SOC-1 | `task.social-domain.001` (navigation, brand switcher, mismatch banner, Overview, Channels) |
| SOC-2 | `task.social-core.001`, plus `task.social-live-adapter.001` (D-2) |
| SOC-3 and SOC-4 | `task.social-content.001` (single body until SOC-6) |
| SOC-5 | `task.social-workbench.001` |
| SOC-6 (variants, draft states, brand profile, source registry) and SOC-7 (Sources) | Social service owner proposals, **held**. The fixture may show *Proposed fields* labels only. |
| SOC-8 | Channels, inside `task.social-domain.001` |

**Adopted states:** service unreachable with last-synced time, Unknown runs, conflict with *Load their version* / *Save mine as a copy*, not saved with text kept, and example data.

**Adopted honesty copy:** never *scheduled*, *published*, *posted*, *live* or *connected*.

**Token values:** from T2 (`ctx.visual-system-binding.001`). T3's proposed token names are superseded by T2's.
<!-- codex-section:end id="spec.hq-social-work#ctx.social-design-reconciliation.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.visual-system-binding.001" -->
## Visual system binding (T2)

**Evidence.** `docs/design/hq-visual-system/` at `f3c1daff9c6ab98d51a1bfb4aafbe83c351c1124` (PR #18, base `work/hq-foundation`). Its changes are limited to that directory. The root accepted it as a design and source artifact for implementation input. T1 read `README.md`, `tokens/hq-tokens.{json,css}`, `tokens/t0-bridge.css`, `components/hq-components.css` and `evidence/manifest.json` at that commit on 2026-10-20.

**Reported checks** (T2's own run, headless Chromium 155 at 1×; not rerun by T1 or root):

- `hq_tokens.py check`: 104/104 contrast pairs pass in both modes;
- `compare_regions.py`: 13/13 region checks pass, with identical well pixels in light and dark chrome, 1:1 wells equal to the source PNGs, and System matching explicit Light/Dark;
- live preview at 1280 and 760.

There is no CI on the base; nothing here is called green CI. **Unverified:** Electron, macOS, SF Pro fallback, real window controls, screen readers, forced colours, 2× capture.

**What it supplies:**

- final role values for RS-1 and the UI kit;
- the preserved-content marker, aligned with RS-2;
- SaveIndicator and StateView state names, aligned with RS-3;
- reference-block treatments matching RL-4: same project, other project (worded with a warning edge), missing (dashed, snapshot kept).

T3's proposed `--hq-*` names are superseded by T2's role names. `--social-future*` stays a Social domain role.

**The color-scheme pin requirement.** Carried into RS-2, `iface.ui-kit.001` and `ac.ui-kit.001`. It is posted on coordination issue #1 for Design owners, who own their preview, compare and export wells.

**T2 shared proposals, under their existing owners and gates** (none expands T1's R1 cone):

| Proposal | Owner | Gate |
| --- | --- | --- |
| Load tokens and `t0-bridge.css`; retire T0's palette in `styles.css` | Shell chrome (`task.shell-chrome.001`) | A named UI owner assigned for `App.tsx`/`styles.css`, which are released by T0 but unassigned |
| Appearance control in the titlebar; compact drawer below 960px | Shell chrome | Same |
| Bundle IBM Plex Sans 400/500/600 and Mono 400/500 as local woff2. No runtime Google Fonts (CSP `font-src 'self'`). | Root (packaging and assets), consumed by `@hq/ui` | An exact-file SIL OFL 1.1 provenance and licence check, recorded before any font file enters the repository. Fallback stack until then. |
| Theme-matched `BrowserWindow` background (`#E6E5DD` light, `#0B0C0A` dark) | Root, Electron main | A later serialized integration phase |
| macOS `titleBarStyle: 'hiddenInset'` with drag and no-drag regions | Root, Electron main, plus shell chrome CSS | Same, plus native macOS verification |
| Pin `--hq-content-scheme` to the recorded theme on every preserved well | `@hq/ui` (`PreservedContent`); Design owners for Design wells | `ac.ui-kit.001`; Design consumes it via issue #1 |
<!-- codex-section:end id="spec.hq-social-work#ctx.visual-system-binding.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.work-design-binding.001" -->
## Work design binding (T4)

**Evidence.** `docs/design/work/` at `1bb550de4069ff6b0e1666844896b1a6c2cb03e9` (PR #19). Its 19 changed paths are all in that directory. T1 read `hq-work-design.md`, `adapter-boundary.md`, `mockup-evidence.md` and the observations in `planner-behavior-inventory.md` on 2026-10-20.

The 13 captures and zero-execution checks are **mockup evidence** against an in-page fixture. They are not adapter, service, persistence or native proof, and there is no CI on the base. T4 reports these gaps; they stay visible:

- full loading and error views;
- screen readers;
- replay and `request_id_reused`, which the mockup fixture lacks;
- date editing;
- any real service or persistence.

**Adopted:**

- P-1 → RW-7; P-2 → RW-8; P-3 → RW-5 (module-level store) and RW-8 (consume once).
- P-4, tightened by RW-9: same-request reconciliation only; a heuristic match is never proof.
- P-5 → RW-10; P-6 → `iface.work-port.001` invariants and RW-4; P-7 → RW-6; P-8 → Work destinations.
- T4's seven conformance cases → `ac.work-core.001`; its design acceptance checks 1–8 → `ac.work-board.001`, `ac.work-views.001` and `ac.work-domain.001`.
- Bridge transport notes → `ac.live-adapters.001`.
- Layouts are reconciled against `mockups/work-hq.html` and its screenshots.

**Resolved, superseding T4's "undecided" text with the owner decisions already received:**

| T4 item | Resolution |
| --- | --- |
| D-1 / GW-3 | The 3 selected files are checked and approved (`ctx.d1-import.001`) |
| D-2 / GW-1 | The source bridge is next. It is held on contracts/IPC custody (`ac.service-bridge-approval.001`). |
| D-4 / Q-5 | The core reference plan is now in this spec. Option B is the target, Planner-owned and lossless after its explicit schema phase. Option C is rejected. |
| D-3 / Q-4 | Editable lists and Weekly plan are deferred |
| Q-1 | Board home (RV-7) |
| Q-2 / GW-6 | All items, with a not-project-scoped note (RV-7) |
| Q-3 / GW-5 | `week_start` (RV-5) |
| GW-2 | Still G-3 |
| GW-7 | Live verification needs a scratch Planner with synthetic data |

**Material contract conflicts: none found.** P-10 option B matches `iface.service-reference-extensions.001`. T4's "Linked across HQ" rows (a Design annotation with a revision, a Jones request with an observed status that never changes the card, and an unavailable target with a snapshot) match RL-4 through RL-6 and RL-10. Jones requests are a target kind for a provider owned outside this plan; until one exists they resolve as `unknown`.
<!-- codex-section:end id="spec.hq-social-work#ctx.work-design-binding.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.change-surface.001" -->
## Exact Change Surface And Ownership

### Writer map (one writer per path; literal, subject to the RF-2 rebind)

| Lane / owner | Literal write scope | Never writes |
| --- | --- | --- |
| **HQ root (integration owner)** | `package.json`, `package-lock.json`, root configs, `modules/social/package.json`, `modules/social/tsconfig.json`, `modules/work/package.json`, `modules/work/tsconfig.json`, `packages/hq-ui/package.json`, `tsconfig.json`, `vitest.config.ts`, `apps/desktop/package.json`, `apps/desktop/src/modules.tsx`, `apps/desktop/src/environment.d.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/services.ts`, `apps/desktop/electron/services.ts`, `apps/desktop/electron/services.test.ts`, `apps/desktop/electron/main.ts`, `apps/desktop/electron/preload.cts`, `docs/evidence/hq-social-work/foundation/`, `docs/evidence/hq-social-work/integration/`, `docs/evidence/hq-social-work/verification/` | Module feature code |
| **UI** (HQ-UI lane) | `packages/hq-ui/src/`, `packages/hq-ui/test/`, `packages/hq-ui/README.md`, `docs/evidence/hq-social-work/ui/`; after custody transfer: `apps/desktop/src/App.tsx`, `apps/desktop/src/styles.css` | Contracts, root files, `modules/**` |
| **SOC-C** (Social content lane) | `modules/social/core/`, `modules/social/content/`, `modules/social/index.tsx`, `modules/social/nav/`, `modules/social/live/` (when activated), `docs/evidence/hq-social-work/social-content/` | `modules/social/workbench/` |
| **SOC-W** (Social workbench lane) | `modules/social/workbench/`, `docs/evidence/hq-social-work/social-workbench/` | `modules/social/core/` (proposes changes to SOC-C) |
| **WRK-P** (Work planner lane) | `modules/work/core/`, `modules/work/views/`, `modules/work/live/` (when activated), `docs/evidence/hq-social-work/work-planner/` | `modules/work/board/` |
| **WRK-B** (Work board lane) | `modules/work/board/`, `modules/work/detail/`, `modules/work/capture/`, `modules/work/index.tsx`, `modules/work/nav/`, `docs/evidence/hq-social-work/work-board/` | `modules/work/core/` (proposes changes to WRK-P) |
| **T1 planner** | this spec, `docs/work-notes/hq-social-work.md`, `docs/design/hq-shared-foundation.md` | Everything else |
| **Design lanes / T0 / T2–T4** | their own published scopes | — |

### Serialization rules

- **Root-owned shared files.** These are the manifests, lockfile, registry, contracts, preload and main. The root changes them in ordered commits: the skeleton first, then the bridge, then registration. Lanes propose via the coordination PR.
- **Core is the seam inside each domain.** `modules/<domain>/core/` has one writer: SOC-C for Social, WRK-P for Work. The sibling lane consumes the published core at an exact commit and sends any needed change as a proposal. The core owner lands it as a small commit and the consumer rebinds.
- **Fixtures.** Synthetic fixtures live in `core/fixtures/` and have one writer. Consumers add view-specific fixtures inside their own directory.
- **Generated output.** No generated output is committed. Builds go to ignored directories defined by T0.

### Consumers

- **Direct:** T0 registry and contracts; the `hq-ui` consumers (Social, Work, and optionally Design); the service bridge consumers (the two live adapters).
- **Indirect:** the existing Fieldnotes and Planner web UIs, which share data and therefore concurrency. Neither service is changed.
<!-- codex-section:end id="spec.hq-social-work#ctx.change-surface.001" -->

## Interface Contracts

<!-- codex-section:begin id="spec.hq-social-work#iface.domain-module.001" -->
**Domain module consumption** (bound to T0 candidate `33dfe44`, confirmed at `ac.foundation-baseline.001`).

- **Entry point.** Each domain's package (`@hq/social` in `modules/social`, `@hq/work` in `modules/work`) default-exports a `ComponentType<ModulePort>` from `index.tsx`. Integration replaces the slot in `MODULES` in `apps/desktop/src/modules.tsx` with that import.
- **What `ModulePort` supplies:** `context: ProjectContext`, `destination: string`, `appearance: ResolvedAppearance`, `desktop: DesktopPort` and `navigate(destination)`.
- **Destinations.** They are module-local opaque strings that must pass `isDestination`: no URL scheme, no leading `//`, at most 512 characters. The shell stores one destination per domain and defaults it to `home`. Each module maps `home` to its landing view and serializes its location into the destination through `navigate`.
- **State across switches.** T0 remounts the module on every domain switch. Selection, filters, scroll and unsaved text therefore live in a module-level store keyed by `context.id`, which survives remounts within the session. Persistence across restarts waits for G-3.
- **Rules.** Modules never read the OS theme; they use `appearance` and the root `data-theme` tokens. They never change project silently and never touch another domain's state.

Social destinations are reconciled with T3 in `ctx.social-design-reconciliation.001`: `home` (Overview), `overview`, `sources[/<sourceId>]` (reserved), `workbenches[/<toolId>]`, `library[/<draftId>]`, `calendar[/<YYYY-MM>]`, `runs[/<runId>]`, `channels`.

Work destinations (with T4 P-8):

- `home` (Board), `glance`, `board`, `board/by-date`, `list`, `calendar`, `calendar/<YYYY-MM>`, `timeline`, `review`, `archive`, `settings`, `item/<itemId>`;
- `lists` is an alias of `board/by-date`;
- `item/<itemId>` opens the detail panel over the last view;
- `board/plan/<listBoardId>` is reserved for D-3 and renders *Proposed — not available*.

Cross-domain links use T0's `ReferenceEnvelope` and `parseReference`, plus the optional `ModulePort.references` and `ModulePort.returnContext` members proposed in `iface.references.001`. A module renders unknown or unresolvable references read-only, with their title and provenance.
<!-- codex-section:end id="spec.hq-social-work#iface.domain-module.001" -->

<!-- codex-section:begin id="spec.hq-social-work#iface.social-port.001" -->
**`SocialWorkspacePort`** (owner SOC-C; file `modules/social/core/port.ts`; Fieldnotes semantics):

```ts
type Channel = 'General'|'X'|'LinkedIn'|'TikTok'|'Instagram'|'Facebook'|'Reddit'|'Article';
type ToolId = 'tiktok-intelligence'|'x-intelligence'|'x-studio'|'seo-studio'|'search-visibility'|'social-publisher'|'reddit-opportunities'|'creator-relationships';
interface Brand { id: string; name: string; project_id?: string|null /* proposed Social-owned mapping; held */ }
interface Draft { id: string; title: string; body: string; brand_id: string; channel: Channel;
  planned_date: string /* '' | YYYY-MM-DD */; archived: 0|1; version: number; updated_at: string;
  links?: ReferenceEnvelope[] /* proposed; only with feature hq-references-v1 */ }
interface Tool { id: ToolId; name: string; category: 'Discover'|'Create'|'Measure'|'Plan'|'Connect'; description: string; mark: string }
type RunStatus = 'queued'|'running'|'succeeded'|'failed'|'interrupted';
interface RunRecord { id: string; tool: ToolId; status: RunStatus; is_example: 0|1; created_at: string;
  finished_at: string|null; error: string|null; output?: unknown }
interface WorkspaceSnapshot { brands: Brand[]; content: Draft[]; runs: RunRecord[] /* latest 200 */; tools: Tool[];
  features: string[] /* [] on today's service */; observedAt: string }
type SaveDraft = Omit<Draft,'id'|'version'|'updated_at'> & ({ id?: undefined } | { id: string; version: number });
type PortError = { kind: 'invalid'; message: string } | { kind: 'conflict'; message: string }
  | { kind: 'not_found' } | { kind: 'forbidden' } | { kind: 'unavailable' } | { kind: 'unknown'; attemptedAt: string };
interface SocialWorkspacePort {
  snapshot(): Promise<WorkspaceSnapshot>;                 // content class
  saveDraft(d: SaveDraft): Promise<Draft>;                // content class; conflict on stale version
  addBrand(name: string): Promise<Brand>;                 // content class
  example(tool: ToolId): Promise<Record<string, unknown>>;// read
  run(id: string): Promise<RunRecord>;                    // read
  submitRun(tool: ToolId, input: Record<string, unknown>, isExample: boolean): Promise<RunRecord>; // EXECUTION class; never retried
}
```

**Invariants:**

- Errors are values of `PortError`. A lost response on `submitRun` is `unknown`, never `unavailable`.
- Adapters never retry `submitRun`.
- `saveDraft` sends `links` **only** when `features` includes `hq-references-v1`. Otherwise it returns `invalid` locally for a draft carrying new links, because the live service would silently drop them.
- Fixture and live adapters pass one shared conformance suite, `modules/social/core/test/port-conformance.ts`.
- The recorder wrapper tags every call `content`, `read` or `execution`.
<!-- codex-section:end id="spec.hq-social-work#iface.social-port.001" -->

<!-- codex-section:begin id="spec.hq-social-work#iface.work-port.001" -->
**`PlannerPort`** (owner WRK-P; file `modules/work/core/port.ts`; Planner API semantics, no execution methods):

```ts
interface Snapshot { items: Item[]; settings: Settings; stateVersion: number; observedAt: string }
interface WriteResult { item?: Item; changed: Item[]; stateVersion: number; replayed: boolean }
type Anchor = { after_id: string } | { before_id: string } | { place: 'top'|'bottom' };
type PlannerError = { kind: 'invalid'; errors: { field: string; message: string }[] }
  | { kind: 'revision_conflict'; current: Item } | { kind: 'order_conflict' } | { kind: 'request_id_reused' }
  | { kind: 'not_found' } | { kind: 'unavailable' } | { kind: 'unknown'; requestId: string };
interface PlannerPort {
  snapshot(): Promise<Snapshot>;
  version(): Promise<number>;
  create(fields: NewItemFields, requestId: string): Promise<WriteResult>;
  patch(id: string, revision: number, patch: ItemPatch, requestId: string): Promise<WriteResult>;
  move(id: string, revision: number, status: Status, anchor: Anchor, requestId: string): Promise<WriteResult>;
  setArchived(id: string, revision: number, archived: boolean, requestId: string): Promise<WriteResult>;
  markReviewed(id: string, revision: number, requestId: string): Promise<WriteResult>;
  history(id: string): Promise<{ at: string; action: string; detail: unknown }[]>;
  updateSettings(s: Settings, requestId: string): Promise<{ settings: Settings; stateVersion: number }>;
}
```

`Item`, `Settings`, `Status`, `NewItemFields` and `ItemPatch` follow RW-1 exactly. `Snapshot` also carries `features: string[]` (`[]` on today's service). An item reference is `{id, kind: Exclude<RefKind,'hq'>, label, url} | {id, kind: 'hq', label, target: ReferenceEnvelope}`. The `hq` variant is writable only when `features` includes `hq-references-v1`. Derived date fields (`instant`, `end_instant`, `tz_abbr`) are accepted on read and stripped before write.

**Invariants:**

- A retry after `unknown` reuses the same `requestId` and body (RW-9).
- `move` renumbers only the target status.
- `create` always places the item at the top of its status.
- `ItemPatch` has no `status` member (RW-7).
- `markReviewed` is its own explicit action.
- The key set of the port surface is asserted by test, and contains no execution member.
- The port exposes no export, import or backup methods until the live adapter phase adds read-only `exportJson` and an explicitly confirmed `importPreview`/`import` that mirror the service. The root and owner approve those with D-2.
<!-- codex-section:end id="spec.hq-social-work#iface.work-port.001" -->

<!-- codex-section:begin id="spec.hq-social-work#iface.service-bridge.001" -->
**Proposed shared contract: desktop domain-service bridge** (owner: root; implementer: the root-designated shared writer; activation: `ac.service-bridge-approval.001`).

- **Contract.** `packages/contracts/src/services.ts`, exported as the subpath `@hq/contracts/services` through `packages/contracts/package.json`, so `index.ts` stays with the reference task. It declares closed route unions:
  - Social: `workspace`, `sample`, `run`, `saveContent`, `addBrand`, `submitRun`;
  - Work: `state`, `version`, `item`, `history`, `create`, `patch`, `move`, `archive`, `restore`, `reviewed`, `settings`.

  Each route has typed parameters and response envelopes `{ ok: true, status, body } | { ok: false, kind: 'unavailable'|'unknown'|'http', status? }`.
- **Preload.** `apps/desktop/electron/preload.cts` exposes `window.hqServices.social.call(route, params)` and `window.hqServices.work.call(route, params)` next to the existing `hqDesktop` object. There is no URL, header or method argument. Types are declared in `apps/desktop/src/environment.d.ts`.
- **Main process** (`apps/desktop/electron/services.ts`, registered from `main.ts` through `ipcMain.handle`).
  - It maps each route to a fixed method and path and validates parameters (ID charset, body size up to 2 MB).
  - It reads the endpoint per domain from main-only configuration that the user enters in an HQ settings dialog. The endpoint is stored outside the repository and never logged.
  - Social: it obtains and caches the workspace token from `workspace` and attaches `X-Workspace-Token`, refreshing once on 403.
  - Work: it attaches `X-Planning-Request: 1` and the caller's `X-Request-Id`.
  - It enforces the response size cap and timeouts: reads 10 s, writes 20 s, `submitRun` 20 s. A timeout on a mutation yields `unknown`.
- **Exclusions.**
  - No generic fetch, redirects disabled, no cookies.
  - No route reachable from Design.
  - Not used by the fixture adapters.
- **Failure.** An unconfigured endpoint makes every call return `unavailable`. The UI shows "Not connected" with a settings action and stays fully usable in fixture/demo mode, which is labeled.
<!-- codex-section:end id="spec.hq-social-work#iface.service-bridge.001" -->

<!-- codex-section:begin id="spec.hq-social-work#iface.references.001" -->
**HQ reference additions** (shared contract; owner: root; activation: `ac.reference-contract-custody.001`). These are additive to T0's `@hq/contracts`. `ReferenceEnvelope` and `parseReference` are reused unchanged.

```ts
export const REFERENCE_STATUSES = ['available','changed','archived','missing','moved','forbidden','unavailable','unknown'] as const;
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number];
export interface ReferenceResolution {
  readonly status: ReferenceStatus; readonly observedAt: string;
  readonly latestTitle?: string; readonly latestRevision?: string; readonly targetProjectId?: string;
  readonly destination?: string;               // provider's module-local destination, if openable
}
export interface ReferenceProvider {             // implemented by each domain module; no execution members
  readonly domain: DomainId; readonly kinds: readonly string[];
  find(query: string, scope: { projectId: string; kinds?: readonly string[]; limit: number }): Promise<readonly ReferenceEnvelope[]>;
  resolve(envelope: ReferenceEnvelope): Promise<ReferenceResolution>;
}
export interface ReturnContext { readonly label: string; readonly to: DomainDestination }
export interface ReferencePort {                 // supplied by the shell to modules
  find(query: string, scope: { projectId: string; domains?: readonly DomainId[]; kinds?: readonly string[]; limit: number }): Promise<readonly ReferenceEnvelope[]>;
  resolve(envelope: ReferenceEnvelope): Promise<ReferenceResolution>;
  open(envelope: ReferenceEnvelope, returnTo: ReturnContext): void;   // navigation only
}
// ModulePort gains OPTIONAL members (source-compatible): references?: ReferencePort; returnContext?: ReturnContext;
```

**Invariants:**

- The shell keeps a per-device in-memory resolution cache keyed by `domain/kind/entityId`. It never persists resolutions to any service.
- `open` validates the envelope with `parseReference`.
  - Another project: it shows context and does not navigate.
  - Unknown domain or kind: read-only.
  - Otherwise it switches domain and destination and supplies `returnContext` to the target module.
- Providers never write, never call execution ports and never import another domain.
- Providers register through `apps/desktop/src/reference-providers.ts`, which is root-owned, next to `MODULES`.

Design supplies its own provider for its kinds through its integration owner; that is requested via the root. Until it exists, Design targets resolve as `unknown` with readable snapshots, and Design items cannot be found from the picker.
<!-- codex-section:end id="spec.hq-social-work#iface.references.001" -->

<!-- codex-section:begin id="spec.hq-social-work#iface.service-reference-extensions.001" -->
**Proposed minimal service extensions** (owners: the Planner and Social service owners in their private repositories; **not authorized for mutation or publication by this plan**; activation goes through `ctx.operator-interaction-inventory.001`).

**Planner (`hq-references-v1`):**

- `normalize_fields` accepts a reference entry `{id, kind: 'hq', label ≤200, target}`. `target` is validated with the same rules as T0's `parseReference`, and `url` must be absent for `kind: 'hq'`.
- `/api/state` returns `features: ['hq-references-v1']`.
- Import validation accepts the same shape.
- No table or DDL change is expected if references are stored as serialized JSON; the Planner owner confirms this at implementation.
- Export format stays `jones-planning-export` v1 (additive).
- The Planner web UI renders `kind: 'hq'` as a non-link label: "Linked in HQ: <title>".

**Social service (`hq-references-v1`, and separately `hq-brand-project-v1`):**

- `content` gains `links TEXT NOT NULL DEFAULT '[]'` through a non-destructive `ALTER TABLE ADD COLUMN`.
- `POST /api/content` accepts optional `links` (≤30 envelopes, validated). **When the field is absent, the stored links are preserved**, unlike today's full-field overwrite.
- `GET /api/workspace` adds `features`.
- Separately, behind `hq-brand-project-v1`, `brands` gains a nullable `project_id`.
- Older clients that do not send `links` keep working.

**Compatibility checks the service owners must prove:**

- Existing records load unchanged.
- A save without `links` preserves them.
- Validation rejects malformed envelopes.
- Features are advertised only when the server can persist the field.
- A backup taken before migration restores exactly.
<!-- codex-section:end id="spec.hq-social-work#iface.service-reference-extensions.001" -->

<!-- codex-section:begin id="spec.hq-social-work#iface.ui-kit.001" -->
**`@hq/ui`** (owner UI lane). Values come from T2 at `f3c1daff` (`ctx.visual-system-binding.001`).

- **Tokens.** `packages/hq-ui/src/tokens/hq-tokens.css` and `hq-tokens.json` are byte-for-byte copies of T2's generated files. An integrity test records T2's path and SHA-256 per file. Edits happen upstream in T2's JSON source, never in HQ copies. Role names are T2's: `--hq-canvas`, `--hq-nav`, `--hq-surface[-raised|-overlay|-sunken|-hover|-pressed|-selected]`, `--hq-border[-strong|-control]`, `--hq-text[-muted|-subtle|-disabled]`, `--hq-accent*`, `--hq-on-accent`, `--hq-focus`, `--hq-selection`, `--hq-success|warning|danger|info[-soft]`, `--hq-skeleton*`, `--hq-scrim`, plus artwork invariants. They are scoped by `[data-theme]` and `light-dark()`.
- **Bridge.** `t0-bridge.css` is also copied verbatim, for the shell owner to load.
- **TypeScript names.** `packages/hq-ui/src/tokens.ts` exports the token names; values live only in CSS.
- **Domain roles.** These are module-local and paired with words: Work `--work-st-<status>` and `--work-dk-<datekind>`, Social `--social-channel-<id>`. Each needs a light and a dark value.
- **Components.** `packages/hq-ui/src/components/` exports the RS-3 set, styled to T2's `hq-components.css` geometry and class roles (`hq-btn`, `hq-save`, `hq-fresh`, `hq-ref`, `hq-empty`, `hq-banner`, `hq-toast`, …). The component CSS is reference geometry; HQ's implementation is checked against it, not copied wholesale.
- **Preserved content.** `PreservedContent` renders the RS-2 well. Its props are `kind: 'captured'|'producer'|'export'`, `recordedScheme: 'light'|'dark'` and `matte?: 'checker'`. It sets `--hq-content-scheme` through CSSOM. `setContentScheme(element, scheme)` is exported for modules that own their own wells.
- **Contrast.** `packages/hq-ui/src/contrast.ts` recomputes T2's 104 contrast pairs in tests.
- **Fonts.** The system fallback stack (`system-ui` / `ui-monospace`) is used until the font gate in `ctx.visual-system-binding.001` clears.

Token names may be renamed only before the first consumer lands.
<!-- codex-section:end id="spec.hq-social-work#iface.ui-kit.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.check-catalog.001" -->
### Proposed affected-check catalog delta (G-4)

HQ's single catalog is `tests/check-groups.toml`. It is being created by the Design plan (PR #4) in the Codex V3 trusted-group schema: `summary`, `covers`, `direct_surfaces`, `tests`. This plan **does not write or duplicate that file**. The bytes below are an additive, disjoint group delta in the same schema, proposed to the catalog owner on the coordination channel. They are also the exact bytes the planning helpers bind as a projection catalog, with this schema line prepended.

```toml
schema = "codex.v3-check-groups/v1"

[groups.hq-foundation]
summary = "T0 shell state, Electron security and shared contract parsing."
covers = ["appearance persistence and system following", "per-domain destination restoration", "strict reference and project-context parsing", "window security defaults"]
direct_surfaces = ["apps/desktop/src/state.ts", "apps/desktop/electron/security.ts", "packages/contracts/src/"]
tests = ["apps/desktop/src/state.test.ts", "apps/desktop/electron/security.test.ts", "packages/contracts/src/index.test.ts"]

[groups.shell-integration]
summary = "HQ shell, module registry, reference shell and desktop bridge behavior."
covers = ["module mounting and cross-domain restoration", "reference open/return and status paths", "bridge route allowlist when present"]
direct_surfaces = ["apps/desktop/"]
tests = ["apps/desktop/**/*.test.ts", "apps/desktop/**/*.test.tsx"]

[groups.hq-ui]
summary = "Shared HQ UI tokens, primitives and reference components."
covers = ["light and dark token roles and contrast", "keyboard operability", "captured-content exemption", "reference status rendering"]
direct_surfaces = ["packages/hq-ui/"]
tests = ["packages/hq-ui/**/*.test.ts", "packages/hq-ui/**/*.test.tsx"]

[groups.social-module]
summary = "Social domain core, content, workbench, references and domain shell."
covers = ["Social port conformance and call classification", "draft versioning and conflicts", "explicit-only runs and unknown handling", "capability-gated links"]
direct_surfaces = ["modules/social/"]
tests = ["modules/social/**/*.test.ts", "modules/social/**/*.test.tsx"]

[groups.work-module]
summary = "Work domain core, upstream Planner logic, views, board and references."
covers = ["Planner validation parity and upstream integrity", "ordering, moves and undo", "views and date-derived lists", "capability-gated links"]
direct_surfaces = ["modules/work/"]
tests = ["modules/work/**/*.test.ts", "modules/work/**/*.test.tsx"]
```

**Whole-repository commands, not catalog groups.** Every candidate also runs `npm run typecheck` and `npm run build`. UI-bearing candidates attach **manual** light and dark visual evidence with fictional data. Manual evidence is explicit and never counted as a passing group.

**Inactive until its files exist.** Bridge tests (`apps/desktop/electron/services.test.ts`) join `shell-integration` automatically through its glob once `task.service-bridge.001` creates them.

**Note for the catalog owner.** Groups here use globs, where the Codex V3 contract expects exact test-module paths. The catalog owner may expand them to exact modules at integration.
<!-- codex-section:end id="spec.hq-social-work#ctx.check-catalog.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.test-plan.001" -->
## Test Plan

**Environments:**

- Node with T0's test runner for pure logic.
- For components, the DOM test environment that the root adds in the skeleton task. T0's candidate has none: `vitest.config.ts` includes only `*.test.ts`.
- The Electron dev app or the Vite renderer with fixture adapters for visual evidence.
- Live-adapter contract tests against hand-written synthetic HTTP exchanges.
- Optionally, a task-owned scratch instance of each private service with synthetic data, started from its source checkout with an explicit scratch data directory, and removed after the test. This is never the live service.

Unavailable browser or Electron capture is reported as a platform gap, not a pass.

**Evidence predicates:**

- A check passes only on the exact candidate head.
- Visual evidence names the surface, theme, viewport (1280×800, and 900×700 for narrow layouts) and fixture.
- Screenshots contain only fictional content.

**Required state matrix per surface:** empty, loading, error, offline or unavailable, saving, conflict where applicable, and unknown where applicable. Each state is checked in light and dark, by keyboard only, and with reduced motion.

Machine Test Intents follow as `test.*` blocks.
<!-- codex-section:end id="spec.hq-social-work#ctx.test-plan.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.task-plan.001" -->
## Parallelization And Task Plan

### Lane count: five implementation lanes, plus root-owned serialized tasks

| Lane | Outcome | Why it is a separate lane |
| --- | --- | --- |
| **UI** (HQ-UI) | `@hq/ui` tokens and primitives, then shell chrome styling after custody | Every other lane consumes it; small, but on the critical path |
| **SOC-C** (Social content) | Social core port, fixture and hook; library, editor, brands, calendar; domain descriptor | Owns the Social seam and the content flows |
| **SOC-W** (Social workbench) | Eight tool workbenches, runs, receipts, unknown handling, save-to-library | Distinct UX surface with substantial per-tool forms and results; independent after core |
| **WRK-P** (Work planner) | Work core (model, validation, logic, fixture, hook) and the read/plan views Glance, List, Calendar, Timeline, Review, Archive, Lists | Owns the Work seam; the views share the core's date logic |
| **WRK-B** (Work board) | Board, card, drag/keyboard/menu moves, capture, detail panel, domain descriptor, Work links | The Trello-like interaction core; independent after core |

The D-4 references add work to existing lanes, not new lanes:

- UI: `task.reference-ui.001`;
- SOC-C: `task.social-references.001`;
- WRK-B: `task.work-references.001`;
- root: `task.reference-contract.001`, `task.reference-shell.001` and `task.reference-integration.001`.

The contract and shell tasks are explicit, under `ac.reference-contract-custody.001`. `task.shell-chrome.001` now follows `task.reference-shell.001`, because both write `apps/desktop/src/App.tsx`. The root may swap that order if chrome custody arrives first.

No reviewer lanes are planned. Codex V3 defaults to zero independent reviewers for ordinary Green work. The owner may grant a review budget. The root performs fan-in verification.

Root tasks R0–R2 and integration are single-writer shared-file work. They are not extra lanes. Splitting further, for example one lane per view, would create shared-core churn and integration cost with no independent outcome. Merging SOC-W into SOC-C, or WRK-B into WRK-P, would serialize a large surface behind one thread.

### Dependency graph (machine form in the `task.*` blocks)

```text
R0 bind-foundation ─┬─> R1 workspace-skeleton ─┬─> UI ui-kit ──────────────┬─> UI shell-chrome (explicit: custody)
                    │                          ├─> SOC-C social-core ──┬──> SOC-C social-content ─┐
                    │                          │                       └──> SOC-W social-workbench ┴─> SOC-C social-domain ─┐
                    │                          └─> WRK-P work-core ────┬──> WRK-P work-views ─┐                              │
                    │                                                  └──> WRK-B work-board ─┴─> WRK-B work-domain ─────────┤
                    └─> R2 service-bridge (explicit: D-2) ─┬─> SOC-C social-live-adapter (explicit: D-2)                   │
                                                           └─> WRK-P work-live-adapter (explicit: D-2)                     │
                                         R-INT domain-integration <────────────────────────────────────────────────────────┘
                                         (after social-domain, work-domain, ui-kit; live adapters when activated)
                                         R-VER campaign-verification
```

The UI-kit dependency also feeds social-content, social-workbench, work-views and work-board.

Reference chain (D-4):

```text
bind-foundation → reference-contract (explicit) → reference-shell → shell-chrome (explicit)
                                                → reference-ui (+ ui-kit)
social-content + reference-ui → social-references
work-board + reference-ui → work-references
domain-integration + reference-shell + social-references + work-references → reference-integration
```

### Semantic dependencies outside the task graph

| Producer | Consumer | Deliverable | Blocks |
| --- | --- | --- | --- |
| T0 | R0 → all | Accepted baseline commit with registry, contracts and scripts | All implementation |
| T2 visual system (`docs/design/hq-visual-system/`), **published `f3c1daff`** | UI | Token values, type scale, density, rail and chrome treatment, preserved-content pin | Satisfied for UI-kit input |
| T3 Social mockups (`docs/design/social/`) | SOC-C, SOC-W | Library, calendar, workbench and run layouts | Visual acceptance; core and logic start now |
| T4 Work mockups (`docs/design/work/`) | WRK-P, WRK-B | Board, card, detail, capture and Lists layouts | Visual acceptance; core and logic start now |
| Owner D-1 (approved) | WRK-P | Verbatim three-file import mapping, `ctx.d1-import.001` | None now |
| Planner and Social service owners | social-references, work-references (live use only) | `hq-references-v1` service extensions (`iface.service-reference-extensions.001`) and their gated activation | Live link persistence only; fixtures proceed |
| Design coordinator | reference-integration (Design targets) | A Design `ReferenceProvider` and connector spy | Linking to Design items only |
| Owner D-2 + root contract acceptance | R2, both live adapters | Bridge approval | Live adapters only |

### Work ready before T0 acceptance (reversible, in each lane's own worktree, uncommitted or on a lane branch)

- Read the source.
- Draft port-conformance cases and fixtures.
- Write pure-logic modules and tests in plain TypeScript.
- Reconcile layouts against T2–T4 as they publish.

Lanes do not publish code that assumes unbound T0 names.

### Fan-in

1. Each lane publishes one PR against the accepted T0 base. A lane that consumes a sibling core stacks on that core's exact commit.
2. The root integrates in this order: R1 → UI ui-kit → SOC-C core → WRK-P core → content / workbench / views / board → domains → R-INT.
3. The root runs the union checks on the integrated head and attaches cumulative evidence.

Merge is held.
<!-- codex-section:end id="spec.hq-social-work#ctx.task-plan.001" -->

<!-- codex-section:begin id="spec.hq-social-work#plan.implementation.001" -->
```json
{
  "schema_version": 1,
  "default_context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.project-summary.001",
    "brief.hq-shared-foundation#iface.shell.001",
    "brief.hq-shared-foundation#iface.references.001"
  ],
  "deferred_findings_sink_ref": "worknote.hq-social-work#ctx.deferred-findings.001",
  "artifact_path_hints": {
    "spec.hq-social-work": "docs/engineering-specs/hq-social-work.md",
    "brief.hq-shared-foundation": "docs/design/hq-shared-foundation.md",
    "worknote.hq-social-work": "docs/work-notes/hq-social-work.md"
  },
  "launch_policy": "start_all_currently_launchable_with_rolling_capacity_refill",
  "machine_block_source_rendering": "deterministic_two_space_json",
  "runtime_rendering": "canonical_compact_json",
  "fan_in_owner": "hq-root",
  "additional_final_check_groups": [
    "hq-foundation",
    "shell-integration"
  ],
  "delivery_boundary": "Root launches lanes from this published plan on the accepted T0 base; lanes publish candidate PRs; merge held for integration-owner agreement; no deployment, signing, service change, migration or live-data access; tests/check-groups.toml stays with its Design owner."
}
```
<!-- codex-section:end id="spec.hq-social-work#plan.implementation.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.bind-foundation.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "hq-root",
  "objective": "Confirm the accepted T0 baseline (source 33dfe44, guidance-only head 35f9a3e) against the plan: commit, workspaces list, MODULES registry in apps/desktop/src/modules.tsx, @hq/contracts exports, vitest configuration and npm scripts. Publish any RF-2 path or name rebind as a versioned plan delta before dependent lanes mutate.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.domain-module.001",
    "spec.hq-social-work#ctx.foundation-binding-record.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "docs/evidence/hq-social-work/foundation"
  ],
  "requires": [
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "produces": [
    "spec.hq-social-work#ac.foundation-baseline.001"
  ],
  "dependencies": [],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.foundation-baseline.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.foundation-binding.001"
  ],
  "affected_check_groups": [
    "hq-foundation"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.bind-foundation.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.workspace-skeleton.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Single root commit creating modules/social, modules/work and packages/hq-ui workspaces (manifest, tsconfig, empty passing test), any batched devDependency proposals such as a DOM test environment, one lockfile regeneration, and available-stub registration of Social and Work in the module registry.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#ctx.foundation-binding-record.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.ts",
    "apps/desktop/package.json",
    "modules/social/package.json",
    "modules/social/tsconfig.json",
    "modules/work/package.json",
    "modules/work/tsconfig.json",
    "packages/hq-ui/package.json",
    "packages/hq-ui/tsconfig.json",
    "apps/desktop/src/modules.tsx",
    "modules/social/index.tsx",
    "modules/social/skeleton.test.ts",
    "modules/work/index.tsx",
    "modules/work/skeleton.test.ts",
    "packages/hq-ui/src/index.ts",
    "packages/hq-ui/skeleton.test.ts",
    "docs/evidence/hq-social-work/integration"
  ],
  "requires": [
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.bind-foundation.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.bind-foundation.001",
      "fields": [
        "summary",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.workspace-skeleton.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.workspace-skeleton.001"
  ],
  "affected_check_groups": [
    "hq-foundation",
    "hq-ui",
    "social-module",
    "work-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.workspace-skeleton.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.service-bridge.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Implement the proposed domain-service bridge: closed route unions in contracts, preload call surface without URL/header/method arguments, main-process route mapping, endpoint configuration outside the repository, token and request headers in main, size caps and timeouts mapping mutation timeouts to unknown.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.service-bridge.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "packages/contracts/src/services.ts",
    "packages/contracts/package.json",
    "apps/desktop/electron/services.ts",
    "apps/desktop/electron/services.test.ts",
    "apps/desktop/electron/main.ts",
    "apps/desktop/electron/preload.cts",
    "apps/desktop/src/environment.d.ts"
  ],
  "requires": [
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [
    "spec.hq-social-work#iface.service-bridge.001"
  ],
  "dependencies": [
    "spec.hq-social-work#task.workspace-skeleton.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-social-work#ac.service-bridge-approval.001"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.service-bridge.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.service-bridge.001"
  ],
  "affected_check_groups": [
    "shell-integration"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled",
    "contracts/IPC single-writer custody or cross-owner contract compatibility is absent"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.service-bridge.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.ui-kit.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-hq-ui",
  "objective": "Build @hq/ui: byte-for-byte copies of T2 tokens at f3c1daff with an integrity test, PreservedContent wells pinning --hq-content-scheme to the recorded theme via CSSOM, contrast helper recomputing the 104 pairs, and the accessible primitive set (Button, IconButton, Menu, Dialog, Toast with Undo, Tabs, StatusChip, SaveIndicator, StateView) with a kit evidence page.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.ui-kit.001",
    "spec.hq-social-work#ctx.visual-system-binding.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop",
    "docs/design/hq-visual-system"
  ],
  "write_scope": [
    "packages/hq-ui/src",
    "packages/hq-ui/test",
    "packages/hq-ui/README.md",
    "docs/evidence/hq-social-work/ui"
  ],
  "requires": [
    "spec.hq-social-work#req.shell.001"
  ],
  "produces": [
    "spec.hq-social-work#iface.ui-kit.001"
  ],
  "dependencies": [
    "spec.hq-social-work#task.workspace-skeleton.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.ui-kit.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.ui-kit.001"
  ],
  "affected_check_groups": [
    "hq-ui"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.ui-kit.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.shell-chrome.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-hq-ui",
  "objective": "After explicit custody transfer, restyle the T0 shell chrome with @hq/ui tokens: slim rail Design, Social, Work with non-color selection, visible project context and the Light/Dark/System control, preserving T0 behavior and tests.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop",
    "docs/design/hq-visual-system"
  ],
  "write_scope": [
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/styles.css"
  ],
  "requires": [
    "spec.hq-social-work#req.shell.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.ui-kit.001",
    "spec.hq-social-work#task.reference-shell.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.ui-kit.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.reference-shell.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-social-work#ac.custody-transfer.001"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.shell-chrome.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.shell-chrome.001"
  ],
  "affected_check_groups": [
    "shell-integration"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.shell-chrome.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.social-core.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-social-content",
  "objective": "Implement modules/social/core: SocialWorkspacePort types, client validation mirroring Fieldnotes, fictional fixture adapter with conflict and run lifecycle including interrupted and unknown, call recorder classifying content/read/execution, features capability (fixture advertises hq-references-v1; links field and brand project_id as labeled proposed schema), shared port conformance suite and a state hook. Publish early for the workbench lane.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.social-port.001",
    "spec.hq-social-work#ctx.social-design-reconciliation.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "modules/social/core"
  ],
  "requires": [
    "spec.hq-social-work#req.social-content.001",
    "spec.hq-social-work#req.social-research.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [
    "spec.hq-social-work#iface.social-port.001"
  ],
  "dependencies": [
    "spec.hq-social-work#task.workspace-skeleton.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.social-core.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.social-core.001"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.social-core.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.social-content.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-social-content",
  "objective": "Build the Social library, draft editor with version-conflict handling and preserved unsaved text, brands, and editorial calendar with undated tray and undoable planned-date moves, covering empty/loading/error/saving/conflict states in light and dark.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop",
    "docs/design/social"
  ],
  "write_scope": [
    "modules/social/content",
    "docs/evidence/hq-social-work/social-content"
  ],
  "requires": [
    "spec.hq-social-work#req.social-content.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.social-core.001",
    "spec.hq-social-work#task.ui-kit.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.social-core.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.ui-kit.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.social-content.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.social-content.001"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.social-content.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.social-workbench.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-social-workbench",
  "objective": "Build the eight-tool workbench: catalog with delivered limits, form-first inputs and typed file import with Advanced JSON, examples, explicit-only Run, run history and receipts with visible-only polling, unknown submission with possible matches and no resubmission, tool-specific results, and Start draft from a result with a run citation that is persisted only under hq-references-v1 and otherwise shown as not saved.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop",
    "docs/design/social",
    "modules/social/core"
  ],
  "write_scope": [
    "modules/social/workbench",
    "docs/evidence/hq-social-work/social-workbench"
  ],
  "requires": [
    "spec.hq-social-work#req.social-research.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.social-core.001",
    "spec.hq-social-work#task.ui-kit.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.social-core.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.ui-kit.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.social-workbench.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.social-workbench.001"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.social-workbench.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.social-domain.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-social-content",
  "objective": "Compose the Social domain descriptor and T3-reconciled navigation (Overview, Sources reserved, Workbenches, Library, Calendar, Run history, Channels) with brand switcher, project-mismatch banner that never switches project silently, destination and state restoration, the delivered-limits banner and package-boundary import checks.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop",
    "modules/social/workbench"
  ],
  "write_scope": [
    "modules/social/index.tsx",
    "modules/social/nav"
  ],
  "requires": [
    "spec.hq-social-work#req.social-content.001",
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.social-content.001",
    "spec.hq-social-work#task.social-workbench.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.social-content.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.social-workbench.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.social-domain.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.social-domain.001"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.social-domain.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.social-live-adapter.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-social-content",
  "objective": "Implement the Fieldnotes live adapter over the service bridge, passing the shared Social port conformance suite against synthetic recorded exchanges; token refresh on 403, conflict mapping, and no submitRun retry.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.service-bridge.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "modules/social/live"
  ],
  "requires": [
    "spec.hq-social-work#req.safety.001",
    "spec.hq-social-work#req.social-research.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.social-core.001",
    "spec.hq-social-work#task.service-bridge.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.social-core.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.service-bridge.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-social-work#ac.service-bridge-approval.001"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.live-adapters.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.social-live-adapter.001"
  ],
  "affected_check_groups": [
    "social-module",
    "shell-integration"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled",
    "any step would read live Social data"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.social-live-adapter.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.work-core.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-work-planner",
  "objective": "Implement modules/work/core: verbatim D-1 upstream copies of ordering.js, dates.js and model.js with declarations, PROVENANCE.md and an integrity test; PlannerPort and item types exactly per RW-1 plus the features capability and capability-gated hq reference variant, validation parity, ordering/anchors, periods and ISO weeks, review buckets and filters, fictional fixture adapter with revision/order conflicts, actual replay and request_id_reused, T4 conformance cases, move-only status changes, and the module-store state hook with save states, same-request reconciliation of unknown writes, and a 40-entry consume-once compare-and-swap undo stack. Publish early for the board lane.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.work-port.001",
    "spec.hq-social-work#ctx.d1-import.001",
    "spec.hq-social-work#ctx.work-design-binding.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "modules/work/core"
  ],
  "requires": [
    "spec.hq-social-work#req.work-core.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [
    "spec.hq-social-work#iface.work-port.001"
  ],
  "dependencies": [
    "spec.hq-social-work#task.workspace-skeleton.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.work-core.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.work-core.001"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.work-core.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.work-views.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-work-planner",
  "objective": "Build Glance, List, Calendar, Timeline, Review, Archive and the read-only By date board (Today, This week by Planner week_start, Later, Undated) with Planner behavior parity, the not-project-scoped note, undoable calendar and timeline moves, and full state coverage in light and dark.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop",
    "docs/design/work"
  ],
  "write_scope": [
    "modules/work/views",
    "docs/evidence/hq-social-work/work-planner"
  ],
  "requires": [
    "spec.hq-social-work#req.work-views.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.work-core.001",
    "spec.hq-social-work#task.ui-kit.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.work-core.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.ui-kit.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.work-views.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.work-views.001"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.work-views.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.work-board.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-work-board",
  "objective": "Build the status Board with cards, pointer/touch drag, keyboard and menu moves sharing one move path with Undo, detail and List status changes through move, quick capture into Inbox without invented dates and with explicit-only HQ drafts, and the card detail panel with autosave, checklist, typed dates, references and conflict handling.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop",
    "docs/design/work",
    "modules/work/core"
  ],
  "write_scope": [
    "modules/work/board",
    "modules/work/detail",
    "modules/work/capture",
    "docs/evidence/hq-social-work/work-board"
  ],
  "requires": [
    "spec.hq-social-work#req.work-views.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.work-core.001",
    "spec.hq-social-work#task.ui-kit.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.work-core.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.ui-kit.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.work-board.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.work-board.001"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.work-board.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.work-domain.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-work-board",
  "objective": "Compose the Work domain descriptor and secondary navigation with view, filter, scroll and selection restoration, Work-scoped quick-capture shortcut, board presets and package-boundary import checks.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop",
    "modules/work/views"
  ],
  "write_scope": [
    "modules/work/index.tsx",
    "modules/work/nav"
  ],
  "requires": [
    "spec.hq-social-work#req.work-views.001",
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.work-views.001",
    "spec.hq-social-work#task.work-board.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.work-views.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.work-board.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.work-domain.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.work-domain.001"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.work-domain.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.work-live-adapter.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-work-planner",
  "objective": "Implement the Planner live adapter over the service bridge, passing the shared Work port conformance suite against synthetic recorded exchanges; X-Planning-Request and same X-Request-Id on retry, conflict mapping, request_id_reused treated as a defect, export read-only.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.service-bridge.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "modules/work/live"
  ],
  "requires": [
    "spec.hq-social-work#req.work-core.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.work-core.001",
    "spec.hq-social-work#task.service-bridge.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.work-core.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.service-bridge.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-social-work#ac.service-bridge-approval.001"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.live-adapters.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.work-live-adapter.001"
  ],
  "affected_check_groups": [
    "work-module",
    "shell-integration"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled",
    "any step would read live Planner data"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.work-live-adapter.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.domain-integration.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Register the Social and Work domain descriptors in the module registry, integrate lane candidates in the documented order, and prove cross-domain restoration, appearance persistence, captured-content invariance and zero execution calls on the integrated head.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "apps/desktop/src/modules.tsx",
    "docs/evidence/hq-social-work/integration"
  ],
  "requires": [
    "spec.hq-social-work#req.foundation-binding.001",
    "spec.hq-social-work#req.shell.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.ui-kit.001",
    "spec.hq-social-work#task.social-domain.001",
    "spec.hq-social-work#task.work-domain.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.ui-kit.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.social-domain.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.work-domain.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.integration.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.domain-integration.001"
  ],
  "affected_check_groups": [
    "shell-integration",
    "hq-foundation",
    "hq-ui",
    "social-module",
    "work-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.domain-integration.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.reference-contract.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Add the additive reference contract to @hq/contracts: REFERENCE_STATUSES, ReferenceStatus, ReferenceResolution, ReferenceProvider, ReferencePort, ReturnContext and optional ModulePort.references/returnContext, reusing ReferenceEnvelope and parseReference unchanged, with contract tests proving source compatibility and no execution members.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.references.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "packages/contracts/src/references.ts",
    "packages/contracts/src/references.test.ts",
    "packages/contracts/src/index.ts"
  ],
  "requires": [
    "spec.hq-social-work#req.references.001"
  ],
  "produces": [
    "spec.hq-social-work#iface.references.001"
  ],
  "dependencies": [
    "spec.hq-social-work#task.workspace-skeleton.001"
  ],
  "dependency_inputs": [],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-social-work#ac.reference-contract-custody.001"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.reference-contract.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.reference-contract.001"
  ],
  "affected_check_groups": [
    "hq-foundation"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled",
    "Design coordinator compatibility confirmation is absent"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.reference-contract.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.reference-shell.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Implement the shell reference port: provider registry beside MODULES, find/resolve aggregation with a per-device in-memory resolution cache, open(envelope, returnTo) that validates, switches domain and destination and supplies returnContext, Back restoration, project-mismatch and unknown-kind read-only paths, and zero calls to non-reference ports.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.references.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/references.ts",
    "apps/desktop/src/references.test.ts",
    "apps/desktop/src/reference-providers.ts"
  ],
  "requires": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.reference-contract.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.reference-contract.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "explicit",
    "predicate_ref": "spec.hq-social-work#ac.reference-contract-custody.001"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.reference-shell.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.reference-shell.001"
  ],
  "affected_check_groups": [
    "shell-integration"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.reference-shell.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.reference-ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-hq-ui",
  "objective": "Build @hq/ui reference components: ReferenceChip with text status and freshness for every ReferenceStatus, LinkList with Unlink and Update snapshot actions offering Undo, and a keyboard-operable LinkPicker over ReferencePort.find, in light and dark.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.references.001",
    "spec.hq-social-work#iface.ui-kit.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "packages/hq-ui/src/references",
    "packages/hq-ui/test/references"
  ],
  "requires": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.shell.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.ui-kit.001",
    "spec.hq-social-work#task.reference-contract.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.ui-kit.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.reference-contract.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.reference-ui.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.reference-ui.001"
  ],
  "affected_check_groups": [
    "hq-ui"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.reference-ui.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.social-references.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-social-content",
  "objective": "Implement the Social ReferenceProvider (drafts, runs, brands) and draft Links in the editor: capability-gated persistence through saveDraft, version conflict and Undo, not-saved display without hq-references-v1, return-context Back, and recorder proof of zero execution calls.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.references.001",
    "spec.hq-social-work#iface.social-port.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "modules/social/references",
    "modules/social/content",
    "docs/evidence/hq-social-work/social-references"
  ],
  "requires": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.social-content.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.social-domain.001",
    "spec.hq-social-work#task.reference-ui.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.social-domain.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.reference-ui.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.social-references.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.social-references.001"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.social-references.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.work-references.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "lane-work-board",
  "objective": "Implement the Work ReferenceProvider (items including archived and missing) and the card detail Links section adding and removing kind hq entries under hq-references-v1 with revision guards, conflicts and Undo, export/import byte preservation on the fixture, and zero execution calls including linked-card drag.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.references.001",
    "spec.hq-social-work#iface.work-port.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "modules/work/references",
    "modules/work/detail",
    "docs/evidence/hq-social-work/work-references"
  ],
  "requires": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.work-views.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.work-domain.001",
    "spec.hq-social-work#task.reference-ui.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.work-domain.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.reference-ui.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.work-references.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.work-references.001"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.work-references.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.reference-integration.001" -->
```json
{
  "schema_version": 1,
  "kind": "implementation",
  "profile_role": "builder",
  "accountable_owner": "hq-root",
  "objective": "Register the Social and Work reference providers, integrate the reference candidates, and prove on the integrated head with fixtures: Social to Work and back links, open and return with intact state, truthful changed/archived/missing/moved/unavailable rendering, unlink leaving targets untouched, export round trip and zero execution calls.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "apps/desktop/src/reference-providers.ts",
    "docs/evidence/hq-social-work/references"
  ],
  "requires": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.domain-integration.001",
    "spec.hq-social-work#task.reference-shell.001",
    "spec.hq-social-work#task.social-references.001",
    "spec.hq-social-work#task.work-references.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.domain-integration.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.reference-shell.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.social-references.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.work-references.001",
      "fields": [
        "produced_refs",
        "candidate_binding"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.reference-integration.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.reference-integration.001"
  ],
  "affected_check_groups": [
    "shell-integration",
    "social-module",
    "work-module",
    "hq-ui"
  ],
  "result_fields": [
    "summary",
    "changed_paths",
    "evidence_refs",
    "produced_refs",
    "candidate_binding",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.reference-integration.001" -->

<!-- codex-section:begin id="spec.hq-social-work#task.campaign-verification.001" -->
```json
{
  "schema_version": 1,
  "kind": "verification",
  "profile_role": "verifier",
  "accountable_owner": "hq-root",
  "objective": "Verify the integrated candidate at its exact head: deduplicated union of affected checks, cumulative light and dark evidence with fictional data, public-safety diff review, and an explicit record of uncovered, blocked and unavailable work.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001"
  ],
  "read_scope": [
    "AGENTS.md",
    "docs/engineering-specs/hq-social-work.md",
    "docs/design/hq-shared-foundation.md",
    "docs/engineering-specs/hq-bootstrap.md",
    "packages/contracts",
    "apps/desktop"
  ],
  "write_scope": [
    "docs/evidence/hq-social-work/verification"
  ],
  "requires": [
    "spec.hq-social-work#req.safety.001",
    "spec.hq-social-work#req.references.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.domain-integration.001",
    "spec.hq-social-work#task.reference-integration.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.domain-integration.001",
      "fields": [
        "candidate_binding",
        "evidence_refs"
      ]
    },
    {
      "task_ref": "spec.hq-social-work#task.reference-integration.001",
      "fields": [
        "candidate_binding",
        "evidence_refs"
      ]
    }
  ],
  "activation": {
    "mode": "automatic"
  },
  "acceptance_refs": [
    "spec.hq-social-work#ac.integration.001"
  ],
  "test_refs": [
    "spec.hq-social-work#test.campaign-verification.001"
  ],
  "affected_check_groups": [
    "hq-foundation",
    "shell-integration",
    "hq-ui",
    "social-module",
    "work-module"
  ],
  "result_fields": [
    "summary",
    "evidence_refs",
    "deferred_findings"
  ],
  "preserved_boundaries": [
    "write only the literal write_scope; propose shared changes to the root",
    "no root manifest, lockfile, contracts, apps/desktop or Design edits without explicit custody",
    "fictional fixtures only; no private data, addresses or credentials",
    "zero execution calls from navigation, mode switch or card movement",
    "publish candidate PR; merge held for integration owner"
  ],
  "stop_conditions": [
    "accepted T0 baseline or required rebind is missing",
    "a change outside write_scope or a dependency/lockfile change is required",
    "an unknown prior Git, GitHub or service effect is unreconciled"
  ]
}
```
<!-- codex-section:end id="spec.hq-social-work#task.campaign-verification.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.foundation-binding.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "scenario": "The root reads the accepted T0 commit and records registry, contracts exports, workspace globs and scripts; fresh install, typecheck, test and build pass there.",
  "evidence": {
    "predicate": "Recorded names and paths match the accepted T0 tree and its four commands pass.",
    "invalid": "Names are inferred from an unaccepted branch or the commands were not run on the accepted commit.",
    "unknown": "T0 is unpublished or unaccepted."
  },
  "environment": [
    "Node with the accepted T0 test runner"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.bind-foundation.001",
  "evidence_executor_task": "spec.hq-social-work#task.bind-foundation.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": []
  },
  "target_hints": [
    "docs/evidence/hq-social-work/foundation/"
  ],
  "affected_check_groups": [
    "hq-foundation"
  ],
  "required_at": "checkpoint"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.foundation-binding.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.workspace-skeleton.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "scenario": "After the skeleton commit, a fresh install with the regenerated lockfile succeeds and each new workspace's empty test runs; Social and Work show available stubs.",
  "evidence": {
    "predicate": "Fresh npm install, typecheck, test and build pass and the stubs render.",
    "invalid": "The lockfile was edited by hand or more than one writer touched root files.",
    "unknown": "Install could not run on this host."
  },
  "environment": [
    "Node with the accepted T0 test runner"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.workspace-skeleton.001",
  "evidence_executor_task": "spec.hq-social-work#task.workspace-skeleton.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.bind-foundation.001"
    ]
  },
  "target_hints": [
    "package.json",
    "modules/social/package.json",
    "modules/work/package.json"
  ],
  "affected_check_groups": [
    "hq-foundation",
    "hq-ui",
    "social-module",
    "work-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.workspace-skeleton.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.service-bridge.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-social-work#req.safety.001"
  ],
  "scenario": "Bridge tests call every enumerated route against a local stub server and attempt unknown routes, renderer-supplied hosts, headers and oversized bodies.",
  "evidence": {
    "predicate": "Only enumerated routes reach the stub; all other attempts are rejected before I/O; mutation timeouts return unknown.",
    "invalid": "Tests use a real service endpoint or private data.",
    "unknown": "Electron main-process tests cannot run on this host."
  },
  "environment": [
    "Node with the accepted T0 test runner",
    "local stub HTTP server in task-owned scratch"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.service-bridge.001",
  "evidence_executor_task": "spec.hq-social-work#task.service-bridge.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.bind-foundation.001"
    ]
  },
  "target_hints": [
    "apps/desktop/electron/services.test.ts"
  ],
  "affected_check_groups": [
    "shell-integration"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.service-bridge.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.ui-kit.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.shell.001"
  ],
  "scenario": "Token and primitive tests render every primitive in light and dark, operate them by keyboard only, recompute the 104 T2 contrast pairs, and verify each PreservedContent kind keeps pixels and its recorded color-scheme (img, SVG-as-img, srcdoc iframe probe) across Light, Dark and System.",
  "evidence": {
    "predicate": "T2 token copies match recorded hashes, contrast pairs meet thresholds, keyboard paths complete, and preserved wells keep the recorded scheme with no filter, blend or opacity.",
    "invalid": "Contrast is asserted from a screenshot guess, token copies were hand-edited, or a well follows global appearance.",
    "unknown": "An environment T2 also left unverified (Electron, macOS, screen reader, forced colours, 2x) is unavailable; recorded as a gap."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.ui-kit.001",
  "evidence_executor_task": "spec.hq-social-work#task.ui-kit.001",
  "acceptance_owner": "lane-hq-ui",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.workspace-skeleton.001"
    ]
  },
  "target_hints": [
    "packages/hq-ui/test/"
  ],
  "affected_check_groups": [
    "hq-ui"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.ui-kit.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.shell-chrome.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.shell.001"
  ],
  "scenario": "Restyled rail and chrome keep Design, Social, Work order, persist explicit theme, follow System changes and restore per-domain destinations.",
  "evidence": {
    "predicate": "T0's existing shell tests and the new chrome tests pass with light and dark evidence.",
    "invalid": "T0 behavior tests were modified to pass.",
    "unknown": "Custody transfer is not recorded."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.shell-chrome.001",
  "evidence_executor_task": "spec.hq-social-work#task.shell-chrome.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.ui-kit.001"
    ]
  },
  "target_hints": [
    "apps/desktop/src/App.tsx",
    "apps/desktop/src/styles.css"
  ],
  "affected_check_groups": [
    "shell-integration"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.shell-chrome.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.social-core.001" -->
```json
{
  "schema_version": 1,
  "kind": "unit",
  "validates": [
    "spec.hq-social-work#req.social-content.001",
    "spec.hq-social-work#req.social-research.001"
  ],
  "scenario": "The Social port conformance suite runs against the fixture adapter for validation, conflicts, unknown brand, channel set, planned-date format, run lifecycle including interrupted, and an injected lost submitRun response.",
  "evidence": {
    "predicate": "The suite passes and the recorder classifies every call as content, read or execution.",
    "invalid": "The fixture diverges from Fieldnotes messages or limits without a recorded reason.",
    "unknown": "A Fieldnotes behavior could not be determined from source."
  },
  "environment": [
    "Node with the accepted T0 test runner"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.social-core.001",
  "evidence_executor_task": "spec.hq-social-work#task.social-core.001",
  "acceptance_owner": "lane-social-content",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.workspace-skeleton.001"
    ]
  },
  "target_hints": [
    "modules/social/core/test/"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.social-core.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.social-content.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.social-content.001"
  ],
  "scenario": "Library, editor, brands and calendar run against the fixture through create, edit, conflict, archive, restore and calendar move with undo, including a domain switch with unsaved text.",
  "evidence": {
    "predicate": "Each interaction yields the documented content calls, the recorder shows zero execution calls, and state coverage evidence exists in both themes.",
    "invalid": "Evidence uses non-fictional content or a planned date is labeled as scheduled.",
    "unknown": "Visual capture is unavailable on this host."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.social-content.001",
  "evidence_executor_task": "spec.hq-social-work#task.social-content.001",
  "acceptance_owner": "lane-social-content",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.social-core.001",
      "spec.hq-social-work#task.ui-kit.001"
    ]
  },
  "target_hints": [
    "modules/social/content/"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.social-content.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.social-workbench.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.social-research.001"
  ],
  "scenario": "For all eight tools, forms and imports build the exact native input; Run submits once; navigation, examples and imports submit zero; an injected lost response renders unknown with possible matches and never resubmits.",
  "evidence": {
    "predicate": "Recorder counts and built inputs match the expectations for every tool and every tool's synthetic example renders results.",
    "invalid": "Any interaction other than explicit Run produces an execution call.",
    "unknown": "A tool's native input contract could not be determined from source."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.social-workbench.001",
  "evidence_executor_task": "spec.hq-social-work#task.social-workbench.001",
  "acceptance_owner": "lane-social-workbench",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.social-core.001",
      "spec.hq-social-work#task.ui-kit.001"
    ]
  },
  "target_hints": [
    "modules/social/workbench/"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.social-workbench.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.social-domain.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-social-work#req.social-content.001",
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "scenario": "The Social descriptor mounts in the T0 registry harness and restores section, filters and selection across Design, Social, Work, Social.",
  "evidence": {
    "predicate": "Restoration assertions pass and cross-package imports are limited to contracts and ui.",
    "invalid": "The test bypasses the T0 registry.",
    "unknown": "The registry harness is unavailable."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.social-domain.001",
  "evidence_executor_task": "spec.hq-social-work#task.social-domain.001",
  "acceptance_owner": "lane-social-content",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.social-content.001",
      "spec.hq-social-work#task.social-workbench.001"
    ]
  },
  "target_hints": [
    "modules/social/index.tsx"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.social-domain.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.social-live-adapter.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-social-work#req.safety.001",
    "spec.hq-social-work#req.social-research.001"
  ],
  "scenario": "The Fieldnotes adapter runs the shared Social port suite against hand-written synthetic exchanges replayed through a bridge stub.",
  "evidence": {
    "predicate": "The shared suite passes; submitRun is never retried; 403 refreshes the token once.",
    "invalid": "Any exchange derives from live Social data.",
    "unknown": "The bridge contract is not yet accepted."
  },
  "environment": [
    "Node with the accepted T0 test runner",
    "bridge stub with synthetic exchanges"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.social-live-adapter.001",
  "evidence_executor_task": "spec.hq-social-work#task.social-live-adapter.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.social-core.001",
      "spec.hq-social-work#task.service-bridge.001"
    ]
  },
  "target_hints": [
    "modules/social/live/"
  ],
  "affected_check_groups": [
    "social-module",
    "shell-integration"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.social-live-adapter.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.work-core.001" -->
```json
{
  "schema_version": 1,
  "kind": "unit",
  "validates": [
    "spec.hq-social-work#req.work-core.001"
  ],
  "scenario": "A validation parity table covers every enum, limit, date precision, time and timezone rule and URL rule; ordering, periods with week_start, review buckets and filters are tested; the fixture and hook run T4's seven conformance cases including actual replay and request_id_reused, same-request reconciliation, CAS undo and remount survival.",
  "evidence": {
    "predicate": "All parity and conformance tests pass; unknown writes resolve only by the same request ID and body; a heuristic match is never treated as proof.",
    "invalid": "Parity expectations were derived from the TypeScript implementation instead of the Planner rules, or replay cases were skipped because the mockup fixture lacks them.",
    "unknown": "A Planner rule could not be determined from source."
  },
  "environment": [
    "Node with the accepted T0 test runner"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.work-core.001",
  "evidence_executor_task": "spec.hq-social-work#task.work-core.001",
  "acceptance_owner": "lane-work-planner",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.workspace-skeleton.001"
    ]
  },
  "target_hints": [
    "modules/work/core/test/"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.work-core.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.work-views.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.work-views.001"
  ],
  "scenario": "Glance, List, Calendar, Timeline, Review, Archive and Lists render the synthetic fixture; calendar and timeline moves produce documented patches with undo; Lists group only by actual dates.",
  "evidence": {
    "predicate": "View assertions pass, undated items stay Undated, Lists issue zero writes, and light and dark evidence exists.",
    "invalid": "A Lists group writes a date or maps a horizon to Today or This week.",
    "unknown": "Visual capture is unavailable on this host."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.work-views.001",
  "evidence_executor_task": "spec.hq-social-work#task.work-views.001",
  "acceptance_owner": "lane-work-planner",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.work-core.001",
      "spec.hq-social-work#task.ui-kit.001"
    ]
  },
  "target_hints": [
    "modules/work/views/"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.work-views.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.work-board.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.work-views.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "scenario": "Board drag, keyboard and menu moves are compared call-for-call, undone and redone; quick capture and detail autosave and conflict paths run against the fixture.",
  "evidence": {
    "predicate": "Identical move calls across the three input methods, consistent state after undo, and a port surface without execution methods.",
    "invalid": "Drag-only behavior lacks a keyboard or menu equivalent.",
    "unknown": "Real touch hardware is unavailable; synthetic pointer evidence is labeled as such."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.work-board.001",
  "evidence_executor_task": "spec.hq-social-work#task.work-board.001",
  "acceptance_owner": "lane-work-board",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.work-core.001",
      "spec.hq-social-work#task.ui-kit.001"
    ]
  },
  "target_hints": [
    "modules/work/board/",
    "modules/work/detail/"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.work-board.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.work-domain.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-social-work#req.work-views.001",
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "scenario": "The Work descriptor mounts in the T0 registry harness and restores view, filters, scroll and selection across a domain round trip; quick capture is scoped to Work focus.",
  "evidence": {
    "predicate": "Restoration assertions pass and cross-package imports are limited to contracts and ui.",
    "invalid": "The test bypasses the T0 registry.",
    "unknown": "The registry harness is unavailable."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.work-domain.001",
  "evidence_executor_task": "spec.hq-social-work#task.work-domain.001",
  "acceptance_owner": "lane-work-board",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.work-views.001",
      "spec.hq-social-work#task.work-board.001"
    ]
  },
  "target_hints": [
    "modules/work/index.tsx"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.work-domain.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.work-live-adapter.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-social-work#req.work-core.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "scenario": "The Planner adapter runs the shared Work port suite against hand-written synthetic exchanges replayed through a bridge stub, including lost responses and replay.",
  "evidence": {
    "predicate": "The shared suite passes with the same X-Request-Id on retry and correct conflict mapping.",
    "invalid": "Any exchange derives from live Planner data.",
    "unknown": "The bridge contract is not yet accepted."
  },
  "environment": [
    "Node with the accepted T0 test runner",
    "bridge stub with synthetic exchanges"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.work-live-adapter.001",
  "evidence_executor_task": "spec.hq-social-work#task.work-live-adapter.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.work-core.001",
      "spec.hq-social-work#task.service-bridge.001"
    ]
  },
  "target_hints": [
    "modules/work/live/"
  ],
  "affected_check_groups": [
    "work-module",
    "shell-integration"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.work-live-adapter.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.domain-integration.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-social-work#req.shell.001",
    "spec.hq-social-work#req.safety.001",
    "spec.hq-social-work#req.foundation-binding.001"
  ],
  "scenario": "On the integrated head, Design, Social, Work, Design round trips restore each domain; explicit theme survives reload; System follows OS; captured content is unchanged; switches, card moves and reference follows make zero execution calls.",
  "evidence": {
    "predicate": "Integration tests pass on the exact integrated head with Design's own tests unchanged.",
    "invalid": "Design tests were edited or execution spies were removed.",
    "unknown": "The Electron app cannot run on this host."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.domain-integration.001",
  "evidence_executor_task": "spec.hq-social-work#task.domain-integration.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.ui-kit.001",
      "spec.hq-social-work#task.social-domain.001",
      "spec.hq-social-work#task.work-domain.001"
    ]
  },
  "target_hints": [
    "docs/evidence/hq-social-work/integration/"
  ],
  "affected_check_groups": [
    "shell-integration",
    "hq-foundation",
    "hq-ui",
    "social-module",
    "work-module"
  ],
  "required_at": "integration-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.domain-integration.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.reference-contract.001" -->
```json
{
  "schema_version": 1,
  "kind": "conformance",
  "validates": [
    "spec.hq-social-work#req.references.001"
  ],
  "scenario": "Contract tests parse every status, reject unknown statuses, compile T0's existing tests and the Design placeholder against the extended ModulePort, and check provider and port types expose no execution members.",
  "evidence": {
    "predicate": "Existing T0 tests pass unchanged and the new contract tests pass.",
    "invalid": "An existing T0 test or the ReferenceEnvelope shape was modified.",
    "unknown": "Design coordinator compatibility is unconfirmed."
  },
  "environment": [
    "Node with the accepted T0 test runner"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.reference-contract.001",
  "evidence_executor_task": "spec.hq-social-work#task.reference-contract.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.workspace-skeleton.001"
    ]
  },
  "target_hints": [
    "packages/contracts/src/references.test.ts"
  ],
  "affected_check_groups": [
    "hq-foundation"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.reference-contract.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.reference-shell.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "scenario": "With stub providers, the shell opens references for each status, returns via Back to the exact source destination, refuses silent navigation on project mismatch and renders unknown kinds read-only.",
  "evidence": {
    "predicate": "Every status path behaves as RL-5 states and spies on non-reference ports record zero calls.",
    "invalid": "Resolutions are written to any port or navigation happens on mismatch.",
    "unknown": "App.tsx custody is not recorded."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.reference-shell.001",
  "evidence_executor_task": "spec.hq-social-work#task.reference-shell.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.reference-contract.001"
    ]
  },
  "target_hints": [
    "apps/desktop/src/references.test.ts"
  ],
  "affected_check_groups": [
    "shell-integration"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.reference-shell.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.reference-ui.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.shell.001"
  ],
  "scenario": "ReferenceChip, LinkList and LinkPicker render every status in light and dark and are operated by keyboard only, including Unlink and Update snapshot with Undo.",
  "evidence": {
    "predicate": "Each status has a text label and freshness, snapshots stay readable, and keyboard paths complete.",
    "invalid": "Status is conveyed by color alone or an unresolved target renders as available.",
    "unknown": "An environment T2 also left unverified (Electron, macOS, screen reader, forced colours, 2x) is unavailable; recorded as a gap."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.reference-ui.001",
  "evidence_executor_task": "spec.hq-social-work#task.reference-ui.001",
  "acceptance_owner": "lane-hq-ui",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.ui-kit.001",
      "spec.hq-social-work#task.reference-contract.001"
    ]
  },
  "target_hints": [
    "packages/hq-ui/test/references/"
  ],
  "affected_check_groups": [
    "hq-ui"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.reference-ui.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.social-references.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.social-content.001"
  ],
  "scenario": "On the fixture, link a draft to a fixture Work card, unlink, undo, hit a version conflict, and save with features both present and absent; resolve drafts, runs and brands for each status.",
  "evidence": {
    "predicate": "Links persist only with hq-references-v1, are shown not saved otherwise, and the recorder shows zero execution calls.",
    "invalid": "Links are silently dropped or the test uses non-fictional content.",
    "unknown": "Visual capture is unavailable on this host."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.social-references.001",
  "evidence_executor_task": "spec.hq-social-work#task.social-references.001",
  "acceptance_owner": "lane-social-content",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.social-domain.001",
      "spec.hq-social-work#task.reference-ui.001"
    ]
  },
  "target_hints": [
    "modules/social/references/"
  ],
  "affected_check_groups": [
    "social-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.social-references.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.work-references.001" -->
```json
{
  "schema_version": 1,
  "kind": "component",
  "validates": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "scenario": "On the fixture, add and remove kind hq links on a card with revision guards, conflicts and Undo; export and re-import; drag a linked card; resolve archived and missing items.",
  "evidence": {
    "predicate": "Envelopes round-trip byte-for-byte, writes require hq-references-v1, and drag makes zero execution calls.",
    "invalid": "A link is stored as a URL reference or the export shape changes.",
    "unknown": "Visual capture is unavailable on this host."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.work-references.001",
  "evidence_executor_task": "spec.hq-social-work#task.work-references.001",
  "acceptance_owner": "lane-work-board",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.work-domain.001",
      "spec.hq-social-work#task.reference-ui.001"
    ]
  },
  "target_hints": [
    "modules/work/references/"
  ],
  "affected_check_groups": [
    "work-module"
  ],
  "required_at": "checkpoint-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.work-references.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.reference-integration.001" -->
```json
{
  "schema_version": 1,
  "kind": "integration",
  "validates": [
    "spec.hq-social-work#req.references.001",
    "spec.hq-social-work#req.safety.001"
  ],
  "scenario": "On the integrated head with fixtures, a Social draft links to a Work card and back; each link opens and returns with source state intact; status variants, unlink, export round trip and zero dispatch are checked in light and dark.",
  "evidence": {
    "predicate": "All RL behaviors pass on the exact integrated head with every execution spy at zero.",
    "invalid": "Spies were removed or a service schema change was assumed instead of the fixture capability.",
    "unknown": "The Electron app cannot run on this host."
  },
  "environment": [
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.reference-integration.001",
  "evidence_executor_task": "spec.hq-social-work#task.reference-integration.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.domain-integration.001",
      "spec.hq-social-work#task.reference-shell.001",
      "spec.hq-social-work#task.social-references.001",
      "spec.hq-social-work#task.work-references.001"
    ]
  },
  "target_hints": [
    "docs/evidence/hq-social-work/references/"
  ],
  "affected_check_groups": [
    "shell-integration",
    "social-module",
    "work-module",
    "hq-ui"
  ],
  "required_at": "integration-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.reference-integration.001" -->

<!-- codex-section:begin id="spec.hq-social-work#test.campaign-verification.001" -->
```json
{
  "schema_version": 1,
  "kind": "manual",
  "validates": [
    "spec.hq-social-work#req.safety.001",
    "spec.hq-social-work#req.shell.001"
  ],
  "scenario": "The verifier runs the deduplicated union of affected checks on the exact integrated head, reviews the cumulative light and dark evidence and the public-safety diff, and records uncovered work.",
  "evidence": {
    "predicate": "All union checks pass at the head, evidence is fictional and complete, and gaps are listed explicitly.",
    "invalid": "Checks ran on a different head or evidence contains private content.",
    "unknown": "A required environment is unavailable; recorded as a gap, not a pass."
  },
  "environment": [
    "Node with the accepted T0 test runner",
    "T0 or skeleton-provided DOM test environment",
    "Electron dev app or Vite renderer with fixture adapters, light and dark"
  ],
  "obligation_owner_task": "spec.hq-social-work#task.campaign-verification.001",
  "evidence_executor_task": "spec.hq-social-work#task.campaign-verification.001",
  "acceptance_owner": "hq-root",
  "activation": {
    "after_accepted": [
      "spec.hq-social-work#task.domain-integration.001",
      "spec.hq-social-work#task.reference-integration.001"
    ]
  },
  "target_hints": [
    "docs/evidence/hq-social-work/verification/"
  ],
  "affected_check_groups": [
    "hq-foundation",
    "shell-integration",
    "hq-ui",
    "social-module",
    "work-module"
  ],
  "required_at": "candidate-review-and-verification"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.campaign-verification.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.stop-recovery-delivery.001" -->
## Stop, Recovery, And Delivery Boundaries

**Stop and hold the affected effect when:**

- the T0 baseline is unaccepted or its names differ without a rebind;
- a needed change falls outside the writer cone;
- a dependency or lockfile change would be required (propose it to the root);
- live data, credentials or a private address would be read or committed;
- an action could start execution from a card, navigation or mode switch;
- an unknown prior effect exists, such as a lost PR, push or commit response;
- CPU is at 85% or higher before tests.

Continue all unaffected work.

**Recovery:**

- Reconcile lost Git or GitHub responses by readback: `git ls-remote`, `gh pr view`. Never retry blindly.
- A plan delta from the root, such as a path rebind or contract name, triggers an explicit rebind in each affected lane before its next mutation.
- A lane that cannot finish publishes its useful partial work as a draft PR with exact gaps.

**Review:**

- Self-review of the final diff is required.
- No automated PR review bots.
- P2–P4 findings, and ordinary P1 findings in this first release, are recorded and deferred without implementation unless the owner directs otherwise.
- P0 findings stop delivery: core use broken, credential exposure, unauthorized access, data loss, unknown effect.

**Delivery:**

- Publish lane branches and PRs, non-draft once checks pass, and link them to the lane's native thread.
- Record exact commits and check results in the PR.
- Merge is held for integration-owner agreement.
- No CI workflows until the Jones shared Actions guidance is read by the root.
- No signing, installation, deployment, service change or data migration.

**Operator Interaction Inventory:** see `ctx.operator-interaction-inventory.001`. HQ source work introduces no protected operation. The service extensions and live access do.
<!-- codex-section:end id="spec.hq-social-work#ctx.stop-recovery-delivery.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.operator-interaction-inventory.001" -->
## Operator Interaction Inventory

HQ source tasks in this plan run with **no owner command, TTY, password or sudo**. Protected effects arise only when existing services are changed or reached. Each needs its own exact gate, and none is approved by this plan.

| Phase | Effect | Class | Owner action | Gate and readback | Stop and recovery |
| --- | --- | --- | --- | --- | --- |
| Bootstrap | Implementing the service extensions in the private Planner and Social repositories, with tests on synthetic scratch data | Green in those repositories, under their owners and policies | None beyond assigning those owners | Their own PRs and checks. No HQ lane writes there. | Normal PR recovery |
| Bootstrap | Deploying a new Planner or Social service release to the existing hosted instance | **Red** (shared operational mutation) | M Jones approves one exact envelope: target instance, release SHA, unit, pre-deploy backup and rollback pointer | Health and feature readback (`features` includes the flag), plus a record count unchanged versus the backup | Stop on variance. Roll back to the prior release pointer and restore the backup. |
| Bootstrap | Social `ALTER TABLE content ADD COLUMN links` on live data | **Red** (shared data migration, additive) | Covered by the same deploy envelope only if named in it | Backup taken and readable, column present, row count and checksum of existing columns unchanged | On failure restore the backup exactly. There is no destructive repair. |
| Normal startup and steady state | A user enters service endpoints in HQ settings. HQ reads and writes through the bridge. | Green user configuration. Real-service reads and writes are the user's own use. | The owner enters the endpoints. Agents never do, and never read live data. | The endpoint is verified by a `features`/health read and shown as *Connected*, with an exact access scope (which service, which project) | *Not connected* on failure. No fallback host. |
| Routine diagnostics | Connection status and freshness in the HQ UI | Green | None | `unavailable`/`unknown` stay visible | None needed |
| Expected recovery | Service unreachable: links show `unavailable` and runs show Unknown | Green | None | Reconcile by readback before any retry | Never retry `submitRun` automatically |
| Upgrade and rollback | Service releases | Red, as above | Per-release envelope | As above | Prior release plus backup |
| Credential enrollment and rotation | None. The services use network-level access, and HQ stores no credentials. Social's per-session workspace token stays in the main process. | — | none | — | — |
| Destructive or forced effects | None planned. Unlink is a user edit of one record, never deletion of a target. | — | none | — | — |
| Rare exceptional fallback | A failed migration or unknown deploy effect | Red | M Jones decides after readback | Authoritative readback of service state | Hold all writes, restore the backup |
<!-- codex-section:end id="spec.hq-social-work#ctx.operator-interaction-inventory.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.lane-capsules.001" -->
## Lane capsules

The root renders each capsule into a native launch message. It adds the private bindings: local Codex V3 checkout path, worktree, branch and native thread ID. Every capsule begins with `ctx.launch-preflight.001`.

Common to all capsules:

- Plan: `Jones-Systems/HQ`, branch `work/hq-social-work-plan`, the immutable plan commit recorded in the root's launch message, this file `docs/engineering-specs/hq-social-work.md`.
- Base: the accepted T0 commit.
- Coordination channel: the plan PR and the lane PRs.
- Model: `claude-opus-5-5`/high, no descendants.
- Authority: implement and publish the assigned scope only; no merge.

| Lane | Tasks | Read first | Ready now | First real gate | Finish line |
| --- | --- | --- | --- | --- | --- |
| UI | `task.ui-kit.001`, `task.reference-ui.001`, then `task.shell-chrome.001` | `iface.ui-kit.001`, `req.shell.001`, `ctx.visual-system-binding.001`, T2 commit `f3c1daff` | Token copy with integrity test, contrast helper, primitives, PreservedContent | R1 skeleton; a named UI owner for shell-chrome | `ac.ui-kit.001`, then `ac.shell-chrome.001` |
| SOC-C | `task.social-core.001` → `task.social-content.001` → `task.social-domain.001` → `task.social-references.001`; `task.social-live-adapter.001` when activated | `iface.social-port.001`, `req.social-content.001`, `req.references.001`, `ctx.social-design-reconciliation.001`, T3 commit `8f91f6b2` | Port, fixture, conformance suite | R1; publish core early for SOC-W | `ac.social-core.001`, `ac.social-content.001`, `ac.social-domain.001` |
| SOC-W | `task.social-workbench.001` | `req.social-research.001`, `iface.social-port.001`, T3 branch | Per-tool input builders and result summarizers as pure functions | SOC-C core commit; UI kit | `ac.social-workbench.001` |
| WRK-P | `task.work-core.001` → `task.work-views.001`; `task.work-live-adapter.001` when activated | `iface.work-port.001`, `req.work-core.001`, `req.work-views.001`, `ctx.d1-import.001`, `ctx.work-design-binding.001`, T4 commit `1bb550de` | Verbatim D-1 import with provenance and an integrity test; validation; fixture | R1; publish core early for WRK-B | `ac.work-core.001`, `ac.work-views.001` |
| WRK-B | `task.work-board.001` → `task.work-domain.001` → `task.work-references.001` | `req.work-views.001` RV-1–3 and RV-6, `iface.work-port.001`, T4 branch | Pointer-drag engine and keyboard move model against port types | WRK-P core commit; UI kit | `ac.work-board.001`, `ac.work-domain.001` |
<!-- codex-section:end id="spec.hq-social-work#ctx.lane-capsules.001" -->
