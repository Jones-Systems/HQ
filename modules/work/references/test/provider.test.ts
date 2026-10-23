import { describe, expect, it, vi } from 'vitest';
import { parseReference } from '@hq/contracts';
import { createWorkReferenceProvider } from '../provider';
import { setup, fixedNow, NOW, item } from '../../board/test/fixtures';

import { envelope } from './fixtures';

describe('synthetic Work ReferenceProvider', () => {
  it('exposes the exact read-only interface and scoped, bounded search, including archives', async () => {
    const env = await setup({ items: [item('it-seed', 'Seed plan', 'inbox', 1), item('it-old', 'Old seed plan', 'done', 2, { archived_at: NOW })] });
    const provider = createWorkReferenceProvider(envelope.projectId, env.fixture.port, fixedNow);
    expect(Object.keys(provider).sort()).toEqual(['domain', 'find', 'kinds', 'resolve']);
    expect(provider.domain).toBe('work'); expect(provider.kinds).toEqual(['item']);
    expect((await provider.find('SEED', { projectId: envelope.projectId, limit: 30 })).map((e) => e.entityId)).toEqual(['it-seed', 'it-old']);
    expect(await provider.find('', { projectId: 'other', limit: 30 })).toEqual([]);
    expect(await provider.find('', { projectId: envelope.projectId, kinds: ['draft'], limit: 30 })).toEqual([]);
    for (const limit of [0, -1, NaN, Infinity]) expect(await provider.find('', { projectId: envelope.projectId, limit })).toEqual([]);
    expect(await provider.find('', { projectId: envelope.projectId, limit: 1 })).toHaveLength(1);
    for (const result of await provider.find('', { projectId: envelope.projectId, limit: 30 })) expect(parseReference(result)).toEqual(result);
  });
  it('resolves available, changed, archived and missing without writing', async () => {
    const env = await setup();
    const provider = createWorkReferenceProvider(envelope.projectId, env.fixture.port, fixedNow);
    expect(await provider.resolve(envelope)).toMatchObject({ status: 'available', latestRevision: '1', destination: 'item/it-seed' });
    await env.device.patch('it-seed', 1, { title: 'Updated seed plan' }, env.otherRid());
    expect(await provider.resolve(envelope)).toMatchObject({ status: 'changed', latestTitle: 'Updated seed plan', latestRevision: '2' });
    await env.device.setArchived('it-seed', 2, true, env.otherRid());
    expect(await provider.resolve(envelope)).toMatchObject({ status: 'archived' });
    expect(await provider.resolve({ ...envelope, entityId: 'gone' })).toEqual({ status: 'missing', observedAt: NOW });
    expect(env.calls.map((c) => c.method)).toEqual(['snapshot']);
  });
  it('does not infer availability across projects or unsupported kinds, and reports read outages', async () => {
    const snapshot = vi.fn().mockRejectedValue(new Error('offline'));
    const provider = createWorkReferenceProvider(envelope.projectId, { snapshot }, fixedNow);
    expect(await provider.resolve({ ...envelope, kind: 'unknown' })).toEqual({ status: 'unknown', observedAt: NOW });
    expect(await provider.resolve({ ...envelope, projectId: 'different' })).toMatchObject({ status: 'unknown', targetProjectId: envelope.projectId });
    expect(snapshot).not.toHaveBeenCalled();
    expect(await provider.resolve(envelope)).toEqual({ status: 'unavailable', observedAt: NOW });
    await expect(provider.find('', { projectId: envelope.projectId, limit: 1 })).rejects.toThrow('offline');
  });
});
