import { describe, expect, it, vi } from 'vitest';
import { createToastApi, createToastStore, type ToastApi } from '@hq/ui';
import type { ServiceResponse, SocialServiceTransport, WorkServiceTransport } from '@hq/contracts/services';
import { createObservedStatusStore, describeObservation, formatClock, observeSocial, observeWork, outcomeOf } from './observed-status';

const ok: ServiceResponse = { ok: true, status: 200, body: {}, replayed: false };
const unavailable: ServiceResponse = { ok: false, kind: 'unavailable' };
const unknown: ServiceResponse = { ok: false, kind: 'unknown' };
const at = (hour: number, minute: number, second = 0) => new Date(2026, 10, 3, hour, minute, second).getTime();

function fixture(start = at(14, 2)) {
  let time = start;
  const toast = { warning: vi.fn<ToastApi['warning']>(() => 'toast'), success: vi.fn<ToastApi['success']>(() => 'toast') };
  const store = createObservedStatusStore({ now: () => time, toast });
  return { store, toast, setTime: (value: number) => { time = value; } };
}

describe('outcomeOf', () => {
  it('reads only what the transport contract says an answer means', () => {
    expect(outcomeOf(ok)).toBe('reachable');
    // Every received HTTP response is `ok: true`, 4xx and 5xx included: the service answered.
    expect(outcomeOf({ ok: true, status: 503, body: null, replayed: false })).toBe('reachable');
    expect(outcomeOf(unavailable)).toBe('unreachable');
    expect(outcomeOf(unknown)).toBe('unknown');
    for (const malformed of [null, undefined, 'ok', {}, { ok: true }, { ok: true, status: 200 }, { ok: false }, { ok: false, kind: 'other' }]) expect(outcomeOf(malformed)).toBe('unknown');
  });
});

describe('observed status store', () => {
  it('records reachable and unreachable with the time of the call', () => {
    const { store } = fixture();
    expect(store.getSnapshot()).toEqual({ social: null, work: null });
    store.recordResponse('work', ok);
    expect(store.getSnapshot().work).toEqual({ state: 'reachable', at: at(14, 2) });
    expect(store.getSnapshot().social).toBeNull();
  });

  it('does not toast on the first observation, whichever way it goes', () => {
    for (const first of [ok, unavailable]) {
      const { store, toast } = fixture();
      store.recordResponse('work', first);
      expect(toast.warning).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
    }
  });

  it('raises one warning when a reachable service becomes unreachable, and one success when it returns', () => {
    const { store, toast } = fixture();
    store.recordResponse('work', ok);
    store.recordResponse('work', unavailable);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith('Work service unreachable', expect.objectContaining({ id: 'hq-service-work' }));
    expect(store.getSnapshot().work?.state).toBe('unreachable');
    store.recordResponse('work', unavailable); store.recordResponse('work', unavailable);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    store.recordResponse('work', ok);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Work service reconnected', { id: 'hq-service-work' });
    expect(store.getSnapshot().work?.state).toBe('reachable');
  });

  it('an unknown outcome changes nothing: no state, no toast, no notification', () => {
    const { store, toast } = fixture();
    const listener = vi.fn(); store.subscribe(listener);
    store.recordResponse('work', unknown);
    expect(store.getSnapshot()).toEqual({ social: null, work: null }); expect(listener).not.toHaveBeenCalled();
    store.recordResponse('work', ok); listener.mockClear();
    const before = store.getSnapshot();
    store.recordResponse('work', unknown); store.recordResponse('work', 'not a response');
    expect(store.getSnapshot()).toBe(before); expect(listener).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps each domain and its toast id separate', () => {
    const { store, toast } = fixture();
    store.recordResponse('work', ok); store.recordResponse('social', ok);
    store.recordResponse('social', unavailable);
    expect(store.getSnapshot().work?.state).toBe('reachable'); expect(store.getSnapshot().social?.state).toBe('unreachable');
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith('Social service unreachable', expect.objectContaining({ id: 'hq-service-social' }));
  });

  it('refreshes the time at most once a minute so quiet repeats never re-render', () => {
    const { store, setTime } = fixture(at(14, 2, 5));
    const listener = vi.fn(); store.subscribe(listener);
    store.recordResponse('work', ok); expect(listener).toHaveBeenCalledTimes(1);
    setTime(at(14, 2, 50)); store.recordResponse('work', ok);
    expect(listener).toHaveBeenCalledTimes(1); expect(store.getSnapshot().work?.at).toBe(at(14, 2, 5));
    setTime(at(14, 3, 1)); store.recordResponse('work', ok);
    expect(listener).toHaveBeenCalledTimes(2); expect(store.getSnapshot().work?.at).toBe(at(14, 3, 1));
  });

  it('subscribes, unsubscribes and resets without toasts', () => {
    const { store, toast } = fixture();
    const listener = vi.fn(); const stop = store.subscribe(listener);
    store.recordResponse('work', ok); stop(); store.recordResponse('work', unavailable);
    expect(listener).toHaveBeenCalledTimes(1);
    store.reset();
    expect(store.getSnapshot()).toEqual({ social: null, work: null }); expect(toast.success).not.toHaveBeenCalled();
  });

  it('shows at most one toast per domain as the service flaps, updated in place', () => {
    const toasts = createToastStore();
    const store = createObservedStatusStore({ now: () => at(9, 0), toast: createToastApi(toasts) });
    store.recordResponse('work', ok);
    for (let round = 0; round < 3; round += 1) { store.recordResponse('work', unavailable); store.recordResponse('work', ok); }
    store.recordResponse('work', unavailable);
    const records = toasts.getSnapshot();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 'hq-service-work', tone: 'warning', title: 'Work service unreachable' });
    store.recordResponse('work', ok);
    expect(toasts.getSnapshot()).toHaveLength(1);
    expect(toasts.getSnapshot()[0]).toMatchObject({ id: 'hq-service-work', tone: 'success', title: 'Work service reconnected' });
  });
});

describe('wording', () => {
  it('formats local HH:MM and the two observed phrases', () => {
    expect(formatClock(at(9, 7))).toBe('09:07'); expect(formatClock(at(0, 0))).toBe('00:00'); expect(formatClock(at(23, 59, 59))).toBe('23:59');
    expect(describeObservation({ state: 'reachable', at: at(14, 2) })).toEqual({ tone: 'success', label: 'Connected', detail: 'observed 14:02' });
    expect(describeObservation({ state: 'unreachable', at: at(9, 40) })).toEqual({ tone: 'danger', label: 'Unreachable', detail: 'last tried 09:40' });
  });
});

describe('observing transports', () => {
  it('forwards the exact route, params and answer, and records the outcome', async () => {
    const { store } = fixture();
    const answers: ServiceResponse[] = [ok, unavailable];
    const inner = { call: vi.fn(async () => answers.shift()!) } as unknown as WorkServiceTransport;
    const work = observeWork(inner, store);
    const params = { id: 'item-123456' };
    const first = await work.call('item', params);
    expect(first).toBe(ok); expect(inner.call).toHaveBeenCalledWith('item', params);
    expect(store.getSnapshot().work?.state).toBe('reachable');
    expect(await work.call('item', params)).toBe(unavailable);
    expect(store.getSnapshot().work?.state).toBe('unreachable');
  });

  it('lets a thrown error through unchanged and records nothing', async () => {
    const { store } = fixture();
    const failure = new Error('bridge lost');
    const work = observeWork({ call: async () => { throw failure; } }, store);
    await expect(work.call('state', {})).rejects.toBe(failure);
    expect(store.getSnapshot()).toEqual({ social: null, work: null });
  });

  it('never lets observation alter an answer even if recording fails', async () => {
    const toast = { warning: () => { throw new Error('toast failed'); }, success: vi.fn<ToastApi['success']>(() => 'toast') };
    const store = createObservedStatusStore({ now: () => at(14, 2), toast });
    const answers: ServiceResponse[] = [ok, unavailable];
    const work = observeWork({ call: async () => answers.shift()! }, store);
    expect(await work.call('state', {})).toBe(ok);
    expect(await work.call('state', {})).toBe(unavailable);
  });

  it('observes Social separately', async () => {
    const { store } = fixture();
    const social = observeSocial({ call: async () => unavailable } as SocialServiceTransport, store);
    expect(await social.call('workspace', {})).toBe(unavailable);
    expect(store.getSnapshot()).toMatchObject({ social: { state: 'unreachable' }, work: null });
  });
});
