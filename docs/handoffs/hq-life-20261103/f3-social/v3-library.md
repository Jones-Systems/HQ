# F3-V3 handoff: Library composer, channel preview, save bar

Part of [lane F3](../f3-social.md). The builder finished before the pause, so the lane lead wrote this summary from its report and branch.

| | |
| --- | --- |
| Branch | `work/hq-life-social-20261103-v3-library` |
| Worktree | `~/.t3/worktrees/HQ/work-hq-life-social-20261103-v3-library` (clean) |
| Head | `fb4c2de`, pushed |
| In the lane | yes, merged at `a836337` |
| PR | none |
| State | **Done.** Accepted. The lead changed the save toast afterwards, in `2ea095f`. |

## What it built

Finding 8 of the [flow assessment](../../../design/social/flow-assessment-20261103.md), plus F7's X6 and X13.

- **List:**
  - search;
  - an *Active / Archived / All* control;
  - brand, channel and planned-date filter chips, and *Clear*;
  - rows with channel badge, planned-date chip or "No date yet", and an unsaved dot;
  - a staggered entrance;
  - a quiet icon button to hide or show the list.
- **Composer:**
  - a live channel preview;
  - a length ring labelled *illustrative, not a platform rule*;
  - the checks list, planned date, citations and links.
- **Save bar:** it stays at the bottom of the scroll area and reads *Unsaved → Saving… → Saved v2 · 2:00 PM*. *Archive* and *Save draft* (Ctrl/⌘+S) sit on the right.
- **Conflict and validation:**
  - a save conflict keeps the user's text and offers *Load their version*, *Save mine as a copy* or *Copy my text*;
  - field errors take focus and keep the text.
- **X6:** below 780 px the list and composer take turns, with an *All drafts* back button. There is no horizontal scroll at 760 × 560.
- **X13:** the serialized reference, the paste field and raw records sit behind a closed *Advanced* disclosure.
- **Start draft:** a run hand-off shows "From run · <tool> · <date>" with the example tag. It never replaces an existing new-draft editor.
- **Renamed:** *Save* is now **Save draft**, and the editor's close control is an icon button named "Close".

## Checks it reported (on `fb4c2de`)

- `vitest run modules/social` plus `apps/desktop/src/social-work.integration.test.tsx`: 839 passed.
- `npm run typecheck`: clean.

## Lead changes after the merge

- **`2ea095f`:** the save toast covered the save bar's buttons for 8 s while the bar already said *Saved*. It now appears only when the editor closed before its save finished. Tested: content tests, 135 passed.
- **`9f069ca`:** removed the dead `.soc-*` rules from `content.css`. No element uses them.

## Open points

- The `@hq/ui` toast viewport sits bottom right, over any bottom action bar. That position is F1's to decide.
- `field-sizing: content` is Chromium-only. Electron is fine.
- The conflict notice uses the *danger* tone. *Warning* may suit it better, because nothing was lost. Minor.

## Evidence (not committed; `/tmp` on the build host)

`/tmp/hq-f3-scratch/v3/after/`:

- `desk-1280-composer-*` and `desk-760-*` (real shell);
- `library-*-{light,dark}` (states);
- `ev-760-*`;
- `motion-*`.

## Thread

- **Title:** "F3-V3 Social Library composer and channel preview".
- **T3 thread:** `thread:delegated-task:command%3Amcp%3Ac58a3144-7142-4df6-ad88-2b85a5f583cd%3Adelegate-task%3Af3-v3-library-r1`.
