// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEditableTarget, modalDialogOpen, resolveShellShortcut, useShellShortcuts, type KeyInput, type ShortcutGuards } from './shortcuts';

const key = (over: Partial<KeyInput> & { key: string }): KeyInput => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, ...over });
const win: ShortcutGuards = { mac: false, modalOpen: false };
const mac: ShortcutGuards = { mac: true, modalOpen: false };

describe('resolveShellShortcut', () => {
  it('maps Ctrl+1..4 to the four domains on Windows and Linux', () => {
    expect(['1', '2', '3', '4'].map(digit => resolveShellShortcut(key({ key: digit, ctrlKey: true }), win))).toEqual([
      { type: 'domain', domain: 'design' }, { type: 'domain', domain: 'social' }, { type: 'domain', domain: 'work' }, { type: 'domain', domain: 'wiki' },
    ]);
    expect(resolveShellShortcut(key({ key: '5', ctrlKey: true }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: '0', ctrlKey: true }), win)).toBeNull();
  });

  it('uses ⌘ on macOS and ignores Ctrl there', () => {
    expect(resolveShellShortcut(key({ key: '3', metaKey: true }), mac)).toEqual({ type: 'domain', domain: 'work' });
    expect(resolveShellShortcut(key({ key: '3', ctrlKey: true }), mac)).toBeNull();
    expect(resolveShellShortcut(key({ key: '3', metaKey: true }), win)).toBeNull();
  });

  it('reads the physical digit key so other keyboard layouts still work', () => {
    expect(resolveShellShortcut(key({ key: '&', code: 'Digit1', ctrlKey: true }), win)).toEqual({ type: 'domain', domain: 'design' });
    expect(resolveShellShortcut(key({ key: '2', code: 'Numpad2', ctrlKey: true }), win)).toEqual({ type: 'domain', domain: 'social' });
  });

  it('opens Settings with Ctrl/⌘+, and the palette with Ctrl/⌘+K', () => {
    expect(resolveShellShortcut(key({ key: ',', ctrlKey: true }), win)).toEqual({ type: 'settings' });
    expect(resolveShellShortcut(key({ key: ',', metaKey: true }), mac)).toEqual({ type: 'settings' });
    expect(resolveShellShortcut(key({ key: 'k', ctrlKey: true }), win)).toEqual({ type: 'palette' });
    expect(resolveShellShortcut(key({ key: 'K', ctrlKey: true }), win)).toEqual({ type: 'palette' });
    expect(resolveShellShortcut(key({ key: 'k', metaKey: true }), mac)).toEqual({ type: 'palette' });
  });

  it('ignores extra modifiers, so Design’s Alt+1…5 and other chords stay Design’s', () => {
    expect(resolveShellShortcut(key({ key: '1', code: 'Digit1', altKey: true }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: '1', ctrlKey: true, altKey: true }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: '1', ctrlKey: true, shiftKey: true }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: 'k', ctrlKey: true, shiftKey: true }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: '\\', ctrlKey: true }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: 'F6' }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: '1' }), win)).toBeNull();
  });

  it('yields to a handled event, an open modal dialog and text composition', () => {
    expect(resolveShellShortcut(key({ key: 'k', ctrlKey: true, defaultPrevented: true }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: '2', ctrlKey: true, defaultPrevented: true }), win)).toBeNull();
    expect(resolveShellShortcut(key({ key: 'k', ctrlKey: true }), { ...win, modalOpen: true })).toBeNull();
    expect(resolveShellShortcut(key({ key: ',', ctrlKey: true }), { ...win, modalOpen: true })).toBeNull();
    expect(resolveShellShortcut(key({ key: '1', ctrlKey: true, isComposing: true }), win)).toBeNull();
  });

  describe('Back', () => {
    const back = key({ key: 'ArrowLeft', altKey: true });
    it('is Alt+← on Windows and Linux, only while the pill is shown', () => {
      expect(resolveShellShortcut(back, { ...win, backAvailable: true })).toEqual({ type: 'back' });
      expect(resolveShellShortcut(back, win)).toBeNull();
      expect(resolveShellShortcut(key({ key: 'ArrowLeft' }), { ...win, backAvailable: true })).toBeNull();
      expect(resolveShellShortcut(key({ key: 'ArrowRight', altKey: true }), { ...win, backAvailable: true })).toBeNull();
    });
    it('is ⌘[ on macOS, and Alt+← does nothing there', () => {
      expect(resolveShellShortcut(key({ key: '[', metaKey: true }), { ...mac, backAvailable: true })).toEqual({ type: 'back' });
      expect(resolveShellShortcut(key({ key: '[', metaKey: true }), mac)).toBeNull();
      expect(resolveShellShortcut(back, { ...mac, backAvailable: true })).toBeNull();
      expect(resolveShellShortcut(key({ key: '[', ctrlKey: true }), { ...win, backAvailable: true })).toBeNull();
    });
    it('is not triggered by a handled event, a dialog or an editable field', () => {
      const guards = { ...win, backAvailable: true };
      expect(resolveShellShortcut({ ...back, defaultPrevented: true }, guards)).toBeNull();
      expect(resolveShellShortcut(back, { ...guards, modalOpen: true })).toBeNull();
      expect(resolveShellShortcut(back, { ...guards, editable: true })).toBeNull();
      expect(resolveShellShortcut(key({ key: '[', metaKey: true }), { ...mac, backAvailable: true, editable: true })).toBeNull();
    });
  });
});

describe('DOM helpers', () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ''; });
  it('recognises editable targets', () => {
    document.body.innerHTML = '<input id="a"><textarea id="b"></textarea><select id="c"></select><div id="d" contenteditable="true"><span id="e"></span></div><div id="f" contenteditable="false"></div><button id="g"></button>';
    const el = (id: string) => document.getElementById(id);
    expect(['a', 'b', 'c', 'd', 'e'].map(id => isEditableTarget(el(id)))).toEqual([true, true, true, true, true]);
    expect(['f', 'g'].map(id => isEditableTarget(el(id)))).toEqual([false, false]);
    expect(isEditableTarget(null)).toBe(false);
  });
  it('sees an open aria-modal dialog', () => {
    expect(modalDialogOpen()).toBe(false);
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(modalDialogOpen()).toBe(true);
    document.body.innerHTML = '<div role="dialog" aria-modal="false"></div><div role="region"></div>';
    expect(modalDialogOpen()).toBe(false);
  });
});

describe('useShellShortcuts', () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ''; });
  const mount = () => {
    const handlers = { switchDomain: vi.fn(), openSettings: vi.fn() };
    function Probe() { useShellShortcuts(handlers); return <input aria-label="Field" />; }
    const view = render(<Probe />);
    return { handlers, input: view.getByLabelText('Field'), view };
  };
  const press = (target: Element | Window, init: KeyboardEventInit) => fireEvent.keyDown(target, init);

  it('switches domain with Ctrl+1..4 and opens Settings with Ctrl+, and prevents the default action', () => {
    const { handlers } = mount();
    expect(press(document.body, { key: '3', ctrlKey: true })).toBe(false);
    expect(handlers.switchDomain).toHaveBeenCalledExactlyOnceWith('work');
    press(document.body, { key: '4', ctrlKey: true });
    expect(handlers.switchDomain).toHaveBeenLastCalledWith('wiki');
    press(document.body, { key: ',', ctrlKey: true });
    expect(handlers.openSettings).toHaveBeenCalledOnce();
  });

  it('still works from a text field, where these chords type nothing', () => {
    const { handlers, input } = mount();
    press(input, { key: '2', ctrlKey: true });
    expect(handlers.switchDomain).toHaveBeenCalledExactlyOnceWith('social');
  });

  it('does nothing for Alt+digits, a handled event or while a modal dialog is open', () => {
    const { handlers } = mount();
    press(document.body, { key: '1', code: 'Digit1', altKey: true });
    document.addEventListener('keydown', handledByModule, { once: true });
    function handledByModule(event: KeyboardEvent) { event.preventDefault(); }
    press(document.body, { key: '2', ctrlKey: true });
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"></div>');
    press(document.body, { key: '3', ctrlKey: true });
    press(document.body, { key: ',', ctrlKey: true });
    expect(handlers.switchDomain).not.toHaveBeenCalled();
    expect(handlers.openSettings).not.toHaveBeenCalled();
  });

  it('stops listening on unmount and always calls the latest handlers', () => {
    const first = { switchDomain: vi.fn(), openSettings: vi.fn() };
    const second = { switchDomain: vi.fn(), openSettings: vi.fn() };
    function Probe({ handlers }: { handlers: typeof first }) { useShellShortcuts(handlers); return null; }
    const view = render(<Probe handlers={first} />);
    view.rerender(<Probe handlers={second} />);
    press(document.body, { key: '1', ctrlKey: true });
    expect(first.switchDomain).not.toHaveBeenCalled();
    expect(second.switchDomain).toHaveBeenCalledExactlyOnceWith('design');
    view.unmount();
    press(document.body, { key: '1', ctrlKey: true });
    expect(second.switchDomain).toHaveBeenCalledOnce();
  });
});
