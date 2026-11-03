# Handoff: B3 Design backend, W3 content freshness

Paused on owner request. No work is in flight and nothing is uncommitted.

## Where this lives

- Branch: `work/hq-b3-design-content-20261103` (pushed, no force).
- Worktree: `~/.t3/worktrees/HQ/work-hq-b3-design-content-20261103`.
- Base branch: `work/hq-b3-design-errors-20261103` (W1). It was at `1fe0c16` when merged. It may have moved since; this branch has not been re-merged.
- Code head before this handoff commit: `43c987d36d56c15542033c0b082411b896f7ca4b`. The handoff commit sits on top of it.
- No PR is open. None was asked for. W2 is expected to stack on this branch and takes contract §12.

Commits on the branch, oldest first:

| commit | what |
| --- | --- |
| `3917ee9` | W1 base: typed failures and project content events |
| `3e879f2` | W3 first delivery: fresh content, annotation session, captured-version thumbnails |
| `8377551` | Merge of the revised W1 contract (`1fe0c16`) |
| `43c987d` | Fix round after lead review (retry, boundary docs, reference reads test, `taste.open`, `#remember`) |

## What W3 is

In the bridged (durable) workspace, Projects/Gallery, Annotations, Compare, Flows, Taste and the Requests picker must show current project content, and live captures must show their image bytes and thumbnails. The contract for view lanes is `modules/design/app/compose/BACKEND-CONTRACT.md`. W3 owns §7 to §11. W2 takes §12.

## Status

### Original W3 scope: done

- Revision-keyed accessors (`revision-cache.ts`): `contentFor`, `flowsFor`, `annotationSessionFor`, `compareFor`, `tasteFor`. Same promise while nothing changes. A change to project A never rebuilds project B.
- `useProjectContentRevision(workspace, projectId)` in `content-revision.ts`. Deferred, so a mounted view keeps its content while a refresh runs.
- Annotation session (`annotation-session.ts`): explicit version selection, default is the newest version with a stored capture (a screen default only, never lineage), stored capture bytes shown, an empty digest is never used.
- Thumbnail on captured versions (`capture-thumbnail.ts`, used by `acceptCapture`): added only when the stored PNG qualifies. Otherwise omitted, never faked.
- Projects controller refreshes after outside writes (`refreshContent`) and reports its own edits (`onContentChange`). Compare refreshes its version lists in place (`refreshVersions`). Canvas lists versions saved later.
- Typed failures with operation names `projects.load`, `flows.load`, `compare.load`, `annotations.open`, `captures.accept` (and `taste.open`, see below).
- `compare-catalog.ts` was checked: it re-reads on every call. It still returns `captures: []`. Nothing fabricates capture receipts; the contract says so (§11).
- Fake workspace still works.

### Merge of the revised W1 contract: done (`8377551`)

Required `write` on failure contexts, feedback `id` and `status`, new unknown wording, per-call subscriptions, "after any attempt" notification. `subscribeAll` was brought to the same rules. The Projects controller now notifies on every edit attempt, including a refused one.

### Lead's fix-round message: all five items done (`43c987d`)

| item | state | notes |
| --- | --- | --- |
| 1. P2 failed builds never retry | done | `projectsFor`, `canvasFor`, `componentsFor` and the discovery connection follow the keep rule. `workspace.retry(projectId)` is on both workspaces. Builds subscribe only after they succeed. A failed annotation controller load is read again. Tests and §7/§10 text added. |
| 2. P3 typed feedback in a boundary | done | Documented in §10 under "Showing the typed failure in a section boundary". Two compose tests added. |
| 3. P3 reference reads never cache | done | One test in `content-freshness.test.ts`. |
| 4. P3 `taste.load` vs W4 | done | Renamed to `taste.open`, action `open Taste`. Code, test, §10 table. |
| 5. P4 `#remember` marker | done, weakly tested | Marker is cleared before the shortcut. The marker is private and hidden by cached content, so the test pins recovery behaviour only. It cannot fail on the old code. |

### Not started

- An Annotations version picker control. The API and `choices` exist; no UI uses them. That is for the view lanes (F4 core, F5 Sources).
- F4's section boundary calling `workspace.retry(project.id)` before it resets. `retry` exists and is documented. Nothing in the repo calls it from Try again yet.
- Imports calling `contentEvents.notify` after its writes. Imports was out of scope and untouched.
- Contract §12 (W2's section).
- A run in the real Electron app. View tests ran in happy-dom only.

## Last verified results

Before the pause, CPU under 85%, one serial process, `TMPDIR=/tmp`:

- Compose node, `modules/design/app/compose/test/*.test.ts`: 297 pass, 0 fail.
- App vitest (`modules/design/app/vitest.config.ts`): 2 files, 20 pass.
- Projects node: 49 pass. Compare vitest: 6 files, 44 pass.
- Annotations node: 73 pass. Annotations vitest: 1 file, 3 pass.
- CI inventory test (`tools/ci/design-sections.test.mjs`): 6 pass.
- `tsc` clean for app, projects, compare, annotations, and also root, electron and design-host.

Nothing has been run since the fix-round commit. The handoff commit changes only a markdown file.

## Decisions and why

- **Revision cache, not subscriptions in views.** Accessors are keyed by the project's content revision. A view passes the revision it is showing and is served the newest value that already resolved, so a refresh never puts a mounted view back into its loading state. Rejected: rebuilding on every notify with no stale serving (flashes the loading state over a live preview).
- **Keep mode for stateful objects** (Compare controller, Taste client, Projects controller, Canvas environment, Components library, discovery). They own state a rebuild would lose (unsaved layout, journal retry state, selection and scroll). They refresh themselves. Only a failed build is rebuilt.
- **Failures are cached per revision.** A suspended view must not loop. The next change or `retry` rebuilds.
- **`retry` is a notify.** Simple, and re-renders every hook user. Cost: healthy snapshot-style values (`contentFor`, `flowsFor`, annotation session) are read again too. A targeted "clear failed entries only" call was considered and not built, because the lead said notifying is fine.
- **Any project notification clears a failed discovery.** Otherwise a rebuilt Projects accessor would hit the stale rejection and "next change retries" would be false.
- **Thumbnail comes from the stored bytes.** `CaptureRecord` has no byte size. The ref is built from the blob (hash check, PNG header, size limit) and omitted if anything fails.
- **Projects controller notifies after any attempt**, including a refused edit, to match the contract. A conflict means another writer changed the project.
- **Canvas subscribes last**, after the whole environment exists, with one catch-up refresh if the revision moved during the build.
- **Operation `taste.open`** for the accessor, so W4's `taste.load` (load ratings) stays distinct.
- **View edits are wiring only** (hook plus `{ revision }`), because F4 and F5 are rebuilding the views at the same time.

## Findings

- `canvasFor`, `projectsFor` and `componentsFor` were forever-memoised. One transient catalog host timeout at startup left them failed until restart. W2 saw that timeout in its run.
- A section boundary's Try again re-renders and gets the same rejected promise back unless something resets the accessor.
- The Projects failure marker (`#unavailable`) is only observable when no content is cached.
- Canvas build failures are hard to inject. The only late failure point is `createCanvasStorage`, which reads `documents.kind`. The canvas test uses that.
- `serializeComparison` of a layout with no panels does not load back as valid. Test fixtures need at least one panel.
- A hook in this environment rejects a shell redirect to a path built from a shell variable. Use literal paths.

## What is left, in priority order

1. **Re-merge the base.** Run `git fetch origin work/hq-b3-design-errors-20261103`, then merge (not rebase) if it moved. The likely conflicts are `BACKEND-CONTRACT.md`, `errors.ts` consumers and `content-events.ts`. Keep W3 sections numbered 7 to 11. Re-run the compose node suite and `tsc -p modules/design/app/tsconfig.json`.
2. **Get F4 to call `workspace.retry(project.id)` in Try again.** Without it the §10 behaviour exists only in the contract and tests. Check with the F4 owner; do not edit their boundary from this lane.
3. **Tell the Imports lane to call `contentEvents.notify`** after its writes. Without it other sections will not see Imports changes. Add the row to the §3 "who notifies" table when it lands.
4. **Annotations version picker** for the view lanes. Use `annotationSessionFor(context, { revision, selection })` and `session.choices`. Add a vitest for the control.
5. **Run the views in the real app** (the repo's run skill, no install or restart of HQ). Check that Taste, Annotations, Flows and Requests do not flash their loading state when a live capture is saved.
6. **Optional: targeted retry.** If re-reading healthy snapshots on retry turns out to cost something visible, add a call that clears only failed entries.

## Open questions and risks

- Is `retry` as a notify acceptable once F4 wires it? It re-reads healthy snapshot values and nudges Compare and Projects to refresh.
- The default capture probe reads at most the 20 newest versions. If none has readable bytes, Annotations opens on the newest annotatable version with "Capture unavailable". Is 20 enough?
- Views that do not pass `{ revision }` show their loading state briefly on each content change. Taste, Annotations, Flows and the Requests picker do pass it. Any new view using `use()` must too.
- `projectsFor` subscribes to every project's changes for the session and is never unsubscribed. One controller exists per project id passed in, as before this work.
- Item 5 above has only a recovery-path test, as noted.
- Capture receipts (full-extent capture, HQR-2) are owner-held. `compare-catalog.ts` returns `captures: []` on purpose.

## What exists only outside the committed code

- Nothing is uncommitted. The tree was clean before this file was added.
- A throwaway backup, `/tmp/b3-bridged-workspace.bak`, exists on the working machine from a mutation check. It is not needed and not part of the branch.
- The mutation checks themselves (re-breaking discovery retry and the canvas subscription order to see the tests fail) were done in the conversation and are not recorded in the repo. Redo them by temporarily removing the discovery reset in `bridged-workspace.ts` and by subscribing before `createCanvasStorage`.
- The lead's review instructions are in the conversation only. Their content is summarised in the fix-round table above.
