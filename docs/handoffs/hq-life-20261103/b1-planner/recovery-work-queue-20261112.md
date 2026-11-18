# WRK-Q source recovery checkpoint

Artifact Type: work-note
Artifact ID: note.hq-work-queue-recovery-20261112
Purpose: Hand queue, health and real-Planner scenario source to the integration owner and serial verifier.
Decision owner: M Jones
Consumers: SHL, INT, independent correctness reviewer, Mini serial verifier
Authority effect: none

## Source and history

Branch: `work/hq-recovery-work-queue-20261112`.
Implementation checkpoint: `f7a3f1554e1670240e84a6357917c6302ba27045`.
Base: completed WSP `cd1371e12182db9aaa09f7a7c809f8f07fd8f042`.
Accepted amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.

Ordinary merges preserve retained queue `0406757`, health `d372516`, E2E
`87dff10`, WSP and foundation ancestry. Queue and E2E merge-tree previews
were conflict-free. Health preview showed exactly the original handoff's
adapter, live index and adapter-test conflicts. Adapter imports combine intent
and health types; the boundary test includes health, intent and durable files.
The live index retains WSP bytes; use the direct health import in SHL's patch.
Health's shell changes and both historical builder handoff additions were excluded
from the merge result to preserve the assigned writer cone and sanitized receipts.
Historical handoffs remain available at their original commits.

## Resulting source

- Core queue/durability/index plus four queue test/support files retain the
  offline queue, three-way comparison, fresh request IDs and explicit resolution.
- Pending ordinary sends now settle a durable unknown marker before dispatch.
  A restart holds that marker without automatic resend or Apply authority.
  Until an unknown response exports an adapter intent, the marker has no intent;
  a restored marker cannot infer a replay body and remains conservatively held.
  Save failure retains the existing failed-durability policy; it does not add retry.
- Live adapter/health/wire and their four matching test files retain typed health,
  failure reasons and `store_changed`, with WSP intent adoption preserved.
- Desktop Planner helper and both retained integration files are included.
  The Work integration source updates the old G7 assertion to `store_changed`,
  adds real-device-storage restart, offline reconnect/conflict, unknown-before/
  after-send, single-Apply and health scenarios. Host refusal injects an
  unapproved synthetic Host header: the actual Planner permits its bound host.
- A core gate scenario checks marker-before-send and no automatic repeat after
  restore. A compile-time equality assertion binds both persistence interfaces.

## Static evidence and limits

`git diff --check` passes for this capsule. Node `--check` parses all 16 changed
`.ts` files successfully without importing or executing application/test code.
The retained `.tsx` integration file was diff-inspected, not parsed by Node.
Lexical marker inspection finds no conflict markers across all 17 source paths.
Source comparison confirms both persistence interfaces declare exactly
`load(): Promise<unknown>` and `save(value: unknown): Promise<void>`.
This is structural source evidence; the new type assertion has not been typechecked.

WSP Electron implementation, transport, intent, live index, contracts, shell,
Settings, main and root configuration are byte-identical to the starting WSP
checkpoint. No builds, tests, installs, servers, app/native/browser launches or
private stores were used. No PR or integration merge was performed.

## Required review and verification handoff

SOURCE ONLY. Before integration, the parent must obtain one independent Sol/max
correctness review of this exact implementation checkpoint and resulting receipt
head. The builder has not launched a reviewer or self-certified correctness.
Focus review on hub save/claim ordering, pending/unknown transitions, restored
Apply authorization, stale revisions, origin binding and duplicate intents.

The serial verifier must first run typecheck and focused Work core/live,
Electron work-local/services/preload, and both desktop integration suites, using
the required emitted Electron prerequisite. Confirm no scratch directories,
Planner descendants or sockets survive success/failure/cancellation. Measure
Planner startup/E2E cost and required-job execution versus queue-inclusive time;
no timeout was loosened and no test was skipped. Then run the full required
Foundation, CLI with real Planner opt-in, Planner and complete Design family
on the assembled head under the allocated Mini serial slot. Settings health
wording/check-path tests belong to SHL after Settings integration. INT still
owns main-process WorkLocal registration from WSP's receipt. Neither source
presence nor these unrun scenarios qualify persistence, native restart or UI.

Historical monotonic baseline, older-state refresh, quit drain, directory-fsync
answer and stale projection/hash findings remain recorded in the original B1
handoff. This checkpoint does not repair or dispose of them. No automatic P2-P4
repair is claimed. Pending markers without an exported intent remain `no_intent`
after restore; this deliberately grants no additional queue/recovery authority.

## Exact SHL hunks

Apply after the owned shell/Settings source is assembled; reconcile context
rather than copying entire old files. These are proposed source hunks only.
The first registers durability before `setWorkSessionPort`; the remaining hunks
supply Planner wording and the read-only connection probe. Direct `live/health`
import avoids changing the WSP-owned public index.

```diff
--- a/apps/desktop/src/services/domains.tsx
+++ b/apps/desktop/src/services/domains.tsx
@@ -7,10 +7,12 @@
 import { createLiveSocialPort } from '../../../../modules/social/live';
 import { createWorkbenchFixture } from '../../../../modules/social/workbench/fixtures/examples';
 import { FEATURE_HQ_EDITORIAL_TIMEBOX, FEATURE_HQ_REFERENCES } from '../../../../modules/social/core';
+import { registerWorkDurability } from '../../../../modules/work/core';
+import { isWorkLocalBridge, workLocalPersistence } from '../../../../modules/work/live';
 import { bridgeTransport, createPlannerLive } from '../../../../modules/work/live';
 import { serviceStatus } from './data-source-status';
 
-type Services = Pick<HqServices, 'social' | 'work'> & { config: Pick<HqServices['config'], 'status'> };
+type Services = Pick<HqServices, 'social' | 'work' | 'workLocal'> & { config: Pick<HqServices['config'], 'status'> };
 type Examples = { planner?: () => import('../../../../modules/work/core/port').PlannerPort; social?: () => import('../../../../modules/social/core/port').SocialWorkspacePort };
 
 type Selection = 'live' | 'example' | 'unavailable';
@@ -55,6 +57,7 @@
     if (selection === 'live') {
       const planner = createPlannerLive(bridgeTransport(services!.work));
       workExport = createWorkExportClient(services!.work);
+      if (isWorkLocalBridge(services!.workLocal)) registerWorkDurability(planner.port, workLocalPersistence(services!.workLocal));
       setWorkSessionPort(planner.port, { example: false, recovery: planner.recovery });
     } else if (selection === 'example') setWorkSessionPort(examples?.planner?.() ?? examplePlanner(), { example: true });
     return selection;
```

```diff
--- a/apps/desktop/src/services/data-source-status.ts
+++ b/apps/desktop/src/services/data-source-status.ts
@@ -1,4 +1,5 @@
 import type { ServiceConfigStatus } from '@hq/contracts/services';
+import type { PlannerHealth, PlannerLimit } from '../../../../modules/work/core/port';
 export type DataSource = 'social' | 'work' | 'wiki';
 export type SourceStatus = { readonly text: string; readonly tone: 'neutral' | 'good' | 'bad' };
 export const SOURCE_NAMES: Record<DataSource, string> = { social: 'Social', work: 'Work', wiki: 'Local Wiki' };
@@ -14,6 +15,18 @@
 export function checkedServiceStatus(reachable: boolean): SourceStatus {
   return reachable ? { text: 'Reachable', tone: 'good' } : { text: 'Unreachable', tone: 'bad' };
 }
+const LIMIT_WORDS: Record<PlannerLimit, string> = { no_replay: 'no replay', no_hq_references: 'no HQ links', no_batch: 'no batch create' };
+/** Work's connection check: why the Planner is or is not usable, in plain words. */
+export function plannerHealthStatus(health: PlannerHealth): SourceStatus {
+  if (health.status === 'ready') return { text: health.api === null ? 'Reachable' : `Reachable · Planner API ${health.api}`, tone: 'good' };
+  if (health.status === 'limited') return { text: health.limits.length ? `Reachable · limited (${health.limits.map(limit => LIMIT_WORDS[limit]).join(', ')})` : 'Reachable · limited', tone: 'neutral' };
+  switch (health.reason) {
+    case 'refused': return { text: 'Refused · start the Planner with --allowed-host for this address', tone: 'bad' };
+    case 'server_error': return { text: 'Planner error', tone: 'bad' };
+    case 'incompatible': return { text: 'Not a compatible Planner', tone: 'bad' };
+    default: return { text: 'Unreachable', tone: 'bad' };
+  }
+}
 export function wikiStatus(states: readonly string[] | undefined): SourceStatus {
   if (!states) return { text: 'Index unavailable', tone: 'bad' };
   const configured = states.filter(state => state !== 'not-configured');
```

```diff
--- a/apps/desktop/src/settings/DataSources.tsx
+++ b/apps/desktop/src/settings/DataSources.tsx
@@ -1,7 +1,8 @@
 import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
 import type { ServiceConfigTransport } from '@hq/contracts/services';
 import { validateIndexStatus } from '../../../../modules/wiki/contract/src/index';
-import { CHECKING, UNAVAILABLE, checkedServiceStatus, serviceStatus, wikiStatus, type DataSource, type SourceStatus } from '../services/data-source-status';
+import { probePlanner } from '../../../../modules/work/live/health';
+import { CHECKING, UNAVAILABLE, checkedServiceStatus, plannerHealthStatus, serviceStatus, wikiStatus, type DataSource, type SourceStatus } from '../services/data-source-status';
 const initial: Record<DataSource, SourceStatus> = { social: CHECKING, work: CHECKING, wiki: { text: 'Index not checked', tone: 'neutral' } };
 type Sources = { statuses: Record<DataSource, SourceStatus>; busy: boolean; check: (source: DataSource) => Promise<void>; reload: () => void };
 const Context = createContext<Sources | null>(null);
@@ -55,7 +56,13 @@
         const configured = serviceStatus(await config?.status(source));
         if (configured.text !== 'Set up · not checked') { if (!timedOut) update(configured); return; }
         if (timedOut) return;
-        const result = source === 'social' ? await window.hqServices?.social.call('workspace', {}) : await window.hqServices?.work.call('version', {});
+        if (source === 'work') {
+          const work = window.hqServices?.work;
+          const status = work ? plannerHealthStatus(await probePlanner(work)) : checkedServiceStatus(false);
+          if (!timedOut) update(status);
+          return;
+        }
+        const result = await window.hqServices?.social.call('workspace', {});
         if (!timedOut) update(checkedServiceStatus(!!result?.ok && result.status >= 200 && result.status < 300));
       }
     } catch { if (!timedOut) update(failure); }
```

## Changed source inventory

- `apps/desktop/src/live-services.integration.test.tsx`
- `apps/desktop/src/test/planner.ts`
- `apps/desktop/src/work-live.integration.test.ts`
- `modules/work/core/durability.ts`
- `modules/work/core/index.ts`
- `modules/work/core/store.ts`
- `modules/work/core/test/durability.test.ts`
- `modules/work/core/test/queue-flush.test.ts`
- `modules/work/core/test/queue-support.ts`
- `modules/work/core/test/queue.test.ts`
- `modules/work/live/adapter.ts`
- `modules/work/live/health.ts`
- `modules/work/live/test/adapter.test.ts`
- `modules/work/live/test/health.test.ts`
- `modules/work/live/test/transcript.test.ts`
- `modules/work/live/test/wire.test.ts`
- `modules/work/live/wire.ts`
