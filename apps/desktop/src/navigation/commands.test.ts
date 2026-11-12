// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildCommands, runAction, type CommandContext, type PaletteEffects } from './commands';
import { chordKeys } from './platform';

const context = (over: Partial<CommandContext> = {}): CommandContext => ({ domain: 'work', settingsOpen: false, appearance: 'system', back: null, mac: false, ...over });
const byId = (commands: ReturnType<typeof buildCommands>, id: string) => commands.find(command => command.id === id);

describe('buildCommands', () => {
  it('goes to every domain, with the platform shortcut as a hint', () => {
    const commands = buildCommands(context());
    const keys = (id: string) => chordKeys(byId(commands, id)!.shortcut!, false).join('+');
    expect(['design', 'social', 'work', 'wiki'].map(domain => keys(`go:${domain}`))).toEqual(['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4']);
    expect(byId(commands, 'go:wiki')!.action).toEqual({ type: 'navigate', domain: 'wiki' });
    expect(byId(commands, 'go:work')!.detail).toBe('Current');
    expect(byId(commands, 'go:social')!.detail).toBeUndefined();
  });

  it('does not call a domain current while Settings covers it', () => {
    expect(byId(buildCommands(context({ settingsOpen: true })), 'go:work')!.detail).toBeUndefined();
  });

  it('offers each domain’s sections as navigate commands, shown on an empty query only for the current domain', () => {
    const commands = buildCommands(context());
    const board = byId(commands, 'section:work:board')!;
    expect(board.action).toEqual({ type: 'navigate', domain: 'work', destination: 'board' });
    expect(board.browse).toBe(true);
    expect(byId(commands, 'section:social:library')!.browse).toBe(false);
    expect(byId(commands, 'section:social:library')!.action).toEqual({ type: 'navigate', domain: 'social', destination: 'library' });
    expect(byId(commands, 'section:design:review')!.action).toEqual({ type: 'navigate', domain: 'design', destination: 'review' });
    expect(byId(commands, 'section:wiki:home')).toBeDefined();
  });

  it('opens Settings categories with the shell’s existing targets, leaving Updates out', () => {
    const commands = buildCommands(context());
    expect(byId(commands, 'settings:sources')!.action).toEqual({ type: 'settings', target: null });
    expect(byId(commands, 'settings:appearance')!.action).toEqual({ type: 'settings', target: 'appearance' });
    expect(byId(commands, 'settings:work')!.action).toEqual({ type: 'settings', target: 'work' });
    expect(commands.some(command => /update/iu.test(command.title))).toBe(false);
    expect(chordKeys(byId(commands, 'settings:open')!.shortcut!, true)).toEqual(['⌘', ',']);
  });

  it('switches appearance and marks the current choice', () => {
    const commands = buildCommands(context({ appearance: 'dark' }));
    expect(['light', 'dark', 'system'].map(value => byId(commands, `appearance:${value}`)!.action)).toEqual([
      { type: 'appearance', value: 'light' }, { type: 'appearance', value: 'dark' }, { type: 'appearance', value: 'system' },
    ]);
    expect(byId(commands, 'appearance:dark')!.detail).toBe('Current');
    expect(byId(commands, 'appearance:system')!.title).toBe('Follow system');
  });

  it('adds Back only while a return frame is active, with the platform shortcut', () => {
    expect(byId(buildCommands(context()), 'go:back')).toBeUndefined();
    const back = byId(buildCommands(context({ back: { label: 'Work · Status board' } })), 'go:back')!;
    expect(back.title).toBe('Back to Work · Status board');
    expect(chordKeys(back.shortcut!, false)).toEqual(['Alt', '←']);
    expect(chordKeys(byId(buildCommands(context({ back: { label: 'x' }, mac: true })), 'go:back')!.shortcut!, true)).toEqual(['⌘', '[']);
  });

  it('includes getting started', () => {
    expect(byId(buildCommands(context()), 'help:welcome')!.action).toEqual({ type: 'welcome' });
  });

  it('has unique ids', () => {
    const ids = buildCommands(context({ back: { label: 'x' } })).map(command => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('runAction', () => {
  const effects = (): PaletteEffects => ({ navigate: vi.fn(), openSettings: vi.fn(), setAppearance: vi.fn(), showWelcome: vi.fn(), back: vi.fn(), openReference: vi.fn() });
  it('routes each action to exactly one effect', () => {
    const e = effects();
    runAction({ type: 'navigate', domain: 'social', destination: 'calendar' }, e);
    runAction({ type: 'settings', target: 'appearance' }, e);
    runAction({ type: 'appearance', value: 'dark' }, e);
    runAction({ type: 'welcome' }, e);
    runAction({ type: 'back' }, e);
    expect(e.navigate).toHaveBeenCalledExactlyOnceWith('social', 'calendar');
    expect(e.openSettings).toHaveBeenCalledExactlyOnceWith('appearance');
    expect(e.setAppearance).toHaveBeenCalledExactlyOnceWith('dark');
    expect(e.showWelcome).toHaveBeenCalledOnce();
    expect(e.back).toHaveBeenCalledOnce();
    expect(e.openReference).not.toHaveBeenCalled();
  });
});
