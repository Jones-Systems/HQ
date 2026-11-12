# SHL successor source checkpoint

Artifact Type: handoff
Artifact ID: handoff.hq-recovery-shell-integration
Authority effect: none

## Source and scope

The successor starts at shell `734d1f3e8e666052c93fd58dc5944c39456fe2cf`.
Ordinary merge `c12abb7ce55eee299e8859d36bd8f52595f4ce07` consumes INT
`6cfbaf28964eb8376244e1ab14e6efc6a1d73301`. `merge-tree --write-tree`
reported no conflicts (tree `53c1bdd5921f32f7ef1a109249929966d4ce0f07`).
All upstream module, Electron and contract files are inherited unchanged.
No new dependency changes. The retained react-dom hunk is unchanged.

The current shell keeps the palette, reference ReturnPill, onboarding,
observed-status wording, reduced motion and navigation primitives.
Social/Work remain workspace-scoped; Work defaults and navigation order are
unchanged. Original X1–X16 were read as design inputs, with no automatic
repair of recorded review findings.

`createServiceDomains().referenceReads` supplies read-only capabilities over
the same cached selection and ports as the mounted domains.
`createReferenceProviders(reads)` consumes those capabilities; production uses
`SERVICE_DOMAINS.referenceReads`. Reference search does not inject Work sessions.
Only mounting Work calls `setWorkSessionPort`. Failed/missing configuration
stays unavailable, live errors never choose examples, and configuration changes
still require reload. No write, run submission or retry is introduced by reads.
The Wiki remains a read-only reference target using its existing client.

## Work-owned Alt+Left hunk (proposal only)

Apply in `modules/work/board/StatusBoard.tsx`, in `onCardKey`, immediately after
the existing target/currentTarget guard and before `cardKey`:

```diff
     if (event.target !== event.currentTarget) return;
+    if (event.altKey && !event.ctrlKey && !event.metaKey
+      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) event.preventDefault();
     const key = cardKey(event, item.status);
```

This reserves the card's move chord at an edge even when `cardKey` returns null.
It must not trigger a move, reference return or execution for a no-op. Work's
owner should add its edge-card regression. SHL does not edit module code or
claim this remaining ownership conflict fixed.

## Wiki route source

Source inspection found no Wiki keydown/Alt+Left listener. Shell shortcuts use
`DOMAIN_IDS` (Wiki is fourth). Palette sections use Wiki `HOME`, `NAMESPACES`
and `topicsDestination`; query navigation uses Wiki `searchDestination`.
Reference targets use the existing Wiki provider's destination.
No replacement Wiki route or module listener is invented. Current listener
order and mounted keyboard behavior still require serial verification.

## Pending module-to-shell hunks

SOC-V must supply the exact public example-seed API and hunk replacing the
`createWorkbenchFixture(...)` selection in `services/domains.tsx`, so seed
references use `WORKSPACE_SCOPE` and point at actual example Work IDs.
The current Social fixture hardcodes `fixture-project`; selecting the shared
port alone does not repair those stored references. Supply all four accepted
desktop integration hunks with checkpoint SHA, imports, old/new context,
feature and error-notice requirements, and test adjustments. Mount remains
`SocialDomain` with the selected `port`, `example` and shell `ModulePort`.
No unfinished Social entry or transport is wired here.

WRK-Q must supply its exact public `registerWorkDurability` import and call,
with the proved bridge-to-port adapter and options. Insert in `mountWork()`
after `await getWork()` and before `setWorkSessionPort`, before the first
`WorkModule` mount. State whether registration is live-only, failure behavior,
restore ordering, health subscription and teardown; preserve `planner.recovery`
and the same selected port used by reference reads. No guessed signature or
queue transport is introduced. Planner-health wording in `DataSources.tsx`
and `services/data-source-status.ts` waits for SET-V/WRK-Q evidence.

The existing `references.integration.test.tsx` uses production singleton
providers across changing bridge fixtures. The selection is now intentionally
frozen per renderer. `reference-fixture-proposal.patch` provides the exact
fixture-local factory adaptation, preserving every behavioral assertion.
That file is outside the literal `references*.ts` grant, so the patch is
returned for owner-authorized application rather than applied here. Production
provider ordering is still asserted. Status tests explicitly select the moved
fixture's provider instead of changing the transport underneath a frozen choice.

## Static evidence and deferred qualification

`git diff --check`, final authored-file review, merge conflict preflight,
ancestry readback and `git apply --check` of the proposed fixture patch only.
Authored diff from merge `c12abb7` passes whitespace checks. The wider diff
from shell base reports pre-existing trailing spaces in the inherited
`b1-planner/evidence/hqr-verify-summary-20261103.txt`; those upstream bytes
are preserved, not repaired. Electron, contracts and module paths match INT;
the lockfile difference is solely the retained react-dom dependency. New `services/reference-reads.test.tsx` is unexecuted
source covering shared example reads, Work injection timing, configuration
freeze, live-failure refusal and unavailable configuration.

No tests, typechecks, builds, installs, servers, browser/native app launches,
private data, activation, PRs or foundation/main merges. TypeScript semantic
and syntax qualification remains unrun because no local parser dependency is
available. The Mini serial verifier must run affected shell/services/navigation,
references and root checks after the remaining authorized hunks are assembled.
Mounted journeys, accessibility, visual fidelity and native behavior remain
unqualified. This checkpoint is a consumable shell source base, not acceptance
of the assembled recovery outcome.

Frontend guidance was read at
`Jones-Systems/Frontend-Development@b59d310cae8472ae8ed42d4d8562d08c362379d8`.
The local shared bridge is absent. No guidance installation or gallery/runtime
publication was attempted under the source-only boundary.
