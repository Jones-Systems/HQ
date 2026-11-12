# F7-B2 first-run welcome: real-app captures

Artifact Type: evidence-index
Purpose: Screenshots of the Getting started panel in the real Electron app, for the F7-B2 pull request.

Captured from the production renderer and preload under Xvfb, driven over CDP. The build was F7-B2 commit `83cad99`
plus one evidence-only commit that mounts the panel in `PresentationShell.tsx`, because the shell mount belongs to F1. Fresh disposable profiles, synthetic
data only. 1280×820 unless noted. The capture host aliases the generic sans-serif to Liberation Sans; F1's font token
change makes the app itself resolve a proportional face.

| File | State |
| --- | --- |
| `01-first-launch-light.png`, `02-first-launch-dark.png` | New profile, no services, no Wiki: the card opens over Design › Projects. |
| `03-collapsed-pill-light.png`, `04-collapsed-pill-dark.png` | Collapsed to the pill at the bottom-left, clear of the rail and footer. |
| `05-look-around-social-overview.png` | "Take a look around" navigated to Social › Overview; the card stays open and non-blocking. |
| `06-step-just-done-work-board.png` | Work board visited: the step is ticked and washes with the accent; progress reads 1 of 5. |
| `07-connect-work-opens-settings.png` | "Connect Work (Planner)" opens Settings › Data sources with Work targeted; the card is hidden while Settings is open. |
| `08-hide-toast-with-undo.png` | Hide: the confirmation toast with Undo, bottom-right. |
| `09-after-restart-stays-hidden.png` | After a full app restart on the same profile the card stays hidden. |
| `10-reopened-via-show-welcome.png` | `hq-show-welcome` reopens it and moves focus to its heading. |
| `11-reduced-motion-collapsed.png` | `prefers-reduced-motion: reduce`: collapse is instant, with no animation running. |
| `12-narrow-760x560-pill.png`, `13-narrow-760x560-opened.png` | Minimum window: the workspace is 594 px, so it rests as the pill; opened on request it scrolls inside its own height. |
| `14-unreachable-before-recheck.png`, `15-unreachable-notice.png` | Social and Work configured at a closed loopback port: "Set up · not checked", then "Unreachable" after the rail's recheck, with an inline notice and the steps left open. |
