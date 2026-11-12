# VAL-S selected P1 repair source receipt

Authority effect: none.

Repository: `Jones-Systems/HQ`. Task branch:
`work/hq-recovery-native-p1-fixes-20261112`. Sole Git owner: Codex.
Base: `3bb13af3b3872bf52ad04606be9d0540d84810b3` (retained INT and final SHL ancestry).
Implementation checkpoint: `f879f0fc2faeca450230160dfa2da23711137dc2`.
Commit author and committer explicitly set per command to
`Codex <codex@users.noreply.github.com>`; no history rewrite or merge.
Accepted amendment and continuity note read at
`e9db4f61b0688f3727e4be4e37d00521131fc6f3`; fetched coordination ref
resolved to `89669e3204f2e94e33230af260a4a65901fe5d10`.
The amendment was read by exact object rather than assuming branch-tip equality.
The old VAL-S source handoff and current product controls/driver were inspected.
Local shared-guidance bridge remains absent; no enrollment was installed.

The assigned implementation-role fallback retains codex-v3-builder scope,
explicit Blended Frontier Max, captured preference revision 11, Sol/high,
default service tier and no Fast. No child agents were launched.

## Selected repairs

- VALS-R01: Library readiness covers `.soc-lib-empty` and `.soc-lib-list`.
  Empty-state New draft is scoped to its invitation; populated Library uses
  the frame header, avoiding duplicate controls. Composer waits use `.soc-cmp`.
  Save targets the unique savebar control by its declared keyboard shortcuts,
  including its disabled unknown state, without exact whole-button text.
  Three attempts, two applied saves, one rejection, response loss, explicit
  read-only Check and no navigation/read resubmission assertions remain.
- VALS-R02: both Work detail waits target `textarea.work-detail-title`;
  return additionally requires the originating title value.
- VALS-R03: exact `.hq-return-label` text selects the owning enabled button,
  independent of appended keyboard hints. Missing, ambiguous, disabled or
  exiting controls cannot dispatch. Existing one-reference-save and zero
  navigation mutations assertions remain.
- VALS-R04: offline Quick capture stays editable. One explicit Capture must
  retain local text, show Planner unreachable / nothing was saved and offer
  Keep as HQ draft. Domain navigation must preserve unsent text. Actual Work
  and Social unavailable reads, zero mutation ledgers and no automatic
  execution remain required. No local-draft persistence is claimed: this
  journey does not choose Keep as HQ draft or Send drafts.

Only the three assigned scenarios, `fixtures/recovery-ui.mjs`, its matching
regression source and this lane receipt changed. Runner, Planner fixture,
README, root configuration and product modules are untouched. Original
first-failure capture/cleanup and held/gap result rows remain unchanged.

## Static evidence and pending qualification

Five affected JavaScript files pass `node --check`; `git diff --check` passes.
These commands parse source only. No application/test code, build, dependency
install, service, native application, browser, PR or merge was executed.
No failing-before or passing-after behavior execution is claimed.

`fixtures/recovery-ui.test.mjs` authors four regression cases: empty/populated
Library and New draft scope; shortcut-decorated save with disabled/ambiguous
refusal; textarea and exact return-label selection with hints and quoted titles;
and positive/negative unavailable-service scenario probes. The last two cases
exercise the scenario against a synthetic DOM, including rejecting a send
without the offline guard. These are SOURCE, UNRUN, not product behavior proof.
They use the existing locked root `happy-dom` development dependency; no new
package was added. Foundation's existing acceptance Node glob discovers them
following the existing root install. Standalone execution also needs those
root dependencies; the service-only fixture command is insufficient.

Independent fix review is still needed on this exact successor checkpoint:
verify all four selected P1 dispositions against current assembled UI and
confirm none of the original mutation/unknown/availability assertions weakened.
The serial Mini verifier owns later regression execution and native Social,
reference round-trip and unavailable-service journeys at one fresh assembled
head, under baseline reconciliation, capacity and heavy-slot holds.

VALS-R05 remains P2, RECORDED / UNSELECTED: Planner PATCH can escape the final
guard on late invocation. No runner/proxy repair was made. That limits global
no-unexpected-write qualification even though reference navigation retains its
local ledger assertion. Remaining recorded P2 cleanup/qualification limits
also remain unresolved; unchanged cleanup source is not a new proof of process,
socket, EOF or scratch closure. No other P2-P4 was repaired automatically.

## Exact shared hunk requested from INT

After consuming this checkpoint, include the new executable helper in the
runner's retained harness hash inventory. This is an additive provenance hunk,
not a runner behavior or Planner guard repair. INT owns the runner; the lane
has not applied it. All prior registration and held/gap obligations remain.

```diff
--- a/tests/acceptance/run.mjs
+++ b/tests/acceptance/run.mjs
@@ -82,1 +82,1 @@
-  for (const path of ['run.mjs', 'runtime.mjs', 'build-inventory.mjs', 'fixtures/setup.mjs', 'fixtures/http.mjs', 'fixtures/remote-gallery.mjs', 'fixtures/host-gallery.mjs', 'scenarios/sources.mjs', 'scenarios/ui.mjs', 'scenarios/work.mjs', 'fixtures/results.mjs', 'fixtures/wiki.mjs', 'fixtures/social.mjs', 'scenarios/social.mjs', 'scenarios/references.mjs', 'scenarios/wiki.mjs', 'scenarios/services.mjs']) report.harness[path] = createHash('sha256').update(await readFile(join(repo, 'tests/acceptance', path))).digest('hex');
+  for (const path of ['run.mjs', 'runtime.mjs', 'build-inventory.mjs', 'fixtures/setup.mjs', 'fixtures/http.mjs', 'fixtures/remote-gallery.mjs', 'fixtures/host-gallery.mjs', 'scenarios/sources.mjs', 'scenarios/ui.mjs', 'scenarios/work.mjs', 'fixtures/results.mjs', 'fixtures/wiki.mjs', 'fixtures/social.mjs', 'fixtures/recovery-ui.mjs', 'scenarios/social.mjs', 'scenarios/references.mjs', 'scenarios/wiki.mjs', 'scenarios/services.mjs']) report.harness[path] = createHash('sha256').update(await readFile(join(repo, 'tests/acceptance', path))).digest('hex');
```

No other shared hunk is requested. Existing Foundation discovery already
includes the new regression file; no workflow or README change is necessary
for that discovery. Broader acceptance, private/live providers, native release,
signing, installation, activation and deployment remain unqualified/held.
