/** `@hq/ui`: Shared visual-system tokens, the contrast helper and accessible primitives (task.ui-kit.001). */

// Loading the kit loads the tokens and the class-scoped component styles. The tokens declare only `--hq-*`
// custom properties, `color-scheme` on `:root` / `[data-theme]`, and the RS-2 `[data-hq-content]` well rules.
// `tokens/t0-bridge.css` is deliberately not loaded here: it redefines T0 shell names and is the shell owner's.
import './tokens/hq-tokens.css';
import './components/hq-ui.css';
import './references/references.css';

export * from './components';
export * from './contrast';
export * from './tokens';
export { ReferenceChip, type ReferenceChipProps } from './references/ReferenceChip';
export { LinkList, type LinkListProps } from './references/LinkList';
export { LinkPicker, type LinkPickerProps } from './references/LinkPicker';
export { REFERENCE_STATUSES, referenceKey, type ReferenceStatus, type ReferenceResolution, type ReferencePort,
  type ReturnContext, type ReferenceEntry, type ReferenceUndo, type ReferenceSnapshotUpdate } from './references/types';
export { REFERENCE_MAX_AGE_MS } from './references/freshness';

export { TimeGrid, type TimeGridProps } from './calendar/TimeGrid';
export { calendarGridSnap, calendarZonedParts, CALENDAR_HOUR_HEIGHT, layoutCalendarEvents, type CalendarGridEvent, type CalendarGridPosition } from './calendar/geometry';
