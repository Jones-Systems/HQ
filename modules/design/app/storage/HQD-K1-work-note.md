# Design storage engine work note

Artifact Type: work-note
Artifact ID: work.hq-design-storage-engine
Purpose: Preserve implementation and verification continuity.
Decision owner: Design integration coordinator
Consumers: Integration and host successor
Authority effect: none

## Custody and basis

HQD-K1 is sole writer/Git owner of its isolated task branch, with scope limited to
modules/design/app/storage. Base K is 73a6532159686c769ba6e39d8070907b2a9b021e;
read-scope equivalence to P was verified. The authorized successor
0759c66a560371fea567ef5eb8c6402950b1047e was incorporated by fast-forward; it changes
only a discovery test outside this lane. No foundation merge was performed.
Plan authority: c49c3c4e25bc634deeaa3ed29df927d76cbb82fb. Five coordinator gap
dispositions accepted: catalog-only Pick; imports prefix mapping; bounded keys and
stream-enumeration refusal; preserved legacy export enablement; reopen after live
manifest failure. No descendants, bots or independent reviewers were launched.

## Checks so far

Preflight npm ci passed (149 added, 155 audited, zero vulnerabilities), storage
typecheck passed and all 97 original tests passed. Manifests/lock were unchanged.
Initial new-source typecheck found one branded-digest comparison, corrected to
compare strings. A fixture typecheck then found an incomplete synthetic evidence
record, corrected to a complete typed record. First focused run: 14/18 passed;
failures were an erased-type graph expectation, an intentionally idempotent input
incorrectly used as a conflict case, and two sweep assertions demanding a readdir
call not made by the commit path. These expectations were corrected without removing
any crash position. The next full run passed 110/112: the two original proposal
crash suites exposed new-engine startup misclassification of old-format intents.
The scanner now leaves the unchanged proposal format to its original owner.

New clean and torn sweeps reach 73 filesystem call positions each, including
readFile/stat; both reach 43 absent and 31 applied observations, with three torn
replay blocks in the torn sweep. Repair is explicit; no automatic repair occurs.
Final candidate results and publication are recorded at delivery.

## Follow-ups and limits

Discovery owner narrows catalog-only consumers before binding the new Pick port.
Design-store owner owns a future persistent index for legacy hashed journal names.
Host successor wires every operation to the gated facade. Existing raw APIs remain
outside that guarantee. Both engine status constants remain OFF. No source integration,
installed-app, power-loss, private-store, or real-send claim is made here.

## Source checkpoint

Storage typecheck and all 113 node tests pass (29 suites; zero skipped, cancelled or todo).
This includes the unchanged 97-test baseline and a regression proving that a staged blob
referenced by an older document remains invisible without committed metadata. Both new
sweeps still reach all 73 filesystem-call positions. The renderer graph excludes the engine
and test-only constructors. This checkpoint precedes full root/host validation.
