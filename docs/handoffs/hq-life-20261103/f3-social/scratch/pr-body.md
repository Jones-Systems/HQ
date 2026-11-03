## HQ Social: views rebuilt for the flow (lane F3)

Lane F3 rebuilds the HQ Social views up to and beyond their mockups (`docs/design/social/screenshots`) so the core flow runs without dead ends:

**add sources → run a workbench → review results → compose in the Library → plan on the Calendar → check Run history**

The flow assessment comes first: `docs/design/social/flow-assessment-20261103.md`. It ranks the findings, sets the design direction and records what is routed to other lanes.

### Top flow findings
<!-- fill from the assessment -->

### What changed
<!-- frame + V1..V4 summaries -->

### Honesty and safety
- Nothing says scheduled, posted, published, live or connected unless it happened.
- Planned dates are editorial. Example data is labelled, and Unknown stays *Unknown*.
- Nothing retries on its own. A run is always an explicit click.
- No real accounts, credentials or private data. Every capture uses the fictional example workspace.

### Evidence
Before and after captures are in `docs/design/social/flow-assessment-20261103/`. They cover light and dark at 1280 × 800, the 760 × 560 desktop shell, reduced motion, offline and first-load failure.
<!-- table of pairs -->

### Checks
<!-- counts -->

### Not in this PR / follow-ups
<!-- B1 Work item, F7 example providers, F1 TimeGrid render prop + InlineNotice label, B2 portErrorNotice, run input provenance, quiet focus check -->

Merge is held for the integration owner. Do not merge into `work/hq-foundation` or `main` from this lane.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
