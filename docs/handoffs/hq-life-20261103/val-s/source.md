# VAL-S recovery source receipt

Authority effect: none.

Base `8945d156585510fbdf1515fad01798f416146b4e`; task branch
`work/hq-recovery-native-scenarios-20261112`. Sole lane Git owner: Codex.
Accepted recovery amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
Original T7 source handoff and B4 lane handoff read. Local shared-guidance
bridge absent; shared enrollment unavailable. Explicit builder scope retained.

Four native journey sources, real disposable Social service fixture, Wiki
availability control and portable lifecycle/report tests are authored. Existing
gap/held dispositions are unchanged. Synthetic Social fault controls never
forward execution routes; no private or live-provider qualification is claimed.
No public contract changes, retained merges or application source changes.

External overlap readback: #180 `85a49ae9a19bf17d4f05f808296bcb243eda1a5b`,
#193 `b3f8c2282ecec1e5e1a60092effaa97b163b1780`,
#194 `46cbad0a3ccc6935dba73563a22ceb47720308bd`. Their README/preview/host-gallery
ownership is preserved. INT must reconcile the additive README hunk below with
that stack; do not replace its current content.

Validation: eight affected JavaScript modules pass `node --check`;
`git diff --check` passes. Proposed shared hunks pass `git apply --check`;
all three proposed shared JavaScript edits also pass syntax-only parsing. No build, test, service, native app or browser started.
All fixture assertions, cleanup execution, assembled-head typechecks and native
acceptance remain unrun, assigned to the serial Mini verifier. The heavy slot
remains held elsewhere. Existing Foundation portable glob already discovers the new test; INT adds it
to the documented explicit portable command.

## Exact shared hunks for INT

Apply after integrating this source checkpoint, against the current shared
owners' files. These are proposals only; this lane did not write those files.
The Social intent boundary preserves all read-only prefixes and permits only
three specific draft-save attempts. Checkpoint/routine zero-mutation checks
remain. Native scenarios keep first failures; no retry loop is introduced.
Full/selected invoke unavailable services last among recovery journeys.
The existing `recoveryOutcome` helper is a conservative subset utility, not a
new runner mode or permission to discharge held acceptance rows.

```diff
--- a/tests/acceptance/fixtures/setup.mjs
+++ b/tests/acceptance/fixtures/setup.mjs
@@ -2,10 +2,11 @@
 import { join } from 'node:path';
 import { startReadFixture } from './http.mjs';
 import { createWikiCorpus } from './wiki.mjs';
+import { startSocial } from './social.mjs';
 import { startPlanner } from './planner.mjs';
 import { startGallery } from './remote-gallery.mjs';
 import { createLocalFolder, PREVIEW_PNG } from './local-folder.mjs';
-export async function setupFixtures(runtime, repo, profile, { scenarios = false, localFolders = scenarios, observe = () => {} } = {}) {
+export async function setupFixtures(runtime, repo, profile, { scenarios = false, localFolders = scenarios, recovery = false, observe = () => {} } = {}) {
   const exchange = async name => JSON.parse(await readFile(join(repo, 'modules/work/live/test/contract/exchanges', name), 'utf8'));
   const state = (await exchange('02-state-empty.json')).response;
   const version = (await exchange('01-version.json')).response;
@@ -13,7 +14,7 @@
   observe(fixtures);
   const work = scenarios ? await startPlanner(runtime, repo, partial => { fixtures.work = partial; }) : await startReadFixture(runtime, { '/api/state': state, '/api/version': version });
   fixtures.work = work;
-  const social = await startReadFixture(runtime, { '/api/workspace': { status: 200,
+  const social = recovery ? await startSocial(runtime, repo) : await startReadFixture(runtime, { '/api/workspace': { status: 200,
     body: { brands: [], content: [], runs: [], tools: [], csrf: 'synthetic-acceptance-token', features: [] } } });
   fixtures.social = social;
   const wiki = await createWikiCorpus(runtime, repo, profile);
--- a/tests/acceptance/fixtures/planner.mjs
+++ b/tests/acceptance/fixtures/planner.mjs
@@ -47,7 +47,8 @@
       const entry = { count: ledger.length + 1, method: req.method, path: req.url,
         body: JSON.stringify(body), bodyUtf8: bytes.toString('utf8'), requestId: req.headers['x-request-id'] ?? body?.request_id ?? null };
       ledger.push(entry);
-      if (!(req.method === 'GET' && ['/api/state', '/api/version'].includes(req.url)) &&
+      if (!(req.method === 'GET' && (['/api/state', '/api/version'].includes(req.url) || /^\/api\/items\/[A-Za-z0-9_-]{6,40}(?:\/history)?$/.test(req.url))) &&
+          !(req.method === 'PATCH' && /^\/api\/items\/[A-Za-z0-9_-]{6,40}$/.test(req.url)) &&
           !(req.method === 'POST' && ['/api/items', '/api/requests/replay'].includes(req.url))) { entry.status = 404; res.writeHead(404); res.end(); return; }
       const target = new URL(req.url, upstream);
       const headers = { ...req.headers, host: target.host, 'content-length': String(bytes.length) };
@@ -85,6 +86,10 @@
       const response = await fetch(new URL('api/state', upstream), { signal: AbortSignal.timeout(5000) });
       assert.equal(response.status, 200); return response.json();
     },
+    async stop() {
+      await until(() => pending.size === 0, 'Planner proxy idle before stop');
+      await runtime.stop(child);
+    },
     async restart() {
       await until(() => pending.size === 0, 'Planner proxy idle before restart');
       await runtime.stop(child);
--- a/tests/acceptance/run.mjs
+++ b/tests/acceptance/run.mjs
@@ -13,6 +13,10 @@
 import { setupFixtures } from './fixtures/setup.mjs';
 import { assertNoServiceMutations } from './fixtures/http.mjs';
 import { row, scenarioGaps, fullOutcome, selectedOutcome, routineOutcome, replaceRow } from './fixtures/results.mjs';
+import { socialScenario } from './scenarios/social.mjs';
+import { referenceScenario } from './scenarios/references.mjs';
+import { wikiScenario } from './scenarios/wiki.mjs';
+import { unavailableServiceScenario } from './scenarios/services.mjs';
 import { workScenarios } from './scenarios/work.mjs';
 import { localFolderScenario, galleryScenario } from './scenarios/sources.mjs';

@@ -45,6 +49,7 @@
 let cdp;
 let fixtures;
 let workCaptureBoundary;
+let socialSaveBoundary;
 let activeRow;
 let buildInventory;
 const prerequisite = [{ id: 'built-native-app', status: 'pass' }];
@@ -74,7 +79,7 @@
   await access(main);
   await access(join(repo, 'apps/desktop/dist/index.html'));
   report.harness = {};
-  for (const path of ['run.mjs', 'runtime.mjs', 'build-inventory.mjs', 'fixtures/setup.mjs', 'fixtures/http.mjs', 'fixtures/remote-gallery.mjs', 'fixtures/host-gallery.mjs', 'scenarios/sources.mjs', 'scenarios/ui.mjs', 'scenarios/work.mjs']) report.harness[path] = createHash('sha256').update(await readFile(join(repo, 'tests/acceptance', path))).digest('hex');
+  for (const path of ['run.mjs', 'runtime.mjs', 'build-inventory.mjs', 'fixtures/setup.mjs', 'fixtures/http.mjs', 'fixtures/remote-gallery.mjs', 'fixtures/host-gallery.mjs', 'scenarios/sources.mjs', 'scenarios/ui.mjs', 'scenarios/work.mjs', 'fixtures/results.mjs', 'fixtures/wiki.mjs', 'fixtures/social.mjs', 'scenarios/social.mjs', 'scenarios/references.mjs', 'scenarios/wiki.mjs', 'scenarios/services.mjs']) report.harness[path] = createHash('sha256').update(await readFile(join(repo, 'tests/acceptance', path))).digest('hex');
   buildInventory = await collectBuildInventory(repo);
   await evidenceRun.write('build-inventory.json', JSON.stringify(buildInventory, null, 2) + '\n');
   report.build = {};
@@ -86,7 +91,7 @@
     delete env.DISPLAY;
   }
   const fixtureStarted = performance.now();
-  fixtures = await setupFixtures(runtime, repo, env.HQ_USER_DATA_DIR, { scenarios: !checkpoint && !galleryOnly, localFolders: !checkpoint && !galleryOnly && !routine, observe: partial => { fixtures = partial; } });
+  fixtures = await setupFixtures(runtime, repo, env.HQ_USER_DATA_DIR, { recovery: !checkpoint && !galleryOnly && !routine, scenarios: !checkpoint && !galleryOnly, localFolders: !checkpoint && !galleryOnly && !routine, observe: partial => { fixtures = partial; } });
   if (fixtures.work.loseNextCreateResponse) {
     const armCapture = fixtures.work.loseNextCreateResponse.bind(fixtures.work);
     fixtures.work.loseNextCreateResponse = () => {
@@ -98,7 +103,7 @@
   }
   if (hostBinding) fixtures.hostGallery = await bindHostGallery(hostBinding);
   report.timings.fixtureSetupMs = Math.round(performance.now() - fixtureStarted);
-  report.fixturePrerequisites = { work: checkpoint || galleryOnly ? 'read-only-loopback' : 'real-owned-Planner-and-recording-proxy', social: 'read-only-loopback', wiki: fixtures.wiki.commits, durableClientIntent: 'not-provided-session-only-RW9-G3' };
+  report.fixturePrerequisites = { work: checkpoint || galleryOnly ? 'read-only-loopback' : 'real-owned-Planner-and-recording-proxy', social: !checkpoint && !galleryOnly && !routine ? 'real-owned-Social-synthetic-data-and-recording-proxy' : 'read-only-loopback', wiki: fixtures.wiki.commits, durableClientIntent: 'not-provided-session-only-RW9-G3' };
   // Darwin uses owned process groups, without Linux PID/user namespaces.
   const wrapped = darwin
     ? (command, args, options = {}) => runtime.spawn(command, args, { cwd: repo, env, ...options })
@@ -188,9 +193,15 @@
   await capture('after-restart');
   if (!checkpoint) {
     const context = { fixtures, profile: env.HQ_USER_DATA_DIR, cdp: () => cdp, until, domain, begin, passed,
+      beginSocialSaves: () => {
+        assert.equal(socialSaveBoundary, undefined, 'Social intent boundary recorded once');
+        assertNoServiceMutations(fixtures.social.ledger, 'Social before intentional save');
+        socialSaveBoundary = fixtures.social.ledger.length;
+        report.socialSaveBoundary = socialSaveBoundary;
+      },
       held: detail => finish('held', detail), stopApp, launchApp, restartApp, capture };
     // Each independent scenario retains its own first failure; no behavior retries.
-    for (const scenario of [...(galleryOnly ? [] : [workScenarios, ...(routine ? [] : [localFolderScenario]), galleryScenario]), ...(hostBinding ? [ctx => galleryScenario(ctx, fixtures.hostGallery)] : [])]) {
+    for (const scenario of [...(galleryOnly ? [] : [workScenarios, ...(routine ? [] : [localFolderScenario]), galleryScenario]), ...(!galleryOnly && !routine ? [socialScenario, referenceScenario, wikiScenario, unavailableServiceScenario] : []), ...(hostBinding ? [ctx => galleryScenario(ctx, fixtures.hostGallery)] : [])]) {
       try { await scenario(context); }
       catch (error) {
         if (cancelled) throw error;
@@ -231,7 +242,16 @@
     if (fixtures) {
       try {
         if (fixtures.work) assertNoServiceMutations(fixtures.work.ledger.slice(0, workCaptureBoundary), 'Work before intentional capture');
-        if (fixtures.social) assertNoServiceMutations(fixtures.social.ledger, 'Social throughout native invocation');
+        if (fixtures.social) {
+          assertNoServiceMutations(fixtures.social.ledger.slice(0, socialSaveBoundary), 'Social before intentional save');
+          if (socialSaveBoundary !== undefined) {
+            const writes = fixtures.social.ledger.slice(socialSaveBoundary).filter(entry => entry.method !== 'GET');
+            assert.deepEqual(writes.map(entry => [entry.method, entry.path, entry.status]),
+              [['POST', '/api/content', 201], ['POST', '/api/content', 422], ['POST', '/api/content', 200]],
+              'Only the three deliberate Social save attempts are admitted');
+            assert.equal(writes[2].responseLost, true);
+          }
+        }
       } catch (error) {
         report.outcome = 'failed';
         replaceRow(report.rows, row('unsolicited-service-mutations', 'fail', [{ id: 'read-only-service-ledgers', status: 'fail' }], [error.message]));
--- a/tests/acceptance/README.md
+++ b/tests/acceptance/README.md
@@ -128,7 +128,7 @@
 real stdlib Python Planner, but no Electron or display. Run it serially before N:

 ```sh
-node --test --test-concurrency=1 tests/acceptance/build-inventory.test.mjs tests/acceptance/fixtures/fixtures.test.mjs tests/acceptance/fixtures/scenarios.test.mjs tests/acceptance/fixtures/host-gallery.test.mjs tests/acceptance/cleanup.test.mjs
+node --test --test-concurrency=1 tests/acceptance/build-inventory.test.mjs tests/acceptance/fixtures/fixtures.test.mjs tests/acceptance/fixtures/scenarios.test.mjs tests/acceptance/fixtures/social.test.mjs tests/acceptance/fixtures/host-gallery.test.mjs tests/acceptance/cleanup.test.mjs
 ```

 `fixtures/http.mjs` supplies only fixed Work/Social shell reads on ephemeral
@@ -238,6 +238,36 @@
 cleanup failure fails the run and preserves any original error. The lifecycle
 tests cover success, deliberate failure, partial child startup, both handled
 signals, an open HTTP socket, concurrent peers and injected cleanup failure.
+
+## Recovery scenario source (VAL-S)
+
+Full and selected invocations additionally register `social-save-and-unknown`,
+`reference-round-trips`, `wiki-committed-corpus`, and `unavailable-service-ui`.
+Run them only on the serial verifier's fresh assembled Mini build. Source and
+syntax checks do not qualify native behavior. Routine and checkpoint modes keep
+their read-only Social fixture and existing outcome meanings. Existing held/gap
+rows remain; selected/full success does not follow from adding source.
+
+Recovery uses the real repository Social service with owned synthetic SQLite
+state behind a recording proxy. Only workspace reads and draft saves are
+forwarded; runs, posting and unknown routes fail closed. One explicit save is
+rejected before forwarding; one applied update loses its response. Native UI
+must keep the unknown save blocked until explicit read reconciliation, without
+repeating it. The real Planner proxy additionally allows item/history reads
+and item PATCH for the one explicit reference save. Navigation may never write.
+
+Wiki uses only the existing checked-in synthetic corpus committed into owned
+bare repositories. One repository is temporarily parked inside runtime scratch,
+then restored for restart recovery; private sources and remote freshness are
+unqualified. The final scenario stops only the invocation-owned Planner and
+Social children and checks unavailable UI. Runtime cleanup owns all children,
+sockets and scratch on success, failure and cancellation.
+
+Add `tests/acceptance/fixtures/social.test.mjs` to the serial portable B command
+and its existing fast CI discovery; do not execute it concurrently with native
+journeys. It tests real Social response loss/rejection, route denial, partial
+startup/failure cleanup, peer preservation, Wiki restoration and result holds.
+All tests and native journeys remain unrun for this source checkpoint.

 ## Selected T7 scenarios

```
