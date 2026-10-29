import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Button, Dialog, IconButton, Menu, Splitter, SAVE_STATES, SaveIndicator, STATUS_TONES, StateView, StatusChip, Tabs, Toast, ToastRegion, TOAST_AUTO_DISMISS_MS, VIEW_STATES,
} from '../src';

// Happy-dom has no layout or colour engine: these prove roles, names and keyboard paths in each chrome scheme.
// Pixels, computed colours and focus-ring rendering are proved in a browser (docs/evidence/hq-social-work/ui/).
describe.each(['light', 'dark'] as const)('primitives in %s chrome', (theme) => {
  beforeEach(() => { document.documentElement.dataset.theme = theme; });
  afterEach(() => { cleanup(); delete document.documentElement.dataset.theme; });

  it('Button activates with Enter and Space, stays focusable but inert while busy, and never submits', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<form onSubmit={() => { throw new Error('submitted'); }}><Button variant="primary" onClick={onClick}>Capture</Button></form>);
    const button = screen.getByRole('button', { name: 'Capture' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toBe('hq-btn hq-btn--primary');
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);

    rerender(<form><Button variant="primary" busy busyLabel="Saving" onClick={onClick}>Capture</Button></form>);
    const busy = screen.getByRole('button', { name: 'Saving' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(busy);
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('IconButton is named by its label, not its icon, and exposes toggle state', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="Pin board" pressed={false} onClick={onClick} icon={<svg viewBox="0 0 24 24" />} />);
    const button = screen.getByRole('button', { name: 'Pin board' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('title')).toBe('Pin board');
    expect(button.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('Menu opens from the keyboard, roves focus, skips activation of disabled items and returns focus', async () => {
    const user = userEvent.setup();
    const archive = vi.fn();
    const rename = vi.fn();
    render(<Menu trigger="Card actions" items={[
      { id: 'rename', label: 'Rename', onSelect: rename },
      { id: 'move', label: 'Move to list', onSelect: vi.fn(), disabled: true },
      { id: 'archive', label: 'Archive', onSelect: archive, tone: 'danger' },
    ]} />);
    const trigger = screen.getByRole('button', { name: 'Card actions' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.tab();
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu').getAttribute('aria-labelledby')).toBe(trigger.id);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1]);

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    expect(items[1]!.getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[2]);
    await user.keyboard('{Home}r');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[2]);
    await user.keyboard(' ');
    expect(archive).toHaveBeenCalledOnce();
    expect(rename).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Dialog moves focus in, traps Tab both ways, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <Button onClick={() => setOpen(true)}>Delete board</Button>
        <Dialog open={open} onClose={() => setOpen(false)} role="alertdialog" title="Delete this board?"
          description="Cards stay in the Planner; only this board view is removed."
          actions={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" onClick={onConfirm}>Delete</Button></>} />
      </>;
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Delete board' });
    await user.tab();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this board?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const remove = screen.getByRole('button', { name: 'Delete' });
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(remove);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(remove);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape inside a Menu in a Dialog closes only the menu', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Card">
      <Menu trigger="Card actions" items={[{ id: 'rename', label: 'Rename', onSelect: vi.fn() }]} />
    </Dialog>);
    const trigger = screen.getByRole('button', { name: 'Card actions' });
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Dialog keeps focus inside when the scrim is clicked and dismissOnScrim is off', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Unsaved" dismissOnScrim={false} actions={<Button onClick={vi.fn()}>Keep editing</Button>} />);
    const keep = screen.getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keep);
    await user.click(document.querySelector('.hq-dialog-scrim')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(keep);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Dialog Tab wrap skips tabindex="-1" elements and elements in hidden ancestors', async () => {
    const user = userEvent.setup();
    const actions = (hiddenPanel: boolean) => <>
      <Button>Apply</Button>
      <Button>Cancel</Button>
      <Button tabIndex={-1}>Roving</Button>
      {hiddenPanel && <div hidden><Button>Hidden panel action</Button></div>}
    </>;
    for (const hiddenPanel of [false, true]) {
      const { unmount } = render(<Dialog open onClose={vi.fn()} title="Filters" actions={actions(hiddenPanel)} />);
      const apply = screen.getByRole('button', { name: 'Apply' });
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(document.activeElement).toBe(apply);
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(cancel);
      await user.tab();
      expect(document.activeElement).toBe(apply);
      unmount();
    }
  });

  it('Dialog restores focus to the opener when a child uses autoFocus', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <Button onClick={() => setOpen(true)}>Rename</Button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Rename card">
          <input aria-label="Card name" autoFocus />
        </Dialog>
      </>;
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Rename' });
    await user.tab();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Card name' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Toast announces politely, offers Undo by keyboard and dismisses with Escape', async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    const dismiss = vi.fn();
    render(<ToastRegion label="Notifications">
      <Toast message="Moved “Write menu card copy” to Active" meta="Planning change only · no run started"
        action={{ label: 'Undo', onAction: undo }} onDismiss={dismiss} />
    </ToastRegion>);
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy();
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    // role="status" implies aria-atomic="true"; each new toast must be read alone, not the whole stack again.
    expect(live.getAttribute('aria-atomic')).toBe('false');
    expect(live.textContent).toContain('Planning change only · no run started');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }));
    await user.keyboard('{Enter}');
    expect(undo).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    expect(dismiss).toHaveBeenCalledOnce();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss' }));
  });

  it('Tabs keep one tab stop, move with arrows and Home/End, and select automatically or manually', async () => {
    const user = userEvent.setup();
    const tabs = [
      { id: 'board', label: 'Board', panel: <p>Board panel</p> },
      { id: 'list', label: 'List', panel: <p>List panel</p> },
      { id: 'review', label: 'Review', panel: <p>Review panel</p> },
    ];
    const { unmount } = render(<Tabs label="Work views" tabs={tabs} />);
    const [board, list, review] = screen.getAllByRole('tab');
    expect(screen.getByRole('tablist', { name: 'Work views' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    await user.tab();
    expect(document.activeElement).toBe(board);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(list);
    expect(list!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'List' }).textContent).toBe('List panel');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(review);
    await user.keyboard('{Home}');
    expect(board!.getAttribute('aria-selected')).toBe('true');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tabpanel', { name: 'Board' }));
    unmount();

    const onSelectedChange = vi.fn();
    render(<Tabs label="Manual" tabs={tabs} activation="manual" onSelectedChange={onSelectedChange} />);
    const manual = screen.getAllByRole('tab');
    await user.tab();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(manual[2]);
    expect(manual[2]!.tabIndex).toBe(0);
    expect(manual[0]!.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Enter}');
    expect(manual[2]!.getAttribute('aria-selected')).toBe('true');
    expect(onSelectedChange).toHaveBeenCalledWith('review');
  });

  it('StatusChip always shows its word, with a distinct shape per tone', () => {
    render(<>{STATUS_TONES.map((tone) => <StatusChip key={tone} tone={tone} label={`Word ${tone}`} detail="observed 2 min ago" />)}</>);
    for (const tone of STATUS_TONES) {
      const chip = screen.getByText(`Word ${tone}`).closest('.hq-status')!;
      expect(chip.className).toContain(`hq-status--${tone}`);
      expect(chip.querySelector('.hq-status-shape')!.getAttribute('aria-hidden')).toBe('true');
    }
    expect(() => render(<StatusChip tone="success" label="  " />)).toThrow(/visible status word/);
  });

  it('SaveIndicator words every state and offers only Retry (failed) or Check (unknown)', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const check = vi.fn();
    const words: Record<string, string> = {
      saved: 'Saved 14:02', saving: 'Saving…', unsaved: 'Unsaved changes', failed: 'Not saved',
      offline: 'Offline · kept on this device', unknown: 'Save result unknown',
    };
    render(<>{SAVE_STATES.map((state) => <SaveIndicator key={state} state={state} savedAt="14:02" onRetry={retry} onCheck={check} />)}</>);
    const statuses = screen.getAllByRole('status').map((node) => node.textContent);
    expect(statuses).toEqual(SAVE_STATES.map((state) => words[state]));
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Retry', 'Check']);
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard(' ');
    expect(retry).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledOnce();
  });

  it('StateView renders every panel state with a title, and loading as busy', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<>{VIEW_STATES.map((state) => <StateView key={state} state={state} title={`Title ${state}`} description="Nothing was changed." action={{ label: `Act ${state}`, onAction: action }} />)}</>);
    for (const state of VIEW_STATES) expect(screen.getByText(`Title ${state}`)).toBeTruthy();
    expect(document.querySelector('[data-state="loading"]')!.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Title error');
    expect(screen.queryByRole('button', { name: 'Act loading' })).toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Act empty' }));
    await user.keyboard('{Enter}');
    expect(action).toHaveBeenCalledOnce();
  });
});


describe('resizable panel separator', () => {
  afterEach(cleanup);
  it.each(['start', 'end'] as const)('resizes a %s-side panel with arrows and supports full collapse, restore and bounds', async side => {
    const toggle = vi.fn();
    function Panel() {
      const [size, setSize] = useState(120);
      return <Splitter label="Panel width" side={side} value={size} min={0} max={280} onResize={setSize} onToggle={toggle} />;
    }
    render(<Panel />);
    const separator = screen.getByRole('separator', { name: 'Panel width' });
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    separator.focus();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe(side === 'start' ? '128' : '112');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('120');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('0');
    expect(document.activeElement).toBe(separator);
    fireEvent.keyDown(separator, { key: side === 'start' ? 'ArrowLeft' : 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator.getAttribute('aria-valuenow')).toBe('280');
    fireEvent.keyDown(separator, { key: 'Enter' });
    fireEvent.doubleClick(separator);
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it.each(['start', 'end'] as const)('captures a pointer for %s-side drag, ignores other pointers and releases on cancel/unmount', side => {
    const resize = vi.fn();
    const view = render(<Splitter label="Drag panel" side={side} value={0} min={0} max={280} onResize={resize} />);
    const separator = screen.getByRole('separator', { name: 'Drag panel' });
    let captured: number | null = null;
    separator.setPointerCapture = vi.fn(id => { captured = id; });
    separator.hasPointerCapture = vi.fn(id => captured === id);
    separator.releasePointerCapture = vi.fn(() => { captured = null; });
    fireEvent.pointerDown(separator, { pointerId: 1, button: 0, clientX: 200 });
    expect(separator.setPointerCapture).toHaveBeenCalledWith(1);
    expect(document.activeElement).toBe(separator);
    fireEvent.pointerMove(separator, { pointerId: 2, clientX: 240 });
    expect(resize).not.toHaveBeenCalled();
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: side === 'start' ? 240 : 160 });
    expect(resize).toHaveBeenLastCalledWith(40);
    fireEvent.pointerCancel(separator, { pointerId: 1 });
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(1);
    resize.mockClear();
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 280 });
    expect(resize).not.toHaveBeenCalled();
    fireEvent.pointerDown(separator, { pointerId: 3, button: 0, clientX: 200 });
    view.unmount();
    expect(separator.releasePointerCapture).toHaveBeenLastCalledWith(3);
  });
});


describe('selectable menu items', () => {
  afterEach(cleanup);

  it('exposes checked choices and retains mixed-role keyboard navigation and activation', async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    const disabled = vi.fn();
    render(<Menu trigger="Sort" items={[
      { id: 'title', label: 'Title', checked: true, onSelect: vi.fn() },
      { id: 'date', label: 'Date', checked: false, onSelect: choose },
      { id: 'unavailable', label: 'Unavailable', checked: false, disabled: true, onSelect: disabled },
      { id: 'reset', label: 'Reset', onSelect: vi.fn() },
    ]} />);
    const trigger = screen.getByRole('button', { name: 'Sort' });
    await user.click(trigger);
    const [title, date, unavailable] = screen.getAllByRole('menuitemradio');
    expect(title!.getAttribute('aria-checked')).toBe('true');
    expect(date!.getAttribute('aria-checked')).toBe('false');
    expect(title!.querySelector('[aria-hidden="true"]')?.textContent).toBe('✓');
    expect(date!.querySelector('[aria-hidden="true"]')?.textContent).toBe('');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reset' }));
    await user.keyboard('{ArrowUp}{Enter}');
    expect(document.activeElement).toBe(unavailable);
    expect(disabled).not.toHaveBeenCalled();
    await user.keyboard('{Home}d');
    expect(document.activeElement).toBe(date);
    await user.keyboard(' ');
    expect(choose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{ArrowUp}{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Title' }));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });
});

describe('opt-in toast expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it('dismisses at 8000ms, not 7999ms, and does not restart for a new callback identity', () => {
    const original = vi.fn();
    const current = vi.fn();
    const { rerender } = render(<Toast message="Saved" autoDismissMs={TOAST_AUTO_DISMISS_MS} onDismiss={original} />);
    advance(4000);
    rerender(<Toast message="Saved" autoDismissMs={TOAST_AUTO_DISMISS_MS} onDismiss={current} />);
    advance(3999);
    expect(current).not.toHaveBeenCalled();
    advance(1);
    expect(original).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
    advance(8000);
    expect(current).toHaveBeenCalledOnce();
  });

  it.each(['hover', 'focus'] as const)('keeps independent overlapping pauses when %s ends first', first => {
    const dismiss = vi.fn();
    render(<Toast message="Saved" action={{ label: 'Undo', onAction: vi.fn() }} autoDismissMs={8000} onDismiss={dismiss} />);
    const toast = screen.getByText('Saved').closest('.hq-toast')!;
    const undo = screen.getByRole('button', { name: 'Undo' });
    const close = screen.getByRole('button', { name: 'Dismiss' });
    advance(3000);
    fireEvent.mouseEnter(toast);
    fireEvent.focusIn(undo);
    advance(10000);
    fireEvent.focusOut(undo, { relatedTarget: close });
    fireEvent.focusIn(close, { relatedTarget: undo });
    if (first === 'hover') fireEvent.mouseLeave(toast);
    else fireEvent.focusOut(close, { relatedTarget: document.body });
    advance(10000);
    expect(dismiss).not.toHaveBeenCalled();
    if (first === 'hover') fireEvent.focusOut(close, { relatedTarget: document.body });
    else fireEvent.mouseLeave(toast);
    advance(4999);
    expect(dismiss).not.toHaveBeenCalled();
    advance(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('pauses while the document is hidden and resumes only after hover also ends', () => {
    const dismiss = vi.fn();
    const hidden = vi.spyOn(document, 'hidden', 'get');
    render(<Toast message="Saved" autoDismissMs={8000} onDismiss={dismiss} />);
    const toast = screen.getByText('Saved').closest('.hq-toast')!;
    advance(2000);
    hidden.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.mouseEnter(toast);
    advance(20000);
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    advance(20000);
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    advance(5999);
    expect(dismiss).not.toHaveBeenCalled();
    advance(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('waits for visibility when initially hidden', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const dismiss = vi.fn();
    render(<Toast message="Saved" autoDismissMs={8000} onDismiss={dismiss} />);
    advance(10000);
    expect(dismiss).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    advance(7999);
    expect(dismiss).not.toHaveBeenCalled();
    advance(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('starts a full duration for a replacement message and removes timers and visibility listeners on unmount', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const dismiss = vi.fn();
    const { rerender, unmount } = render(<Toast message="First" autoDismissMs={8000} onDismiss={dismiss} />);
    advance(6000);
    rerender(<Toast message="Second" autoDismissMs={8000} onDismiss={dismiss} />);
    advance(7999);
    expect(dismiss).not.toHaveBeenCalled();
    advance(1);
    expect(dismiss).toHaveBeenCalledOnce();
    rerender(<Toast message="Third" autoDismissMs={8000} onDismiss={dismiss} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    for (const [type, listener] of add.mock.calls.filter(([type]) => type === 'visibilitychange')) {
      expect(remove).toHaveBeenCalledWith(type, listener);
    }
    advance(10000);
    fireEvent(document, new Event('visibilitychange'));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('keeps a replacement paused until the existing hover ends', () => {
    const dismiss = vi.fn();
    const { rerender } = render(<Toast message="First" autoDismissMs={8000} onDismiss={dismiss} />);
    const toast = screen.getByText('First').closest('.hq-toast')!;
    fireEvent.mouseEnter(toast);
    rerender(<Toast message="Second" autoDismissMs={8000} onDismiss={dismiss} />);
    advance(10000);
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    advance(7999);
    expect(dismiss).not.toHaveBeenCalled();
    advance(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('persists by default and exposes action shortcuts without changing action or Escape behavior', () => {
    const undo = vi.fn();
    const dismiss = vi.fn();
    render(<Toast message="Saved" action={{ label: 'Undo', onAction: undo, keyshortcuts: 'Control+Z Meta+Z' }} onDismiss={dismiss} />);
    advance(80000);
    expect(dismiss).not.toHaveBeenCalled();
    const action = screen.getByRole('button', { name: 'Undo' });
    expect(action.getAttribute('aria-keyshortcuts')).toBe('Control+Z Meta+Z');
    fireEvent.click(action);
    expect(undo).toHaveBeenCalledOnce();
    fireEvent.keyDown(action, { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
