// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { OPEN_PALETTE_EVENT, SHOW_WELCOME_EVENT } from './commands';
import { TestShell, workProvider } from './test-shell';

const cards = [{ id: 'aa59fe21', title: 'Book the venue' }, { id: 'bb01', title: 'Order sample packs' }, { id: 'cc02', title: 'Venue floor plan' }];

beforeEach(() => {
  // Instant exits keep these tests about behaviour; the motion path has its own test.
  document.documentElement.setAttribute('data-hq-motion', 'reduce');
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; document.documentElement.removeAttribute('data-hq-motion'); document.title = ''; });

const ctrlK = (target: Element = document.body) => fireEvent.keyDown(target, { key: 'k', ctrlKey: true });
const dialog = () => screen.queryByRole('dialog', { name: 'Command palette' });
const combobox = () => screen.getByRole('combobox', { name: 'Search HQ or run a command' }) as HTMLInputElement;
const location = () => screen.getByTestId('location').textContent;
const rail = (name: string) => within(screen.getByRole('navigation', { name: 'Domains' })).getByRole('button', { name });
const type = (value: string) => fireEvent.change(combobox(), { target: { value } });
const activeOption = () => document.getElementById(combobox().getAttribute('aria-activedescendant')!)!;
const keys = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(combobox(), { key, ...init });

describe('opening', () => {
  it.each(['social', 'work', 'wiki'] as const)('opens with Ctrl+K in %s', domain => {
    render(<TestShell initial={{ domain }} />);
    expect(dialog()).toBeNull();
    expect(ctrlK()).toBe(false);
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(combobox());
  });

  it('opens with Ctrl+K in Settings, from the Settings page itself', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('region', { name: 'Settings page' })).toBeTruthy();
    ctrlK(screen.getByRole('region', { name: 'Settings page' }));
    expect(dialog()).not.toBeNull();
  });

  it('opens with ⌘K on macOS and ignores Ctrl+K there', () => {
    render(<TestShell mac initial={{ domain: 'work' }} />);
    ctrlK();
    expect(dialog()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(dialog()).not.toBeNull();
    expect(screen.getAllByText('⌘').length).toBeGreaterThan(0);
  });

  it('opens on the hq-open-command-palette event', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    act(() => { window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); });
    expect(dialog()).not.toBeNull();
    act(() => { window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('does not open over Design’s own palette, which handles Ctrl+K and calls preventDefault', () => {
    render(<TestShell initial={{ domain: 'design' }} />);
    expect(ctrlK(screen.getByLabelText('Design draft'))).toBe(false);
    expect(dialog()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Design palette' })).toBeTruthy();
    // While Design’s dialog is open the shell palette stays shut, from anywhere and via the event.
    ctrlK(rail('Work'));
    act(() => { window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); });
    expect(dialog()).toBeNull();
  });

  it('opens from the rail while Design is showing, because Design only handles keys inside itself', () => {
    render(<TestShell initial={{ domain: 'design' }} />);
    rail('Design').focus();
    ctrlK(rail('Design'));
    expect(dialog()).not.toBeNull();
  });

  it('does not open while another modal dialog is open', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true" aria-label="Other"></div>');
    ctrlK();
    expect(dialog()).toBeNull();
    act(() => { window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); });
    expect(dialog()).toBeNull();
  });

  it('ignores Ctrl+Shift+K and plain K', () => {
    render(<TestShell />);
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(dialog()).toBeNull();
  });
});

describe('accessibility', () => {
  it('is a modal dialog with a combobox that controls a listbox of grouped options', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    const modal = dialog()!;
    expect(modal.getAttribute('aria-modal')).toBe('true');
    const input = combobox();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    const list = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    const groups = within(list).getAllByRole('group');
    expect(groups.length).toBeGreaterThan(2);
    for (const group of groups) expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBeTruthy();
    expect(within(list).getAllByRole('option').filter(option => option.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(activeOption().getAttribute('role')).toBe('option');
    expect(activeOption().getAttribute('aria-selected')).toBe('true');
  });

  it('announces the number of results politely and not the searching state', async () => {
    render(<TestShell initial={{ domain: 'work' }} providers={[workProvider(cards)]} />);
    ctrlK();
    expect(screen.getAllByRole('status').some(node => /\d+ results?/u.test(node.textContent ?? ''))).toBe(true);
    type('venue');
    expect(screen.getByText('Searching…').closest('[aria-hidden="true"]')).not.toBeNull();
    await screen.findByText('Book the venue');
  });

  it('keeps focus inside: Tab stays on the input and focus that escapes is pulled back', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    expect(keys('Tab')).toBe(false);
    expect(document.activeElement).toBe(combobox());
    screen.getByRole('button', { name: 'Settings' }).focus();
    expect(document.activeElement).toBe(combobox());
  });

  it('shows the grouped rows with group labels, current domain sections first and shortcut hints', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    const list = screen.getByRole('listbox');
    const labels = within(list).getAllByRole('group').map(group => group.firstElementChild!.textContent);
    expect(labels).toEqual(['Go to', 'Work', 'Settings', 'Appearance', 'Help']);
    const goWork = within(list).getByRole('option', { name: /^Work/u });
    expect(goWork.textContent).toContain('Current');
    expect(goWork.textContent).toContain('Ctrl');
    expect(within(list).getByRole('option', { name: /Open Settings.*Ctrl/u })).toBeTruthy();
    expect(within(list).queryByRole('option', { name: /Library/u })).toBeNull();
  });
});

describe('closing and focus', () => {
  it('Escape closes and returns focus to the element that had it', () => {
    render(<TestShell initial={{ domain: 'social' }} />);
    const field = screen.getByLabelText('Social draft');
    field.focus();
    ctrlK(field);
    expect(document.activeElement).toBe(combobox());
    expect(keys('Escape')).toBe(false);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('closes on a click on the backdrop, and on Ctrl+K again, restoring focus', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    const settings = screen.getByRole('button', { name: 'Settings' });
    settings.focus();
    ctrlK();
    const layer = dialog()!.parentElement!;
    fireEvent.mouseDown(dialog()!);
    expect(dialog()).not.toBeNull();
    fireEvent.mouseDown(layer);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(settings);
    ctrlK();
    keys('k', { ctrlKey: true });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(settings);
  });

  it('starts fresh each time it opens', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    type('library');
    keys('Escape');
    ctrlK();
    expect(combobox().value).toBe('');
  });

  it('plays an exit motion and then unmounts when motion is allowed, and is instant under reduced motion', async () => {
    document.documentElement.removeAttribute('data-hq-motion');
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    expect(dialog()!.parentElement!.getAttribute('data-hq-presence')).toBe('enter');
    keys('Escape');
    expect(dialog()!.parentElement!.getAttribute('data-hq-presence')).toBe('exit');
    expect(dialog()!.getAttribute('aria-modal')).toBeNull();
    // The exiting dialog no longer counts as modal, so the shortcut reopens it straight away.
    ctrlK();
    expect(dialog()!.parentElement!.getAttribute('data-hq-presence')).toBe('enter');
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    keys('Escape');
    await waitFor(() => expect(dialog()).toBeNull());
    document.documentElement.setAttribute('data-hq-motion', 'reduce');
    ctrlK();
    keys('Escape');
    expect(dialog()).toBeNull();
  });
});

describe('keyboard and mouse', () => {
  it('moves the highlight with arrows (wrapping), Page keys, Home and End', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    const options = screen.getAllByRole('option');
    const at = () => options.indexOf(activeOption());
    expect(at()).toBe(0);
    keys('ArrowDown'); expect(at()).toBe(1);
    keys('ArrowUp'); keys('ArrowUp'); expect(at()).toBe(options.length - 1);
    keys('ArrowDown'); expect(at()).toBe(0);
    keys('PageDown'); expect(at()).toBe(6);
    keys('PageUp'); expect(at()).toBe(0);
    keys('End'); expect(at()).toBe(options.length - 1);
    keys('Home'); expect(at()).toBe(0);
    expect(keys('ArrowDown')).toBe(false);
  });

  it('highlights on hover and runs on click', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    const social = screen.getByRole('option', { name: /^Social/u });
    fireEvent.mouseMove(social);
    expect(social.getAttribute('aria-selected')).toBe('true');
    expect(activeOption()).toBe(social);
    fireEvent.click(social);
    expect(dialog()).toBeNull();
    expect(location()).toBe('social:home');
    expect(rail('Social').getAttribute('aria-current')).toBe('page');
  });

  it('runs the highlighted command on Enter: goes to a section in another domain', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    type('library');
    expect(activeOption().textContent).toContain('Library');
    keys('Enter');
    expect(dialog()).toBeNull();
    expect(location()).toBe('social:library');
    expect(document.title).toBe('Social — HQ');
  });

  it('goes to a section of the current domain and to every domain', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK(); type('calendar'); keys('Enter');
    expect(location()).toBe('work:calendar');
    ctrlK(); type('wiki'); keys('Enter');
    expect(location()).toBe('wiki:home');
    ctrlK(); type('review'); keys('Enter');
    expect(location()).toBe('design:review');
  });

  it('does not run on Enter while an input method is composing', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK(); type('library');
    fireEvent.keyDown(combobox(), { key: 'Enter', isComposing: true });
    expect(location()).toBe('work:home');
    expect(dialog()).not.toBeNull();
  });

  it('shows “No results” for a query nothing answers, and still offers the Wiki search', async () => {
    render(<TestShell initial={{ domain: 'work' }} providers={[workProvider(cards)]} />);
    ctrlK(); type('zzqx');
    await screen.findByText('No results for “zzqx”');
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Search Wiki for “zzqx”']);
  });

  it('says “No results” for a single character nothing matches, and Enter then does nothing', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK(); type('ø');
    expect(screen.getByText('No results for “ø”')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    keys('Enter');
    expect(dialog()).not.toBeNull();
  });
});

describe('settings, appearance and help commands', () => {
  it('opens Settings on the Appearance and Data sources targets', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK(); type('appearance settings'); keys('Enter');
    expect(screen.getByRole('region', { name: 'Settings page' }).getAttribute('data-target')).toBe('appearance');
    expect(document.title).toBe('Settings — HQ');
    ctrlK(); type('data sources'); keys('Enter');
    expect(screen.getByRole('region', { name: 'Settings page' }).getAttribute('data-target')).toBe('null');
    ctrlK(); type('work data'); keys('Enter');
    expect(screen.getByRole('region', { name: 'Settings page' }).getAttribute('data-target')).toBe('work');
  });

  it('sets the appearance', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK(); type('dark'); keys('Enter');
    expect(screen.getByTestId('appearance').textContent).toBe('dark');
    ctrlK(); type('follow system'); keys('Enter');
    expect(screen.getByTestId('appearance').textContent).toBe('system');
    ctrlK(); type('light'); keys('Enter');
    expect(screen.getByTestId('appearance').textContent).toBe('light');
  });

  it('dispatches hq-show-welcome for “Show getting started”', () => {
    const listener = vi.fn();
    window.addEventListener(SHOW_WELCOME_EVENT, listener);
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK(); type('getting started'); keys('Enter');
    expect(listener).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
    window.removeEventListener(SHOW_WELCOME_EVENT, listener);
  });

  it('hands Settings the previously focused element as its opener, not the palette', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    const field = screen.getByLabelText('Work draft');
    field.focus();
    ctrlK(field); type('open settings');
    keys('Enter');
    expect(document.activeElement).toBe(field);
  });
});

describe('search across HQ', () => {
  it('renders titles and kind labels across domains while keeping internal reference IDs out of the list', async () => {
    const results = [
      { domain: 'social' as const, kind: 'draft', entityId: 'd-9', title: 'Autumn blend notes' },
      { domain: 'design' as const, kind: 'project', entityId: 'p-1', title: 'Autumn menu design' },
      { domain: 'work' as const, kind: 'item', entityId: 'abc123', title: 'Autumn tasting card' },
    ].map(value => ({ version: 1 as const, projectId: 'hq-local', ...value,
      returnDestination: { domain: value.domain, destination: 'home' } }));
    render(<CommandPalette domain="social" destinations={{ design: 'home', social: 'home', work: 'home', wiki: 'home' }}
      settingsOpen={false} projectId="hq-local" appearance="system" mac={false}
      references={{ find: vi.fn(async () => results), open: vi.fn() }}
      onNavigate={vi.fn()} onOpenSettings={vi.fn()} onAppearance={vi.fn()} />);
    ctrlK(); type('autumn');
    const list = screen.getByRole('listbox');
    await within(list).findByRole('option', { name: 'Autumn blend notes Social draft' });
    expect(within(list).getByRole('option', { name: 'Autumn menu design Design project' })).toBeTruthy();
    expect(within(list).getByRole('option', { name: 'Autumn tasting card Work card' })).toBeTruthy();
    expect(list.textContent).not.toMatch(/p-1|abc123|d-9/u);
    expect(combobox().getAttribute('aria-activedescendant')).not.toMatch(/p-1|abc123|d-9/u);
  });

  it('searches the reference port after a pause, grouped by domain with plain kind labels and no ids', async () => {
    const find = vi.fn(async (query: string) => cards.filter(card => card.title.toLowerCase().includes(query)).map(card => ({
      version: 1 as const, domain: 'work' as const, projectId: 'hq-local', kind: 'item', entityId: card.id, title: card.title, returnDestination: { domain: 'work' as const, destination: `item/${card.id}` },
    })));
    render(<TestShell initial={{ domain: 'social', destinations: { design: 'home', social: 'library', work: 'home', wiki: 'home' } }} providers={[workProvider(cards, find)]} />);
    ctrlK();
    type('ve');
    type('ven');
    type('venue');
    expect(find).not.toHaveBeenCalled();
    expect(screen.getByText('Searching…')).toBeTruthy();
    const list = screen.getByRole('listbox');
    await within(list).findByRole('option', { name: /Book the venue/u });
    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith('venue', { projectId: 'hq-local', limit: 20 });
    expect(screen.queryByText('Searching…')).toBeNull();
    const group = within(list).getByRole('group', { name: 'In Work' });
    expect(within(group).getAllByRole('option').map(option => option.textContent)).toEqual(['Venue floor planWork card', 'Book the venueWork card']);
    expect(list.textContent).not.toMatch(/aa59fe21|cc02/u);
    expect(within(list).getByRole('option', { name: 'Search Wiki for “venue”' })).toBeTruthy();
  });

  it('opens a result through the reference port with the current location as the way back, and Back returns', async () => {
    render(<TestShell initial={{ domain: 'social', destinations: { design: 'home', social: 'library', work: 'home', wiki: 'home' } }} providers={[workProvider(cards)]} />);
    ctrlK();
    type('floor');
    const result = await screen.findByRole('option', { name: /Venue floor plan/u });
    fireEvent.click(result);
    await waitFor(() => expect(location()).toBe('work:item/cc02'));
    const pill = await screen.findByRole('button', { name: 'Back to Social · Library' });
    expect(document.title).toBe('Work — HQ');
    // The palette lists Back too, and the shortcut goes back.
    ctrlK();
    expect(screen.getByRole('option', { name: /^Back to Social · Library.*Alt/u })).toBeTruthy();
    keys('Escape');
    fireEvent.click(pill);
    expect(location()).toBe('social:library');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Back to/u })).toBeNull());
  });

  it('Back from the palette goes back and restores the earlier location', async () => {
    render(<TestShell initial={{ domain: 'social', destinations: { design: 'home', social: 'calendar', work: 'home', wiki: 'home' } }} providers={[workProvider(cards)]} />);
    ctrlK(); type('sample');
    await screen.findByRole('option', { name: /Order sample packs/u });
    keys('Enter');
    await waitFor(() => expect(location()).toBe('work:item/bb01'));
    ctrlK(); type('back to');
    keys('Enter');
    expect(location()).toBe('social:calendar');
  });

  it('Alt+← goes back after a result opens', async () => {
    // One hosted diagnostic: observers add work and can perturb timing; a pass is not a repair.
    type Row = Readonly<Record<string, string | number | boolean | null>>;
    const rows: Row[] = [];
    let bytes = 0, dropped = 0, closed = false;
    const trace = (row: Row) => {
      if (closed) return;
      const size = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
      // Reserve envelope space; never retain nodes, callbacks or events in JSON rows.
      if (rows.length >= 128 || bytes + size > 30 * 1024) { dropped++; return; }
      rows.push(row); bytes += size;
    };
    const short = (value: string | null | undefined) => value?.slice(0, 160) ?? null;
    const describeElement = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return 'non-element';
      const role = target.getAttribute('role') ?? ({ BUTTON: 'button', INPUT: 'textbox', BODY: 'body', MAIN: 'main' } as Record<string, string>)[target.tagName] ?? target.tagName.toLowerCase();
      return `${role}:${short(target.getAttribute('aria-label') ?? target.textContent) ?? ''}`;
    };
    const callsite = () => (new Error().stack?.split('\n').flatMap(line =>
      line.match(/(?:apps|packages|modules)\/[\w./-]+:\d+:\d+/u) ?? []).slice(0, 4).join(' | ') ?? '').slice(0, 480);
    const ids = new WeakMap<object, number>();
    let nextId = 0;
    const identity = (listener: EventListenerOrEventListenerObject | null) => {
      if (listener === null) return 0;
      let id = ids.get(listener);
      if (id === undefined) { id = ++nextId; ids.set(listener, id); }
      return id;
    };
    const active = new Set<string>();
    const registration = (action: string, args: Parameters<typeof window.addEventListener>) => {
      if (args[0] !== 'keydown') return;
      const capture = typeof args[2] === 'boolean' ? args[2] : args[2]?.capture ?? false;
      const id = identity(args[1]);
      const key = `${id}:${capture}`;
      if (action === 'remove') active.delete(key);
      else if (active.size < 128) active.add(key);
      trace({ phase: `listener.${action}`, id, capture, callsite: callsite() });
    };
    let lastEvent: KeyboardEvent | null = null;
    let arrivals = 0, goBacks = 0, lastFrame: string | null = null;
    const observe = (owner: string) => (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft') return;
      lastEvent = event;
      trace({ phase: 'event', owner, order: ++arrivals, defaultPrevented: event.defaultPrevented,
        target: describeElement(event.target), composing: event.isComposing, alt: event.altKey,
        ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey,
        editable: event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null });
    };
    const windowCapture = observe('window.capture'), documentCapture = observe('document.capture');
    const documentBubble = observe('document.bubble'), windowBubble = observe('window.bubble');
    const snapshot = (phase: string) => {
      const back = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Back to'));
      const hidden = back ? back.closest('[hidden], [aria-hidden="true"]') !== null : null;
      const palette = document.querySelector('[role="dialog"][aria-label="Command palette"]');
      trace({ phase, location: short(screen.queryByTestId('location')?.textContent), backPresent: !!back,
        backVisible: !!back && !hidden, backHidden: hidden, backName: back ? describeElement(back) : null,
        modals: Array.from(document.querySelectorAll('[aria-modal="true"]')).slice(0, 6).map(describeElement).join(' | '),
        modalCount: document.querySelectorAll('[aria-modal="true"]').length,
        palettePresent: !!palette, paletteModal: palette?.getAttribute('aria-modal') ?? null,
        paletteOpen: palette?.getAttribute('aria-modal') === 'true',
        motion: document.documentElement.getAttribute('data-hq-motion'), activeElement: describeElement(document.activeElement),
        eventTarget: lastEvent ? describeElement(lastEvent.target) : null,
        defaultPrevented: lastEvent?.defaultPrevented ?? null, listeners: Array.from(active).join(','), goBacks, lastFrame });
    };
    const originalAdd = window.addEventListener, originalRemove = window.removeEventListener;
    let restoreAdd = () => {}, restoreRemove = () => {};
    // Observation listeners precede fixture listeners; the post-dispatch snapshot reads final cancellation.
    try {
      window.addEventListener('keydown', windowCapture, true);
      document.addEventListener('keydown', documentCapture, true);
      document.addEventListener('keydown', documentBubble);
      window.addEventListener('keydown', windowBubble);
      const addSpy = vi.spyOn(window, 'addEventListener');
      restoreAdd = () => { addSpy.mockRestore(); };
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      restoreRemove = () => { removeSpy.mockRestore(); };
      addSpy.mockImplementation(function (this: Window, ...args: Parameters<typeof originalAdd>) {
        const result = Reflect.apply(originalAdd, this, args);
        registration('add', args);
        return result;
      });
      removeSpy.mockImplementation(function (this: Window, ...args: Parameters<typeof originalRemove>) {
        const result = Reflect.apply(originalRemove, this, args);
        registration('remove', args);
        return result;
      });
      render(<TestShell initial={{ domain: 'social' }} providers={[workProvider(cards)]} trace={row => {
        if (closed) return;
        if (row.phase === 'goBack') { goBacks++; lastFrame = typeof row.frame === 'string' ? row.frame : null; }
        trace(row);
      }} />);
      ctrlK(); type('sample');
      await screen.findByRole('option', { name: /Order sample packs/u });
      keys('Enter');
      snapshot('after-enter');
      await waitFor(() => expect(location()).toBe('work:item/bb01'));
      snapshot('after-destination-wait');
      snapshot('before-alt-left');
      fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
      snapshot('after-alt-left');
      try {
        expect(location()).toBe('social:home');
      } catch (originalError) {
        snapshot('original-assertion-failed');
        try {
          await act(async () => {});
          snapshot('after-failure-empty-act');
        } finally {
          throw originalError;
        }
      }
      snapshot('after-original-assertion');
    } finally {
      closed = true;
      try { restoreAdd(); } finally { restoreRemove(); }
      window.removeEventListener('keydown', windowCapture, true);
      document.removeEventListener('keydown', documentCapture, true);
      document.removeEventListener('keydown', documentBubble);
      window.removeEventListener('keydown', windowBubble);
      console.log('HQ_COMMAND_PALETTE_ALTLEFT_DIAGNOSTIC_V1 ' + JSON.stringify({ rows, dropped,
        limits: '128 rows; 32KiB; observer work may perturb timing; active IDs cover only this scope; registration is not invocation; unresolved without decisive trace' }));
    }
  });

  it('closes Settings when a result opens and Back returns to the domain', async () => {
    render(<TestShell initial={{ domain: 'work' }} providers={[workProvider(cards)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    ctrlK(); type('order');
    const result = await screen.findByRole('option', { name: 'Order sample packs Work card' });
    fireEvent.mouseMove(result);
    expect(activeOption()).toBe(result);
    keys('Enter');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Settings page' })).toBeNull());
    expect(location()).toBe('work:item/bb01');
    expect(screen.getByRole('button', { name: 'Back to Work · Status board' })).toBeTruthy();
  });

  it('opens the Wiki search destination for “Search Wiki for …”', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK(); type('espresso notes');
    keys('Enter');
    expect(location()).toBe('wiki:search?q=espresso%20notes');
  });

  it('a failing provider contributes nothing: the palette says so and keeps offering the Wiki search', async () => {
    const find = vi.fn(async () => { throw new Error('planner down'); });
    const failing = workProvider([], find);
    render(<TestShell initial={{ domain: 'social' }} providers={[failing]} />);
    ctrlK(); type('zzqx');
    await screen.findByText('No results for “zzqx”');
    expect(find).toHaveBeenCalledExactlyOnceWith('zzqx', { projectId: 'hq-local', limit: 20 });
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Search Wiki for “zzqx”']);
  });

  it('shows an inline note without breaking the palette when the whole search rejects', async () => {
    const onNavigate = vi.fn();
    const find = vi.fn().mockRejectedValue(new Error('port down'));
    render(<CommandPalette domain="work" destinations={{ design: 'home', social: 'home', work: 'home', wiki: 'home' }} settingsOpen={false}
      projectId="hq-local" appearance="system" references={{ find, open: vi.fn() }} onNavigate={onNavigate} onOpenSettings={vi.fn()} onAppearance={vi.fn()} mac={false} />);
    ctrlK(); type('venue');
    expect(await screen.findByText('Search is unavailable')).toBeTruthy();
    expect(screen.getByText(/Commands still work/u)).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Search Wiki for “venue”' })).toBeTruthy();
    expect(screen.queryByText(/No results/u)).toBeNull();
    type('calendar'); keys('Enter');
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('work', 'calendar');
  });
});

describe('global shortcuts and title with the palette mounted', () => {
  it('switches domain with Ctrl+2 and keeps the title in step', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    expect(document.title).toBe('Work — HQ');
    expect(fireEvent.keyDown(document.body, { key: '2', ctrlKey: true })).toBe(false);
    expect(location()).toBe('social:home');
    expect(document.title).toBe('Social — HQ');
    fireEvent.keyDown(document.body, { key: ',', ctrlKey: true });
    expect(document.title).toBe('Settings — HQ');
    fireEvent.keyDown(document.body, { key: '4', ctrlKey: true });
    expect(location()).toBe('wiki:home');
    expect(screen.queryByRole('region', { name: 'Settings page' })).toBeNull();
    expect(document.title).toBe('Wiki — HQ');
  });

  it('leaves the shortcuts alone while the palette is open', () => {
    render(<TestShell initial={{ domain: 'work' }} />);
    ctrlK();
    fireEvent.keyDown(combobox(), { key: '2', ctrlKey: true });
    expect(location()).toBe('work:home');
  });

  it('leaves Design’s Alt+digits and Ctrl+K alone', () => {
    render(<TestShell initial={{ domain: 'design' }} />);
    fireEvent.keyDown(screen.getByLabelText('Design draft'), { key: '2', code: 'Digit2', altKey: true });
    expect(location()).toBe('design:home');
  });
});
