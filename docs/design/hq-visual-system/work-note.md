# HQ visual system — work note

<!-- codex-section:begin id="worknote.hq-visual-system#ctx.artifact-header.001" -->
Artifact Type: `work-note`

Artifact ID: `worknote.hq-visual-system`

Purpose: Continuity and decision record for the preliminary HQ desktop visual system (T2).

Governing artifact: `brief.hq-shared-foundation` v0.3 (see sources below)

Continuity owner: T2 visual-system lane

Consumers: HQ continuity owner, T1 planner, foundation (T0) owner, Design coordinator, Social/Work implementers

Authority effect: none
<!-- codex-section:end id="worknote.hq-visual-system#ctx.artifact-header.001" -->

## Outcome

<!-- codex-section:begin id="worknote.hq-visual-system#ctx.outcome.001" -->
Delivered a preliminary visual system for HQ's shared chrome in this directory only. It includes light and dark tokens (JSON source plus generated CSS), reference component CSS covering every requested state, illustrative Design/Social/Work chrome mockups, a states sheet, an artwork-invariance page, rendered evidence with automated pixel and contrast checks, and an integration note in [README.md](README.md). This is not runnable application code. No root, `apps/desktop`, `packages/contracts`, Design module, plan or spec file was touched.
<!-- codex-section:end id="worknote.hq-visual-system#ctx.outcome.001" -->

## Current State And Evidence

<!-- codex-section:begin id="worknote.hq-visual-system#ctx.evidence.001" -->
Sources read (read-only):

- HQ target: `Jones-Systems/HQ`, branch `work/hq-visual-system`, intake HEAD `aab225bcbb49968fec97dc71bbc20caf21fe8d1d`, clean. Target `AGENTS.md` and `docs/engineering-specs/hq-bootstrap.md` read in full.
- HQ shared foundation v0.3: an uncommitted file in the HQ continuity owner's Codex V3 worktree, SHA-256 `a0d4e6789b2549ce9cb828f02babfca5c3a11238d9f832c7c9040c89e8e33271` (matched before use). Read in full as evidence, not as a published plan.
- Codex V3 root guidance, adopted on owner direction mid-task: `AGENTS.md` at HEAD `4beb491c44551b6e4207adcc7459c4b11407bcbc`, 30,716 bytes, SHA-256 `1238a90adbf10ea8f2359f90ed0c7bf99fc1121589dcde5b99881fd247e87ce6`, blob `3402719bc3a09e7e08ed113425d7137818eda25c`, read in full. Triggered guides loaded: README practice, Linux telemetry admission, temporary scratch, commit granularity, context/tool efficiency, comment practice, GitHub issue tracking, delivery and merge (default delivery, T3 PR association, PR description), interaction (unattended open-question protocol, thread references), cross-repository loading, research-first operating contract and depth, model selection (Claude Frontier and planning), frontend-development pointer.
- T0 foundation candidate (read back, not accepted or frozen): PR #2, `origin/work/hq-foundation` at `33dfe44d6786b40ac8a5dcb5442d85c20da38c67`. Facts used: `<html data-theme>` receives the *resolved* theme; `ModulePort.appearance` is resolved; window minimum 760×560 with a fixed `backgroundColor` of `#17191d`; CSP `style-src 'self'`, `font-src 'self'`, `img-src 'self' data:`, `frame-src 'none'`; current palette variable names.
- T1 plan candidate: PR #3, `origin/work/hq-social-work-plan` at `118d3c6`, unmerged, not edited. No path overlap with this lane. RS-1 takes its final role values from this artifact; to match, this lane adopted RS-2's `data-hq-content` marker and drew RS-3's SaveIndicator and StateView state sets.
- Sibling Social mockup lane: PR #9 (`docs/design/social/**`) owns Social page design. This lane's `social.html` illustrates chrome only.
- Design shell boundary `spec.design-studio#iface.hq-shell.001` (Design lane worktree, uncommitted) and the published Design PRD on `work/hq-design-plan` (`149d843`). Used only to name illustrative Design sections; no Design feature or canvas design is proposed.
- Manual Planner public CSS at Codex V3 HEAD `4beb491c`. Its status, horizon and date-kind axes informed the Work mockup; no files or values were copied.

Probe evidence (local headless Chromium 155, scratch outside the repository):

- An iframe's `prefers-color-scheme` follows its owner element's used `color-scheme` (dark owner → dark, light owner → light), whatever the OS preference. With `color-scheme: normal` it follows the OS.
- An SVG with a `prefers-color-scheme` rule, used as an `<img>`, rendered its dark fill under a dark-scheme owner and its light fill under a light or `normal` owner (OS light). So chrome theme can re-theme SVG artwork unless the well pins its scheme.
- `light-dark()` resolves per element `color-scheme`; `--blink-settings=preferredColorScheme` emulates the OS preference for System checks.

Checks run on the final candidate (results in [README.md](README.md#evidence) and [evidence/manifest.json](evidence/manifest.json)): token build/check (104/104 contrast pairs), 13/13 pixel-invariance checks, and a live T3 preview interaction at 1280 and 760px. Telemetry before each batch: CPU 12–28%, one core is 6.25% of capacity, ≥41 GiB RAM available, one serial process allowed.

Contributing T3 threads:

- HQ T2 — Visual system and shared shell mockups (`mcp:eb7e2ad0-e54a-425d-9351-8009962c29a3`), Claude Opus 5.5/high: research, visual direction, tokens, mockups, evidence, delivery for this lane.

Referenced T3 threads:

- Unifying Social and Design Hub (`ceff6379-4f5b-4a50-9b69-80f975951c3e`): HQ continuity owner. Its foundation and work note were read as evidence; it received one guidance-adoption confirmation.
<!-- codex-section:end id="worknote.hq-visual-system#ctx.evidence.001" -->

## [Q-001] Visual direction

<!-- codex-section:begin id="worknote.hq-visual-system#dec.direction.001" -->
Question: which chrome direction best meets the owner's requirements? Those are: distinctive, coherent, no generic AI gradients or cards, light and dark required, artwork never recoloured, Design first in a slim rail, and planning cards, artifacts and runs kept visibly distinct.

Coordinator ranking, recorded before any rendering:

1. **Primary (strength 4): bezel and sheet, warm graphite/paper neutrals, one lime signal, mono provenance.** The chrome recedes so artwork carries the colour. A single signal colour that is never used for status keeps status shapes and words unambiguous. Mono metadata separates record facts from interface text. Tradeoff: lime is assertive and needs an edge on paper for the light-mode primary button.
2. **Runner-up (3): continue Manual Planner's ink-blue accent across HQ.** It gives continuity for Work, but reads like a stock app palette and collides with the informational blue.
3. **Third (2): per-domain chrome hues.** It aids wayfinding, but makes a rainbow that competes with artwork and multiplies contrast pairs.

The unattended two-reviewer recommendation protocol in the Codex V3 guidance was **not run**: this assignment forbids descendants, and the explicit task restriction takes precedence. The primary was selected on the coordinator's ranking. Reversibility: the accent is one role family in `hq-tokens.json` (`accent*`, `focus`, `selection`), so the owner can swap it without structural change.
<!-- codex-section:end id="worknote.hq-visual-system#dec.direction.001" -->

## Conflicts And Proposals

<!-- codex-section:begin id="worknote.hq-visual-system#ctx.conflicts.001" -->
Guidance conflicts, each resolved by the narrower task bound and reported to the HQ continuity owner:

- The Codex V3 delegation and research-delegation defaults, and the recommendation panel, conflict with "no descendants". Resolution: work solo and record the reason.
- The default delivery merge conflicts with the explicit merge hold. Resolution: non-draft PR, no merge.
- Codex V3 assigns issue writes to the continuity owner, and HQ's `AGENTS.md` routes shared changes through the coordination issue. Resolution: the proposals below go to the continuity owner; this lane files no issues.

The command guard blocks `rm -rf`, even for a task-owned temporary profile. `tools/render.sh` therefore passes no `--user-data-dir`, so Chromium owns and removes its own temporary profile, and the script owns no scratch.

Proposed shared changes (owner: foundation/HQ shell; not made here): adopt `hq-tokens.css` plus `t0-bridge.css`; bundle IBM Plex Sans/Mono woff2 (OFL 1.1); use the theme-matched window `backgroundColor`; `hiddenInset` titlebar with drag regions; move the appearance control to the titlebar; pin `color-scheme` on preserved-content wells (set through CSSOM under the CSP).
<!-- codex-section:end id="worknote.hq-visual-system#ctx.conflicts.001" -->

## Next Action

<!-- codex-section:begin id="worknote.hq-visual-system#ctx.next-action.001" -->
Integration owner: review the PR and decide adoption of the tokens and the proposals above. The T1 planner may reference the artifact paths and token names. If the owner swaps the accent, edit the JSON, run `tools/hq_tokens.py build`, re-render the evidence and re-run the checks.
<!-- codex-section:end id="worknote.hq-visual-system#ctx.next-action.001" -->
