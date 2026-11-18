/** Platform detection and shortcut labels. Pure apart from `currentPlatformIsMac`, which reads the window once. */

export interface PlatformSignals {
  /** `window.hqDesktop?.platform`. The preload reports `desktop` or `browser`; `darwin` is accepted when a host supplies it. */
  readonly desktop?: string | undefined;
  /** `navigator.userAgentData?.platform`, for example `macOS`. */
  readonly userAgentDataPlatform?: string | undefined;
  /** `navigator.platform`, for example `MacIntel`. */
  readonly platform?: string | undefined;
  readonly userAgent?: string | undefined;
}

const MAC = /mac|iphone|ipad|ipod/iu;

export function isMacPlatform(signals: PlatformSignals): boolean {
  if (signals.desktop === 'darwin') return true;
  const named = signals.userAgentDataPlatform || signals.platform;
  if (named) return MAC.test(named);
  return Boolean(signals.userAgent && /Macintosh|Mac OS X/u.test(signals.userAgent));
}

export function currentPlatformIsMac(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorLike = window.navigator as Navigator & { readonly userAgentData?: { readonly platform?: string } };
  return isMacPlatform({
    desktop: (window.hqDesktop?.platform as string | undefined),
    userAgentDataPlatform: navigatorLike.userAgentData?.platform,
    platform: navigatorLike.platform,
    userAgent: navigatorLike.userAgent,
  });
}

/** A shortcut as data. `mod` is ⌘ on macOS and Ctrl elsewhere. */
export interface Chord {
  readonly mod?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  /** `KeyboardEvent.key` value, lower-case for letters. */
  readonly key: string;
}

export const PALETTE_CHORD: Chord = { mod: true, key: 'k' };
export const SETTINGS_CHORD: Chord = { mod: true, key: ',' };
export const domainChord = (index: number): Chord => ({ mod: true, key: String(index + 1) });
/** Back is ⌘[ on macOS and Alt+← elsewhere. */
export const backChord = (mac: boolean): Chord => (mac ? { mod: true, key: '[' } : { alt: true, key: 'ArrowLeft' });

const KEY_LABELS: Readonly<Record<string, string>> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Enter: '↵' };

/** Key caps for a chord: `['⌘', 'K']` on macOS, `['Ctrl', 'K']` elsewhere. */
export function chordKeys(chord: Chord, mac: boolean): string[] {
  const keys: string[] = [];
  if (chord.mod) keys.push(mac ? '⌘' : 'Ctrl');
  if (chord.alt) keys.push(mac ? '⌥' : 'Alt');
  if (chord.shift) keys.push(mac ? '⇧' : 'Shift');
  keys.push(KEY_LABELS[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return keys;
}

/** Spoken or plain-text form: `Ctrl+K`, `⌘K`. */
export function chordText(chord: Chord, mac: boolean): string {
  const keys = chordKeys(chord, mac);
  return mac ? keys.join('') : keys.join('+');
}
