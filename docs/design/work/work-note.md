# Work Note — HQ Work design lane (T4)

Artifact Type: `work-note`

Artifact ID: `note.hq-work-design`

Purpose: Lane continuity for the HQ Work design and mockup task: identity, guidance adoption, bindings, decisions, state and handoff.

Governing artifact: `docs/engineering-specs/hq-bootstrap.md`; the HQ root coordinator's T4 assignment

Decision owner: M Jones

Consumers: the HQ root coordinator, T1, WRK-P, WRK-B

Authority effect: none

## Lane

- **Role.** T4, HQ Work design: recover the Manual Planner's behavior, design
  the Work adaptation, and build rendered, inspected mockups. Propose the
  module boundary and adapter surface to T1.
- **Writer cone.** `docs/design/work/**` only, on branch `work/hq-work-design`
  in this lane's own HQ worktree. The lane is that worktree's sole Git owner.
- **Not owned.** The following are untouched:
  - root manifests, locks and configuration;
  - `apps/desktop`, `packages/contracts` and `modules/**`;
  - the Design domain;
  - the shared plan and foundation documents.
- **Model routing.** `claude-opus-5-5` at high effort, by explicit owner
  override. No descendants.
- **Finish line.** Publish this branch and a scoped PR. **Merge is held** for
  integration-owner agreement.

## Guidance adoption

| Source | Identity |
| --- | --- |
| Codex V3 root guidance | `Jones-Systems/Codex-V3` `AGENTS.md` at `4beb491c44551b6e4207adcc7459c4b11407bcbc`: blob `3402719bc3a09e7e08ed113425d7137818eda25c`, 30,716 bytes, SHA-256 `1238a90adbf10ea8f2359f90ed0c7bf99fc1121589dcde5b99881fd247e87ce6`. Read in full. |
| HQ target rules | `AGENTS.md` at the root of this HQ worktree. It takes precedence over broader Codex V3 defaults. |

These triggered guides were loaded, all at Codex V3 `4beb491`. Blob prefixes
are 12 characters and SHA-256 prefixes are 16.

| Guide | Blob | SHA-256 | Trigger |
| --- | --- | --- | --- |
| `docs/design/orchestration-review-parallelism.md` | `17edc3366776` | `993e3e1d30d964f4` | Lane and review shape |
| `docs/design/model-selection-modes.md` | `daf9dfc15894` | `3511423c9867fa38` | Claude Frontier mode under the owner override |
| `.agents/skills/operate-t3-threads/SKILL.md` | `b3e9e1e10155` | `3637644c5cd14e75` | Parent messaging and PR linking |
| `skills/inspect-linux-system-telemetry/SKILL.md` | `d2322f4ae28b` | `224c6cf4224650be` | Telemetry before checks |
| `docs/projects/frontend-development.md` | `1a2b800991db` | `286ed26adbca8452` | Frontend home pointer |
| `.codex/skills/ui-design-craft/SKILL.md` and `references/rubric.md` | `1b3a7a6fbb20`, `a5d7ef90e2ec` | `923c318f25181893`, `2dfc3bb2f7691a48` | Mockup design and critique |
| `docs/design/delivery-and-merge.md` | `855ef604ce4d` | `f136550cc14e947a` | Publication |
| `docs/design/commit-granularity.md` | `d4212dd68076` | `15b4c6f7c2fb550e` | Commits |

Material conflicts, each resolved toward the narrower rule:

1. **Delegation default and the fallback Luna watcher** versus the
   assignment's "no descendants". No descendants were launched, and no
   fresh-context critic was run (see the mockup evidence).
2. **Default delivery through merge** versus the merge hold. The PR is
   published non-draft and the hold is kept.
3. **Exact local paths in continuity** versus public-repository rules. This
   public note records repository, commit, blob and hash identities only. Local
   paths go only in native handoffs.
4. **Thread registration and other Codex V3 continuity mechanics** do not apply
   inside this HQ lane, beyond PR linking.

Future HQ handoffs and any authorized descendants of this lane must carry the
same Codex V3 root-guidance bootstrap, in addition to HQ target rules.

**Shared enrollment: unavailable.** After this branch was cut, PR #5 merged
into `work/hq-foundation` at `35f9a3e1fd0561335737ea47f6a680e74a5ad0e7`. It
adds an HQ `AGENTS.md` rule to read the locally delivered
`.agents/shared-guidance.md` bridge, and adds `docs/shared-agent-guidance.md`.
Both were read. The bridge file is absent in this worktree, so shared
enrollment is reported as unavailable, as the rule requires. Nothing was
installed or registered. The Codex V3 root guidance above was read directly
from its exact revision. The change does not affect `packages/contracts`, whose
SHA-256 is unchanged at `35f9a3e`.

## Bindings

| Item | Identity |
| --- | --- |
| Branch base | `aab225bcbb49968fec97dc71bbc20caf21fe8d1d` (HQ bootstrap assignment). It is an ancestor of the T0 candidate and not on `main`. |
| T0 candidate | `work/hq-foundation` `33dfe44d6786b40ac8a5dcb5442d85c20da38c67` (draft PR #2, not accepted). Contracts SHA-256 `41b966869d8af365a5db07afb632b7f4f8f08e9e000052c015c1e54fb00923c4`. |
| T1 plan | `work/hq-social-work-plan` `78c3cf370b26babd09eb31140cd99e6303e3c2b9` (PR #3) |
| Manual Planner source | Private Codex V3 `4beb491`, `apps/manual-planner/`. Source only; no store, backup, draft or live service was read. |

## Decisions in this lane

- **Horizon is never relabelled.** Today / This week / Later is offered two
  ways: a read-only **By date** board derived from real dates (phase 1, matches
  T1's RV-5), and a **Weekly plan** board with placement separate from status
  (Proposed, D-3).
- **Status changes route through `move`,** and field undo is compare-and-swap
  (proposals P-1 and P-2).
- **Import and restore stay in the Planner's own tools** in phase 1.
- **Design annotations and Jones requests are distinct link kinds.** Neither
  ever changes card status.
- **The PR targets `work/hq-foundation`.** The branch carries `aab225b`, which
  exists only on that unmerged line. This matches the sibling Social design PR
  (#9).

## Current state and evidence

- **Source complete:**
  - [design spec](hq-work-design.md);
  - [Planner behavior inventory](planner-behavior-inventory.md);
  - [adapter boundary](adapter-boundary.md);
  - [mockup](mockups/work-hq.html) and its [evidence](mockup-evidence.md),
    with 13 screenshots.
- **Checked behavior:** fixture-only interaction checks, `node --check` on the
  mockup script, and the private-data scan. All are listed in the evidence.
- **Not done:** integration with HQ, a real Planner service, installed-app
  checks and implementation. None was in scope.
- **Exact commits and the PR** are reported in the PR body and the completion
  message to the root.

## Contributing T3 threads

| Thread | Native ID | Role |
| --- | --- | --- |
| HQ root coordinator | `ceff6379-4f5b-4a50-9b69-80f975951c3e` | Assignment, coordination and merge custody |
| HQ Work design (T4, this lane) | `mcp:658d675a-4e0e-42e2-acb2-0c908c66d43e` | Planner recovery, Work design, mockup, evidence and adapter proposals |
| HQ Social/Work planner (T1) | `mcp:5b942785-2b41-43dd-bcd9-413b791e7d5d` | Consumer of the adapter proposals. No direct contribution here. |

## Handoff

- **T1 and WRK-P/WRK-B:** see [Recommendations for T1](adapter-boundary.md#recommendations-for-t1)
  and gaps GW-1 to GW-7.
- **Owner questions:** Q-1 to Q-5 in the [design spec](hq-work-design.md#open-questions-for-the-owner).
