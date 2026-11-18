# HQ Social — page design and mockups

Artifact Type: design-brief
Artifact ID: brief.hq-social-design
Purpose: Define HQ Social's desktop pages, states and honest capability boundaries so a later implementation plan can slice the work.
Decision owner: M Jones
Consumers: HQ shared implementation planner, Social implementation lanes, HQ visual-system lane
Authority effect: none

## Status and scope

Preliminary product and design output. This is not an implementation-ready plan, and it changes no production code, root configuration, shared contract or Design module. The mockup runs entirely in page memory on fictional fixtures. It makes no network requests and has no accounts, collection or posting.

| File | What it is |
| --- | --- |
| [`hq-social-mockup.html`](hq-social-mockup.html) | Interactive desktop prototype. Open it directly in a browser. It has seven Social pages, light/dark/system appearance, and every state listed below (use the **Mockup controls** panel, bottom right). |
| [`screenshots/`](screenshots/) | 19 rendered captures at 1280×800: core pages in light and dark, plus each non-happy state. |
| This file | Inventory, page specs, states, rules, implementation slices and acceptance. |

Visual tokens are provisional semantic roles (`--hq-surface-*`, `--hq-text-*`, `--hq-accent*`, `--hq-focus`, `--hq-success|warning|danger*`, plus one Social role, `--social-future*`). The HQ visual-system lane owns final names and values. Its branch had no published artifacts when this was written. Swap the values; keep the roles.

## Inputs read

- HQ bootstrap assignment `docs/engineering-specs/hq-bootstrap.md` at `aab225bcbb49968fec97dc71bbc20caf21fe8d1d`.
- HQ shared foundation **v0.3**, SHA-256 `a0d4e6789b2549ce9cb828f02babfca5c3a11238d9f832c7c9040c89e8e33271`. This is an uncommitted coordinator source, read directly as evidence, not as a published plan.
- The in-progress (unaccepted) T0 contracts draft: `DomainId`, `Appearance`, `ProjectContext`, `ReferenceEnvelope` and `ModulePort` with an opaque `destination` string. This brief aligns with those names but depends on none of them being final.
- The existing Social growth tools, private source repository at revision `3f647da`. Used for bounded interface research only (page names, tool catalog, record fields, run lifecycle). No source, data or records were copied. The live dashboard and its records were not opened.
- Workflow guidance: Jones-Systems/Codex-V3 `AGENTS.md` at `4beb491c44551b6e4207adcc7459c4b11407bcbc`, SHA-256 `1238a90adbf10ea8f2359f90ed0c7bf99fc1121589dcde5b99881fd247e87ce6`, read in full. Triggered guides loaded:
  - thread operations
  - plan-preserving messages
  - thread references
  - local app testing
  - default delivery
  - README practice
  - worktree cleanup readiness
  - Linux telemetry
  - the frontend pointer

  Where the defaults differ from this assignment's restrictions, the restrictions win: no descendant agents, a merge hold, and no model switch.

## Existing capability inventory

Every row is labeled by what actually exists. "Delivered" means built in the existing account-free dashboard. It does not mean freshly re-verified here.

| Capability | State | Notes for HQ |
| --- | --- | --- |
| Pages: overview, content library, planning calendar, tool workbenches, run history | Delivered | HQ keeps these as the core of its Social navigation. |
| Brands | Delivered, name only | Brand profile fields (audience, voice, topics, avoid-list) are a **proposed extension**. |
| Drafts: title, body, brand, channel (General, X, LinkedIn, TikTok, Instagram, Facebook, Reddit, Article), planned date, archived, version | Delivered | Saves use optimistic versioning. A stale save is rejected ("changed in another window"). Per-channel **variants** and draft states (Idea, Drafting, Ready for review) are **proposed**. |
| Planned date | Delivered | Editorial only. Saving a date never schedules or publishes. |
| Eight workbenches | Delivered | TikTok signals, Signal inbox and Reddit opportunities (Discover). Writing studio and SEO workbench (Create). Search visibility (Measure). Channel preview, five channel profiles (Plan). Creator fit (Connect). All run offline on supplied input. |
| Workbench input | Delivered as JSON objects, with fictional samples | Guided forms and file import with validation are the **proposed** usability step. JSON stays available as an advanced mode. |
| Runs: queued, running, succeeded, failed, interrupted; example label; receipt; network-off sandbox; bounded queue | Delivered | A restart marks in-flight runs *interrupted*. Nothing is retried automatically. |
| Writing studio voice | Delivered with example voices only | A brand voice from the profile is **planned**. |
| Supplied-data source registry with provenance | **Proposed** | The dashboard has no first-class source list today. Inputs are per run. |
| Local publisher simulator, social-listening import, keyword watch, trend board, publish-consent tooling | Separate CLIs, not in the dashboard | Shown in HQ only as "exists outside this workspace" or "planned". No live network, credentials or posting route. |
| Account connections, live collection, posting, executed scheduling | **Not built** | Shown as *Not connected / Not available / Planned*, never as working. Each needs its own approval. |

## Information architecture

- **HQ rail** (shell-owned): Design above Social above Work, plus the appearance control. Shown in the mockup for context only.
- **Social secondary navigation** (Social-owned): brand switcher and linked-project line. Pages: Overview, Sources, Workbenches, Library, Calendar, Run history. Under a *Later* group: Channels & accounts.
- **Top bar**: breadcrumb, the HQ project context chip (shell-owned), Social service status, and *New draft*.
- **Proposed module-local destinations** (opaque to the shell): `overview`, `sources[/<sourceId>]`, `workbenches/<toolId>`, `library[/<draftId>]`, `calendar[?month=YYYY-MM]`, `runs[/<runId>]`, `channels`. Social restores its own page, selection, filters, form input and unsaved text. Switching domains never submits, saves or runs anything.
- **Brand vs project**: a brand links to one HQ project. If the selected brand belongs to a different project than the HQ context, show a banner with an explicit *Switch HQ project*. Never switch silently, and never match records by title.

## Pages

Each page lists its content hierarchy, primary interactions and data authority.

### Overview: brand context
1. A capability strip (Analysis: available; Drafts & calendar: available; Live collection: not available; Accounts & posting: not available).
2. Brand profile (proposed fields, labeled as such).
3. Coming up (next planned drafts).
4. Needs attention (stale sources, failed and interrupted runs).
5. Recent research.
6. Linked across HQ: Design and Work references showing title snapshot, revision, status and "checked HH:MM". Unavailable targets keep the readable reference.

Opening a reference only navigates.

Authority: drafts, runs and sources come from the Social service; the Design and Work fields come from the reference envelope and its owner's readback.

### Sources: supplied data
A table of imported data (name, file, kind, records, as-of date, status valid/stale/invalid) plus a detail panel. The panel shows provenance (file, SHA-256, imported time, "supplied by you · not collected by HQ"), which workbenches the source feeds, and which runs used it.

Import flow: choose kind and file, validate locally, preview the count and as-of date, then *Save as source*. Errors give line and column, and nothing is saved. A labeled fictional example is available.

A *Collection: not available* card explains that live collection is absent and the listening tool is separate.

### Workbenches
A tool list grouped by category, then the selected tool with three input modes:
- **Guided form** (proposed): source pickers prefilled from Sources, topics prefilled from the brand profile, required markers, inline errors with an error summary that receives focus.
- **Import file**.
- **JSON** (advanced; the existing shape).

*Run analysis* shows a Queued → Running → Succeeded/Failed stepper, a receipt ID, summary tiles and a results table. Each result says what it describes ("supplied data only, as of its date"). Example runs are labeled.

*Start draft* on a result creates an unsaved draft with the citation attached. Runs are disabled, with a reason, while the service is unreachable.

### Library: drafts, composer, variants
A filterable list (active / state / archived, plus search) with unsaved-change dots. The composer has:
- title and state
- a core message
- channel variant tabs, each with a character count against an *illustrative* limit and checks (length, avoid-list, empty)
- *Check in Channel preview*
- a planned date with the editorial-only note
- sources and citations (run, data as of)
- a Design asset reference whose artwork keeps its own colors in both themes
- a Work planning-card reference
- *Publishing: Not available*

The save bar is sticky. It shows unsaved, saving, saved (version and time), conflict (*Load their version* / *Save mine as a copy*) and not-saved (service unreachable; text kept on device). Ctrl/⌘ S saves.

### Calendar: editorial plan
Month and Agenda views, plus a *No date yet* tray. Drag a draft to a day, or to the tray to clear its date. The keyboard alternative: select a draft to open a dialog with *Move to date*, *Clear date* and *Open draft*. Every move offers Undo.

The banner says: "Planned dates are editorial intent. Nothing on this calendar is scheduled or posted. Work's planning dates stay in Work and aren't copied here."

### Run history
A table of runs plus a receipt panel: input source and as-of date, input digest, "Local Social service · network off", errors, and *Run again with same input* (always explicit). When the service is unreachable, last-seen running or queued runs show **Unknown**, with "Don't start it again until the status is known".

### Channels & accounts (future, honest)
One card per channel. Text checks and analysis show as *Available*. Account connection, collection and publish/schedule show as *Planned*. *Connect account…* is `aria-disabled` and explains that nothing changed.

A "What publishing would need" list covers per-channel approved connection, credentials outside the HQ window, per-post approval of exact content with a receipt, platform readback with unknown shown as unknown, and planned dates staying editorial.

## States

| State | Where shown | Behavior |
| --- | --- | --- |
| Empty | Every page | Explains what goes here and offers one primary action (import data, new draft, open workbenches). |
| Loading | Every page | Skeleton blocks with `aria-busy`. Reduced-motion users see no shimmer. |
| Load error | Every page except Channels | Names the failure, says unsaved text is kept, offers *Try again*. |
| Service unreachable | Global banner and top bar | Shows the last-synced time. Saving, moves and runs pause. In-flight runs show *Unknown*. *Check again* never retries a run. |
| Validation | Workbench form, import, title | Inline per-field errors plus a focused summary. |
| Draft / unsaved | Library list and composer | Dot plus "Unsaved changes". Preserved across page and domain switches. |
| Saved | Composer | Version and time. |
| Conflict | Composer | Never overwrites. The user chooses to load theirs or save mine as a copy. |
| Stale source | Sources, Overview, run toast | "Stale · N days". Results say they reflect the data's date. |
| Example data | Runs, results, imports | Dashed "Example data" tag. Never presented as brand data. |
| Project mismatch | Banner | Explicit *Switch HQ project*. |

## Copy and honesty rules

- Never write *scheduled*, *published*, *posted*, *live* or *connected* for anything that hasn't actually happened. Use *planned date*, *Not available*, *Planned*, *Not connected*.
- Every analysis result states its basis: supplied data, as of a date, or example data.
- A status that can't be confirmed is *Unknown*, not success or failure. Nothing retries automatically.
- Illustrative channel limits are labeled illustrative. Authoritative limits belong to the Channel preview profiles.
- Public fixtures are fictional: *Fernhill Seed Library* and *Lantern Cycle Co-op*, and `example.invalid`-style data only.

## Accessibility and keyboard

- Semantic landmarks, a skip link, `aria-current` on navigation, tabs with `aria-selected`, labeled form controls, `aria-invalid` with described-by errors, a live status toast, and native modal dialogs (Esc closes).
- Status never relies on color alone. Every badge has text or an icon plus screen-reader text.
- `:focus-visible` uses a 2px ring in both themes.
- Shortcuts: Ctrl/⌘ 1–3 switch domain (shell proposal); N creates a new draft; Ctrl/⌘ S saves; ? lists shortcuts.
- Every drag has a keyboard/menu alternative with Undo.
- Measured token contrast is WCAG AA or better for every text/background pair; the lowest is 4.80:1 (light *future* tag). Focus ring against raised surface is 5.07:1 (light) and 8.93:1 (dark).
- `color-scheme` follows the resolved theme so native controls match.
- Artwork and captured content use their own fixed colors and never chrome tokens.

## Cross-domain references

The composer and Overview show Design assets and Work cards as reference envelopes: domain, kind, opaque ID, title snapshot, source revision where content matters, and a return destination such as `social` / `library/<draftId>`. Each owner resolves its own records. Social stores only the envelope plus the last readback (status and checked time). It never stores a copy.

Opening, linking, moving a draft date or switching domains makes **zero execution calls**. Work planning dates and Social planned dates stay separate.

## Implementation slices

Proposed slices for the HQ planner to sequence. Each slice consumes the T0 module mount and `ModulePort` once those are accepted. None of them edits root, shared contracts or Design.

| Slice | Scope | Acceptance |
| --- | --- | --- |
| **SOC-1** Shell integration | Social module mount, secondary navigation, destinations, brand switcher, project-mismatch banner, per-page state restore, empty/loading/error frames, consuming HQ theme roles. | Design → Social → Work → Social restores page, selection and unsaved text. No mode switch causes a network write. Both themes pass AA on Social chrome. |
| **SOC-2** Service adapter | Read and write through the *existing* Social service API: workspace snapshot, versioned content save, run submit/poll/receipt. Add reachability and last-synced state. No data migration and no new store. | A stale version gets a conflict UI with no overwrite. An unreachable service pauses writes and shows Unknown for in-flight runs. No automatic retries (tested). |
| **SOC-3** Library and composer | Draft list and filters, composer, archive/restore, unsaved preservation, Ctrl/⌘ S. Variants and draft states only once SOC-6 lands; until then one body per draft, as today. | Save, conflict, not-saved and archive/undo paths all covered by tests. The planned-date copy is present. |
| **SOC-4** Calendar | Month and Agenda views, tray, drag plus keyboard move dialog, Undo. | Drag and keyboard produce identical date changes. Undo restores. Zero execution calls on move (asserted). |
| **SOC-5** Workbenches and run history | Tool list, JSON mode (parity with today), results renderers per tool, receipts, example labels, explicit re-run. Then guided forms one tool at a time. | Each tool runs its fictional example end to end. Every result shows basis and date. Form validation errors receive focus. |
| **SOC-6** Service extensions (Social service owner) | Draft variants and states, brand profile fields, source registry with provenance. Backward compatible with existing records. | Existing drafts load unchanged. The export/restore round trip keeps IDs and versions. |
| **SOC-7** Sources and overview | Sources page and import validation (needs the SOC-6 registry), Overview aggregation, linked references with freshness. | Invalid files save nothing. Stale and unavailable are shown truthfully. |
| **SOC-8** Channels & accounts page | Static, honest capability page. No account capability. | No control triggers any external effect. All future items are labeled. |

## Open decisions for the coordinator

1. **Service reach from Electron.** The existing Social service is a local HTTP service. The HQ renderer is sandboxed with a strict CSP and no generic IPC. How the Social module reaches it is a shared-contract decision (a narrow preload port or an allowed origin), owned by the HQ coordinator, not this lane.
2. **Where extensions live.** Variants, brand profiles and the source registry (SOC-6) belong to the Social service, and the working tool must keep working.
3. **Brand ↔ project link.** Who stores which HQ project a brand belongs to: proposed Social-owned, keyed by the shell's project ID.

## Verification performed

- Rendered in the T3 headless browser at 1280×800, in light and in dark (OS appearance emulation), with no console errors on any page.
- Exercised flows:
  - page navigation
  - brand switch and project-mismatch banner
  - guided-form run through queued → running → succeeded
  - validation errors
  - result → *Start draft* with citation
  - typing with focus retained
  - Design → Social restores the unsaved draft
  - Ctrl+S save
  - simulated save conflict
  - calendar keyboard move and Undo
  - service-unreachable *Unknown* run
  - import-error dialog
  - empty, loading and load-error states
- Not performed: screen-reader pass, automated axe audit, narrow-width layout, real Electron host. Fonts on the render host fell back to Liberation Sans. This is mockup evidence only; it doesn't prove implementation or integration.
