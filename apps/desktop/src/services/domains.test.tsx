import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast, toastStore } from '@hq/ui';
import type { ModulePort } from '@hq/contracts';
import type { ServiceConfigStatus, ServiceResponse } from '@hq/contracts/services';
import * as Work from '@hq/work';
import { resetWorkSessions, setWorkSessionPort } from '../../../../modules/work/nav';
import { resetSocialSessions } from '../../../../modules/social/core';
import { CONNECTING_DELAY_MS, createServiceDomains, RELOAD_NOTE } from './domains';
import { observedStatus } from './observed-status';
import { findServiceStatus } from './test-support';

let serial = 0;
const props = (): ModulePort => ({ context: { id: `services-${++serial}`, name: 'Synthetic services' }, destination: 'home', appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: vi.fn() });
const configured: ServiceConfigStatus = { configured: true, policy: 'ok', transport: 'loopback-http' };
const unconfigured: ServiceConfigStatus = { configured: false, policy: 'ok', transport: null };
const ok: ServiceResponse = { ok: true, status: 200, body: {}, replayed: false };
const unavailable: ServiceResponse = { ok: false, kind: 'unavailable' };
const never = () => new Promise<never>(() => {});

/** Services whose calls answer from `answer.current`, or never answer when it is null. */
function services(status: ServiceConfigStatus | Promise<ServiceConfigStatus>, answer: { current: ServiceResponse | null } = { current: null }) {
  const call = vi.fn(() => answer.current ? Promise.resolve(answer.current) : never());
  return { config: { status: () => Promise.resolve(status) }, work: { call }, social: { call } };
}
const region = (domain: 'Work' | 'Social') => screen.getByRole('region', { name: `${domain} service` });
const strip = (domain: 'Work' | 'Social') => region(domain).querySelector<HTMLElement>('.service-status')!;
const tone = (domain: 'Work' | 'Social') => strip(domain).querySelector('.hq-indicator')!.getAttribute('data-tone');
const detail = (domain: 'Work' | 'Social') => strip(domain).querySelector('.hq-status-detail')?.textContent ?? null;

afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  observedStatus.reset(); toast.dismiss();
  resetWorkSessions(); setWorkSessionPort(null); resetSocialSessions();
});

describe('while the configuration is checked', () => {
  it.each(['Work', 'Social'] as const)('%s shows a busy region and a polite status only after the delay', async domain => {
    vi.useFakeTimers();
    const domains = createServiceDomains(() => services(new Promise(() => {})));
    const View = domains[domain];
    render(<View {...props()} />);
    const busy = region(domain);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // Nothing flashes for a check that finishes quickly.
    expect(screen.queryByText(`Connecting to ${domain}…`)).toBeNull();
    expect(busy.querySelector('.hq-skeleton')).toBeNull();
    act(() => { vi.advanceTimersByTime(CONNECTING_DELAY_MS - 1); });
    expect(busy.querySelector('.hq-skeleton')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(within(busy).getByRole('status').textContent).toBe(`Connecting to ${domain}…`);
    expect(busy.querySelectorAll('.hq-skeleton').length).toBeGreaterThanOrEqual(4);
    expect(busy.querySelector('.hq-enter-fade .hq-skeleton')).toBeTruthy();
    // The skeleton is decoration: assistive technology hears only the status.
    expect(busy.querySelector('.service-skeleton')!.getAttribute('aria-hidden')).toBe('true');
    expect(busy.getAttribute('aria-busy')).toBe('true');
  });

  it('is shaped like the domain: Work as board columns, Social as rows', () => {
    vi.useFakeTimers();
    const domains = createServiceDomains(() => services(new Promise(() => {})));
    render(<><domains.Work {...props()} /><domains.Social {...props()} /></>);
    act(() => { vi.advanceTimersByTime(CONNECTING_DELAY_MS); });
    expect(region('Work').querySelectorAll('.service-skeleton-column')).toHaveLength(4);
    expect(region('Social').querySelectorAll('.service-skeleton-rows > .hq-skeleton')).toHaveLength(4);
  });

  it('never shows the skeleton when the check settles within the delay', async () => {
    vi.useFakeTimers();
    const domains = createServiceDomains(() => undefined);
    render(<domains.Work {...props()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(CONNECTING_DELAY_MS - 50); });
    expect(region('Work').getAttribute('aria-busy')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(CONNECTING_DELAY_MS * 2); });
    expect(screen.queryByText('Connecting to Work…')).toBeNull();
    expect(document.querySelector('.hq-skeleton')).toBeNull();
  });
});

describe('when the service is unavailable', () => {
  it.each(['Work', 'Social'] as const)('%s explains itself and opens settings for that domain', async domain => {
    const domains = createServiceDomains(() => undefined);
    const View = domains[domain];
    const opened = vi.fn((event: Event) => (event as CustomEvent).detail);
    window.addEventListener('hq-open-settings', opened);
    try {
      render(<View {...props()} />);
      expect(await screen.findByText(`${domain} isn't connected`)).toBeTruthy();
      const empty = region(domain).querySelector('.service-empty')!;
      expect(empty.classList.contains('hq-enter-rise')).toBe(true);
      expect(empty.querySelector('[data-state="unavailable"]')).toBeTruthy();
      expect(empty.textContent).toContain(`This build has no reachable ${domain} service configured, so nothing can be read or changed.`);
      // Nothing was checked, so nothing claims it was.
      expect(empty.textContent).not.toMatch(/\bchecked\b|is reachable|is connected/i);
      fireEvent.click(within(empty as HTMLElement).getByRole('button', { name: 'Open settings' }));
      expect(opened).toHaveBeenCalledTimes(1);
      expect(opened.mock.results[0]!.value).toEqual({ source: domain.toLowerCase() });
      fireEvent.click(within(strip(domain)).getByRole('button', { name: 'Settings' }));
      expect(opened).toHaveBeenCalledTimes(2);
      expect(opened.mock.results[1]!.value).toEqual({ source: domain.toLowerCase() });
    } finally { window.removeEventListener('hq-open-settings', opened); }
  });

  it('keeps the strip and mounts no module', async () => {
    const mounted = vi.spyOn(Work, 'WorkModule');
    const domains = createServiceDomains(() => undefined);
    render(<domains.Work {...props()} />);
    expect(await findServiceStatus('Work', 'Unavailable')).toBeTruthy();
    expect(tone('Work')).toBe('unavailable'); expect(detail('Work')).toBeNull();
    expect(strip('Work').getAttribute('title')).toBe(RELOAD_NOTE);
    expect(mounted).not.toHaveBeenCalled();
  });
});

describe('the status strip', () => {
  it('says only what configuration says until real traffic has been observed', async () => {
    const live = createServiceDomains(() => services(configured));
    render(<live.Work {...props()} />);
    expect(await findServiceStatus('Work', 'Set up')).toBeTruthy();
    expect(detail('Work')).toBe('not checked'); expect(tone('Work')).toBe('neutral');
    expect(within(strip('Work')).getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(strip('Work').getAttribute('title')).toBe(RELOAD_NOTE);
    cleanup();
    const example = createServiceDomains(() => services(unconfigured));
    render(<example.Social {...props()} />);
    expect(await findServiceStatus('Social', 'Sample data')).toBeTruthy();
    expect(detail('Social')).toBe('not set up'); expect(tone('Social')).toBe('info');
    expect(within(strip('Social')).getByRole('button', { name: 'Set up' })).toBeTruthy();
  });

  it('names the observed state and time once live traffic has answered or failed', async () => {
    const domains = createServiceDomains(() => services(configured));
    render(<domains.Work {...props()} />);
    expect(await findServiceStatus('Work', 'Set up')).toBeTruthy();
    act(() => { observedStatus.record('work', 'reachable'); });
    expect(await findServiceStatus('Work', 'Connected')).toBeTruthy();
    expect(detail('Work')).toMatch(/^observed \d\d:\d\d$/); expect(tone('Work')).toBe('success');
    expect(within(strip('Work')).getByRole('button', { name: 'Settings' })).toBeTruthy();
    act(() => { observedStatus.record('work', 'unreachable'); });
    expect(await findServiceStatus('Work', 'Unreachable')).toBeTruthy();
    expect(detail('Work')).toMatch(/^last tried \d\d:\d\d$/); expect(tone('Work')).toBe('danger');
    expect(strip('Work').getAttribute('title')).toBe(RELOAD_NOTE);
  });

  it('ignores observations when the domain is not live', async () => {
    observedStatus.record('work', 'reachable');
    const example = createServiceDomains(() => services(unconfigured));
    render(<example.Work {...props()} />);
    expect(await findServiceStatus('Work', 'Sample data')).toBeTruthy();
    cleanup();
    const unreachable = createServiceDomains(() => undefined);
    render(<unreachable.Work {...props()} />);
    expect(await findServiceStatus('Work', 'Unavailable')).toBeTruthy();
  });
});

describe('observing live traffic', () => {
  it('records Work calls made through the live planner, toasting only on a change', async () => {
    const answer = { current: unavailable as ServiceResponse | null };
    const bind = vi.spyOn(Work, 'setWorkSessionPort');
    const domains = createServiceDomains(() => services(configured, answer));
    render(<domains.Work {...props()} />);
    // The first observation is silent, whichever way it goes.
    expect(await findServiceStatus('Work', 'Unreachable')).toBeTruthy();
    expect(detail('Work')).toMatch(/^last tried \d\d:\d\d$/);
    expect(toastStore.getSnapshot()).toEqual([]);
    const port = bind.mock.calls[0]![0]!;
    answer.current = ok; await port.snapshot().catch(() => undefined);
    expect(await findServiceStatus('Work', 'Connected')).toBeTruthy();
    expect(toastStore.getSnapshot()).toMatchObject([{ id: 'hq-service-work', tone: 'success', title: 'Work service reconnected' }]);
    answer.current = unavailable; await port.snapshot().catch(() => undefined);
    expect(await findServiceStatus('Work', 'Unreachable')).toBeTruthy();
    expect(toastStore.getSnapshot()).toMatchObject([{ id: 'hq-service-work', tone: 'warning', title: 'Work service unreachable' }]);
    // An unknown outcome proves nothing: the state and the toast stay as they were.
    answer.current = { ok: false, kind: 'unknown' }; await port.snapshot().catch(() => undefined);
    expect(strip('Work').textContent).toContain('Unreachable');
    expect(toastStore.getSnapshot()).toHaveLength(1);
  });

  it('records Social calls made through the live port', async () => {
    const answer = { current: ok as ServiceResponse | null };
    const domains = createServiceDomains(() => services(configured, answer));
    render(<domains.Social {...props()} />);
    expect(await findServiceStatus('Social', 'Connected')).toBeTruthy();
    expect(detail('Social')).toMatch(/^observed \d\d:\d\d$/);
    expect(observedStatus.getSnapshot().work).toBeNull();
    await waitFor(() => expect(toastStore.getSnapshot()).toEqual([]));
  });
});
