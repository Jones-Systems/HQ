# B4 builder A handoff: storage admission on umask-0002 hosts (finished)

Builder A finished before the pause, so the B4 lead wrote this summary.

## Where it stands

**Done.** CI is green and the merge is held for the integration owner.

- Branch: `work/hq-backend-infra-storage-umask-20261103`
- PR: #190 against `work/hq-foundation`
- Head: `f1e9557b7c149ce41460822adcb2c077df759a98`
- Worktree: `~/.t3/worktrees/HQ/work-hq-backend-infra-storage-umask-20261103`. It is clean, with `node_modules` installed.
- Hosted CI: all six checks pass (Foundation, CLI/Planner, Planner, Design inventory, Design sections and Design batch).
- Lead review: the full diff reads correct.
- Independent Sonnet review: started, then stopped by the pause. See [review-pr190.md](review-pr190.md).

## What changed and why

The problem: this host runs `umask 0002`, and `tools/storage/admission.mjs` refused every group-writable ancestor and entry. As a result:

- The storage tests failed, then hung.
- Once #182 lands, every root build and test would refuse in every T3 worktree.

Design, decided by the lead:

- **Linux private boundary.** A real directory owned by the current uid, with no group or other permission bits (`mode & 0o077 === 0`), counts as a private boundary. No other unprivileged principal can traverse such a directory. On Linux, POSIX ACLs fold into the group-class bits.
- **What is tolerated below it.** Only group-write (0o020) is tolerated below the boundary. Other-write (0o002) still refuses everywhere.
- **What did not change.** Uid, symlink, special-file, identity and mount checks are unchanged. Policy numbers, locks and the CLI are unchanged. There is no environment or flag bypass, and non-Linux platforms keep the strict rule.
- **Code.** `resolveDestination()` tracks `shielded` along its canonical walk and returns it. `owned()` receives it for the nearest existing ancestor and for every entry `measureTrees()` visits.

Files changed:

- `tools/storage/admission.mjs`.
- `tools/storage/test/storage.test.mjs`: explicit modes, three new cases (admitted under 0700; refused under 0755, 0750, 0710, 0705 and 0701 parents; other-write refused under 0700, including a sticky 1777 worktree). The SIGINT test now rejects on early `close` with the code, signal and stderr tail. Spawning tests get a 20 s timeout and kill leftover children.
- `tools/storage/README.md`: one paragraph only, so the open stack still merges cleanly.

## Verification (run on this host)

- **Storage suite:** 28/28 under `umask 002` (5.3 s) and 28/28 under `umask 022` (13.5 s).
- **CI portable step:** 50/50 under both umasks. Each umask had one first-attempt failure under heavy load that passed on rerun; see the lane handoff.
- **Before the fix:** the unmodified suite under `umask 002` hangs; an external 40 s timeout ended it with exit 124. Against the old admission code, 25 of the 28 new-suite tests fail fast.
- **End to end on the #184 tip (`3bf99ba`, includes #182)**, on a throwaway local branch:
  - Without the fix, `npm run build` exits 1 in 0.2 s with `{"storageError":"Writable ancestor: ~/.t3/worktrees"}`.
  - With `f1e9557` merged, `npm run build` exits 0 in 10.0 s, and exits 0 again over existing 775/664 output.
  - `npm test` exits 0: 117 files and 1,873 tests in 23.3 s.
  - The merged stack's storage suite passes 51/51 under both umasks.
- **Merge check:** `git merge-tree` reports no conflicts against the #184 tip (`3bf99ba`) or the #180 tip (`85a49ae`).

## Left

1. Finish an independent review of #190, then fix anything material with normal commits on the PR branch.
2. Land #190 before #182 (see the merge order in [../b4.md](../b4.md)).
3. A local-only throwaway branch, `tmp/b4a-e2e-probe-20261103`, remains in the shared repository. The `dcg` hook blocks `git branch -D` without owner approval. Delete it once approved; it was never pushed.
