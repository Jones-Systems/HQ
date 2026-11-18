# Settings → Updates

Purpose: show the installed HQ identity, prepare an update without closing the current session, and accept one exact verified candidate for installation on the next launch.

## Entry points and ownership

- Rail → Settings → Updates. The category lives in [`ServiceSettings.tsx`](../../apps/desktop/src/ServiceSettings.tsx); the view lives in [`settings/Updates.tsx`](../../apps/desktop/src/settings/Updates.tsx).
- Existing Settings entry points can reach Updates by choosing its category. There is no Updates-specific deep link or `hq-open-settings` event target.
- Back returns to the domain that opened Settings. Selecting another category or closing Settings removes the Updates subscription; it does not cancel a native download or scheduled installation.
- The frozen `window.hqUpdates` bridge implements [`UpdatesPort`](../../packages/contracts/src/updates.ts). Settings reads and subscribes to status; it never calls the shell health acknowledgement. Native status and actions belong to the desktop updater.

## States and actions

Installed identity shows version, full source revision when recorded, channel and last-check time. Missing source identity is explicit. Dates include the Eastern time-zone abbreviation. The channel is displayed, not editable.

| State | Visible behavior |
| --- | --- |
| Loading | Loading status; no update action before status arrives |
| Never checked / no candidate | Manual Check for updates; no invented current-version guarantee |
| Checking | Busy check control; current work continues |
| Available | Candidate version, source, size and publication time; Download update passes that candidate ID |
| Downloading | Accessible progress and byte counts; Cancel download remains available while the start request is pending |
| Verifying | Indeterminate verification progress; download is not presented as install-ready |
| Ready | Install on next launch accepts the displayed exact candidate; copy explains that the current session stays open |
| Scheduled | Pending next-launch installation and Cancel scheduled installation |
| Stale consent | Rejection explains that the candidate changed; another explicit action is required for the new candidate |
| Error / recovery hold | Host error and recovery state; a hold does not expose an install action |
| Unconfirmed request result | Further actions wait for Refresh update status or a fresh native status notification; no mutation is retried automatically |
| Unsupported installation | Installed identity and reason remain visible; controls are disabled |
| Missing bridge | Explicit browser/development unavailable state; no fake version or install controls |

Automatic checks and background downloads are separate visible preferences. Each change sends the complete preference pair and keeps the host-confirmed values. A download never grants installation consent. The view exposes no feed URL, filesystem path, shell command, provider control, quit or restart action. Before scheduling, it explains that an ad-hoc signed macOS update may prompt for Keychain access again; it does not promise credential continuity.

## Layout and shared consumers

The view reuses the existing Settings page, categories, scroll owner, 720px content limit, group surfaces, row spacing, shared [`Button`](../../packages/hq-ui/src/components/Button.tsx) and `--hq-*` typography/color tokens. Shared Settings styles also serve Data sources and [Appearance](settings-appearance.md). No shared component or token changes are part of this view.

[`updates.css`](../../apps/desktop/src/settings/updates.css) keeps long source revisions inside their metadata column, wraps actions and preserves the parent-owned gutters. Metadata labels stack below a 360px content width. Existing Settings navigation and row transitions remain at their existing 600px and 480px container widths. Browser inspection covered 1280×800 and 760×800 CSS viewports without page-level horizontal overflow; text-spacing and enlarged-text reflow remain unverified.

## Reproduction and cleanup

From the repository root with the committed dependencies installed, the focused synthetic checks are:

```sh
npx vitest run --project dom apps/desktop/src/settings/Updates.test.tsx apps/desktop/src/ServiceSettings.test.tsx
```

The modules are included by the existing `dom` Vitest project, the `hq-updates-ui` affected-check group and the broader `hq-root-build` group. They use in-memory typed ports, deferred promises and status notifications. React cleanup unmounts each view and restores any test-owned window bridge; no account, profile, package cache, filesystem scratch or network connection is used by these fixtures.

For the real browser fallback, start the repository's renderer script from the root in an owned session:

```sh
npm run dev:web -- --host 127.0.0.1 --port 5173 --strictPort
```

After Vite reports ready, use an isolated empty browser context at its reported URL. Open Rail → Settings → Updates and expect the missing-bridge state. Return to Appearance and Data sources, then close Settings. Stop only the server and browser context created for this check. Do not clear an existing browser profile or shared storage. This recipe cannot exercise the native update bridge.

For the synthetic candidate journey, the tests begin with an available candidate, invoke Download update with its exact ID, emit progress, cancel, then separately begin from a verified ready candidate and schedule/cancel next-launch installation. A replacement candidate rejects stale consent until another explicit selection. The tests also cover failed status reads, rejected preferences, recovery holds, late responses, bridge replacement and subscription cleanup.

## Evidence boundaries

Source discovery is complete for the category and the listed entry points. The 13 focused Updates tests passed on October 22, 2026, with the integration owner's exact source and command evidence in the work record. An isolated incognito T3 Browser tab displayed the missing-bridge state, then exercised an injected in-memory port through available → ready → scheduled → ready. Download and scheduling each received the displayed candidate ID once; cancellation returned the ready state. Captures were visually inspected in the light system appearance at both viewport sizes above. The temporary Vite process exited and the owned tab was closed.

Browser evidence used a dirty candidate based on `3b5b636a672627f103334b2b7a0ea588e4bbf384`. `Updates.tsx` SHA-256 was `de32021dfe187fd089e62063b6adc4b6983a57253a708b4033b6cc5e277ff356`; the browser and server returned identical raw-module bytes with SHA-256 `ce3f46b6f3a3f9199cb60d598ee88f9b2d2accd7d733e4b73ac40e3a3a2bdfff`. This establishes the inspected view's source correspondence, not a packaged-build attestation. Screenshot scaling was not independently measured.

Keyboard and text-enlargement/reflow checks, installed Electron navigation, macOS package verification, next-launch activation, native recovery and Keychain behavior remain **unverified** here. Browser state used a synthetic port and did not test real downloads, persistence, installation or a private profile. The native package harness is separate from this renderer evidence.
