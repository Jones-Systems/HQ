import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { WorkspaceBacking } from '../../../../modules/design/app/storage/backing.ts';
import { operationKey, PROJECTS_REGISTRY_KEY } from './keys.js';
import { emptyRegistry, type HqProjectRecord } from './projects-registry.js';
import {
  createProjectsRegistryService, type ProjectsRegistryBacking, type RegistryDocument, type RegistryPut,
} from './projects-registry-service.js';

const time = '2026-01-02T03:04:05.000Z';
const uuidA = '00000000-0000-4000-8000-000000000001';
const uuidB = '00000000-0000-4000-8000-000000000002';
const request = { operationId: 'create-a', name: 'Example', expectedRegistryRevision: null };
const legacy: HqProjectRecord = {
  id: 'Legacy:/É', identityOrigin: 'adopted-source-derived', name: null,
  createdAt: null, registeredAt: time, adoptionId: 'adopt-a',
};

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

class AtomicBacking implements ProjectsRegistryBacking {
  readonly documents = new Map<string, RegistryDocument>();
  readonly trace: string[] = [];
  readonly batches: (readonly RegistryPut[])[] = [];
  readonly getDocument = vi.fn(async (key: string): Promise<RegistryDocument | null> => {
    this.trace.push(`read:${key}`);
    return copy(this.documents.get(key) ?? null);
  });
  readonly commitPuts = vi.fn(async (puts: readonly RegistryPut[]): Promise<readonly RegistryDocument[]> => {
    this.trace.push('commit');
    this.batches.push(copy(puts));
    for (const put of puts) {
      if ((this.documents.get(put.key)?.revision ?? null) !== put.expectedRevision) {
        throw Object.assign(new Error('CAS refused'), { name: 'StoreError', code: 'conflict' });
      }
    }
    const committed = puts.map(put => ({ key: put.key, revision: (put.expectedRevision ?? 0) + 1, value: copy(put.value) }));
    for (const document of committed) this.documents.set(document.key, document);
    return copy(committed);
  });
  seed(key: string, revision: number, value: unknown) {
    this.documents.set(key, { key, revision, value: copy(value) });
  }
}

function service(backing = new AtomicBacking(), uuid = uuidA) {
  const mintUuid = vi.fn(() => { backing.trace.push('mint'); return uuid; });
  const now = vi.fn(() => { backing.trace.push('clock'); return time; });
  return { backing, mintUuid, now, api: createProjectsRegistryService({ backing, mintUuid, now }) };
}

describe('injected projects registry service', () => {
  it('accepts the existing workspace atomic port structurally and does nothing on construction', () => {
    expectTypeOf<Pick<WorkspaceBacking, 'getDocument' | 'commitPuts'>>().toMatchTypeOf<ProjectsRegistryBacking>();
    const ctx = service();
    expect(ctx.backing.trace).toEqual([]);
    expect(ctx.mintUuid).not.toHaveBeenCalled();
    expect(ctx.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
  });

  it('lists absence as empty and preserves adopted IDs and all metadata through create and reconstruction', async () => {
    const ctx = service();
    expect(await ctx.api.list()).toEqual({ status: 'listed', revision: null, registry: emptyRegistry() });
    ctx.backing.seed(PROJECTS_REGISTRY_KEY, 7, { ...emptyRegistry(), projects: [legacy] });
    expect(await ctx.api.create({ ...request, expectedRegistryRevision: 7 })).toEqual({
      status: 'saved', result: { projectId: `project-${uuidA}` }, registryRevision: 8,
    });
    const listed = await service(ctx.backing).api.list();
    expect(listed).toEqual({ status: 'listed', revision: 8, registry: { ...emptyRegistry(), projects: [legacy, {
      id: `project-${uuidA}`, identityOrigin: 'hq-created', name: 'Example', createdAt: time, registeredAt: time, adoptionId: null,
    }] } });
    expect(ctx.backing.documents.size).toBe(2);
  });

  it('observes operation, registry, mint and clock in order, then commits exactly two atomic puts', async () => {
    const ctx = service();
    expect(await ctx.api.create(request)).toMatchObject({ status: 'saved' });
    expect(ctx.backing.trace).toEqual([
      `read:${operationKey('create-a')}`, `read:${PROJECTS_REGISTRY_KEY}`, 'mint', 'clock', 'commit',
    ]);
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
    expect(ctx.backing.batches[0]).toEqual([
      { key: PROJECTS_REGISTRY_KEY, expectedRevision: null, value: expect.objectContaining({ projects: [expect.objectContaining({ id: `project-${uuidA}` })] }) },
      { key: operationKey('create-a'), expectedRevision: null, value: expect.objectContaining({ operationId: 'create-a', result: { projectId: `project-${uuidA}` } }) },
    ]);
    const next = service(ctx.backing, uuidB);
    await next.api.create({ ...request, operationId: 'create-b', expectedRegistryRevision: 1 });
    expect(ctx.backing.batches[1].map(put => [put.key, put.expectedRevision])).toEqual([
      [PROJECTS_REGISTRY_KEY, 1], [operationKey('create-b'), null],
    ]);
  });

  it('replays stored normalized identity across services before registry reads, minting or clock work', async () => {
    const ctx = service();
    await ctx.api.create({ ...request, name: '  Example  ' });
    ctx.backing.seed(PROJECTS_REGISTRY_KEY, 9, { corrupt: true });
    ctx.backing.trace.length = 0;
    const rebuilt = service(ctx.backing, uuidB);
    expect(await rebuilt.api.create({ ...request, expectedRegistryRevision: 999 })).toMatchObject({
      status: 'replayed', result: { projectId: `project-${uuidA}` },
    });
    expect(await rebuilt.api.create({ ...request, name: 'Changed' })).toEqual({ status: 'conflict', reason: 'operation-id-reused' });
    expect(ctx.backing.trace).toEqual([`read:${operationKey('create-a')}`, `read:${operationKey('create-a')}`]);
    expect(rebuilt.mintUuid).not.toHaveBeenCalled();
    expect(rebuilt.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
  });

  it('lets only one concurrent CAS succeed without losing entries, and requires an explicit fresh request to continue', async () => {
    const backing = new AtomicBacking();
    backing.seed(PROJECTS_REGISTRY_KEY, 1, { ...emptyRegistry(), projects: [legacy] });
    const a = service(backing, uuidA), b = service(backing, uuidB);
    const results = await Promise.all([
      a.api.create({ ...request, expectedRegistryRevision: 1 }),
      b.api.create({ ...request, operationId: 'create-b', expectedRegistryRevision: 1 }),
    ]);
    expect(results.map(result => result.status)).toEqual(['saved', 'refused']);
    expect(results[1]).toEqual({ status: 'refused', reason: 'commit-conflict' });
    expect(backing.commitPuts).toHaveBeenCalledTimes(2);
    expect(backing.documents.has(operationKey('create-b'))).toBe(false);
    expect(a.mintUuid).toHaveBeenCalledTimes(1);
    expect(b.mintUuid).toHaveBeenCalledTimes(1);
    const fresh = service(backing, uuidB);
    expect(await fresh.api.create({ ...request, operationId: 'create-b', expectedRegistryRevision: 2 })).toMatchObject({ status: 'saved' });
    const listed = await fresh.api.list();
    if (listed.status !== 'listed') throw new Error('Expected registry');
    expect(listed.registry.projects.map(project => project.id)).toEqual([legacy.id, `project-${uuidA}`, `project-${uuidB}`]);
  });

  it('refuses invalid input and stale revisions without allocation or writes', async () => {
    const ctx = service();
    expect(await ctx.api.create({ ...request, projectId: 'supplied' })).toMatchObject({ status: 'invalid' });
    expect(ctx.backing.trace).toEqual([]);
    ctx.backing.seed(PROJECTS_REGISTRY_KEY, 2, emptyRegistry());
    expect(await ctx.api.create({ ...request, expectedRegistryRevision: 1 })).toEqual({ status: 'conflict', reason: 'registry-revision' });
    expect(ctx.mintUuid).not.toHaveBeenCalled();
    expect(ctx.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
  });

  it('refuses a UUID collision after one mint and before clock or commit, without modifying existing metadata', async () => {
    const ctx = service();
    const existing = { ...legacy, id: `project-${uuidA}` };
    ctx.backing.seed(PROJECTS_REGISTRY_KEY, 1, { ...emptyRegistry(), projects: [existing] });
    expect(await ctx.api.create({ ...request, expectedRegistryRevision: 1 })).toEqual({ status: 'conflict', reason: 'project-id-collision' });
    expect(ctx.mintUuid).toHaveBeenCalledTimes(1);
    expect(ctx.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
    expect(await ctx.api.list()).toMatchObject({ registry: { projects: [existing] } });
  });

  it.each(['operation', 'registry'] as const)('reports unknown %s reads without minting, writing or retrying', async phase => {
    const ctx = service();
    if (phase === 'registry') ctx.backing.getDocument.mockResolvedValueOnce(null);
    ctx.backing.getDocument.mockRejectedValueOnce(new Error('Read unavailable'));
    expect(await ctx.api.create(request)).toEqual({ status: 'unknown', phase: `${phase}-read` });
    expect(ctx.backing.getDocument).toHaveBeenCalledTimes(phase === 'operation' ? 1 : 2);
    expect(ctx.mintUuid).not.toHaveBeenCalled();
    expect(ctx.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
  });

  it('reports list read failures and malformed registries explicitly, without repair', async () => {
    const ctx = service();
    ctx.backing.getDocument.mockRejectedValueOnce(new Error('Offline'));
    expect(await ctx.api.list()).toEqual({ status: 'unknown', phase: 'registry-read' });
    ctx.backing.seed(PROJECTS_REGISTRY_KEY, 1, { ...emptyRegistry(), projects: [legacy, legacy] });
    expect(await ctx.api.list()).toMatchObject({ status: 'invalid' });
    expect(await ctx.api.create({ ...request, expectedRegistryRevision: 1 })).toMatchObject({ status: 'invalid' });
    expect(ctx.mintUuid).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
  });

  it.each(['value', 'revision', 'key', 'identity'] as const)('refuses a malformed operation %s before consulting registry or allocation', async field => {
    const ctx = service();
    await ctx.api.create(request);
    const key = operationKey('create-a');
    const saved = ctx.backing.documents.get(key)!;
    const value = saved.value as Record<string, unknown>;
    ctx.backing.documents.set(key, field === 'value' ? { ...saved, value: { broken: true } }
      : field === 'revision' ? { ...saved, revision: 0 }
      : field === 'key' ? { ...saved, key: 'other' }
      : { ...saved, value: { ...value, operationId: 'different' } });
    ctx.backing.trace.length = 0;
    const rebuilt = service(ctx.backing);
    expect(await rebuilt.api.create(request)).toMatchObject({ status: field === 'identity' ? 'conflict' : 'invalid' });
    expect(ctx.backing.trace).toEqual([`read:${key}`]);
    expect(rebuilt.mintUuid).not.toHaveBeenCalled();
    expect(rebuilt.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
  });

  it('keeps a lost commit response unknown, then replays durable identity after reconstruction', async () => {
    const ctx = service();
    const commit = ctx.backing.commitPuts.getMockImplementation()!;
    ctx.backing.commitPuts.mockImplementationOnce(async puts => {
      await commit(puts);
      throw new Error('Response lost after atomic write');
    });
    expect(await ctx.api.create(request)).toEqual({ status: 'unknown', phase: 'commit' });
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
    const rebuilt = service(ctx.backing, uuidB);
    expect(await rebuilt.api.create(request)).toMatchObject({ status: 'replayed', result: { projectId: `project-${uuidA}` } });
    expect(rebuilt.mintUuid).not.toHaveBeenCalled();
    expect(rebuilt.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
  });

  it('checks the create-only operation in the same transaction and never partially saves the registry', async () => {
    const ctx = service();
    const commit = ctx.backing.commitPuts.getMockImplementation()!;
    ctx.backing.commitPuts.mockImplementationOnce(async puts => {
      ctx.backing.seed(operationKey('create-a'), 1, { anotherWriter: true });
      return commit(puts);
    });
    expect(await ctx.api.create(request)).toEqual({ status: 'refused', reason: 'commit-conflict' });
    expect(ctx.backing.documents.has(PROJECTS_REGISTRY_KEY)).toBe(false);
    expect(ctx.backing.documents.get(operationKey('create-a'))?.value).toEqual({ anotherWriter: true });
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
    expect(ctx.mintUuid).toHaveBeenCalledTimes(1);
  });

  it.each(['key', 'revision'] as const)('refuses malformed registry document %s on list and create', async field => {
    const ctx = service();
    ctx.backing.documents.set(PROJECTS_REGISTRY_KEY, {
      key: field === 'key' ? 'wrong' : PROJECTS_REGISTRY_KEY,
      revision: field === 'revision' ? 0 : 1, value: emptyRegistry(),
    });
    expect(await ctx.api.list()).toMatchObject({ status: 'invalid' });
    expect(await ctx.api.create({ ...request, expectedRegistryRevision: 1 })).toMatchObject({ status: 'invalid' });
    expect(ctx.mintUuid).not.toHaveBeenCalled();
    expect(ctx.now).not.toHaveBeenCalled();
    expect(ctx.backing.commitPuts).not.toHaveBeenCalled();
  });

  it.each(['missing', 'wrong-key', 'wrong-revision', 'wrong-value'] as const)('never calls an unproved %s commit response saved', async fault => {
    const ctx = service();
    const commit = ctx.backing.commitPuts.getMockImplementation()!;
    ctx.backing.commitPuts.mockImplementationOnce(async puts => {
      const documents = [...await commit(puts)];
      if (fault === 'missing') return documents.slice(0, 1);
      documents[0] = fault === 'wrong-key' ? { ...documents[0], key: 'unrelated' }
        : fault === 'wrong-revision' ? { ...documents[0], revision: 42 }
        : { ...documents[0], value: emptyRegistry() };
      return documents;
    });
    expect(await ctx.api.create(request)).toEqual({ status: 'unknown', phase: 'commit' });
    expect(ctx.mintUuid).toHaveBeenCalledTimes(1);
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
  });

  it('keeps an unclassified commit refusal uncertain and does not invent a saved result or retry', async () => {
    const ctx = service();
    ctx.backing.commitPuts.mockRejectedValueOnce(new Error('Store refused or disconnected'));
    expect(await ctx.api.create(request)).toEqual({ status: 'unknown', phase: 'commit' });
    expect(ctx.backing.documents.size).toBe(0);
    expect(ctx.mintUuid).toHaveBeenCalledTimes(1);
    expect(ctx.backing.commitPuts).toHaveBeenCalledTimes(1);
  });
});
