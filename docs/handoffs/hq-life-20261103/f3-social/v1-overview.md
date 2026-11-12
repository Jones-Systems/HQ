# F3-V1 handoff: Overview, Sources import desk, Channels & accounts

Part of [lane F3](../f3-social.md). The builder finished before the pause, so the lane lead wrote this summary from its report and branch.

| | |
| --- | --- |
| Branch | `work/hq-life-social-20261103-v1-overview` |
| Worktree | `~/.t3/worktrees/HQ/work-hq-life-social-20261103-v1-overview` (clean) |
| Head | `21d196d`, pushed |
| In the lane | yes, merged at `f56e21d` (round 1 `c0863b5` merged at `722ee4a`) |
| PR | none |
| State | **Done.** Accepted after two review rounds. |

## What it built

Findings 3, 11 and 12 of the [flow assessment](../../../design/social/flow-assessment-20261103.md).

- **Overview:**
  - a capability strip;
  - *Next up*, falling back to the nearest past planned drafts, labelled *Past*;
  - *Needs attention*, sorted by consequence;
  - *Recent research*;
  - *Linked across HQ*. *Open* is enabled only for what is known to resolve: a run in this workspace, or a record that resolved as available in this project. Every other state disables *Open* and gives the reason beside it.
- **Sources** becomes an import desk:
  - drop or choose a JSON or JSON Lines file, read on the device only, with line and column errors that take focus;
  - HQ matches the file to the workbenches that accept it, then offers *Open in <workbench>*;
  - *Use fictional example* loads a sample file;
  - saved sources are labelled *Proposed*, because they need the service's source registry (SOC-6).
- **Channels & accounts:** one capability matrix instead of six repeated cards, one explanation of why accounts can't be connected, and the "what publishing would need" checklist.
- **Tests:** a focused test file for the links, `nav/test/linked.test.tsx` (12 cases), and drop-zone and file-input error tests.

## Checks it reported

- `vitest run modules/social`: 738 passed.
- `npm run typecheck`: clean.

Both ran on `21d196d`, with CPU under 85% and one process at a time.

## Decisions

- *Changed* and *archived* links stay openable, because both still resolve to a record. The lead agreed. The owner may want *available* only.
- The broken-file sample button was removed from product code. The error path is shown by an evidence view instead.

## Evidence (not committed; `/tmp` on the build host)

- Round 1: `/tmp/hq-f3-scratch/v1/after/`.
- Round 2: `/tmp/hq-f3-scratch/v1/after2/`, including `r2-sources-*` and `r2-tall-overview-links-*`.
- Scenario files: `/tmp/hq-f3-scratch/v1/*.scenario.mjs`.

## Thread

- **Title:** "F3-V1 Social Overview, Sources import desk, Channels".
