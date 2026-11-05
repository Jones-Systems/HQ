Lead review of W3 (content freshness) at 8377551. The design is right: the revision cache, the deferred hook, the Projects refresh with an unchanged revision, and the annotation session. Please fix the items below on the same branch, then re-run your checks.

1. P2: a failed build in a memoised-forever cache never retries. `bridged-workspace.ts` still keeps these for the whole session:
   - `discoveryEnv` (`discovery ??= createBridgedDiscovery()`), which awaits `catalog.roots`, `service.open()` and `readPort.load()`;
   - `projectsFor`, `canvasFor` and `componentsFor` (plain `perProject`).
   One transient failure, such as the catalog host timing out under load at startup (W2 saw that timeout in its run), leaves Projects, Canvas or Components failed until HQ restarts. §10's notify-to-retry does not reach these caches. F4's section boundary now has **Try again** (`@hq/ui` `ErrorBoundary` reset), which re-renders the view and gets the same rejected promise back.
   Fix:
   - Give every bridged per-project accessor, and the discovery singleton, the keep-mode failure rule: keep a failed build (so a suspended view settles on it and does not loop) until the next change or retry for that project, then rebuild. A healthy value is kept.
   - Expose `workspace.retry(projectId)` on both workspaces as the call behind Try again, Retry and Reload for reads. Notifying is fine. The fake can accept it and change nothing. A failed discovery must also be retried by it.
   - Subscribe inside a build only after the build has succeeded. Today `canvasFor` subscribes before its adapters refresh, so a failed then rebuilt canvas would leave a second subscription.
   - §10: say that Try again calls `workspace.retry(project.id)` and then resets the boundary.
   - Tests:
     - a transient discovery failure, then retry, and Projects loads;
     - the same rejected promise comes back until retry, with no loop;
     - retry does not rebuild a healthy compare or taste value;
     - a failed then rebuilt canvas has one subscription.
2. P3: typed feedback in a section boundary. In §10, document how a boundary fallback shows the typed failure:
   `designFeedback(classifyDesignError(error, { section, operation: '<section>.load', action: 'show this section', write: false }))`.
   A `DesignOperationError` passes through with its own operation, for example `projects.load` with reason `unsupported-stored-schema`. F4 owns the boundary; you only document it. Add one compose test showing that a `contentFor` rejection classifies to the documented kind and recovery through that call.
3. P3: missing regression test, requested earlier. Add a test that the shell's reference reads (`createDesignReferenceReads` in `compose/reference-reads.ts`) do not cache. After a write to project content (a capture, a Projects edit, or a direct repository write), the next `read`/`list` returns the new content with no `notify`.
4. P3: one operation name, two meanings. Your `TASTE_LOAD` in `bridged-workspace.ts` uses `taste.load` with the action `open taste`, but W4 (Taste, parallel branch) defines `taste.load` as `load your taste ratings` for `snapshot`. Rename yours to `taste.open`, with the action `open Taste`, like `annotations.open`, and update the §10 table.
5. P4: in `ProjectsController.#remember`, the same-revision shortcut returns before `this.#unavailable.delete(content.projectId)`, so a stale marker can survive a successful re-read. Delete the marker before the shortcut, and add one assertion.

Leave `readContent` to F4. Their workspace keeps their own stopgap, and your hook plus `contentFor(project, { revision })` is the documented freshness path. W2 will stack on your branch, so keep §7–§11 numbered as they are; W2 takes §12.

Before you run tests, take fresh telemetry: no tests at 85% CPU or more, one serial process, `TMPDIR=/tmp`. Run compose node, app vitest, projects, compare and annotations, and app tsc. Report:
- the head SHA;
- test counts;
- anything you could not run.
