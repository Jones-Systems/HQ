Lead review of W2 (Imports) at faaccf5. The design is right:
- the host key split (Imports documents readable, written only through `import.commit`);
- the pick wiring (one dialog, settles on window or host close, late answers ignored);
- the faithful-then-typed storage layers;
- `hasBlob`;
- the atomic, append-only content link that notifies after any sent attempt.
The test changes in `selection.test.ts` and `design-host.candidate.test.ts` are legitimate: the default store still stays disabled.

Please do these, in order, on the same branch.

0. Stack on W3. W3 (`work/hq-b3-design-content-20261103`) and your branch conflict in `compose/bridged-workspace.ts` and `BACKEND-CONTRACT.md`, and W3 merges first. Run `git fetch origin work/hq-b3-design-content-20261103`, then `git merge origin/work/hq-b3-design-content-20261103`. Use a merge, not a rebase. Resolve the conflicts:
   - `importsFor` stays yours. Keep W3's revision caches, operation contexts and subscriptions.
   - In the contract, W3 owns §3's producer table. Make its Imports row read: "after an imports commit that carries linked versions is sent, whatever the outcome (section 12)".
   - Renumber your §7 to §12, placed after W3's §11, and update every "section 7" reference.
   W3 is also getting a fix round now (a `workspace.retry` call and a few smaller items). Merge its branch again when it reports, before your final checks.
1. P2: typed Imports failures do not reach the view. `imports/src/controller.ts` `fail()` keeps only `error.message`, so the description, recovery and kind are lost. The contract's sentence "The imports reducer, controller and views read `failure.operation` and `failure.kind`" is not true today.
   Fix:
   - Keep the rejection on the controller's error state, for example `cause: unknown`, cleared whenever `message` is.
   - When the error carries a string `description`, make `message` the full sentence (`${message}. ${description}`), as W3 does for the interactive workspace.
   - Use duck typing only. The Imports module must not import `compose`.
   - Correct the §1 "Operation names" sentence, and say in §12 exactly how a view gets the typed failure: `designFeedback(classifyDesignError(state.cause, IMPORTS_CONTEXTS.read))`. A `DesignOperationError` keeps its own operation.
   - Tests: a refused pick (`invalid-png`) and a conflicted apply each show the full sentence in the panel's state and expose a cause that classifies to the documented kind. An unknown-outcome apply classifies as `unknown` with Check.
2. P3: the rights wording does not match the recorded basis. The dialog `message` (shown on macOS) says "files you made or have the right to use", but the source records `basis: 'owned'`. `RightsBasis` also has `licensed`, `permission` and `public-domain`, so a licensed file would be recorded as owned.
   - Make the message match `owned`, for example "Only choose files you made. HQ records you as their owner."
   - Keep the title and button.
   - In §12, say that other bases need a choice in the Imports UI (F5's lane), and that `pickSource` records `owned` only.
   - Update the wiring test's expected strings.
3. P4: fix the stale comment you reported in `enabled-candidate.ts`.

Keep the items you reported as they are, and list them again in your final report:
- the empty draft backup over the bridge;
- no thumbnail for images over 2 MiB;
- the catalog-host timeout under load;
- `tools/updater/packaging/compatibility.cjs` also failing on the base.

Before you run tests, take fresh telemetry: no tests at 85% CPU or more, one serial process, `TMPDIR=/tmp`. Run:
- imports node;
- compose node;
- app vitest;
- storage;
- `npm run build:electron`, then the desktop host and e2e tests;
- app and desktop tsc.

Report:
- the head SHA;
- test counts;
- anything you could not run.
