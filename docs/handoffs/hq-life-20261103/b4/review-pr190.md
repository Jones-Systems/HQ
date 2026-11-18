# B4 PR #190 independent review handoff (paused)

This is the independent reviewer's final reply, recorded verbatim by the B4 lead.

- Reviewer: Claude Sonnet 5.5 at xhigh effort, running as a T3 delegated task.
- Target: PR #190 at head `f1e9557`, base `work/hq-foundation`.
- Mode: read-only in the builder A worktree. It has no branch of its own.
- Status: stopped by the 2026-11-03 pause request before it finished.

**Verdict: unfinished. I have no P0–P2 findings, but I'd hold approval until the P3 items below are addressed or accepted.**

The pgrep line above only matched the cleanup command itself, so no review process is running. I made no commits, pushes or edits, and the checkout is clean (`git status` is empty). All `/tmp/hq-b4r-*` scratch is removed.

## Checked
- I read `AGENTS.md`, the PR #190 description, and the full diff of `tools/storage/admission.mjs`, `tools/storage/README.md` and `tools/storage/test/storage.test.mjs`.
- I read `tools/storage/launcher.mjs` end to end.
- I traced `shielded` from `resolveDestination()` through `inspectStorage` roots into `measureTrees` and `owned()`.
  - Each root's flag comes from that root's own canonical walk.
  - A missing flag means strict, so it fails closed.
  - The launcher only consumes `.path`, `.dev` and `.anchors`.
  - `commands.mjs` on the `harness-cache-placement` and `package-admission` branches, and `tests/acceptance/evidence*.mjs` on the evidence-wiring branches, only call `resolveDestination` and `inspectStorage`. I found no cross-root or unshielded bypass.
- Strictness is unchanged for other-write, sticky handling, uid checks, symlink and special-file refusals, mount-variance checks, policy numbers and lock behaviour.
- The boundary check is sound on the canonical walk. Symlinks are refused at `lstat`, shielding starts strictly below the boundary, and a boundary replaced by an attacker fails the uid check.
- POSIX ACLs fold into the group-class bits on Linux, so `0o077 == 0` also excludes named ACL entries.
- The SIGINT hang fix is correct. It rejects on `close` with exit code and stderr, and kills the child in `t.after`.
- The README paragraph is accurate.

## Findings
- **P3, `tools/storage/test/storage.test.mjs:144-156`:** the test "a group-writable worktree below a non-private parent refuses" depends on the ambient `TMPDIR`.
  - **Scenario:** if `os.tmpdir()` is under a 0700 directory you own (`/run/user/UID`, `$HOME/tmp`), that directory is itself a boundary. Everything below is shielded even with the fixture root at 755, so the expected `Writable ancestor` rejection never happens.
  - **Reproduced:** with `TMPDIR` pointing at a 0700 `mktemp` directory under umask 022, that test failed ("Missing expected rejection") and 27 of 28 passed.
  - **Fix:** skip the test, or fail with a clear message, when any existing ancestor of the fixture parent is a private boundary. The check could live in the fixture, and the lack of a private ancestor should be asserted.
- **P3, `tools/storage/admission.mjs:42-45` (hardening, not reproduced):** a shielded 664 regular file with `nlink > 1` can be hard-linked to a path outside the boundary.
  - **Scenario:** a group member who can reach that outside path (for example a shared cache the owner's tooling hard-links from) could then modify the file's content. The strict rule used to refuse it.
  - **Fix:** document it as an accepted residual, or refuse a group-writable file with `nlink > 1` and chmod the existing hardlink test's fixture.
- **P4, `admission.mjs:30-37`:** the boundary assumes the subtree is reachable only through the 0700 directory.
  - Same-device bind mounts, open file descriptors or working directories held before the chmod, and NFSv4 ACLs or synthetic-mode filesystems break that assumption. Exploiting them needs root or a pre-existing handle, so this is probably a README note.
- **P4, `storage.test.mjs:101`:** `chmod(root, 0o755)` in the original test isn't needed, because 0o777 refuses even when shielded. It is harmless.
- **Not a defect:** foreign-owned intermediate ancestors were already admitted before this PR.

## Commands run
- `(umask 002; timeout 300 node --test --test-concurrency=1 'tools/storage/test/**/*.test.mjs')`: 28 of 28 passed, 2.97 s. CPU was 24% at the first check. My first attempt at this command printed nothing because my grep missed the `ℹ` summary lines. I reran it and report that run.
- Same command under `umask 022`: 28 of 28 passed, 2.61 s, CPU 34%.
- Same command with `TMPDIR` under a 0700 scratch directory, `umask 022`: 27 of 28 passed and 1 failed (the P3 above), 3.0 s, CPU 29%.
- Base (`origin/work/hq-foundation`) extracted to scratch, `umask 022`: 25 of 25 passed, 5.48 s.
  - **Load exception:** I started this run when the telemetry script reported CPU at 89.9% and `broad_test_allowed` false. My command chain didn't gate on that output, so I breached the CPU limit, though only for this one run.

## Not reviewed
- The base suite under `umask 002` (to confirm the hang).
- Whether 20 s is a sensible per-test timeout under heavy load. The PR itself reports a load average of 68 or more.
- The acceptance tests and the `npm test` and `npm run build` end-to-end claims in the PR.
- The PR's stack merge claims against the other open PR branches.
- The wall-clock `<155 ms` assertion flake, which predates this PR.
