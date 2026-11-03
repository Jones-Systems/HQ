# Kit evidence page

Fictional-content page that exercises `@hq/ui` under the app's exact CSP (`style-src 'self'`, so no inline style attributes). Build it, then serve the static build over loopback:

```sh
npx vite build --config packages/hq-ui/test/kit/vite.config.ts
npx vite preview --config packages/hq-ui/test/kit/vite.config.ts --port <free port> --strictPort --host 127.0.0.1
```

Query parameters:

| Parameter | Effect |
| --- | --- |
| `theme=light\|dark` | Initial appearance (default follows the OS). |
| `only=wells\|primitives\|motion` | Render one section: preserved content, the original primitives, or **Motion and feedback**. |
| `motion=reduce` | Start with `<html data-hq-motion="reduce">`. |
| `probe` | Cycle Light, Dark and System and write the preserved-content measurements into `#kit-probe`. |

Scripting hooks on `window.hqKit`: `setAppearance('light'|'dark'|'system')`, `setReducedMotion(boolean)`, `toast` (the toast API bound to the kit's store, for example `hqKit.toast.error('…')`) and `probe()`.

**Motion and feedback** has live controls for every `@hq/ui` motion and feedback primitive: toasts (each tone, Undo with `meta`, promise resolve and reject, a folded repeat, a burst of five, Dismiss all), inline notices (banner, bar, busy action, collapse presence), status indicators and field errors, every `Presence` motion, `useListMotion`, `PageTransition` with `navigateWithTransition`, `Skeleton` and the `hq-stagger`, `hq-press`, `hq-lift`, `hq-flash` and `hq-shimmer-text` classes, and an `ErrorBoundary` with a crash button. The header has the Reduced motion switch beside the appearance switch.

Pixels, real animation timing, View Transitions, focus and live-region behaviour need a browser; record them with the build commit and keep captures outside the repository. The Crash button makes React log the caught error to the console; that line is expected.
