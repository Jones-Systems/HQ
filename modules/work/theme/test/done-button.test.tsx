// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoneButton } from '..';

afterEach(cleanup);

describe('DoneButton', () => {
  it('is a named button that calls onDone once per activation and never reaches the row', () => {
    const onDone = vi.fn();
    const onRowClick = vi.fn();
    const onRowPointerDown = vi.fn();
    render(
      <div onClick={onRowClick} onPointerDown={onRowPointerDown}>
        <DoneButton label="Mark “Renew the library card” done" onDone={onDone} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Mark “Renew the library card” done' });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('data-checked')).toBe('true');
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowPointerDown).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const onDone = vi.fn();
    render(<DoneButton label="Mark done" onDone={onDone} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(onDone).not.toHaveBeenCalled();
  });
});
