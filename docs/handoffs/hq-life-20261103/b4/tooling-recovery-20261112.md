# B4-T tooling recovery source receipt

Source-only successor: `work/hq-recovery-tooling-20261112`, exact foundation base
`8945d156585510fbdf1515fad01798f416146b4e`. Authority effect: none.

Retained ancestry is preserved by ordinary merges of local-checks
`9962b740369391a78b4aaff9fa874367df6fa374` and dev-preview
`64b9407d49c1049971ff710f004460c68cba2cca`. Both merge-tree preflights reported
no conflicts. The approved scoped dev-preview merge excludes its incoming
Foundation workflow and visual-system README changes; those files remain
byte-identical to foundation. Original PR refs were not updated.

## Source changes

- Local mirror retains Foundation/CLI/Planner discovery and the shared Design
  runner, adds the workflow's complete Design inventory validation before section
  checks, rejects empty selections, and reports selected-command success separately
  from hosted qualification. Documentation names the narrow parser, Bash 4+
  prerequisite, setup exclusions, timeout limits and host admission requirement.
- Darwin prerequisite resolution selects the Electron app-bundle executable;
  Linux-only tools are not required on Darwin. Live mode still requires Python.
- The lane-local launcher uses the existing acceptance runtime's owned spawn
  and cleanup behavior. Darwin sets scratch TMPDIR and removes DISPLAY; Linux
  keeps bubblewrap and Xvfb. The acceptance runner and runtime are unchanged.
  No INT helper extraction is necessary. Electron sandboxing is preserved.
- Added unexecuted tests cover Darwin binary admission, native wrapper behavior,
  Linux isolation/display behavior, failure paths, inventory planning and empty
  selection refusal. Historical Linux results belong to the retained handoff.

## Read-only overlap survey

The following open PR heads were read before edits:

- #191: `64b9407d49c1049971ff710f004460c68cba2cca`; tooling overlaps intentionally
  reused here; workflow hunk remains INT-owned.
- #177: `51b2bdb0687485c36f77935d459e16d3147650c1`.
- #180: `85a49ae9a19bf17d4f05f808296bcb243eda1a5b`.
- #182: `01b0aadf68b75f184eaaa51464aece65943f7e5f`.
- #184: `3bf99baaa3bf94b0dab8ce36e1dcc3e815b87194`.
- #193: `b3f8c2282ecec1e5e1a60092effaa97b163b1780`.
- #194: `46cbad0a3ccc6935dba73563a22ceb47720308bd`.

The storage/evidence stack has no direct tooling-file overlap. It owns storage
policy, root command envelopes, acceptance evidence/README and preview fixtures;
none are edited here. Acceptance exports remain a shared dependency guarded by
the retained acceptance-api test source. No recorded P2-P4 repair is claimed.

## Exact workflow hunks requested from INT

Apply to the assembled head, reconciling other workflow owners. These hooks
are proposed only and are not applied in this source branch.

```diff
--- a/.github/workflows/foundation.yml
+++ b/.github/workflows/foundation.yml
@@
       - name: Test portable acceptance fixtures and storage lifecycle
-        run: node --test --test-concurrency=1 'tests/acceptance/**/*.test.mjs' 'tools/storage/test/**/*.test.mjs'
+        run: node --test --test-concurrency=1 'tests/acceptance/**/*.test.mjs' 'tools/storage/test/**/*.test.mjs' 'tools/dev-preview/test/**/*.test.mjs'
--- a/.github/workflows/design-sections.yml
+++ b/.github/workflows/design-sections.yml
@@
       - name: Check Design batch runner
-        run: node --test tools/ci/design-sections.test.mjs
+        run: node --test tools/ci/design-sections.test.mjs tools/ci/local-checks.test.mjs
```

No Design inventory row is added: these are tooling suites. The existing complete
Design inventory and fan-in remain intact. Keep event coverage, pinned Node/Python,
full discovery and storage/acceptance globs. No native preview launch in fast CI.

## Verification and remaining work

Static only: Node syntax checks on tooling modules and tests, `git diff --check`,
scoped final-diff review, retained-ancestry checks and unchanged shared-path checks.
No application or test module was executed. No dependency installation, build,
server, browser, native launch, PR or integration merge was performed.

The serial Mini verifier must run the two tooling suites, required fast checks,
full local mirror with Bash 4+, and admitted Darwin synthetic preview/lifecycle
qualification. Signals, idle timeout, cold installer and concurrency remain
unqualified as in the retained handoff. Current-head behavior, timing, native
appearance and accepted delivery are unproved. Source completion is separate.
