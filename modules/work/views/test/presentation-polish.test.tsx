import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewItems } from '../fixtures';
import { setup } from './harness';

afterEach(cleanup);

describe('Work presentation', () => {
  it('keeps Glance day context in headings and time, next step and actions on their rows', async () => {
    const items = viewItems();
    items.find((item) => item.id === 'ex-library')!.dates[0]!.time = '08:45';
    const openItem = vi.fn();
    const { container, rec } = await setup({ view: 'glance', items, openItem });
    expect(screen.getByRole('heading', { name: 'Overdue · 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    const agenda = container.querySelector('.wv-mini-agenda')!;
    const event = within(agenda as HTMLElement).getByText('Event · 8:45 AM');
    expect(event.closest('.wv-date')!.getAttribute('title')).toContain('Oct 21');
    expect(agenda.querySelector('.is-overdue .wv-date')!.textContent).toContain('Oct 19');
    const now = screen.getByRole('region', { name: 'Now' });
    const title = within(now).getByRole('button', { name: 'Finish the patchwork quilt' });
    expect(title.getAttribute('title')).toBe('Finish the patchwork quilt');
    expect(title.closest('.wv-row')!.querySelector('.wv-row-sub')!.textContent).toBe('Next: Sew the border');
    fireEvent.click(title);
    expect(openItem).toHaveBeenCalledWith('ex-quilt');
    expect(rec.writes()).toHaveLength(0);
  });

  it('moves the eight-quarter window by four quarters, remembers it, and returns to Today without writes', async () => {
    const { container, rec, rerender } = await setup({ view: 'timeline' });
    const range = () => screen.getByRole('status', { name: 'Timeline range' }).textContent;
    expect(range()).toBe('Q4 2026 – Q3 2028');
    expect([...container.querySelectorAll('.wv-tl-tick')].map((tick) => tick.textContent)).toEqual([
      '2026 · Q4', '2027 · Q1', 'Q2', 'Q3', 'Q4', '2028 · Q1', 'Q2', 'Q3',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(range()).toBe('Q4 2025 – Q3 2027');
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(range()).toBe('Q4 2027 – Q3 2029');
    expect(container.querySelector('.wv-tl-today')).toBeNull();
    rerender({ view: 'glance' });
    rerender({ view: 'timeline' });
    expect(range()).toBe('Q4 2027 – Q3 2029');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(range()).toBe('Q4 2026 – Q3 2028');
    expect(container.querySelector<HTMLElement>('.wv-tl')!.style.getPropertyValue('--wv-today')).toMatch(/%$/);
    expect(rec.writes()).toHaveLength(0);
  });

  it('retains full accessible dates for clipped marks and unlabeled coarse bands', async () => {
    const { container } = await setup({ view: 'timeline' });
    const row = container.querySelector('[data-row-id="ex-quilt"]')!.closest('.wv-tl-row')!;
    const edge = row.querySelector('.wv-tl-edge')!;
    expect(edge.textContent).toBe('‹');
    expect(edge.getAttribute('aria-label')).toMatch(/Start.*Sep 21.*before visible range/);
    expect(edge.getAttribute('title')).toContain('Sep 21');
    const band = row.querySelector('.wv-tl-band')!;
    expect(band.textContent).toBe('');
    expect(band.getAttribute('aria-label')).toMatch(/Target.*Dec.*2026/);
    expect(row.querySelector('.wv-tl-date-text')!.getAttribute('title')).toContain('Dec');
  });
});
