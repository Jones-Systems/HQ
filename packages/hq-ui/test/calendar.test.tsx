import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeGrid } from '../src/calendar/TimeGrid';
import { calendarClock, type CalendarGridEvent } from '../src/calendar/geometry';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('shared calendar display and pointer coordinates', () => {
  it.each([[0, '12:00 a.m.'], [420, '7:00 a.m.'], [720, '12:00 p.m.'], [840, '2:00 p.m.'], [1425, '11:45 p.m.'], [1440, '12:00 a.m.']] as const)(
    'formats minute %i as %s', (minute, label) => expect(calendarClock(minute)).toBe(label),
  );

  it('shows 12-hour labels and moves vertically in a scrolled grid, saving only on pointer release', () => {
    const event: CalendarGridEvent = { id: 'example', title: 'Example task', day: '2026-10-20', start: 540,
      endDay: '2026-10-20', end: 570, revision: 1 };
    const onChange = vi.fn();
    const { container } = render(<TimeGrid days={['2026-10-20']} events={[event]} zone="UTC" now={new Date('2026-10-20T12:00:00Z')}
      onChange={onChange} onAnnounce={vi.fn()} />);
    expect(screen.getByText('7:00 a.m.')).toBeTruthy();
    expect(screen.getByText('2:00 p.m.')).toBeTruthy();
    expect(screen.queryByText('14:00')).toBeNull();
    const region = screen.getByRole('region', { name: 'Calendar hours' });
    expect(region.scrollTop).toBe(336);
    const columns = container.querySelector('.hq-calendar-time-columns')!;
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue({ x: 88, y: -236, left: 88, top: -236,
      right: 888, bottom: 916, width: 800, height: 1152, toJSON: () => ({}) });
    const button = screen.getByRole('button', { name: /^Example task, 9:00 a\.m\./ });
    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 300, clientY: 196 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 244 });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('.hq-calendar-time-preview')?.getAttribute('aria-label')).toBe('10:00 a.m.–10:30 a.m.');
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 244 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(event, '2026-10-20', 600, false);
    expect(container.querySelector('.hq-calendar-time-preview')).toBeNull();
  });
});
