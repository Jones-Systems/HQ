import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord, RunStatus } from '../../core';
import { watchRun, type Visibility } from '../polling';

function record(status: RunStatus): RunRecord {
  return { id: 'e'.padEnd(32, '1'), tool: 'x-studio', status, is_example: 0, created_at: '2026-10-20T00:00:00+00:00', finished_at: null, error: null };
}

function fakeVisibility(visible = true) {
  const listeners = new Set<() => void>();
  const visibility: Visibility & { set(value: boolean): void; listeners: Set<() => void> } = {
    listeners,
    isVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      visible = value;
      for (const listener of [...listeners]) listener();
    },
  };
  return visibility;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('run polling', () => {
  it('reads only while the run is active, then stops on a terminal status', async () => {
    const statuses: RunStatus[] = ['running', 'running', 'succeeded'];
    const load = vi.fn(async () => record(statuses.shift()!));
    const onRecord = vi.fn();
    const visibility = fakeVisibility();
    watchRun('id', record('queued'), { load, onRecord, onError: vi.fn(), visibility, intervalMs: 100 });

    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    expect(load).toHaveBeenCalledTimes(3);
    expect(onRecord.mock.calls.map(([run]) => (run as RunRecord).status)).toEqual(['running', 'running', 'succeeded']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(visibility.listeners.size).toBe(0);
  });

  it('makes no read while the page is hidden and resumes when it becomes visible', async () => {
    const load = vi.fn(async () => record('running'));
    const visibility = fakeVisibility(false);
    const stop = watchRun('id', record('running'), { load, onRecord: vi.fn(), onError: vi.fn(), visibility, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(load).not.toHaveBeenCalled();
    visibility.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    visibility.set(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(1);
    stop();
    visibility.set(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not poll a finished run, reads once without a record, and stops after a failed read', async () => {
    const load = vi.fn(async () => record('failed'));
    watchRun('id', record('succeeded'), { load, onRecord: vi.fn(), onError: vi.fn(), visibility: fakeVisibility(), intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(500);
    expect(load).not.toHaveBeenCalled();

    watchRun('id', null, { load, onRecord: vi.fn(), onError: vi.fn(), visibility: fakeVisibility(), intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(500);
    expect(load).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => { throw new Error('lost'); });
    const onError = vi.fn();
    watchRun('id', record('running'), { load: failing, onRecord: vi.fn(), onError, visibility: fakeVisibility(), intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    expect([failing.mock.calls.length, onError.mock.calls.length]).toEqual([1, 1]);
  });

  it('ignores a read that lands after stop', async () => {
    let resolve: (run: RunRecord) => void = () => {};
    const onRecord = vi.fn();
    const stop = watchRun('id', null, { load: () => new Promise((done) => { resolve = done; }), onRecord, onError: vi.fn(), visibility: fakeVisibility() });
    stop();
    resolve(record('succeeded'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onRecord).not.toHaveBeenCalled();
  });
});
