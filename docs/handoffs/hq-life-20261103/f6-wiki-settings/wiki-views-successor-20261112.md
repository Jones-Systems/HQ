# Wiki views successor source receipt

Artifact Type: handoff
Artifact ID: handoff.hq-recovery-wiki-views-successor
Authority effect: none

## Source checkpoint and custody

Branch: `work/hq-recovery-wiki-views-successor-20261112`.
Source checkpoint: `b0b3a035ee96557351e7b1a9103975b9897615c2`.
Assigned base: `17f1d05ca70fa1cc41d9b0b6e55daea49ec9a3ea`.
Canonical origin identity: `Jones-Systems/HQ`; existing HTTPS origin preserved.
The dedicated task worktree began clean at that exact base with one Git owner.
This is the new authorized successor source capsule, not a replay of the rejected original reservation. The original journal/branch/tree were untouched.

Ordinary retained ancestry merges:

- W1 `b9d2f1f307cfdb01329c24bbce877bdbbae4a5a8` through merge `5116d02c6c5a79e945da4bd75674ee7f31e0e26e`.
- W2 `0273a0ad6df6a99052b84aeffc695f205bdeae87` through merge `fb4fd6815b775108f702fef51355f1c746e3a5ea`.

Both literal incoming inventories were inspected before merging. They contained only owned Wiki UI/app/test paths, the granted design/handoff documents and the exact desktop mount path. W1 `merge-tree --write-tree` confirmed exactly four conflicts: `apps/desktop/src/modules.tsx`, `modules/wiki/app/src/domain.ts`, `modules/wiki/ui/src/index.ts`, `modules/wiki/ui/src/status.ts` (add/add). Desktop was restored from the assigned base, byte for byte. Domain and UI exports combine the current setup gate with retained host affordances. The setup gate's implementation is preserved in `ui/src/setup.ts`; `status.ts` supplies the retained repository model and compatibility re-exports. W2 was preflighted again after W1: **no conflicts**, tree `8f6c832db5ac17afd0c19b7ec68213c323eacccc`; its ordinary merge was clean.

Contract `586959e21e233829c7998533929edf9709921d2b` and validation `5a8cbe89673d105b6f391c10d68f42ebf9ed12c6` are ancestors. Core/runtime/scripts/contract, reference/export implementation and all other off-cone inherited bytes remain base-identical. No old screenshot/evidence PNGs were imported. No revision-history product feature is exposed; session navigation history is retained.

## Resulting source

Home, namespace repository selection, combobox/live search, topics tree and filtering, reader/properties/outline, inert links/previews, disambiguation, backlinks, recent pages and session history are composed from the retained accepted design. New `pageTitles` label/filter topics additively; old providers retain path-derived names. Backlinks show `via` and use inert provider `excerpt` without a source-page read; absent excerpts retain cached AST context. Current setup/error gates and reference/export contracts remain intact.

Retained Wiki Alt+arrow window handling was replaced with module-root bubbling handling, preceding the shell window ReturnPill listener only when Wiki history can move. At a history edge the shell retains its return opportunity. Shell Cmd+K/platform shortcuts remain unchanged. Disabled Back/Forward controls retain explanatory focus/hover help and activation guards. The actual mounted/native ordering is unverified.

Test source preserves destination/history and safety assertions while reconciling W2's documented navigation/search selector mismatches. The retained base remount test now checks the current history popover and recent row; its resource-probe generic is explicit so null-spec rerenders are representable. Static stylesheet tests retain scoping, forbidden rendering/egress and token-motion obligations while discovering all retained Wiki CSS files. New `recovery-successor.test.ts` authors synthetic topic title/fallback, inert excerpt/no extra read, heading-outline, retry/backlink failure and module-before-shell shortcut regressions. All test bodies are **UNRUN**.

## Shared desktop hunk requested from SHL

`apps/desktop/src/modules.tsx` is byte-identical to the assigned base. No mount replacement or reference-provider rewrite is requested. The existing `createWikiDomain` mount already supplies the bridge and Settings event. To enable shell toast feedback, the shared writer should apply only:

```diff
+import { toast } from '@hq/ui';
-const wiki = createWikiDomain({ getPort: () => window.hqServices?.wiki ?? null, openSettings: () => window.dispatchEvent(new CustomEvent('hq-open-settings', { detail: { source: 'wiki' } })) });
+const wiki = createWikiDomain({ getPort: () => window.hqServices?.wiki ?? null, toast, openSettings: () => window.dispatchEvent(new CustomEvent('hq-open-settings', { detail: { source: 'wiki' } })) });
```

The optional port is structural and guarded; without injection inline notices remain. SHL owns adapting this literal hunk to its then-current import block and native integration verification.

## Static evidence and remaining obligations

- `git diff --check` from the assigned base passes after owned EOF whitespace reconciliation.
- Node **v26.12.1** `--check` parsed 48 changed `.ts` files, including test source, with zero syntax errors. This executes no imports, application or test bodies. It is not CI Node 24.19.0 qualification or TypeScript typechecking.
- A read-only file inventory check confirmed every changed/untracked path in the literal task cone and exact desktop bytes against the base. Retained merge parents and contract/validation ancestry were read back.
- Canonical Frontend-Development main resolved to `b59d310cae8472ae8ed42d4d8562d08c362379d8`; AGENTS/README/CUSTODY and view-map, layout, unavailable-action and gallery guidance were read pinned there. The local shared-guidance bridge is absent. The retained lane flow assessment was read from W1, without restoring that removed assessment or publishing its aggregates.

**UNRUN:** all behavior tests (new and retained), TypeScript semantic checks, root/Wiki required checks, compiler builds, real Planner save/open/return, committed-corpus indexing/rebuild/recovery/backlinks/reference status, setup/retry/partial failure and cache refresh races, topic/search/disambiguation keyboard journeys, preview timers/Escape/scroll/prefetch/cache reuse, outline/reduced-motion scrolling, title/recents remounts, mounted reference-return/listener order and toast injection. The serial Mini verifier owns these at an assembled head under the held heavy-slot/controller and CI prerequisite gates.

**UNVERIFIED:** native Electron/preload behavior; focus/assistive technology/forced colors; light/dark/system appearance; narrow/intermediate/wide and breakpoint neighbors; long-content and 200% text/spacing/reflow stress; first/last scroll gutters; outline/preview placement and fallback; loading motion/reduced motion; actual accepted-mockup fidelity. Historical captures establish none of this. Fresh layout/capture evidence must bind the actual admitted build and source. Gallery/export completion remains pending a later actual presentation export and producer completion; no fake source screenshots were generated.

No build, test, typecheck, install, server, browser/app/native launch, private data/configuration/account access, activation, posting, signing, deployment, PR or foundation/main merge occurred. No automatic repair of recorded P2–P4 findings. Source completion is not behavior qualification, assembled acceptance, installation or release readiness.

## Exact changed-path inventory from assigned base

- `docs/handoffs/hq-life-20261103/f6-wiki-settings/hq-life-wiki-w1-20261103.md`
- `docs/handoffs/hq-life-20261103/f6-wiki-settings/hq-life-wiki-w2-20261103.md`
- `docs/ui-map/README.md`
- `docs/ui-map/wiki.md`
- `modules/wiki/app/src/domain.ts`
- `modules/wiki/app/src/index.ts`
- `modules/wiki/app/src/wiki-domain.css`
- `modules/wiki/app/test/static.test.ts`
- `modules/wiki/ui/design-20261103.md`
- `modules/wiki/ui/src/cache.ts`
- `modules/wiki/ui/src/chrome.ts`
- `modules/wiki/ui/src/common.ts`
- `modules/wiki/ui/src/context.ts`
- `modules/wiki/ui/src/feedback.ts`
- `modules/wiki/ui/src/format.ts`
- `modules/wiki/ui/src/history.ts`
- `modules/wiki/ui/src/icons.ts`
- `modules/wiki/ui/src/index.ts`
- `modules/wiki/ui/src/load.ts`
- `modules/wiki/ui/src/outage.ts`
- `modules/wiki/ui/src/reader-model.ts`
- `modules/wiki/ui/src/recovery.ts`
- `modules/wiki/ui/src/render-ast.ts`
- `modules/wiki/ui/src/resources.ts`
- `modules/wiki/ui/src/search-data.ts`
- `modules/wiki/ui/src/session.ts`
- `modules/wiki/ui/src/setup.ts`
- `modules/wiki/ui/src/status.ts`
- `modules/wiki/ui/src/topic-tree.ts`
- `modules/wiki/ui/src/view-combobox.ts`
- `modules/wiki/ui/src/view-history.ts`
- `modules/wiki/ui/src/view-home.ts`
- `modules/wiki/ui/src/view-links.ts`
- `modules/wiki/ui/src/view-outline.ts`
- `modules/wiki/ui/src/view-preview.ts`
- `modules/wiki/ui/src/view-reader.ts`
- `modules/wiki/ui/src/view-search.ts`
- `modules/wiki/ui/src/view-sidebar.ts`
- `modules/wiki/ui/src/view-topbar.ts`
- `modules/wiki/ui/src/view-topics.ts`
- `modules/wiki/ui/src/view.ts`
- `modules/wiki/ui/src/wiki-chrome.css`
- `modules/wiki/ui/src/wiki-home.css`
- `modules/wiki/ui/src/wiki-reader.css`
- `modules/wiki/ui/src/wiki-search.css`
- `modules/wiki/ui/src/wiki-topics.css`
- `modules/wiki/ui/src/wiki-view.css`
- `modules/wiki/ui/test/base.test.ts`
- `modules/wiki/ui/test/chrome.ts`
- `modules/wiki/ui/test/combobox.test.ts`
- `modules/wiki/ui/test/home.test.ts`
- `modules/wiki/ui/test/navigation.test.ts`
- `modules/wiki/ui/test/reader.test.ts`
- `modules/wiki/ui/test/recovery-successor.test.ts`
- `modules/wiki/ui/test/search.test.ts`
- `modules/wiki/ui/test/stale.test.ts`
- `modules/wiki/ui/test/static.test.ts`
- `modules/wiki/ui/test/support.ts`
- `modules/wiki/ui/test/surface.test.ts`
- `modules/wiki/ui/test/topics.test.ts`
- `docs/handoffs/hq-life-20261103/f6-wiki-settings/wiki-views-successor-20261112.md` (this receipt)
