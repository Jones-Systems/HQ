# Settings redesign: after captures (2026-11-03)

Renderer captures of the redesigned Settings ([design](../../hq-settings-design-20261103.md), [ui-map](../../../../ui-map/settings-data-sources.md)). Everything shown is synthetic: invented repositories, galleries, addresses and update versions served by a scratch harness that installs fake `window.hqServices` and `window.hqUpdates` bridges in front of the real HQ renderer. No account, profile, filesystem path, host address or private data is involved.

## How these were made

- Real renderer (`apps/desktop`) under Vite dev, headless Chrome 156, 1280×820 unless noted (narrow shots are 560×820). The harness relaxes only the page's CSP `style-src` for its own tooling; the Settings code itself sets no inline style attributes (asserted by `apps/desktop/src/settings/settings-css.test.ts`).
- `-light` / `-dark` is the emulated operating-system colour scheme with the appearance setting left on System, so both exercise the shipped Warm Graphite dark palette.
- Synthetic states used: services configured or not; a check that fails; a save that is rejected; a Wiki that is ready and stale, not set up, indexing, or refuses a reindex; enrolled project sources; Jones not set up, needing authorization or connected; an update available.
- Frame strips: headless screenshots are slower than the motion, so the strip captures stretch the F1 duration tokens about 15–20× (`--hq-duration-base/slow/fast` set inline) and shoot frames back to back. The reduced-motion strip does **not** stretch anything: it runs with `prefers-reduced-motion: reduce` and the shipped zeroed tokens.
- Limits: not the installed Electron app and not the native bridges. Behaviour with real hosts, real Wiki repositories and real credentials is not shown.

## Categories (light and dark)

| File | What it shows |
| --- | --- |
| `01-overview-{light,dark}.png` | Overview: one status row per source with a plain-word chip, one line of detail and Manage; Recheck all |
| `02-social-work-{light,dark}.png` | Social & Work: service rows with Check connection and Change address; "Set up · not checked" |
| `03-local-wiki-{light,dark}.png` | Local Wiki with BusinessLessons ready and App Development stale; Reindex, Change repository…, Remove… |
| `04-projects-jones-{light,dark}.png` | Projects & Jones top: local folder, gallery, enrolled rows with Refresh and Remove… |
| `04b-projects-jones-lower-{light,dark}.png` | Same category scrolled: Jones connection (Connected), saved environment, projects and threads |
| `05-appearance-{light,dark}.png` | Appearance: Light / Dark / System tiles (System selected, split, "Following your device"), dark palette presets and preview; the colour editor stays collapsed |
| `06-updates-{light,dark}.png` | Updates restyled to the shared rows: installed identity, available update, preferences |

## Disclosure forms

| File | What it shows |
| --- | --- |
| `07-form-address-{light,dark}.png` | "Change Social address" disclosure inside the row; stacked label above the field, help below, focus in the field |
| `08a-form-gallery-{light,dark}.png` | "Enroll a gallery…" disclosure: **Gallery label** and **Gallery base URL** stacked (X16) |
| `08-form-gallery-jones-{light,dark}.png` | Gallery and "Save a connection…" disclosures open together; Jones row shows "Needs authorization" |
| `09-wiki-import-selected-{light,dark}.png` | Wiki with nothing set up after Import source profile…: the selection disclosure (Save source, Choose repository…, Cancel) |
| `10-wiki-remove-confirm-{light,dark}.png` | Remove… opens an inline confirmation (danger "Remove source", Cancel) inside the row |

## Busy, failure and feedback

| File | What it shows |
| --- | --- |
| `11-busy-check-{light,dark}.png` | Check connection running: "Checking" with a spinning icon on the button and a "Checking…" status; every other action in the panel is dimmed and says why |
| `12-busy-save-{light,dark}.png` | Save address running: "Saving" on the submit button, the field read-only, other actions unavailable |
| `13-failure-check-{light,dark}.png` | Failed check: Unreachable status, inline failure bar with Retry on the row, matching toast ("The saved address was kept."), attention marker on the Social & Work category |
| `14-failure-rejected-address-{light,dark}.png` | Rejected address: row bar, field error with the typed value kept, toast stating the previous address was cleared |
| `15-failure-wiki-reindex-{light,dark}.png` | Refused reindex: inline bar and toast that say nothing was changed |
| `16-overview-recheck-attention-{light,dark}.png` | After Recheck all with failing checks: Unreachable chips, attention markers in the navigation and the rail, toast "3 of 3 need attention" |

## Wiki states

| File | What it shows |
| --- | --- |
| `17-wiki-not-set-up-{light,dark}.png` | Setup guide (import, choose, save) and "Set up…" on each repository |
| `18-wiki-indexing-{light,dark}.png` | BusinessLessons indexing: "Indexing" status with a spinner, "Building the search index." (the 2-second poll runs behind this) |

## Appearance

| File | What it shows |
| --- | --- |
| `19-theme-dark-chosen.png` | Dark tile selected on a light operating system: the whole window is dark; the System tile reads "Following your device: Light" |
| `20-customize-colors-open-{light,dark}.png` | "Customize colors" disclosure open (label becomes "Hide colors") with the colour editor and contrast ratios |

## Narrow (560 px; the shell rail keeps its width)

| File | What it shows |
| --- | --- |
| `21-narrow-overview-{light,dark}.png` | Navigation becomes a horizontal row; rows stack and Manage drops under the text |
| `22-narrow-wiki-{light,dark}.png` | Wiki rows stacked at narrow width |
| `23-narrow-appearance-{light,dark}.png` | Theme tiles and palette cards reflow |
| `24-narrow-form.png` | Address disclosure at narrow width: field, help and actions stay in a single column |

## Motion strips (eight frames, light)

| File | What it shows |
| --- | --- |
| `strip-category-change.png` | Overview → Local Wiki: the new content region rises and fades in, the navigation selection swaps (motion stretched about 15×) |
| `strip-theme-switch.png` | Light → Dark from the theme tiles: view-transition crossfade of the whole window (motion stretched about 20×) |
| `strip-reduced-motion-category.png` | Same category change with reduced motion: no entrance animation; content is at full opacity and position from the first frame (frame 1 shows skeleton rows while the Wiki status loads) |
