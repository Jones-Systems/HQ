# Settings › shell and data-source categories

Purpose: the Settings page itself (header, grouped category navigation, content region) and its four **Data sources** categories: Overview, Social & Work, Local Wiki and Projects & Jones. [Appearance](settings-appearance.md) and [Updates](settings-updates.md) are the **App** group and have their own entries. Design: [HQ Settings design](../design/settings/hq-settings-design-20261103.md); captures: [after-20261103 evidence](../design/settings/evidence/after-20261103/README.md).

## Entry points and ownership

- Rail → Settings; the Manage buttons on the rail's Data sources rows; the set-up links in the Social and Work status banners; and the `hq-open-settings` window event with `detail.source` set to `social`, `work`, `wiki` or `appearance`. The page and its categories live in [`ServiceSettings.tsx`](../../apps/desktop/src/ServiceSettings.tsx); each category is a file under [`settings/`](../../apps/desktop/src/settings).
- Target mapping: `social` and `work` open **Social & Work** with that row outlined and scrolled into view; `wiki` opens **Local Wiki**; `appearance` opens **Appearance**; no target opens **Overview**. Element ids `settings-social`, `settings-work` and `settings-wiki` are kept for those targets.
- Back returns to the domain that opened Settings. Escape closes Settings unless the key came from a text field or select.
- Status comes from the shell's observed data-source store (`useDataSources()` in [`settings/DataSources.tsx`](../../apps/desktop/src/settings/DataSources.tsx), owned by another lane and consumed unchanged). Project-source and Jones status are read locally by [`settings/project-status.ts`](../../apps/desktop/src/settings/project-status.ts).

## Shell

- Header: `Settings` (`h1`, focused when the page opens), the current category as a quiet crumb, and `← Back to <domain>`.
- Navigation (`nav` named Settings categories): two groups, **Data sources** (Overview, Social & Work, Local Wiki, Projects & Jones) and **App** (Appearance, Updates), each button an SVG icon plus a text label; the current one has `aria-current="page"`. A category that needs attention gets a shape marker (never colour alone) and a screen-reader description (`Needs attention`). Arrow Up/Down/Left/Right, Home and End move focus (wrapping); activating a button selects the category.
- Content region: labelled by the category's `h2`. Selecting a category replays the F1 `hq-enter-rise` entrance, resets scroll to the top and moves focus to that `h2`. Below 600px the navigation becomes a horizontal row; below 480px rows stack.
- Motion uses only F1 tokens and honours `prefers-reduced-motion` and `<html data-hq-motion="reduce">`.

## Common behaviour across categories

- **Rows** show icon, name, a plain-word status, one line of detail and the row's actions. Statuses are words ("Ready", "Stale", "Unreachable", "Set up · not checked"), never raw enums; shapes accompany colour.
- **Unavailable actions stay visible.** They are `aria-disabled`, take focus, ignore activation and name their reason (for example "Add an address first.", "Another action is in progress.", "Native Wiki management isn't available in this window.") in a tooltip shown on hover and on keyboard focus, linked with `aria-describedby`.
- **Forms are disclosures inside the row** (`Presence` collapse): a button with `aria-expanded` opens it, focus moves to the first field, Escape closes it and returns focus to the button. Fields are stacked: label above the control, help text below, an inline error tied to the control with `aria-describedby`.
- **Every mutation** runs through one guard (`useSettingsActions` over `useAsyncAction`): a second activation is ignored, the button shows a busy label and `aria-busy`, other mutating buttons say why they wait. Success: a 4-second toast and a one-time `hq-flash` on the changed row. Failure: a persistent toast that says what was kept (with Retry only when repeating is safe, otherwise Check for an unconfirmed result) and an inline notice on the row that stays after the toast is gone.
- First load shows skeleton rows. A full-panel error appears only when the first load failed and nothing has loaded.

## Categories

| Category | What it shows | Notable states |
| --- | --- | --- |
| Overview | One row per source (Social, Work, Local Wiki, Project sources, Jones requests) with a status chip, one line of detail and **Manage**, which opens the category (and row) that fixes it. **Recheck all** checks Social, Work and Local Wiki in turn and refreshes project status. | Skeleton chips while project status loads; toast "Rechecked all data sources" (and "N of 3 need attention"). |
| Social & Work | A row per service: Check connection (one read-only request) and Change address (disclosure with the new base URL). | No address: "Sample data · not set up". Rejected saved address: warning bar. A rejected save keeps the typed value, marks the field invalid and says HQ cleared the previous address. Without the native bridge: panel notice and every action unavailable with the reason. |
| Local Wiki | Setup guide while nothing is set up (import a profile, choose the repository, save); then a row per repository (BusinessLessons, App Development) with Reindex, Change repository… and Remove… (inline confirmation). Heading actions: Import source profile…, Recheck. | While indexing, the status is read every 2 seconds until nothing is indexing, Settings closes, or 2 minutes pass; then "Still indexing · not updating" with Check. A finished run toasts "<name> reindexed". A failed first load shows a full-panel unavailable state with Try again. |
| Projects & Jones | **Project sources:** local projects folder, gallery enrollment (stacked Gallery label / Gallery base URL fields), enrolled rows with Refresh and Remove…. **Jones change requests:** connection (Authorize in browser…, Save a connection…), saved environment, projects and threads, destinations. | Jones actions name what is missing first ("Save a Jones connection first.", "Authorize in your browser first."). A failed read shows a retryable bar and keeps what loaded earlier. |

## Checks

Unit and App journeys: `apps/desktop/src/ServiceSettings.test.tsx` (navigation, targets, Overview routing, feedback, reasons), `settings/WikiPanel.test.tsx` (fake-timer indexing poll, busy, failure, setup guide), `settings/ProjectSources.test.tsx` (stacked fields, disclosure focus, reasons, toasts), `settings/Updates.test.tsx`, `settings/settings-css.test.ts` (token-only styling, CSP-safe source), `App.settings.test.tsx` and `preview/composition.test.tsx`. Native Wiki management, source enrollment, the Jones connection and the installed app remain outside this renderer evidence; the headless captures use a synthetic harness.
