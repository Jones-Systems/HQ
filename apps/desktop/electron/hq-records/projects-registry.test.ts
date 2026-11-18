import { describe, expect, it, vi } from 'vitest';
import { canonicalDigest } from './canonical.js';
import {
  ADOPTION_SCHEMA, createRequestDigest, decodeAdoption, decodeOperation, decodeProject, decodeRegistry,
  documentRevision, emptyRegistry, encodeAdoption, encodeOperation, encodeRegistry, MAX_PROJECTS,
  OPERATION_SCHEMA, planCreate, projectId, REGISTRY_SCHEMA, timestamp,
  type AdoptionRecord, type CreateOperation, type HqProjectRecord, type OperationObservation, type RegistrySnapshot,
} from './projects-registry.js';

const time = '2026-01-02T03:04:05.000Z';
const uuid = '00000000-0000-4000-8000-000000000001';
const newId = `project-${uuid}`;
const digest = 'sha256:5fc4f46b7687283d50d2fc51ee3741a6871ce700d7d261f029c5d93c6f30073e' as const;
const request = { operationId: 'create-1', name: 'Example', expectedRegistryRevision: null };
const project: HqProjectRecord = { id: newId, identityOrigin: 'hq-created', name: 'Example', createdAt: time, registeredAt: time, adoptionId: null };
const operation: CreateOperation = { schema: OPERATION_SCHEMA, operationId: 'create-1', kind: 'create', requestDigest: digest, result: { projectId: newId }, committedAt: time };
const pin = { key: 'legacy/a', revision: 1, digest };
const adoption: AdoptionRecord = { schema: ADOPTION_SCHEMA, adoptionId: 'adopt-a', fromSchema: 1, toSchema: 2,
  inputs: [pin], adopted: [{ id: 'Legacy:/É', identityOrigin: 'adopted-workspace-local', evidenceKeys: ['legacy/a'] }], untouched: [], committedAt: time };
const context = (observed: OperationObservation = { status: 'absent' }) => ({
  registry: { revision: null, value: null } as RegistrySnapshot, operation: observed, mintUuid: vi.fn(() => uuid), now: vi.fn(() => time),
});

describe('closed identity codecs', () => {
  it('pins golden registry, normalized request and operation records/digests independently', () => {
    expect(encodeRegistry(emptyRegistry())).toBe('{"originatingWorkspaceId":"hq-local","projects":[],"schema":"hq.projects.registry/v1"}');
    expect(canonicalDigest(emptyRegistry())).toBe('sha256:d0fc06a8c0b491cf4bf1e15f163a34bfe32c3937ec986718669c06d906b682fa');
    expect(createRequestDigest({ ...request, name: '  Example  ', expectedRegistryRevision: 9 })).toBe(digest);
    expect(encodeOperation(operation)).toBe('{"committedAt":"2026-01-02T03:04:05.000Z","kind":"create","operationId":"create-1","requestDigest":"sha256:5fc4f46b7687283d50d2fc51ee3741a6871ce700d7d261f029c5d93c6f30073e","result":{"projectId":"project-00000000-0000-4000-8000-000000000001"},"schema":"hq.projects.operation/v1"}');
    expect(canonicalDigest(operation)).toBe('sha256:ef4acf7c476ac43fa1d0b1620e50805a27980277af5e99d82c5a9cfecf246165');
    expect(decodeOperation(JSON.parse(encodeOperation(operation)))).toEqual(operation);
    expect(decodeAdoption(JSON.parse(encodeAdoption(adoption)))).toEqual(adoption);
  });

  it('preserves exact legacy IDs and unknown metadata without confusing them with segments or scope', () => {
    for (const id of ['Legacy:/É', 'source_project:Case 1', '项目', 'x'.repeat(160), 'legacy\u0085id']) {
      const record = { ...project, id, identityOrigin: 'adopted-source-derived', name: null, createdAt: null, adoptionId: 'adopt-a' };
      expect(decodeProject(record)).toEqual(record);
    }
    expect(decodeRegistry(emptyRegistry()).projects).toEqual([]);
    for (const id of ['', ' a', 'a ', 'a\u0000b', 'a\u007fb', 'x'.repeat(161), 'hq-local', 7]) {
      expect(() => projectId(id)).toThrow();
    }
    expect(decodeProject({ ...project, identityOrigin: 'adopted-workspace-local', adoptionId: 'adopt-a', name: null, createdAt: null })).toMatchObject({ name: null, createdAt: null });
  });

  it.each([
    { extra: 1 }, { id: 'hq-local' }, { name: '' }, { name: '  name' }, { name: 'x'.repeat(301) },
    { createdAt: '2026-02-29T00:00:00Z' }, { registeredAt: 'yesterday' }, { identityOrigin: 'source' },
    { adoptionId: 'adopt-a' }, { identityOrigin: 'adopted-workspace-local', adoptionId: null },
    { identityOrigin: 'adopted-source-derived', adoptionId: 'A/B' }, { createdAt: undefined },
  ])('refuses invalid project metadata %j', patch => expect(() => decodeProject({ ...project, ...patch })).toThrow());

  it('validates actual calendar times and explicit offsets', () => {
    for (const value of ['2024-02-29T00:00:00Z', time, '2026-01-02T03:04:05.123456789-05:00']) expect(timestamp(value)).toBe(value);
    for (const value of ['2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z', '2026-01-00T00:00:00Z',
      '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z',
      '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+00:60', '2026-01-01T00:00:00', '2026-01-01']) {
      expect(() => timestamp(value)).toThrow();
    }
  });

  it('bounds registries, rejects duplicate exact IDs and allows duplicate display names', () => {
    const registry = { schema: REGISTRY_SCHEMA, originatingWorkspaceId: 'hq-local', projects: [project, { ...project, id: 'other' }] };
    expect(decodeRegistry(registry).projects).toHaveLength(2);
    expect(() => decodeRegistry({ ...registry, projects: [project, project] })).toThrow(/Duplicate/u);
    expect(() => decodeRegistry({ ...registry, extra: null })).toThrow();
    expect(() => decodeRegistry({ ...registry, originatingWorkspaceId: 'project-a' })).toThrow();
    expect(() => decodeRegistry({ ...registry, projects: new Array(1) })).toThrow();
    expect(() => decodeRegistry({ ...registry, projects: Object.assign([], { hidden: true }) })).toThrow();
    const atLimit = Array.from({ length: MAX_PROJECTS }, (_, index) => ({ ...project, id: `legacy-${index}` }));
    expect(decodeRegistry({ ...registry, projects: atLimit }).projects).toHaveLength(MAX_PROJECTS);
    expect(() => decodeRegistry({ ...registry, projects: [...atLimit, { ...project, id: 'extra' }] })).toThrow();
  });

  it('refuses capture/unknown operation fields, invalid nested records and lossy revisions', () => {
    for (const patch of [{ kind: 'capture' }, { operationId: 'A' }, { result: { projectId: newId, extra: 1 } },
      { result: { projectId: 'hq-local' } }, { requestDigest: digest.toUpperCase() }, { committedAt: null }, { extra: 1 }]) {
      expect(() => decodeOperation({ ...operation, ...patch })).toThrow();
    }
    expect(documentRevision(1)).toBe(1);
    expect(documentRevision(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '1', null]) expect(() => documentRevision(value)).toThrow();
  });

  it('closes adoption fields and pins, validates origins, evidence and document revisions', () => {
    for (const patch of [{ extra: 1 }, { fromSchema: 2 }, { toSchema: 3 }, { adoptionId: 'A' }, { committedAt: 'invalid' },
      { inputs: [pin, pin] }, { inputs: [{ ...pin, revision: 0 }] }, { inputs: [{ ...pin, epoch: 1 }] },
      { adopted: [...adoption.adopted, ...adoption.adopted] }, { adopted: [{ ...adoption.adopted[0], identityOrigin: 'hq-created' }] },
      { adopted: [{ ...adoption.adopted[0], evidenceKeys: [] }] }, { adopted: [{ ...adoption.adopted[0], evidenceKeys: ['unpinned'] }] },
      { adopted: [{ ...adoption.adopted[0], evidenceKeys: ['legacy/a', 'legacy/a'] }] },
      { untouched: [{ key: 'legacy/a', reason: 'ambiguous' }] }, { untouched: [{ key: 'other', reason: 'invalid' }] },
    ]) expect(() => decodeAdoption({ ...adoption, ...patch })).toThrow();
    const reverse = { ...adoption, inputs: [{ ...pin, key: 'legacy/z' }, pin], adopted: [],
      untouched: [{ key: 'legacy/z', reason: 'invalid' }, { key: 'legacy/a', reason: 'unsupported-schema' }] };
    expect(decodeAdoption(reverse).inputs.map(p => p.key)).toEqual(['legacy/a', 'legacy/z']);
    expect(decodeAdoption(reverse).untouched.map(u => u.key)).toEqual(['legacy/a', 'legacy/z']);
  });
});

describe('pure create planning', () => {
  it('mints an opaque main UUIDv4 ID and plans exactly registry CAS and create-only operation', () => {
    const ctx = context();
    const result = planCreate({ ...request, name: ' Example ' }, ctx);
    expect(result.status).toBe('planned');
    if (result.status !== 'planned') throw new Error('Expected plan');
    expect(result.result).toEqual({ projectId: newId });
    expect(result.requestDigest).toBe(digest);
    expect(result.puts).toEqual([
      { key: 'hq/projects/registry', expectedRevision: null, value: { ...emptyRegistry(), projects: [project] } },
      { key: 'hq/projects/operations/create-1', expectedRevision: null, value: operation },
    ]);
    expect(ctx.registry).toEqual({ revision: null, value: null });
    expect(ctx.mintUuid).toHaveBeenCalledTimes(1);
  });

  it('replays recorded results before consulting changed registry, minter or clock', () => {
    const ctx = context({ status: 'present', value: operation });
    ctx.registry = { revision: null, value: { unsupported: true } };
    expect(planCreate({ ...request, name: '  Example ', expectedRegistryRevision: 999 }, ctx))
      .toEqual({ status: 'replayed', result: { projectId: newId }, operation });
    expect(ctx.mintUuid).not.toHaveBeenCalled(); expect(ctx.now).not.toHaveBeenCalled();
    expect(planCreate({ ...request, name: 'Different' }, ctx)).toEqual({ status: 'conflict', reason: 'operation-id-reused' });
    expect(planCreate({ ...request, operationId: 'create-other' }, ctx)).toMatchObject({ status: 'conflict' });
  });

  it('does not allocate or invent retries on unknown operation observations or stale registry CAS', () => {
    const unknown = context({ status: 'unknown' });
    expect(planCreate(request, unknown)).toEqual({ status: 'conflict', reason: 'operation-unknown' });
    expect(unknown.mintUuid).not.toHaveBeenCalled(); expect(unknown.now).not.toHaveBeenCalled();
    const stale = { ...context(), registry: { revision: 2, value: emptyRegistry() } };
    expect(planCreate({ ...request, expectedRegistryRevision: 1 }, stale)).toEqual({ status: 'conflict', reason: 'registry-revision' });
    expect(stale.mintUuid).not.toHaveBeenCalled(); expect(stale.now).not.toHaveBeenCalled();
    expect(planCreate({ ...request, expectedRegistryRevision: 2 }, stale)).toMatchObject({ status: 'planned' });
  });

  it('rejects supplied IDs and malformed requests before minting, and never repairs a bad minter', () => {
    for (const patch of [{ id: 'caller-id' }, { projectId: 'caller-id' }, { name: null }, { name: '' }, { name: 'x'.repeat(301) },
      { operationId: 'bad/id' }, { expectedRegistryRevision: 0 }, { expectedRegistryRevision: 1.1 }, { extra: undefined }]) {
      const ctx = context();
      expect(planCreate({ ...request, ...patch }, ctx)).toMatchObject({ status: 'invalid' });
      expect(ctx.mintUuid).not.toHaveBeenCalled();
    }
    for (const bad of [uuid.toUpperCase().replace('00000001', 'ABCDEF01'), '00000000-0000-1000-8000-000000000001',
      '00000000-0000-4000-7000-000000000001', `project-${uuid}`, 'source-derived-id']) {
      expect(planCreate(request, { ...context(), mintUuid: () => bad })).toMatchObject({ status: 'invalid' });
    }
    expect(planCreate(request, { ...context(), now: () => 'not-time' })).toMatchObject({ status: 'invalid' });
  });

  it('refuses ID collisions without a second minter call and permits duplicate names with unique IDs', () => {
    const ctx = { ...context(), registry: { revision: 1, value: { ...emptyRegistry(), projects: [project] } } };
    expect(planCreate({ ...request, expectedRegistryRevision: 1 }, ctx)).toEqual({ status: 'conflict', reason: 'project-id-collision' });
    expect(ctx.mintUuid).toHaveBeenCalledTimes(1);
    const next = planCreate({ ...request, operationId: 'create-2', expectedRegistryRevision: 1 }, {
      ...ctx, mintUuid: () => '00000000-0000-4000-8000-000000000002',
    });
    expect(next.status).toBe('planned');
    if (next.status === 'planned') expect(next.puts[0].value.projects.map(p => p.name)).toEqual(['Example', 'Example']);
  });
});
