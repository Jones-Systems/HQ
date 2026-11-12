# Handoff: F1-B2 service domain states and observed status (X3)

**Written by the F1 lead, not by B2.** The pause message never reached B2's session: T3 held it while the turn appeared to be inside an earlier background wait. B2 kept working and did not reply within about 10 minutes, so the lead cancelled it at 15:55 CET on 2026-11-03, as the owner's pause instructions say. This file records what the lead could see from B2's commit, worktree and session log.

- **Branch:** `work/hq-life-system-services-20261103`, from `work/hq-life-system-20261103` at `284393d`. The lead pushed it after the cancel; B2 had not pushed.
- **Worktree:** `work-hq-life-system-services-20261103` (under `~/.t3/worktrees/HQ/`). Clean at the cancel; nothing was left uncommitted.
- **Code head:** `15b1344` ("Show connecting, unavailable and observed status in Work and Social"). B2 wrote it as a finished commit, not WIP. This handoff sits on top of it.
- **No PR.**

## Where it stands

**Done, tested on its base (`284393d`)**

1. **Checking state.** "Checking … configuration…" is replaced by `Connecting`. After 150 ms (`CONNECTING_DELAY_MS`), so fast checks show nothing, it shows:
   - a polite "Connecting to Work…" or "Connecting to Social…";
   - a skeleton shaped like the domain: Work as four board columns, Social as library rows;
   - `aria-busy="true"` on the region.
2. **Unavailable state.** The blank workspace is replaced by a centred `StateView state="unavailable"`, entering with `hq-enter-rise`:
   - title "Work isn't connected" or "Social isn't connected";
   - text: "This build has no reachable … service configured, so nothing can be read or changed.";
   - action "Open settings", which dispatches `hq-open-settings` with that domain as the source.
3. **Status strip.** Built from `StatusIndicator`. The tones come from configuration until traffic is observed: sample data `info`, set up `neutral`, unavailable `unavailable`. The action reads "Set up" or "Settings", and the `RELOAD_NOTE` tooltip is kept. The rules moved from `styles.css` to `services/service-domain.css`.
4. **Observed status (X3)**, in `apps/desktop/src/services/observed-status.ts`:
   - a store with `subscribe`/`getSnapshot`, `useObservedStatus(domain)` and `describeObservation`;
   - `observeWork` and `observeSocial` wrap the live transports inside `createServiceDomains` and record each answer as it passes, without changing it;
   - any HTTP response counts as reachable, `kind: 'unavailable'` counts as unreachable, and `unknown` or malformed answers change nothing;
   - nothing polls or sends a request;
   - the strip shows "Connected" with the detail "observed HH:MM", or "Unreachable" with "last tried HH:MM";
   - a change between reachable and unreachable raises one toast per domain ("… service unreachable" or "… service reconnected"); the first observation is silent.
5. **Tests.**
   - New: `services/domains.test.tsx`, `services/observed-status.test.ts`, and the helper `services/test-support.ts`.
   - Adjusted: `live-services.integration`, `preview/composition` and `references.integration`.

**Verification by B2, at `15b1344`, before the cancel**

- `npx vitest run apps/desktop/src/services`: 4 files, 33 tests passed.
- `npx vitest run apps/desktop/src`: 22 files, 160 tests passed.
- `npm run typecheck` (all configs): passed.
- Not run: `npm test` with the Electron build, `npm run build`, the Electron app.

**In progress at the cancel:** screenshot evidence in the browser dev server. Nothing was left in the repo.

## What's left, in priority order

1. **Merge into the lane branch** (`work/hq-life-system-20261103`, which has the new shell at `273df7b`).
   - Expect a conflict in `apps/desktop/src/styles.css`. Keep B2's removal of `.service-domain`/`.service-status`; they live in `services/service-domain.css` now.
   - Then rerun `npm test`, `npm run typecheck` and `npm run build`.
2. **Finish X3: one wording everywhere.** The new top-bar Sources popover, the `Connections` rows and Settings still show configuration status ("Set up · not checked") and Recheck results.
   - Make them read `observedStatus` through `describeObservation`, so the popover, the domain strip and Settings agree.
   - Decide whether a Recheck result is also an observation; if so, feed it to `record()`.
3. **Review points:**
   - `ok: true` with any HTTP status counts as reachable. This is deliberate: the service answered.
   - Toast IDs are `hq-service-<domain>`, so repeated flips replace each other.
   - Observations refresh at most once per displayed minute.
4. **Social is only observed when it is used.** Consider a quiet check when the window gains focus. F7 suggested this; it is outside B2's no-polling brief.
5. **Evidence.** Recapture with the merged shell for the lane PR.

## Exists only outside the branch

- **Screenshots** on the build host, in `/tmp/hq-f1-system/evidence/services/`, 1440×900:
  - Work: connecting (light), unavailable (light and dark), observed unreachable (dark), the unreachable toast, the reconnect toast;
  - Social: connecting (light), unavailable (light and dark).

  They are not committed and may be lost.
- B2's T3 thread and session log hold its reasoning. Its dev server is gone; its preview tab may still be listed in its thread.
