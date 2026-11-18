import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fake = vi.hoisted(() => ({ call: vi.fn(), inspect: vi.fn() }));
vi.mock('./wire', () => ({ createMcpClient: () => fake }));
vi.mock('./oauth', () => ({ authorizeJones: async (base: string) => ({ base, accessToken: 'synthetic-only', expiresAt: Date.now() + 60000, sessionLabel: 'synthetic-session' }) }));
vi.mock('electron', () => ({ app: { isPackaged: false }, safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }, shell: { openExternal: vi.fn() } }));
import { createJonesHost } from './host';
import type { JonesSelection, JonesStatus } from '@hq/contracts/jones-code';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it('persists separate environments and switches opaque profiles without remote calls', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'hq-jones-profiles-')); roots.push(userData);
  const host = createJonesHost(userData);
  await host.call('jonesCode.configure', { baseUrl: 'https://one.example/', label: 'First' });
  const result = await host.call('jonesCode.configure', { baseUrl: 'https://two.example/', label: 'Second' }) as { ok: true; value: { profiles: { token: string; label: string; active: boolean }[] } };
  expect(result.value.profiles.map(profile => [profile.label, profile.active])).toEqual([['First', false], ['Second', true]]);
  expect(JSON.stringify(result)).not.toMatch(/https:|accessToken|projectId/);
  const restored = createJonesHost(userData);
  expect(await restored.call('jonesCode.selectProfile', { token: result.value.profiles[0]!.token })).toMatchObject({ ok: true, value: { state: 'needs-authorization', profiles: [{ label: 'First', active: true }, { label: 'Second', active: false }] } });
  expect(await restored.call('jonesCode.selectProfile', { token: 'unknown' })).toEqual({ ok: false, kind: 'unavailable' });
});

it('enrolls an unsupported profile but rejects before launch even under native qualification flags', async () => {
  vi.stubEnv('HQ_USER_DATA_DIR', 'synthetic-owned-profile'); vi.stubEnv('HQ_QUALIFY_JONES', '1');
  const userData = await mkdtemp(join(tmpdir(), 'hq-jones-unsupported-')); roots.push(userData);
  fake.call.mockImplementation(async (tool: string) => tool === 't3_environment_read' ? { environmentId: 'synthetic-environment', serverVersion: 'old' } : { projects: [{ id: 'synthetic-project', title: 'Project' }] });
  fake.inspect.mockResolvedValue({ descriptor: { environmentId: 'synthetic-environment', serverVersion: 'old', jonesSource: { sha: 'old' } }, tools: { tools: [] } });
  const host = createJonesHost(userData);
  try {
    await host.call('jonesCode.configure', { baseUrl: 'https://unsupported.example/', label: 'Older server' });
    expect(await host.call('jonesCode.authorize', {})).toMatchObject({ ok: true, value: { state: 'connected' } });
    const choices = await host.call('jonesCode.projects', {}) as { ok: true; value: JonesSelection[] };
    expect(choices).toMatchObject({ ok: true, value: [{ kind: 'project', label: 'Project' }] });
    expect(choices.value[0]?.label).toBe('Project');
    const bound = await host.call('jonesCode.bind', { token: choices.value[0]!.token, mode: 'new-thread', label: 'Destination' }) as { ok: true; value: JonesStatus };
    const destination = bound.value.destinations[0]!;
    expect(bound.value.descriptor.qualification.level).toBe('unqualified'); expect(destination.deliveryQualified).toBe(false);
    const handoff = { schema: 'hq.design.handoff/v1', dispatchId: 'dispatch', attemptId: 'attempt', idempotencyKey: 'attempt', packet: { packetId: 'packet', packetDigest: `sha256:${'a'.repeat(64)}` }, packetBody: {}, destination: { destinationId: destination.destinationId, ...destination.identity, threadRef: null, model: null }, fallback: 'forbidden', confirmedAt: '2026-01-01T00:00:00.000Z' };
    expect(await host.call('jonesCode.send', { locator: destination.endpoint.locator, handoff })).toMatchObject({ ok: true, value: { kind: 'rejected' } });
    expect(await host.call('jonesCode.identify', { locator: destination.endpoint.locator })).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(fake.call.mock.calls.some(([tool]) => ['t3_thread_launch', 't3_thread_send', 't3_thread_launch_fence'].includes(tool))).toBe(false);
  } finally { vi.unstubAllEnvs(); }
});
