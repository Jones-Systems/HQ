# Shell CI failure source checkpoint

Artifact Type: handoff
Artifact ID: handoff.hq-shell-ci-failures
Authority effect: none

Base: `9fc113c2d3ee9b8168f48f5e9f1eea636f143068`.
Branch: `work/hq-recovery-shell-ci-failures-20261112`.
This receipt accompanies the source commit; it claims no passing execution.
No ancestry integration was needed and no merge was performed.

## Evidence and changes

Diagnosis used HQ PR #213 Foundation run `43246977249`, job `131282152643`
(read-only failed log, one download). That run passed typecheck/build and
reported 45 failed / 3436 passed root Vitest cases. Only the assigned failures
are addressed here; UI-kit and Work fixes remain with their owners.

| Failure | Source evidence and correction |
| --- | --- |
| App.shell two banner queries | The shell top bar, onboarding header and module headers appear as unnamed banners in the DOM oracle. Name the shell header `HQ workspace` and query that landmark, retaining all project/location/skip-link checks. The welcome card remains a labelled non-modal section. Module headers are outside this cone; no browser landmark audit is claimed. |
| References Add reference | Social's accepted assessment X13 places serialized records behind Advanced. Open that disclosure inside Draft links and assert expansion before accessing its textbox/button. Current Social action is `Update title`; it still writes both title and sourceRevision. Retain all source-state/Back/target-byte assertions and add exact saveContent counts: one after add, unchanged by navigation, two after update, three after unlink. |
| Palette macOS open | The original default Design stub consumes Ctrl+K and opens its own modal before the macOS chord is tried. Use Work for the platform-only test. Existing separate Design-owned, handled-key and modal guards remain. |
| Palette event open | Direct window dispatch was outside React act. Wrap dispatches in act, including modal-guard cases. |
| Palette result order | The accepted B1 brief requires best-match ranking; match tests explicitly prefer a title starting with the query. Venue floor plan must precede Book the venue. Keep exact order, debounce, query count, kind labels and no-ID checks. |
| Palette Settings close | `order` also fuzzy-matches an appearance command (the failed DOM shows appearance changed to light). Commands precede results by contract. Hover the exact reference option, verify it owns aria-activedescendant, then Enter; preserve Settings-close, target and Back assertions. |
| Palette provider failure | `venue` also matches command keywords, so it is not an empty command query. Use the existing no-command query `zzqx`, assert the throwing provider was called exactly once, and retain empty result/Wiki search behavior. Whole-port rejection still has its separate inline-unavailable test. Production error/fallback policy is unchanged. |
| Search internal IDs | Row ID/action metadata intentionally retains entity identity. Check label fields at the pure seam; add a real CommandPalette DOM test for all three domains' titles/kinds, list text and public active-descendant ID. Internal action-envelope equality remains checked. |
| GettingStarted recheck | The fake Work response lacked the version body required by probePlanner; a 200 alone is incompatible. Return a valid API 2 body with existing replay/HQ-reference/batch capabilities; unavailable still returns a transport failure. Hold the probe promise to assert Checking, retained tick and no announcement, then release and assert timestamped API-aware Reachable and the same tick. |
| Preview two edited-title queries | Board title and detail breadcrumb both render the edited title. Assert the uniquely named board article and the editor value, retaining the rest of both synthetic journeys. |
| Wiki setup alert query | The shared toast viewport intentionally mounts an empty assertive live region. Keep the no-wiki-error check and require every exposed alert to be empty, instead of asserting no alert node exists. Wiki setup navigation and exact method set remain intact. |

Design basis: accepted B1 navigation brief, B2 onboarding UI map and retained
flow assessment, Social assessment X13, current Work card/detail semantics.
Canonical Frontend-Development main resolved and read at
`b59d310cae8472ae8ed42d4d8562d08c362379d8`; no private source was copied.
The HQ shared bridge is absent; supplied immutable guidance was used.

## Static evidence and remaining verification

Whitespace/diff review and an exact changed-path ownership check only.
No TypeScript parser is installed in this checkout; syntax/type qualification
is unrun. No application or test code was executed. No new dependencies,
production motion changes, arbitrary timeouts/retries, skips or removed tests.
All retained test conditions remain except the specifically diagnosed obsolete
or ambiguous oracle seams above. No recorded P2–P4 repairs were undertaken.

The serial Mini verifier must execute the affected App.shell, navigation,
onboarding, references integration, preview composition and Wiki setup tests,
then root required discovery on the assembled head after parent-owned kit,
Work boundary and URL-fixture fixes. Exact-head typecheck/build, native keyboard
ownership, accessibility, light/dark/narrow/reduced-motion layout, gallery and
actual presentation exports remain unverified. The heavy slot was not used.
No PR, foundation/main merge, app launch or operational activation occurred.

## Shared hunks requested

None introduced by this checkpoint. Parent-owned UI-kit, Work and Node URL
fixture changes remain separate and must be assembled before qualification.
The only production hunk here is TopBar's accessible landmark name.
