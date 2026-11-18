/**
 * Shell navigation for HQ: the global command palette, the Back pill, global shortcuts and the window title.
 * Everything here is props-only; the shell owns state and mounts these (see docs/design/hq-cross-app-flow-assessment-20261103).
 */
export { CommandPalette, type CommandPaletteProps } from './CommandPalette';
export { ReturnPill, type ReturnPillProps } from './ReturnPill';
export { useShellShortcuts, resolveShellShortcut, type ShellShortcut, type ShellShortcutHandlers } from './shortcuts';
export { useDocumentTitle, documentTitle, type DocumentTitleState } from './useDocumentTitle';
export { OPEN_PALETTE_EVENT, SHOW_WELCOME_EVENT, type SettingsTarget } from './commands';
export { chordKeys, chordText, currentPlatformIsMac, PALETTE_CHORD, SETTINGS_CHORD, type Chord } from './platform';
export { describeLocation } from './destinations';
