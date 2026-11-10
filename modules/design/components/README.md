# Design components and motion (T10 / HQD-09)

Section-owned implementation of `spec.hq-design#task.components.001`. It provides a
runnable component sandbox, a props and variants panel, design tokens with
design-system grouping, a motion study player, and a `CanvasItemProvider`. Writer
cone: `modules/design/components/` only. There are no imports from other Design
sections, and there are no root config, manifest or lock changes.

## Layout

| Path | Layer | Contents |
| --- | --- | --- |
| `src/contract.ts` | contract | Section-local ports and types: branded IDs, sources, variants, tokens, motion, a StoragePort subset, clock, digest, canvas provider. |
| `src/model/` | product-safe | Pure models: RFC 8785 JCS + SHA-256, immutable component revisions, prop specs and variants, tokens and aliases, easing and motion sampling, player reducer, HTML embedding. |
| `src/product/` | product-safe | `buildProductDocument` and the product-safe entry. |
| `src/workspace/` | workspace | `ComponentLibrary` over the injected StoragePort subset; **labelled fakes** (in-memory storage, manual clock). |
| `src/review/` | review | Sandbox `srcdoc` builder, host message channel, isolation probe, canvas provider. |
| `src/tooling/` | tooling | Removability scanner. |
| `ui/` | review UI | React views: `ComponentsWorkspace`, `SandboxFrame`, `PropsPanel`, `TokenBoard`, `MotionPlayer`, plus `components.css`. |
| `samples/` | product | Sample finished product built from one component. |
| `harness/` | review | Lane-local Vite harness (synthetic fixtures, FAKE storage, a stand-in preload global). |
| `tests/`, `ui/render.test.tsx` | checks | Behavioral checks (below). |

Entries: `src/index.ts` (framework-free), `ui/index.ts` (React), and `src/product/index.ts`
(the only entry a finished product may use).

## Behavior

- **Sandbox.** A component runs in `<iframe sandbox="allow-scripts" srcdoc=…>`.
  - The sandbox grants no `allow-same-origin`, so the frame has an opaque origin. It cannot read `window.parent`, `top`, cookies, storage or the parent's preload global, and it gets no Node.
  - The srcdoc carries its own deny-by-default CSP: no network, nested frames, forms, workers or base rewriting.
  - The frame element denies powerful features via `allow` and uses `referrerpolicy="no-referrer"`.
  - The host accepts a message only when all of these hold: it comes from the exact frame window, its origin is `"null"`, it carries the per-document nonce, and it has a known shape (`ready`/`size`/`error`/`probe`).
  - The host only posts sampled motion styles into the frame. Forbidden sandbox tokens throw.
- **Sources and variants.** Component revisions are immutable, write-once and digest-verified on read.
  - Editing creates revision N+1; unchanged content writes nothing.
  - Variant sets are stored separately and bound to one exact source revision. They are never rebound implicitly.
  - Selecting a variant or editing an override changes only the derived `RenderInput` and the panel session key.
- **Tokens.** Typed tokens with `{alias}` resolution. Cycles, missing aliases, type mismatches and dependants are reported, never guessed.
  - Literal values are validated, so token text cannot escape CSS.
  - Grouping is by design-system group, then by type, plus an explicit "Ungrouped" bucket.
  - Samples use token values, independent of HQ chrome appearance.
- **Motion.** `sampleStudy(study, t)` is a pure function of the study and `t`.
  - Easings: linear, cubic-bezier (bounded Newton, then bisection), CSS steps with all four jump positions, and a closed-form damped spring that lands exactly on 1.
  - The player reducer takes an injected clock. Scrub pauses at exactly `t`. Replay restarts from 0. Loop wraps. Ended playback rests on the final frame.
  - Easing edits produce a new draft. Saving creates a new study revision.
- **Canvas provider.** Shape aligned with the T11 flows proposal on HQ issue #1:
  - Members: `key`, `listItems`, `resolveItem` → `{status:'ok'|'missing'}`, `sourceRevision` digest.
  - T10 adds the optional `revision` and `variantId`.
  - Items are bound to exact revisions through explicit project membership, and evidence is `web-sandbox`.
  - `mount(key, host)` renders a framework-neutral frame into a host element.
  - The provider never writes arrangement, source or variant data.
- **Removability.** The scanner walks the static import graph from the sample product and fails if it reaches `src/review/`, `ui/`, `tooling/`, `workspace/`, another section, React, or `@hq/*`. It also checks the built product document for review markers.

## Checks

Run from the repository root (Node 24, TypeScript 7.0.2, after `npm ci`):

```sh
npx tsc -p modules/design/components/tsconfig.json
node --test modules/design/components/tests/*.test.ts
npx vitest run --config modules/design/components/vitest.config.ts
npx vite --config modules/design/components/harness/vite.config.ts   # http://127.0.0.1:5194/ and /shell-csp.html
```

Root `npm test` does not cover `modules/**`.

Node and server-rendered checks prove model behavior and produced markup. They do not prove layout or browser isolation. The harness provides browser evidence only. Electron isolation needs root's typed preview integration.

## Integration notes for root (T1)

1. **Shell CSP and srcdoc.** An `about:srcdoc` document inherits its embedder's CSP. The shell's `script-src 'self'` / `style-src 'self'` therefore also apply inside component frames.
   - Observed in Chromium (harness `shell-csp.html`): `frame-src 'none'` did not stop the srcdoc frames from rendering. Every inline script in them was blocked by the inherited `script-src 'self'`, so no component script, bootstrap or motion ran.
   - Inferred, not observed: the production `style-src 'self'` (without the development `'unsafe-inline'`) would also block component styles.

   The failure is closed, but components are not runnable inside the current shell. Root should pick one of these:
   - serve component frames from a dedicated isolated origin or scheme with its own CSP (this replaces `srcdoc` with `src`);
   - adopt a deliberate shell CSP change for frames.

   This lane does not edit the shell.
2. **Frame navigation.** The sandbox blocks top-level navigation and popups, and the CSP blocks network fetches. A frame can still navigate itself. Root should add an Electron `will-frame-navigate` / `will-navigate` deny for sandbox frames, alongside the existing main-frame guard.
3. **Wiring.**
   - Map the durable StoragePort `workspace` namespace to `ComponentStoragePort`.
   - Pass `performanceClock` and `webCryptoDigest`, or root's promoted JCS implementation.
   - Register `createComponentsCanvasProvider` with canvas.
   - Mount `ComponentsWorkspace` with the resolved appearance, and import `ui/components.css`.
4. **Shared promotions.** Promote these: the branded ID helper, JCS/SHA-256, the `CanvasItemProvider` shape (widening `evidence` to a union such as `'web-approximation' | 'web-sandbox'`), and the StoragePort document subset.
