import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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


describe('calendar day headers and event density', () => {
  const day = '2026-10-20';
  const now = new Date('2026-10-20T12:00:00Z');

  it('drills only on header double-click or keyboard activation, without saving or intercepting all-day controls', async () => {
    const user = userEvent.setup();
    const onOpenDay = vi.fn();
    const onChange = vi.fn();
    const onAllDayOpen = vi.fn();
    const onDrop = vi.fn();
    render(<TimeGrid days={[day]} events={[]} zone="UTC" now={now} onOpenDay={onOpenDay} onChange={onChange} onAnnounce={vi.fn()}
      onDrop={onDrop} renderAllDay={() => <button onClick={onAllDayOpen}>All-day task</button>} />);
    const header = screen.getByRole('button', { name: `Open day ${day}` });
    await user.click(header);
    expect(onOpenDay).not.toHaveBeenCalled();
    await user.dblClick(header);
    expect(onOpenDay).toHaveBeenCalledExactlyOnceWith(day);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onOpenDay).toHaveBeenCalledTimes(3);
    await user.dblClick(screen.getByRole('button', { name: 'All-day task' }));
    expect(onAllDayOpen).toHaveBeenCalledTimes(2);
    fireEvent.drop(screen.getByLabelText(`All day ${day}`));
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop.mock.calls[0]?.[1]).toBe(day);
    expect(onDrop.mock.calls[0]?.[2]).toBeUndefined();
    expect(onOpenDay).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a plain date header when drilling is not supplied', () => {
    render(<TimeGrid days={[day]} events={[]} zone="UTC" now={now} onChange={vi.fn()} onAnnounce={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Open day/ })).toBeNull();
    expect(screen.getByText('Tue, Oct 20')).toBeTruthy();
  });

  it.each([[15, 'tiny'], [30, 'compact'], [35, 'compact'], [44, 'compact'], [45, 'full'], [60, 'full']] as const)(
    'prioritizes a title for a %i-minute %s segment while retaining accessible time and a full tooltip', (duration, density) => {
      const event: CalendarGridEvent = { id: 'event', title: 'Long event title', subtitle: 'Project', day,
        start: 540, endDay: day, end: 540 + duration, revision: 1 };
      render(<TimeGrid days={[day]} events={[event]} zone="UTC" now={now} onChange={vi.fn()} onAnnounce={vi.fn()} />);
      const title = screen.getByText('Long event title');
      expect(title.closest('.hq-calendar-time-event')?.classList.contains(`hq-calendar-time-event--${density}`)).toBe(true);
      const button = title.closest('button')!;
      expect(button.getAttribute('aria-label')).toContain('9:00 a.m.');
      expect(button.getAttribute('title')).toContain('Long event title, 2026-10-20 9:00 a.m.');
      expect(button.getAttribute('title')).toContain(calendarClock(540 + duration));
      expect(button.querySelector('span') === null).toBe(duration < 35);
      expect(screen.getByRole('button', { name: 'Resize Long event title' })).toBeTruthy();
    },
  );

  it('keeps a tiny event resize preview live and saves only on release', () => {
    const event: CalendarGridEvent = { id: 'tiny', title: 'Short task', day, start: 540, endDay: day, end: 555, revision: 1 };
    const onChange = vi.fn();
    const { container } = render(<TimeGrid days={[day]} events={[event]} zone="UTC" now={now} onChange={onChange} onAnnounce={vi.fn()} />);
    vi.spyOn(container.querySelector('.hq-calendar-time-columns')!, 'getBoundingClientRect').mockReturnValue({
      x: 88, y: 0, left: 88, top: 0, right: 888, bottom: 1152, width: 800, height: 1152, toJSON: () => ({}),
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize Short task' }), { pointerId: 1, button: 0, clientX: 300, clientY: 444 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 456 });
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('.hq-calendar-time-preview')?.getAttribute('aria-label')).toBe('9:00 a.m.–9:30 a.m.');
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 456 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(event, day, 570, true);
    expect(container.querySelector('.hq-calendar-time-preview')).toBeNull();
  });

  it('uses each clipped segment duration across midnight, while the tooltip retains the whole interval', () => {
    const event: CalendarGridEvent = { id: 'overnight', title: 'Across midnight', day, start: 1425, endDay: '2026-10-21', end: 60, revision: 1 };
    const { container } = render(<TimeGrid days={[day, '2026-10-21']} events={[event]} zone="UTC" now={now} onChange={vi.fn()} onAnnounce={vi.fn()} />);
    const segments = container.querySelectorAll('.hq-calendar-time-event');
    expect(segments[0]!.classList.contains('hq-calendar-time-event--tiny')).toBe(true);
    expect(segments[1]!.classList.contains('hq-calendar-time-event--full')).toBe(true);
    for (const segment of segments) expect(segment.querySelector('button')!.title).toBe('Across midnight, 2026-10-20 11:45 p.m.–2026-10-21 1:00 a.m.');
    expect(segments[0]!.querySelector('.hq-calendar-time-resize')).toBeNull();
    expect(segments[1]!.querySelector('.hq-calendar-time-resize')).not.toBeNull();
  });
});
