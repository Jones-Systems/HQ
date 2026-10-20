import { afterEach, expect, it, vi } from 'vitest';
import { createJonesConnection, deactivateDesktopPreview, overlayDesktopPreview, selectDesktopProject, subscribeDesktopProject } from './interactive-runtime';
import type { JonesTransport } from '@hq/contracts/jones-code';
afterEach(() => vi.restoreAllMocks());
it('changes actual shell context using the selected catalog identity', () => {
  const listener = vi.fn(), unsubscribe = subscribeDesktopProject(listener);
  selectDesktopProject({ id: 'source-project-digest', label: 'Selected prototype' });
  expect(listener).toHaveBeenCalledWith({ id: 'source-project-digest', name: 'Selected prototype' });
  unsubscribe(); selectDesktopProject({ id: 'another', label: 'Other' }); expect(listener).toHaveBeenCalledOnce();
});
it('uses closed read-only lookup and calls fence only through its explicit method', async () => {
  const call = vi.fn(async (route: string) => route === 'jonesCode.status' ? { ok: true, value: { state: 'connected', destinations: [], descriptor: { kind: 'jones-code', provenance: 'jones', label: 'Jones', modes: ['existing-thread'], qualification: { level: 'unqualified', reason: 'Native evidence required' } } } } : { ok: true, value: { kind: 'not-found' } });
  const runtime = createJonesConnection({ call } as unknown as JonesTransport);
  await runtime.refresh(); const transport = runtime.connection.transports['jones-code']!;
  await transport.lookup({ endpoint: { transport: 'jones-code', locator: 'opaque' }, idempotencyKey: 'attempt' }, new AbortController().signal);
  expect(call.mock.calls.map(([route]) => route)).toEqual(['jonesCode.status', 'jonesCode.lookup']);
  expect(runtime.connection.getCatalog().destinations).toEqual([]); expect(transport.descriptor.qualification.level).toBe('unqualified');
});

it('routes shell lifecycle to native ownership even when no preview was opened through the wrapper', async () => {
  const call = vi.fn(async () => ({ ok: true, value: null }));
  vi.stubGlobal('window', { hqServices: { preview: { call } } });
  try {
    await deactivateDesktopPreview(); await overlayDesktopPreview(true); await overlayDesktopPreview(false);
    expect(call.mock.calls).toEqual([['deactivate', {}], ['overlay', { hidden: true }], ['overlay', { hidden: false }]]);
  } finally { vi.unstubAllGlobals(); }
});
