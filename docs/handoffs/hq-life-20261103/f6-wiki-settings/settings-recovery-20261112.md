# SET-V source recovery, 2026-11-12

Authority effect: none. Source-only checkpoint; behavior is unqualified.

## Inputs and reconciliation

- Shell base: `367cfb2159b85927bd04720c57d809e0970640ed`.
- Retained Settings source: `6b1ab3cf635de9a964573964936aaf524f9b2152`, consumed through an ordinary ancestry merge.
- Accepted recovery amendment: `e9db4f61b0688f3727e4be4e37d00521131fc6f3`.
- Canonical Frontend-Development main resolved and read at `b59d310cae8472ae8ed42d4d8562d08c362379d8`; no private implementation copied.
- Exact branch: `work/hq-recovery-settings-scoped-20261112`; sole writer, implementation-role fallback with codex-v3-builder scope. Explicit Blended Frontier Max, preference revision 11, Sol/high, default tier, no Fast requested.
- Local shared-guidance bridge absent; supplied immutable guidance used without installation.

`merge-tree` reported only `ServiceSettings.tsx`. Resolved by composing the retained category navigation and panels with the shell's unchanged data-source provider. Settings now consumes structured observed reachability labels, tones and timestamp detail, including its check feedback. Added two observation-mapping test cases for the later verifier and isolated the Settings fixture's shared observations on cleanup.

Updates retains the current host port, lifecycle/subscription guards, pending-action serialization, cancellation, candidate-ID consent and unconfirmed-result handling. Retained changes add panel presentation, disabled reasons and toasts; no host, installer or activation source changed. Existing Updates cases remain, with accessible disabled-state assertions and additional feedback cases.

## Files

Changed Settings/appearance components, local styles, helpers and tests; `ServiceSettings.tsx`, `ServiceSettings.test.tsx`, `App.settings.test.tsx`; the three Settings UI maps; retained accepted design and original lane handoff; this receipt. Exact file inventory is the checkpoint's first-parent diff.

Unchanged from shell: `settings/DataSources.tsx`, `preview/composition.test.tsx`, Wiki flow assessment and before-capture tree, Settings after-capture tree. The latter historical assessment/capture trees remain absent from the final tree. No other lane, shared primitive, contract, root configuration or dependency edit.

## Static checks and verification boundary

Static whitespace/conflict-marker, ownership-cone, relative-import existence and excluded-path preimage checks pass. No local TypeScript parser prerequisite was present at the checked task/root/global locations; syntax parsing and typechecking remain unrun. Static source inspection is not compilation or execution evidence.

No tests, builds, installs, servers, browser/native launches or captures ran. All later focused Settings/appearance/App tests, Updates cases, composition tests, root typecheck/build/discovery and assembled-head journeys belong to the admitted serial Mini verifier. No P2-P4 repair was added. Layout, gutters, narrow states, text stress, accessibility, native bridges, light/dark/system and reduced motion remain unverified. No presentation export or gallery completion occurred. No PR, merge into foundation/main or operational action.

## Exact shared hunks requested from SHL

Do not apply these from this lane. In `apps/desktop/src/preview/composition.test.tsx`, replace the old immediate service-configuration assertion after opening Settings with category navigation and unavailable-action assertions:

```diff
   expect(screen.getByRole('region', { name: 'Settings page' })).toBeTruthy();
-  expect(screen.getAllByText('Service configuration is unavailable in this window.')).toHaveLength(2);
+  fireEvent.click(screen.getByRole('button', { name: 'Social & Work' }));
+  expect(screen.getAllByText('Service configuration is unavailable in this window.').length).toBeGreaterThanOrEqual(1);
+  expect(screen.getByRole('button', { name: 'Check connection for Social' }).getAttribute('aria-disabled')).toBe('true');
+  expect(screen.getByRole('button', { name: 'Check connection for Work' }).getAttribute('aria-disabled')).toBe('true');
   expect(window.hqServices).toBeUndefined(); expect(window.hqDesktop).toBeUndefined();
```

In `docs/ui-map/README.md`, add this inventory row beside Appearance:

```markdown
| [Settings data sources](settings-data-sources.md) | Rail → Settings; Sources summary targets; category navigation | Source discovery; recovered candidate tests and UI evidence unverified |
```

SHL also owns the separately assigned Planner-health wording in `settings/DataSources.tsx` and `services/data-source-status.ts`. This capsule requests no additional host or contract hunk.
