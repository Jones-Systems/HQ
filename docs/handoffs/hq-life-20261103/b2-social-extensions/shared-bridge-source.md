# Social shared bridge source checkpoint

Authority effect: none. Source only; independent renderer/host boundary review and serial Mini verification remain required.

Base: `2c5313d9f4d696e169c2ae472ee9c5923edccc0c` on the dedicated `work/hq-recovery-social-shared-bridge-20261112` branch in canonical `Jones-Systems/HQ`. The worktree was clean at intake. INT explicitly granted successor custody after WSP. Existing Work PR #198 overlaps the service/contracts paths; its retained source is already in this base and was preserved. No merge was needed or performed. Parent owns final integration.

Accepted amendment: `e9db4f61b0688f3727e4be4e37d00521131fc6f3`, recovery outcome/writers/capsules/execution/assembled-head sections. Literal request: `90a3098684f4824508f16ea674388afbeeb218b5:docs/handoffs/hq-life-20261103/b2-social-extensions/INT-request.md`. Reconciled with module transport/extension types and Social server, extension and submission validators. The local `.agents/shared-guidance.md` is absent; adopted host guidance was read without installing a replacement.

## Implemented source

- `packages/contracts/src/services.ts`: nine additive routes, structural SaveSource parameters with twelve closed kinds, optional readonly submission source IDs. No module runtime dependency; WorkLocal, Design, Work and error envelopes preserved.
- `apps/desktop/electron/services.ts`: fixed GET/POST mapping, path-only extraction of IDs, closed body keys, opaque ID guards, project UTF-16/control guards, source name/file/text bounds, source kind, archive, account channel/label, draft version, hash and source-ID list guards. Source text uses UTF-8 byte bounds and rejects unpaired surrogates; filename rejects path separators and C0/C1 controls. Source parsing/shape and ISO-date semantics remain server validation. Request cap remains 2,000,000 bytes after serialization, ordinary response cap 2,000,000 bytes, workspace-only cap 16 MiB. Source read loss is unavailable; mutation loss is unknown. No new channels.
- Exact refresh allowlist: saveContent, addBrand, setBrandProject, saveSource, archiveSource, publishingConnect, publishingDisconnect, publishingRequest, publishingCancel. Only the existing exact 403 token error can refresh once. Submission/approval never refresh or replay after rejection; no unknown transport replay.
- `apps/desktop/electron/services.social-extensions.test.ts`: authored unrun boundary tests for every route/body, missing/extra keys, path escape/type/enum/limit rejection before even token reads, inclusive limits and total serialized cap, one content refresh, execution refusal without refresh, failed refresh and transport loss without replay. Includes a compile-time structural module/shared transport assignment.

No main/preload/startup, module runtime, root, workflow or other lane edits. Publishing stays off by default; no simulator startup flag, live provider or activation change.

## Static evidence and deferred verification

Passed syntax-only `node --check` for both changed TypeScript source files and the new test file; host Node v26.12.1, not CI-version qualification. Passed `git diff --check` and final scope/diff inspection. These checks execute no application or test code. Semantic typecheck, tests, builds, real HTTP and native/preload conformance remain unrun by instruction. No installs, services, app/browser/native launches, private data, posting, signing, deployment, PRs or foundation/main merges. No recorded P2–P4 repairs selected.

Serial verifier must run semantic typecheck, focused encoder/refresh cases, existing Social conformance/extensions, real service HTTP conformance through preload/main, and assembled root required checks under campaign admission. Source and mock transport assertions do not establish behavior qualification.

## Exact requested module-test hunk (module owner only)

The existing `modules/social/live/test/extensions.test.ts` exercises fixture/live absent-feature rejection and a pre-snapshot zero-call source guard. It does not assert zero calls for every extension after an absent-feature snapshot. Apply this additive test in that file; no module edit was made here:

```diff
+it('rejects every absent extension without a pre-read or mutation', async () => {
+  const stub = createWireStub({ features: [] });
+  const p = createLiveSocialPort(stub.transport);
+  const calls = [
+    () => p.setBrandProject('default', null),
+    () => p.source('source01'),
+    () => p.saveSource({ name: 'Example', kind: 'feed-items', file_name: 'feed.json', text: '[]', as_of: '' }),
+    () => p.setSourceArchived('source01', 1),
+    () => p.connectChannel('X', 'Example'),
+    () => p.disconnectChannel('connect1'),
+    () => p.requestPublish('draft001', 1, 'connect1'),
+    () => p.cancelPublish('request1'),
+    () => p.approvePublish('request1', 'a'.repeat(64)),
+    () => p.submitRun('x-studio', {}, true, { sourceIds: ['source01'] }),
+  ];
+  for (const observed of [false, true]) {
+    if (observed) await p.snapshot();
+    const before = stub.calls.length;
+    for (const call of calls) {
+      await expect(call()).rejects.toMatchObject({ error: { kind: 'invalid' } });
+      expect(stub.calls).toHaveLength(before);
+    }
+  }
+});
```

No additional shared source hunk is needed. The module owner applies the exact test hunk above; parent independently reviews and merges this source checkpoint. Final source SHA and remote SHA are reported with delivery, avoiding a self-referential commit claim.
