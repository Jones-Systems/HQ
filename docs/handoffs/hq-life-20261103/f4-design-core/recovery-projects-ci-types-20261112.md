# Projects CI type repair — source only

Authority effect: none.

Base: `b8f8198b4f1fa000fbd01ffc5ff3a56734ef1222`.
Task branch: `work/hq-recovery-design-projects-ci-types-20261112`.
Recovery amendment read at `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
Frontend guidance current main read at `b59d310cae8472ae8ed42d4d8562d08c362379d8`.
The local shared-guidance bridge is absent; no enrollment was installed.

## Failure and repair

Read the retained Foundation failure for PR #213, run `43244699475`, job
`131274120091`, at the base above. It fails during root typechecking before
renderer build and behavior evidence. Only its Projects diagnostics are selected.

- `detail.ts`: guard the `reason` property on the active-project union before
  rendering the existing unavailable notice. The content/loading branches and
  original reason, title and tone remain intact.
- `forms.ts`: explicitly store the select's DOM value as `string`. Submission
  still resolves a view from `content.views` and passes that view's branded
  `ViewId` to `addVersion`; no cast or identifier fabrication is introduced.
- `gallery.ts`: make `children` optional in the two local wrapper prop types,
  matching React's variadic `createElement` children and the existing optional
  `ReactNode` value. All four call sites retain their children and markup.
- `ui.ts`: annotate `fieldErrorProps` parameters as `string` and `unknown`, as
  specified by the existing `ProjectsUi` interface.

## Static review and verification boundary

`git diff --check` passed. The final source diff was inspected against the
controller union, branded IDs, content contract and local wrapper consumers.
No new assertions, suppression comments, exclusions or shared primitives.
No runtime behavior change is intended, so no behavior tests were changed.
No dependency installation, typecheck, build, test, application launch or capture
was run. A local TypeScript parser was unavailable; no parser was installed.

The serial Mini verifier must run the Projects checks and root typecheck on the
assembled candidate. This checkpoint is not passing CI or behavior evidence.
Layout, accessibility, responsive states, reduced motion, native journeys and
gallery/export completion remain unverified. Existing UI map gaps remain.

## Shared requests and holds

Exact shared hunks requested: **none**. The parent retains the unrelated shell,
Social contract and fixture diagnostics. No root/config/contract changes, PR,
merge or operational effects are part of this checkpoint. Unselected P2–P4
findings and all existing enablement, native, publication and integration holds
remain unchanged.
