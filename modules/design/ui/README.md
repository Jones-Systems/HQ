# Design chrome (T14 / HQD-13)

Design's own frame inside the HQ shell: the section registry, the sub-navigation
(Projects, Resources, Review, Requests, Runs), resizable sidebar/inspector panels,
the keyboard and focus model, the command palette, chrome theme tokens, state kept
across domain switches, and the `DesignDomain` descriptor handed to the shell.

Status: the chrome is implemented and checked locally, with labelled fake sections
and a fake shell. It has not been integrated into `apps/desktop`; root wires it in.

## Entry points

- `index.ts` (renderer/Vite only): `createProductionDesignDomain(options)` and
  `designRegistry`, built from the glob of `modules/design/*/design-module.ts`.
- `src/domain.tsx`: `createDesignDomain({ registry, storage, shell?, projects?, mac? })`.
- `contract.ts`: section-local ports (`ShellContextPort`, `DesignSectionDescriptor`,
  `DesignSectionProps`, `DesignDomain`, `UiStatePort`). Proposed for promotion on
  issue #1; nothing here is a shared contract yet.
- `src/*.ts`: framework-free models (registry, navigation, panels, focus, palette,
  project guard, theme, session). They run under plain Node 24.

## Adding a section (no registry edit)

Create `modules/design/<id>/design-module.ts` exporting:

```ts
export const designModule: DesignSectionDescriptor<ComponentType<DesignSectionProps>> = {
  schema: 'hq.design.section/v1', id: '<id>', title: 'Canvas', nav: 'review', order: 10,
  commands: [{ id: 'fit', title: 'Reset viewport' }],
  view: async () => (await import('./src/View.tsx')).CanvasView,
};
```

`id` must equal the directory name. Invalid entries are listed in the inspector,
never silently dropped. Duplicate ids reject every claimant. Keep the descriptor
cheap: the view loads lazily on first display.

A suggested placement, for root to confirm: projects and discovery under Projects;
references, components and flows under Resources; canvas, compare, annotations and
taste under Review; requests and imports under Requests; connector under Runs.

## Behaviour

- **Keep-alive.** Chrome state lives in the domain's core, not the React tree, so
  Design→Social→Design restores section state (draft, viewport, selection) whether
  or not the shell keeps the view mounted. `deactivate()` and unmount flush one key,
  `hq.design.ui-session.v1:<projectId>`. Nothing is submitted or sent.
- **Serialize/restore.** `hq.design.ui-session/v1` is strictly validated. Unknown
  section state is preserved. Unreadable or newer stored state is *held*: it is not
  overwritten until the user chooses "Start fresh" in the inspector.
- **Theme.** Shell tokens become `--hqd-*` variables on the chrome root only.
  Sections spread `surface('capture' | 'preview', intended?)` onto any element that
  shows captured bytes or a producer preview. That style takes no appearance input.
- **Project context.** Design never switches project by itself. The palette, a
  section, or a cross-project reference only opens a confirmation prompt (focus
  starts on "Stay"). The shell is asked once, for that exact prompt.
- **Keyboard.** All targets are in the Tab order, in the order `tabStops()` gives.
  Arrows move within the sub-navigation and section lists. F6/Shift+F6 cycle
  regions. Alt+1…5 jump to areas. Mod+K opens the palette. Mod+\ and Mod+Shift+\
  toggle panels. Splitters follow the WAI-ARIA window-splitter pattern. Navigation
  shortcuts are ignored while typing.

## Checks

Take capacity evidence first and serialise with the shared lock.

```sh
node --test modules/design/ui/test/node/*.test.ts                   # models (Node 24)
npx tsc -p modules/design/ui/tsconfig.json                          # TypeScript 7.0.2
npx vitest run --config modules/design/ui/vitest.config.ts          # real glob + React render
npx vite --config modules/design/ui/harness/vite.config.ts          # fake-shell harness, :5191
node modules/design/ui/harness/pixel-evidence.ts light.png dark.png regions.json
```

The Node and vitest checks do not prove browser layout. The harness supplies
runtime evidence in a real browser with a fake shell; it does not prove Electron
or the integrated HQ shell.
