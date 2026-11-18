import { describe, expect, it } from 'vitest';
import { backChord, chordKeys, chordText, domainChord, isMacPlatform, PALETTE_CHORD, SETTINGS_CHORD } from './platform';

describe('isMacPlatform', () => {
  it('trusts a host that reports darwin', () => {
    expect(isMacPlatform({ desktop: 'darwin' })).toBe(true);
  });
  it('falls back to userAgentData, then navigator.platform, then the user agent', () => {
    expect(isMacPlatform({ desktop: 'desktop', userAgentDataPlatform: 'macOS', platform: 'Linux x86_64' })).toBe(true);
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ platform: 'iPad' })).toBe(true);
    expect(isMacPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' })).toBe(true);
  });
  it('is false for Windows, Linux and an unknown host', () => {
    expect(isMacPlatform({ desktop: 'desktop', platform: 'Win32' })).toBe(false);
    expect(isMacPlatform({ userAgentDataPlatform: 'Linux', platform: 'MacIntel' })).toBe(false);
    expect(isMacPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(false);
    expect(isMacPlatform({})).toBe(false);
  });
});

describe('shortcut labels', () => {
  it('shows ⌘ on macOS and Ctrl elsewhere', () => {
    expect(chordKeys(PALETTE_CHORD, true)).toEqual(['⌘', 'K']);
    expect(chordKeys(PALETTE_CHORD, false)).toEqual(['Ctrl', 'K']);
    expect(chordText(PALETTE_CHORD, true)).toBe('⌘K');
    expect(chordText(PALETTE_CHORD, false)).toBe('Ctrl+K');
    expect(chordKeys(domainChord(2), false)).toEqual(['Ctrl', '3']);
    expect(chordKeys(SETTINGS_CHORD, true)).toEqual(['⌘', ',']);
  });
  it('uses ⌘[ for Back on macOS and Alt+← elsewhere', () => {
    expect(chordKeys(backChord(true), true)).toEqual(['⌘', '[']);
    expect(chordKeys(backChord(false), false)).toEqual(['Alt', '←']);
    expect(chordText(backChord(false), false)).toBe('Alt+←');
  });
});
