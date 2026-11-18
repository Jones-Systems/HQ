// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnPill } from './ReturnPill';

beforeEach(() => { document.documentElement.setAttribute('data-hq-motion', 'reduce'); });
afterEach(() => { cleanup(); document.body.innerHTML = ''; document.documentElement.removeAttribute('data-hq-motion'); });

const press = (init: KeyboardEventInit, target: Element | Window = document.body) => fireEvent.keyDown(target, init);

describe('ReturnPill', () => {
  it('is a button named “Back to <label>”, with the arrow and shortcut hint hidden from the name', () => {
    render(<ReturnPill label="Work · Status board" onBack={vi.fn()} mac={false} />);
    const pill = screen.getByRole('button', { name: 'Back to Work · Status board' });
    expect(pill.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowLeft');
    expect(pill.textContent).toContain('Alt');
    expect(pill.title).toBe('Back to Work · Status board (Alt+←)');
  });

  it('shows ⌘[ on macOS', () => {
    render(<ReturnPill label="Social" onBack={vi.fn()} mac />);
    const pill = screen.getByRole('button', { name: 'Back to Social' });
    expect(pill.getAttribute('aria-keyshortcuts')).toBe('Meta+[');
    expect(pill.textContent).toContain('⌘');
  });

  it('takes no layout space: the pill sits in a zero-height anchor and is not a full-width bar', () => {
    const { container } = render(<ReturnPill label="Social" onBack={vi.fn()} mac={false} />);
    const anchor = container.querySelector('.hq-return-anchor')!;
    expect(anchor.querySelector('button.hq-return-pill')).not.toBeNull();
    expect(anchor.parentElement).toBe(container);
  });

  it('goes back on click', () => {
    const onBack = vi.fn();
    render(<ReturnPill label="Social" onBack={onBack} mac={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Social' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('goes back on Alt+← and prevents the default action', () => {
    const onBack = vi.fn();
    render(<ReturnPill label="Social" onBack={onBack} mac={false} />);
    expect(press({ key: 'ArrowLeft', altKey: true })).toBe(false);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('goes back on ⌘[ on macOS and ignores Alt+← there', () => {
    const onBack = vi.fn();
    render(<ReturnPill label="Social" onBack={onBack} mac />);
    press({ key: 'ArrowLeft', altKey: true });
    expect(onBack).not.toHaveBeenCalled();
    press({ key: '[', metaKey: true });
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('does not go back when a module already handled the key (Work’s Alt+← on a focused card)', () => {
    const onBack = vi.fn();
    render(<><button aria-label="Card" /><ReturnPill label="Social" onBack={onBack} mac={false} /></>);
    const card = screen.getByRole('button', { name: 'Card' });
    // Work’s card handler runs first and calls preventDefault for Alt+←.
    card.addEventListener('keydown', event => { if (event.altKey && event.key === 'ArrowLeft') event.preventDefault(); });
    expect(press({ key: 'ArrowLeft', altKey: true }, card)).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('does not go back from an editable field or while a dialog is open', () => {
    const onBack = vi.fn();
    render(<><input aria-label="Draft" /><ReturnPill label="Social" onBack={onBack} mac={false} /></>);
    press({ key: 'ArrowLeft', altKey: true }, screen.getByLabelText('Draft'));
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"></div>');
    press({ key: 'ArrowLeft', altKey: true });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('ignores the shortcut and hides the pill while hidden, for example under Settings', () => {
    const onBack = vi.fn();
    const view = render(<ReturnPill label="Social" onBack={onBack} hidden mac={false} />);
    expect(screen.queryByRole('button', { name: 'Back to Social' })).toBeNull();
    press({ key: 'ArrowLeft', altKey: true });
    expect(onBack).not.toHaveBeenCalled();
    view.rerender(<ReturnPill label="Social" onBack={onBack} mac={false} />);
    expect(screen.getByRole('button', { name: 'Back to Social' })).toBeTruthy();
    press({ key: 'ArrowLeft', altKey: true });
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('stops answering the shortcut once the label clears or it unmounts, and uses the latest onBack', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<ReturnPill label="Social" onBack={first} mac={false} />);
    view.rerender(<ReturnPill label="Social" onBack={second} mac={false} />);
    press({ key: 'ArrowLeft', altKey: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    view.rerender(<ReturnPill label={null} onBack={second} mac={false} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Back to/ })).toBeNull());
    press({ key: 'ArrowLeft', altKey: true });
    expect(second).toHaveBeenCalledOnce();
    view.rerender(<ReturnPill label="Work" onBack={second} mac={false} />);
    view.unmount();
    press({ key: 'ArrowLeft', altKey: true });
    expect(second).toHaveBeenCalledOnce();
  });

  it('keeps the old label out of reach while it plays its exit motion', () => {
    document.documentElement.removeAttribute('data-hq-motion');
    const view = render(<ReturnPill label="Social" onBack={vi.fn()} mac={false} />);
    expect(screen.getByRole('button', { name: 'Back to Social' }).getAttribute('data-hq-presence')).toBe('enter');
    view.rerender(<ReturnPill label={null} onBack={vi.fn()} mac={false} />);
    const leaving = view.container.querySelector('button')!;
    expect(leaving.getAttribute('data-hq-presence')).toBe('exit');
    expect(leaving.getAttribute('aria-hidden')).toBe('true');
    expect(leaving.tabIndex).toBe(-1);
    expect(screen.queryByRole('button', { name: 'Back to Social' })).toBeNull();
  });
});
