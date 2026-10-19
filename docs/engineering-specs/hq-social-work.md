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
| Multiple boards, editable manual lists, multi-labels, cross-domain references stored on cards | **Not** Planner capabilities | Rule-based Lists view and per-device board presets; schema extension is an owner decision (D-3) |

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

Shared presentation lives in `packages/hq-ui/`. Live service access goes through the main process via a root-owned, typed desktop capability (`iface.service-bridge.001`). The renderer never receives a service address or token and cannot name arbitrary URLs.

**Non-goals:** a Design feature; a replacement of Fieldnotes or the Planner service; data migration; service/schema changes in either private repository; posting, collection or account connection; a task scheduler or execution from cards; Trello import; CI workflows; signing, installation or deployment.

**Finish line for this campaign.** Every lane publishes its candidate PR with checks and visual evidence. Root integrates, but merge is held for integration-owner agreement. Installed-app acceptance is a separate later stage.
<!-- codex-section:end id="spec.hq-social-work#ctx.project-summary.001" -->

## Requirements

<!-- codex-section:begin id="spec.hq-social-work#req.foundation-binding.001" -->
- **RF-1.** Lanes consume T0's published, root-accepted baseline. That covers npm workspaces, `apps/desktop/src/modules.tsx` or its registry equivalent, and the `@hq/contracts` domain, appearance, project-context, module-port and read-only platform/version types. No lane edits root manifests, the lockfile, configuration, `apps/desktop/` or `packages/contracts/` without explicit single-writer custody.
- **RF-2.** Literal paths in this plan are rebound mechanically by the root if T0's accepted layout differs, for example if modules live under `apps/desktop/src/modules/`. The root records the rebind as a versioned plan delta before dependent lanes mutate.
- **RF-3.** No duplicate contracts. Domain-specific types stay inside the domain. Shared-contract additions go through the root as a proposal.
<!-- codex-section:end id="spec.hq-social-work#req.foundation-binding.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.shell.001" -->
- **RS-1.** `packages/hq-ui` defines CSS custom-property tokens for the foundation's semantic roles: base/raised surfaces, primary/muted text, border, accent and accent text, focus, success, warning and danger. Each role has light and dark values selected by the shell's appearance state. Final values come from T2's visual system. Modules use only these roles plus documented domain roles.
- **RS-2.** Tokens never apply to captured or producer content. Elements marked `data-hq-content="captured"` and images or iframes of evidence get no filter, blend or recolor. The dark theme changes chrome only.
- **RS-3.** `packages/hq-ui` provides accessible primitives: Button, IconButton, Menu with roving focus, Dialog with focus trap and Escape, Toast with an action (Undo), Tabs, StatusChip with a text label (never color alone), SaveIndicator (saving / saved / not saved / offline / unknown) and StateView (empty / loading / error / offline / unavailable / unknown). All are keyboard operable with a visible focus ring in both themes and respect reduced motion.
- **RS-4.** After explicit custody transfer only, the shell chrome adopts these tokens: slim rail Design → Social → Work, project context, appearance control. Rail order, per-domain destination restoration and appearance persistence keep T0's behavior.
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
- **RC-2.** Saves send the record's current version. A version conflict shows "Changed elsewhere" and lets the user reopen the latest copy or copy their text out. The draft is never silently overwritten. Unsaved editor text survives domain switches.
- **RC-3.** Brands: list and add (name 1–80 characters). The built-in default brand is shown as present, not created.
- **RC-4.** Editorial calendar: a month view of drafts by planned date, plus an undated tray. Moving a draft changes only its planned date, through one versioned save, with undo. The planned date is labeled as a planning label, never "scheduled" or "approved". It is independent of Work planning dates.
- **RC-5.** Social secondary navigation (Library, Calendar, Workbench, Runs, Brands) restores its last section, filters and selection after a domain switch.
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
- **RR-6.** A Writing studio result can be saved to the content library as a new draft through the content port. Its provenance note names the run ID.
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
- **RW-2.** Client validation mirrors the service rules for immediate feedback. The authoritative service, or the fixture adapter standing in for it, remains the validator and returns `[{field, message}]`.
- **RW-3.** Pure logic, behavior-compatible with the Planner: ordering and drop anchors (`before_id` / `after_id` / top / bottom; renumber within the target status), period bounds and ISO weeks, primary date, date state, review buckets, filters.
- **RW-4.** The `PlannerPort` (`iface.work-port.001`) has two implementations:
  - an in-memory fixture adapter with revision guards, `revision_conflict` and `order_conflict` (409 semantics), request-ID idempotency (replay returns the recorded result; reuse with a different body is rejected) and synthetic fictional examples;
  - later, a live adapter over the bridge.
- **RW-5.** The state hook provides:
  - snapshot load and version polling while visible;
  - optimistic projection with rollback;
  - an unconfirmed queue retried with the **same** request ID;
  - save states Saving… / Saved · time / N unconfirmed / Offline · not saving;
  - a client undo stack of up to 40 inverse operations through the normal port.
- **RW-6.** Export and restore stay with the Planner service and its existing format (`jones-planning-export` v1). HQ exposes them only through the live adapter and never reformats records.
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
- **RV-5.** Lists view, illustrating the owner's Today / This week / Later reference. Groups are derived from actual dates only:
  - **Today:** a day-precision date today, or overdue;
  - **This week:** a date in the current ISO week;
  - **Later:** a date after this week;
  - **Undated:** everything else.

  Lists are read-only groupings. Dragging between them is disabled with an explanation. They never write a date or reinterpret a horizon. Board presets are saved filters by area, kind or status, stored per device.
- **RV-6.** Work secondary navigation restores its view, filters, scroll and selection after a domain switch. Mode switch, drag, reorder and status/horizon/date changes make zero execution calls.
<!-- codex-section:end id="spec.hq-social-work#req.work-views.001" -->

<!-- codex-section:begin id="spec.hq-social-work#req.safety.001" -->
- **RX-1.** Public repository content uses fictional fixtures only. It contains no private records, brand names, screenshots of owner content, internal addresses, credentials or session history.
- **RX-2.** Private source (Fieldnotes and Manual Planner) informs interfaces only. No file is imported unless the owner makes the selected-file publication decision D-1.
- **RX-3.** The renderer gets no generic network, filesystem or shell access. Service access is main-process only. Each domain uses an enumerated route allowlist. Endpoints are user-configured at runtime and never committed. Tokens stay in the main process.
- **RX-4.** Agents never read live Social or Planner data. Live adapters are verified against hand-written synthetic HTTP exchanges and, optionally, a task-owned scratch service instance with synthetic data.
- **RX-5.** Every observed external state shows its freshness: last synced, offline, unknown. Stale or unknown state never renders as verified success.
<!-- codex-section:end id="spec.hq-social-work#req.safety.001" -->

## Acceptance

<!-- codex-section:begin id="spec.hq-social-work#ac.foundation-baseline.001" -->
The root has recorded the accepted T0 commit, the actual workspace globs, the module registry mechanism and path, the `@hq/contracts` export names, the test runner and the scripts (`typecheck`, `test`, `build`, dev). It has published any path rebind as a plan delta. Until then, implementation lanes do only reversible preparation.
<!-- codex-section:end id="spec.hq-social-work#ac.foundation-baseline.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.workspace-skeleton.001" -->
`modules/social`, `modules/work` and `packages/hq-ui` exist as workspaces, each with a package manifest, a TypeScript configuration and a passing empty test. They come from one root-owned commit with one lockfile regeneration. Fresh `npm install`, `npm run typecheck`, `npm test` and `npm run build` pass. Each module renders an "available, no data" stub in its rail slot.
<!-- codex-section:end id="spec.hq-social-work#ac.workspace-skeleton.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.ui-kit.001" -->
Token and primitive tests pass in light and dark. Text-role contrast is at least 4.5:1 and focus contrast at least 3:1, both computed. Captured-content containers keep their pixels and computed colors across theme changes. Every primitive is operable by keyboard alone. Light and dark visual evidence of the kit page is attached.
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
Explicit activation predicate: M Jones has approved decision D-2: connecting HQ to the existing Fieldnotes and Planner services through a main-process bridge with user-entered endpoints. The root has accepted `iface.service-bridge.001`, or an amended version, as a shared contract change.
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
Each live adapter passes the same port conformance suite as its fixture against synthetic recorded exchanges. The Planner adapter reuses the same `X-Request-Id` on retry, maps 409 `revision_conflict` and `order_conflict`, and treats 422 `request_id_reused` as a defect. The Fieldnotes adapter refreshes the token on 403, maps 409 conflicts and never retries `submitRun`. No live data is read by agents.
<!-- codex-section:end id="spec.hq-social-work#ac.live-adapters.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.work-core.001" -->
Validation parity table tests pass: every enum, limit, date precision/time/tz rule and URL rule. Ordering, period, review-bucket and filter tests pass. The fixture adapter passes revision-conflict, order-conflict, idempotent replay and request-ID reuse. The hook's unconfirmed retry reuses the request ID, and undo restores prior fields and anchors.
<!-- codex-section:end id="spec.hq-social-work#ac.work-core.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.work-board.001" -->
Board drag, keyboard and menu moves produce identical `move` calls and agree after Undo. Quick capture creates one inbox item with no dates. Detail autosave and conflict states work. Zero execution-class calls exist because the port has none, and a test asserts the port surface. Empty, loading, error, offline and saving states are covered. Light and dark evidence is attached.
<!-- codex-section:end id="spec.hq-social-work#ac.work-board.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ac.work-views.001" -->
Glance, List, Calendar, Timeline, Review, Archive and Lists render the synthetic fixture. Calendar and Timeline moves produce the documented patch with Undo. Lists classify only by actual dates, keep undated items in Undated and never write. Light and dark evidence is attached.
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

<!-- codex-section:begin id="spec.hq-social-work#ctx.research-decision-basis.001" -->
## Research And Decision Basis

### Evidence read for this plan (2026-10-20, read-only)

| Source | Identity | Finding used |
| --- | --- | --- |
| HQ bootstrap assignment | `Jones-Systems/HQ` `work/hq-foundation` at `aab225bcbb49968fec97dc71bbc20caf21fe8d1d`, `docs/engineering-specs/hq-bootstrap.md` | T0 owns root, `apps/desktop`, `packages/contracts`. Social/Work are explicit unavailable slots. Strict Electron security. |
| HQ shared foundation v0.3 | Uncommitted source, SHA-256 `a0d4e678…e33271`; public copy at `docs/design/hq-shared-foundation.md` | Domain boundaries, appearance, references and the three state kinds. Zero execution calls from cards. Planner is the authority. |
| HQ Design PRD | `work/hq-design-plan` at `149d84377ef1e7b72d9df92189f6f9bf83801898`, `docs/prds/design.md` | Design scope and its separate owner. |
| Design lane draft (uncommitted, read-only) | Design plan worktree `docs/design-lanes.json` | Design uses `modules/design/<section>/`, `packages/design-store/`, `ShellContextPort`, `StoragePort`, renderer-glob registration. Social/Work mirror the `modules/<domain>/` layout. |
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
   - Fixture adapters live in the renderer. Live adapters call `window.hq.services.<domain>.<route>`, which is main-process IPC.
   - The present boundary exists because both authorities are private Python services with same-origin HTTP guards. A Node main-process request sends no Origin or `Sec-Fetch-Site` header and a correct Host, so it passes the existing guards. Neither service needs to change for read/write parity. This is an inference from source; it is proved only by the live-adapter tests in a scratch instance.
2. **State and ownership.**
   - Planner items, settings, history and backups: the Planner service.
   - Drafts, brands, runs and receipts: Fieldnotes.
   - UI state (view, filters, selection, unsaved editor text, board presets): the HQ domain module, through T0's storage/shell port. If T0 supplies none, module-scoped local storage holds it. This is gap G-3.
   - Invalid states rejected client-side and again by the authority: a date precision/time mismatch, a non-http reference, an unknown channel or brand, a stale version.
3. **Consumers and hidden impact.**
   - Direct: the shell registry, `@hq/contracts`, `packages/hq-ui`, and both services' HTTP APIs.
   - Indirect: the existing Fieldnotes browser UI and the Planner web UI, which keep working and share the same data, so concurrent edits are real. HQ must honor version and revision conflicts rather than assume exclusivity.
   - Design is unaffected except for the optional adoption of `hq-ui` tokens.
   - Coverage is **partial**: the universe is the HQ public tree at `aab225b` plus the two private sources at the revisions above, discovered by reading the route and handler source. Excluded: T0 code (unpublished), the hosting configuration of the live services (not read, by design), and the physical-device touch drag (unverified upstream).
4. **Interface depth.** Ports sit at the domain-operation level: `saveContent`, `move`, `patch`. They do not expose HTTP routes, so fixture and live adapters are interchangeable. The bridge sits one level lower, with enumerated routes, because it is a shared security boundary that must be reviewable as a fixed list. Exposing generic `fetch` is rejected.
5. **Compatibility and migration.** None. Records keep their identity, format and export. No schema change. HQ adds no field the services would reject. Planner card references to HQ objects (`hq:` URLs) would fail the Planner's http(s) rule, so cross-domain references stored on cards wait for D-4.
6. **Load-bearing safety claims.**
   - Zero execution calls from Work (the port has no such method; tested).
   - Social runs only on explicit Run, with no automatic retry of an unknown (recorder tests).
   - The renderer cannot reach arbitrary hosts (CSP plus bridge conformance).
   - No private data in the public repository (fixtures are authored fictional content; reviewed in the diff).
7. **Verification consequences.** The `test.*` intents below. Each live adapter shares its fixture's conformance suite. The visual evidence covers both themes.

### Decisions

- **DEC-1 (working default).** Five implementation lanes plus root-owned serialized shared tasks. Rationale is in `ctx.task-plan.001`.
- **DEC-2.** Fixtures first, live later. Each domain is useful for review and tests without the bridge. Live connection is held behind D-2.
- **DEC-3.** No new runtime dependencies by lanes. Drag uses pointer events, following the Planner's proven engine design. Validation is hand-written TypeScript. Any devDependency need (for example a DOM test environment) is proposed to the root, which batches it into the skeleton task.

### Owner decisions (defaults allow progress)

| ID | Decision | Default until decided | Recommendation |
| --- | --- | --- | --- |
| D-1 | Publish selected Manual Planner pure modules (`ordering.js`, `dates.js`, `model.js`) into public HQ with provenance? | Behavior-compatible clean TypeScript implementation; private source used only as interface reference | Approve selected-file import of those three files only. They are owner-authored MIT logic with no data, which saves rework. |
| D-2 | Connect HQ to the existing Fieldnotes and Planner services through a main-process bridge with user-entered endpoints? | Fixture adapters only; live adapter tasks held | Approve after T0 acceptance. This is what makes HQ useful day to day. |
| D-3 | Extend the Planner schema for editable manual lists, multiple boards and multi-labels? | Rule-based Lists view and per-device board presets; area shown as a label | Defer until the Lists view has been used. |
| D-4 | Store cross-domain HQ references on Planner cards? | Not stored; existing links only | Decide with the HQ reference envelope owner (root) after T0 publishes its contract. |

### Gaps that hold only their dependents

- **G-1.** T0 code is unpublished. Exact registry, contracts and scripts are unknown, so no compiler-validated runnable implementation is claimed.
- **G-2.** T2, T3 and T4 mockups are unpublished. Token values and layouts are pending. They block visual acceptance, not core start.
- **G-3.** UI-state storage port: pending T0.
- **G-4.** HQ has no `tests/check-groups.toml`. The catalog in `ctx.check-catalog.001` is proposed bytes for the root to adopt.
<!-- codex-section:end id="spec.hq-social-work#ctx.research-decision-basis.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.change-surface.001" -->
## Exact Change Surface And Ownership

### Writer map (one writer per path; literal, subject to the RF-2 rebind)

| Lane / owner | Literal write scope | Never writes |
| --- | --- | --- |
| **HQ root (integration owner)** | `package.json`, `package-lock.json`, root configs, `modules/social/package.json`, `modules/social/tsconfig.json`, `modules/work/package.json`, `modules/work/tsconfig.json`, `packages/hq-ui/package.json`, `packages/hq-ui/tsconfig.json`, `apps/desktop/src/modules.tsx`, `packages/contracts/src/services.ts`, `apps/desktop/src/main/services/`, `apps/desktop/src/preload/services.ts`, `docs/evidence/hq-social-work/integration/` | Module feature code |
| **UI** (HQ-UI lane) | `packages/hq-ui/src/`, `packages/hq-ui/test/`, `packages/hq-ui/README.md`, `docs/evidence/hq-social-work/ui/`; after custody transfer: `apps/desktop/src/shell/` | Contracts, root files, `modules/**` |
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
**Domain module consumption (expected T0 surface; bound at `ac.foundation-baseline.001`).**

Each domain exports a default descriptor from `modules/<domain>/index.tsx` that conforms to T0's `ModulePort`, with:

- `id: 'social' | 'work'`;
- a label;
- destinations under `/social/*` or `/work/*`;
- `render(context)`, where `context` carries the appearance, project context, a storage namespace and a navigation callback.

Domains never read OS theme directly. They never change the project silently. They never write another domain's namespace. If T0's names differ, the root rebinds the names; the semantics stay as written.

Social destinations: `/social/library`, `/social/library/:draftId`, `/social/calendar`, `/social/workbench`, `/social/workbench/:toolId`, `/social/runs`, `/social/runs/:runId`, `/social/brands`.

Work destinations: `/work/glance`, `/work/board`, `/work/list`, `/work/calendar`, `/work/timeline`, `/work/review`, `/work/lists`, `/work/archive`, `/work/item/:itemId`.
<!-- codex-section:end id="spec.hq-social-work#iface.domain-module.001" -->

<!-- codex-section:begin id="spec.hq-social-work#iface.social-port.001" -->
**`SocialWorkspacePort`** (owner SOC-C; file `modules/social/core/port.ts`; Fieldnotes semantics):

```ts
type Channel = 'General'|'X'|'LinkedIn'|'TikTok'|'Instagram'|'Facebook'|'Reddit'|'Article';
type ToolId = 'tiktok-intelligence'|'x-intelligence'|'x-studio'|'seo-studio'|'search-visibility'|'social-publisher'|'reddit-opportunities'|'creator-relationships';
interface Brand { id: string; name: string }
interface Draft { id: string; title: string; body: string; brand_id: string; channel: Channel;
  planned_date: string /* '' | YYYY-MM-DD */; archived: 0|1; version: number; updated_at: string }
interface Tool { id: ToolId; name: string; category: 'Discover'|'Create'|'Measure'|'Plan'|'Connect'; description: string; mark: string }
type RunStatus = 'queued'|'running'|'succeeded'|'failed'|'interrupted';
interface RunRecord { id: string; tool: ToolId; status: RunStatus; is_example: 0|1; created_at: string;
  finished_at: string|null; error: string|null; output?: unknown }
interface WorkspaceSnapshot { brands: Brand[]; content: Draft[]; runs: RunRecord[] /* latest 200 */; tools: Tool[]; observedAt: string }
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

`Item`, `Settings`, `Status`, `NewItemFields` and `ItemPatch` follow RW-1 exactly. Derived date fields (`instant`, `end_instant`, `tz_abbr`) are accepted on read and stripped before write.

**Invariants:**

- A retry after `unknown` reuses the same `requestId`.
- `move` renumbers only the target status.
- The port exposes no export, import or backup methods until the live adapter phase adds read-only `exportJson` and an explicitly confirmed `importPreview`/`import` that mirror the service. The root and owner approve those with D-2.
<!-- codex-section:end id="spec.hq-social-work#iface.work-port.001" -->

<!-- codex-section:begin id="spec.hq-social-work#iface.service-bridge.001" -->
**Proposed shared contract: desktop domain-service bridge** (owner: root; implementer: the root-designated shared writer; activation: `ac.service-bridge-approval.001`).

- **Contract.** `packages/contracts/src/services.ts` declares closed route unions:
  - Social: `workspace`, `sample`, `run`, `saveContent`, `addBrand`, `submitRun`;
  - Work: `state`, `version`, `item`, `history`, `create`, `patch`, `move`, `archive`, `restore`, `reviewed`, `settings`.

  Each route has typed parameters and response envelopes `{ ok: true, status, body } | { ok: false, kind: 'unavailable'|'unknown'|'http', status? }`.
- **Preload.** It exposes `window.hq.services.social.call(route, params)` and `window.hq.services.work.call(route, params)`. There is no URL, header or method argument.
- **Main process.**
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

<!-- codex-section:begin id="spec.hq-social-work#iface.ui-kit.001" -->
**`@hq/ui`** (owner UI lane).

- **Tokens.** `packages/hq-ui/src/tokens.css` sets `--hq-surface-base`, `--hq-surface-raised`, `--hq-text`, `--hq-text-muted`, `--hq-border`, `--hq-accent`, `--hq-accent-text`, `--hq-focus`, `--hq-success`, `--hq-warning` and `--hq-danger`, plus the `-soft` variants of the last four. They are scoped by `[data-hq-appearance="light"|"dark"]` on the shell root, which T0 sets from its resolved appearance.
- **TypeScript names.** `packages/hq-ui/src/tokens.ts` exports the token names; values live only in CSS.
- **Domain roles.** These are module-local: Work `--work-st-<status>` and `--work-dk-<datekind>`, Social `--social-channel-<id>`. Each needs a light and a dark value.
- **Components.** `packages/hq-ui/src/components/` exports the RS-3 set.
- **Contrast.** `packages/hq-ui/src/contrast.ts` exports a contrast helper used by the tests.
- **Captured content.** `[data-hq-content="captured"]` is documented as theme-exempt.

Token names may be renamed only before the first consumer lands.
<!-- codex-section:end id="spec.hq-social-work#iface.ui-kit.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.check-catalog.001" -->
### Proposed affected-check catalog (G-4)

The plan binds these exact bytes. The root may adopt them at `tests/check-groups.toml` in HQ. The commands reflect T0's expected scripts and are re-bound at `ac.foundation-baseline.001`.

```toml
schema = "codex.v3-check-groups/v1"
# Proposed HQ affected-check groups for spec.hq-social-work.
[groups.hq-typecheck]
command = "npm run typecheck"
[groups.hq-unit]
command = "npm test"
[groups.hq-build]
command = "npm run build"
[groups.hq-ui]
command = "npm test -w packages/hq-ui"
[groups.social-module]
command = "npm test -w modules/social"
[groups.work-module]
command = "npm test -w modules/work"
[groups.desktop-bridge]
command = "npm test -w apps/desktop -- services"
[groups.shell-integration]
command = "npm test -w apps/desktop"
[groups.visual-evidence]
command = "manual: light and dark captures of touched surfaces with fictional fixtures"
```
<!-- codex-section:end id="spec.hq-social-work#ctx.check-catalog.001" -->

<!-- codex-section:begin id="spec.hq-social-work#ctx.test-plan.001" -->
## Test Plan

**Environments:**

- Node with T0's test runner for pure logic.
- The DOM test environment that T0 provides, or the one the root adds in the skeleton task, for components.
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
| **WRK-B** (Work board) | Board, card, drag/keyboard/menu moves, capture, detail panel, domain descriptor | The Trello-like interaction core; independent after core |

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

### Semantic dependencies outside the task graph

| Producer | Consumer | Deliverable | Blocks |
| --- | --- | --- | --- |
| T0 | R0 → all | Accepted baseline commit with registry, contracts and scripts | All implementation |
| T2 visual system (`docs/design/hq-visual-system/`) | UI | Token values, type scale, density, rail/chrome treatment | UI-kit acceptance and visual evidence. Start may use foundation roles with provisional values. |
| T3 Social mockups (`docs/design/social/`) | SOC-C, SOC-W | Library, calendar, workbench and run layouts | Visual acceptance; core and logic start now |
| T4 Work mockups (`docs/design/work/`) | WRK-P, WRK-B | Board, card, detail, capture and Lists layouts | Visual acceptance; core and logic start now |
| Owner D-1 | WRK-P | Import-or-rewrite choice for Planner pure logic | Approach only; the default proceeds |
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
    "hq-build",
    "hq-typecheck",
    "hq-unit"
  ],
  "delivery_boundary": "Root launches lanes from this published plan on the accepted T0 base; lanes publish candidate PRs; merge held for integration-owner agreement; no deployment, signing, service change or migration."
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
  "objective": "Read back the accepted T0 baseline: commit, workspace globs, module registry path and mechanism, @hq/contracts export names, test runner and npm scripts. Publish any RF-2 path or name rebind as a versioned plan delta before dependent lanes mutate.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.domain-module.001"
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
    "hq-typecheck",
    "hq-unit",
    "hq-build"
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
    "package.json",
    "package-lock.json",
    "modules/social/package.json",
    "modules/social/tsconfig.json",
    "modules/work/package.json",
    "modules/work/tsconfig.json",
    "packages/hq-ui/package.json",
    "packages/hq-ui/tsconfig.json",
    "apps/desktop/src/modules.tsx"
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
    "hq-typecheck",
    "hq-unit",
    "hq-build"
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
    "apps/desktop/src/main/services",
    "apps/desktop/src/preload/services.ts"
  ],
  "requires": [
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [
    "spec.hq-social-work#iface.service-bridge.001"
  ],
  "dependencies": [
    "spec.hq-social-work#task.bind-foundation.001"
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
    "desktop-bridge",
    "hq-typecheck"
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
    "owner decision D-2 or root contract acceptance is absent"
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
  "objective": "Build @hq/ui: light/dark semantic tokens scoped by data-hq-appearance, captured-content exemption, contrast helper, and the accessible primitive set (Button, IconButton, Menu, Dialog, Toast with Undo, Tabs, StatusChip, SaveIndicator, StateView) with a kit evidence page.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
    "spec.hq-social-work#iface.ui-kit.001"
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
    "hq-ui",
    "hq-typecheck"
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
    "apps/desktop/src/shell"
  ],
  "requires": [
    "spec.hq-social-work#req.shell.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.ui-kit.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.ui-kit.001",
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
    "shell-integration",
    "hq-typecheck"
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
  "objective": "Implement modules/social/core: SocialWorkspacePort types, client validation mirroring Fieldnotes, fictional fixture adapter with conflict and run lifecycle including interrupted and unknown, call recorder classifying content/read/execution, shared port conformance suite and a state hook. Publish early for the workbench lane.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
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
    "social-module",
    "hq-typecheck"
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
    "social-module",
    "hq-typecheck"
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
  "objective": "Build the eight-tool workbench: catalog with delivered limits, form-first inputs and typed file import with Advanced JSON, examples, explicit-only Run, run history and receipts with visible-only polling, unknown submission with possible matches and no resubmission, tool-specific results, and Writing studio save-to-library.",
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
    "social-module",
    "hq-typecheck"
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
  "objective": "Compose the Social domain descriptor and secondary navigation (Library, Calendar, Workbench, Runs, Brands) with destination and state restoration, the delivered-limits banner and package-boundary import checks.",
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
    "social-module",
    "hq-typecheck",
    "hq-build"
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
    "desktop-bridge"
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
  "objective": "Implement modules/work/core: PlannerPort and item types exactly per RW-1, validation parity, ordering/anchors, periods and ISO weeks, review buckets and filters, fictional fixture adapter with revision/order conflicts and request-ID idempotency, port conformance suite, and the state hook with save states, unconfirmed retry using the same request ID and a 40-entry undo stack. Publish early for the board lane.",
  "context_refs": [
    "spec.hq-social-work#ctx.launch-preflight.001",
    "spec.hq-social-work#ctx.change-surface.001",
    "spec.hq-social-work#ctx.stop-recovery-delivery.001",
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
    "work-module",
    "hq-typecheck"
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
  "objective": "Build Glance, List, Calendar, Timeline, Review, Archive and the date-derived read-only Lists view (Today, This week, Later, Undated) with Planner behavior parity, undoable calendar and timeline moves, and full state coverage in light and dark.",
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
    "work-module",
    "hq-typecheck"
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
  "objective": "Build the status Board with cards, pointer/touch drag, keyboard and menu moves sharing one move path with Undo, quick capture into Inbox without invented dates, and the card detail panel with autosave, checklist, typed dates, references and conflict handling.",
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
    "work-module",
    "hq-typecheck"
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
    "work-module",
    "hq-typecheck",
    "hq-build"
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
    "desktop-bridge"
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
    "hq-typecheck",
    "hq-unit",
    "hq-build"
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
    "spec.hq-social-work#req.safety.001"
  ],
  "produces": [],
  "dependencies": [
    "spec.hq-social-work#task.domain-integration.001"
  ],
  "dependency_inputs": [
    {
      "task_ref": "spec.hq-social-work#task.domain-integration.001",
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
    "hq-typecheck",
    "hq-unit",
    "hq-build",
    "visual-evidence"
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
    "hq-typecheck",
    "hq-unit",
    "hq-build"
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
    "hq-typecheck",
    "hq-unit",
    "hq-build"
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
    "apps/desktop/src/main/services/"
  ],
  "affected_check_groups": [
    "desktop-bridge",
    "hq-typecheck"
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
  "scenario": "Token and primitive tests render every primitive in light and dark, operate them by keyboard only, compute contrast and verify captured-content containers keep computed colors across theme change.",
  "evidence": {
    "predicate": "Text contrast is at least 4.5:1, focus at least 3:1, keyboard paths complete and captured content unchanged.",
    "invalid": "Contrast is asserted from a screenshot guess or captured content is recolored.",
    "unknown": "T2 token values are unpublished; provisional values are labeled."
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
    "hq-ui",
    "hq-typecheck"
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
    "apps/desktop/src/shell/"
  ],
  "affected_check_groups": [
    "shell-integration",
    "hq-typecheck"
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
    "social-module",
    "hq-typecheck"
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
    "social-module",
    "hq-typecheck"
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
    "social-module",
    "hq-typecheck"
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
    "social-module",
    "hq-typecheck",
    "hq-build"
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
    "desktop-bridge"
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
  "scenario": "A validation parity table covers every enum, limit, date precision, time and timezone rule and URL rule; ordering, periods, review buckets and filters are tested; the fixture adapter and hook are exercised for conflicts, idempotent replay, unconfirmed retry and undo.",
  "evidence": {
    "predicate": "All parity and behavior tests pass with the same request ID reused on retry.",
    "invalid": "Parity expectations were derived from the TypeScript implementation instead of the Planner rules.",
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
    "work-module",
    "hq-typecheck"
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
    "work-module",
    "hq-typecheck"
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
    "work-module",
    "hq-typecheck"
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
    "work-module",
    "hq-typecheck",
    "hq-build"
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
    "desktop-bridge"
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
    "hq-typecheck",
    "hq-unit",
    "hq-build"
  ],
  "required_at": "integration-and-candidate"
}
```
<!-- codex-section:end id="spec.hq-social-work#test.domain-integration.001" -->

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
      "spec.hq-social-work#task.domain-integration.001"
    ]
  },
  "target_hints": [
    "docs/evidence/hq-social-work/verification/"
  ],
  "affected_check_groups": [
    "hq-typecheck",
    "hq-unit",
    "hq-build",
    "visual-evidence"
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

**Operator Interaction Inventory:** not triggered. No protected host operation, sudo, service installation or credential enrollment is introduced. Endpoint entry in HQ settings is ordinary user configuration in the app. Enabling the bridge (D-2) is an owner product decision, not a privileged operation.
<!-- codex-section:end id="spec.hq-social-work#ctx.stop-recovery-delivery.001" -->

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
| UI | `task.ui-kit.001`, then `task.shell-chrome.001` | `iface.ui-kit.001`, `req.shell.001`, T2 branch `work/hq-visual-system` | Token and contrast helper, primitives against foundation roles | R1 skeleton for checks; T2 values for acceptance; custody for shell-chrome | `ac.ui-kit.001`, then `ac.shell-chrome.001` |
| SOC-C | `task.social-core.001` → `task.social-content.001` → `task.social-domain.001`; `task.social-live-adapter.001` when activated | `iface.social-port.001`, `req.social-content.001`, T3 branch `work/hq-social-design` | Port, fixture, conformance suite | R1; publish core early for SOC-W | `ac.social-core.001`, `ac.social-content.001`, `ac.social-domain.001` |
| SOC-W | `task.social-workbench.001` | `req.social-research.001`, `iface.social-port.001`, T3 branch | Per-tool input builders and result summarizers as pure functions | SOC-C core commit; UI kit | `ac.social-workbench.001` |
| WRK-P | `task.work-core.001` → `task.work-views.001`; `task.work-live-adapter.001` when activated | `iface.work-port.001`, `req.work-core.001`, `req.work-views.001`, T4 branch `work/hq-work-design` | Validation, ordering, dates, review buckets, fixture | R1; publish core early for WRK-B | `ac.work-core.001`, `ac.work-views.001` |
| WRK-B | `task.work-board.001` → `task.work-domain.001` | `req.work-views.001` RV-1–3 and RV-6, `iface.work-port.001`, T4 branch | Pointer-drag engine and keyboard move model against port types | WRK-P core commit; UI kit | `ac.work-board.001`, `ac.work-domain.001` |
<!-- codex-section:end id="spec.hq-social-work#ctx.lane-capsules.001" -->
