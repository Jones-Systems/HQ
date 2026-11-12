# Design app CI composition source receipt

Authority effect: none. Partial source repair; behavior is unqualified.

## Binding

Canonical repository: Jones-Systems/HQ. Task branch:
`work/hq-recovery-design-app-ci-composition-20261112`.
Clean base: `16e9b028bdfe94c5fa691b9a54f7e29ca7ad933f`.
Recovery amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`,
including all five assigned sections and its current work note. B3, DSN-B,
DSN-M and DSN-C handoffs were read. Shared bridge is absent; supplied immutable
shared guidance was read without installing enrollment. Implementation-role
fallback, codex-v3-builder scope; explicit Blended Frontier Max revision 11,
Sol/high/default service tier, no Fast. No children.

## Four diagnoses and dispositions

1. **Workspace feed independence — repaired in source.** The fake feed, project
   store, project-keyed promises and other section caches were module globals.
   Allocating only a new feed would leave shared writers announcing on the wrong
   feed. `createFakeWorkspace` now encloses all those mutable stores/caches and
   accepts the composition feed. Every `createDesignWorkspace(null)` owns a
   complete instance; Projects and annotation sessions use its same feed.
   Legacy direct exported accessors retain one separate default example instance.
   The original feed inequality assertions remain; a new synthetic test checks
   distinct repositories/stores, one edit notification, same-workspace fresh
   content and no second-workspace content/revision change.

2. **Fake retry no-op — repaired in source and oracle timing.** At this exact
   base `workspace.retry` explicitly notified even in fake mode, incrementing
   revision despite retaining the same content promise. That contradicts the
   fake no-op oracle. Fake retry now returns undefined without notification;
   durable retry is untouched. The test awaits content initialization and captures
   its actual revision before retry, preserving both promise identity and exact
   revision equality. Seed initialization must not be confused with retry effects.
   The reported revision 2 is not a universal seed value: this base's `contentFor`
   has no direct notify, and the former global feed admitted prior project edits.
   No arbitrary fixed replacement revision is asserted.

3. **Unregistered documents — blocked outside cone.** The spread fixture correctly
   loses the WeakMap identity used by `bridgeTransportFor`. It gets the disabled
   environment, no picker, and zero IPC; no fake fallback occurs. Its failed read
   reaches `ImportsState.cause` as disabled `imports.read`. The public controller
   refresh catches it with `historyFailed`, which retains `idle` status. The
   safety fixture is correct; its error assertion remains unchanged. Added
   explicit operation and zero-IPC assertions before the retained failure.

4. **Lost read — blocked at the same controller seam.** Actual refresh calls
   `listImports` and `listOpenConflicts` concurrently. Both start `doc.list`, for
   manifests and conflicts respectively; `doc.get` only follows a successful
   listing. Thus existing `doc.list` injection is correct. Typed storage converts
   transport loss into unavailable `imports.read`, but `historyFailed` retains
   idle. Injection and Retry/message/status assertions remain. Added exactly two
   listing attempts, zero document gets, zero commits/puts, empty documents and
   zero content notifications. No retry or fault-seam substitution.

## Exact shared production hunk requested

Controller owner: `modules/design/imports/src/controller.ts`, public return
object near line 362. Do not edit the existing internal `refreshQuietly` used
following writes: preserving an already-completed write's step is intentional.
The requested public refresh hunk is:

```diff
-    refresh: refreshQuietly,
+    async refresh() {
+      try { await refresh(); }
+      catch (error) {
+        fail(error, 'history', {
+          failed: "Couldn't load the import history",
+          unknown: "Couldn't load the import history",
+        });
+      }
+    },
```

This distinguishes an explicitly requested failed read from background history
refresh after an operation. `fail` retains the original typed cause/message and
publishes a definite read failure without a write target. The controller owner
must check manual refresh/recovery and retained apply/undo/resolve/unknown-effect
oracles before accepting the hunk. This file was not edited here. Both Imports
status failures remain expected from source until that boundary is repaired.
No desktop, UI-kit, contract, root, workflow or inventory hunk is requested.

## Static evidence and unrun verification

Passed: `git diff --check`; syntax-only Node 26.12.1 `--check` on all five changed
TypeScript files; relative-import existence and exact write-cone inspection.
Node differs from CI 24.19.0; syntax checks execute no application/test body.
Reviewed the whitespace-insensitive factory diff: existing accessor behavior
moves into instance ownership; public types remain module-level.

Changed files: `compose/fake-workspace.ts`, `compose/workspace.ts`,
`compose/test/content-events.test.ts`, `compose/test/content-freshness.test.ts`,
`compose/test/imports-env.test.ts`, and this receipt, all under the assigned cone.
The factory indentation accounts for the large textual diff.

All tests, TypeScript/compiler checks, builds, dependency installs, runtime,
browser/native/app, private-data and activation checks are UNRUN. No PR or merge.
The serial Mini verifier must run focused compose tests and full required Design
app discovery on the assembled head after controller integration, then the
required fast family at the final head. Existing inventory owns these tests.
No source checkpoint proves those checks pass. Recorded P2-P4 remain untouched.
