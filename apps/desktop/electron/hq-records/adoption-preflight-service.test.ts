import { describe, expect, it, vi } from 'vitest';
import { sha256Bytes } from './canonical.js';
import { CONTENT_SCHEMA, contentKey, planAdoption, PROVISIONAL_KEY, PROVISIONAL_SCHEMA,
  type IdentityProvenance, type SyntheticSnapshot } from './adoption-classifier.js';
import { createAdoptionPreflightService, type AdoptionPreflightRequest } from './adoption-preflight-service.js';
import { adoptionKey, PROJECTS_REGISTRY_KEY } from './keys.js';
import { emptyRegistry, type HqProjectRecord, type RegistrySnapshot } from './projects-registry.js';

const time = '2026-01-02T03:04:05.000Z';
function snapshot(key: string, value: unknown, revision = 1): SyntheticSnapshot {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  return { key, revision, digest: sha256Bytes(bytes), bytes };
}
const provisional = (id = 'Original_ID:/É') => snapshot(PROVISIONAL_KEY,
  { schema: PROVISIONAL_SCHEMA, projects: [{ id, name: null, createdAt: null }] }, 17);
const content = (id: string) => snapshot(contentKey(id), { schema: CONTENT_SCHEMA, projectId: id,
  views: [], versions: [], links: [{ projectId: id, sourceProjectId: id, linkedAt: time, observedRevision: null }], updatedAt: time });
const proof = (id: string): IdentityProvenance => ({ kind: 'proven-source-derivation', key: contentKey(id),
  projectId: id, sourceProjectId: id, evidenceKeys: [contentKey(id)] });
function request(overrides: Partial<AdoptionPreflightRequest> = {}): AdoptionPreflightRequest {
  return { snapshots: [provisional()], provenance: [{ kind: 'workspace-local', key: PROVISIONAL_KEY }],
    blockedScopes: { keyPrefixes: [], projectIds: [] }, expectedRegistryRevision: null, registeredAt: time, ...overrides };
}
function existing(id = 'unrelated'): HqProjectRecord {
  return { id, identityOrigin: 'hq-created', name: 'Retained', createdAt: time, registeredAt: time, adoptionId: null };
}
function reader(registry: RegistrySnapshot = { revision: null, value: null }) {
  const getDocument = vi.fn(async (_key: string) => registry.revision === null ? null
    : { key: PROJECTS_REGISTRY_KEY, revision: registry.revision, value: registry.value });
  return { getDocument };
}
function planned(result: Awaited<ReturnType<ReturnType<typeof createAdoptionPreflightService>['preview']>>) {
  if (result.status !== 'planned') throw new Error(`Expected plan, got ${result.status}`);
  return result;
}

describe('injected synthetic adoption preflight', () => {
  it('constructs inertly without touching any backing capability', () => {
    const access = vi.fn(() => { throw new Error('No construction I/O'); });
    const service = createAdoptionPreflightService({ backing: { get getDocument() { return access(); } } });
    expect(Object.keys(service)).toEqual(['preview']);
    expect(access).not.toHaveBeenCalled();
  });

  it('rejects closed-envelope and basic-bound failures before reading', async () => {
    const backing = reader(), service = createAdoptionPreflightService({ backing });
    const valid = request(), one = valid.snapshots[0];
    const accessor = Object.defineProperty({ ...valid }, 'snapshots', { enumerable: true, get() { throw new Error('Getter ran'); } });
    const decorated: unknown[] = [...valid.snapshots];
    Object.assign(decorated, { extra: true });
    const cases: unknown[] = [null, [], { ...valid, extra: true }, { ...valid, provenance: undefined },
      { ...valid, registeredAt: '2026-02-30T00:00:00Z' }, { ...valid, expectedRegistryRevision: 0 },
      { ...valid, expectedRegistryRevision: Number.MAX_SAFE_INTEGER + 1 }, accessor,
      { ...valid, snapshots: decorated }, { ...valid, snapshots: [{ ...one, extra: true }] },
      { ...valid, snapshots: [{ ...one, bytes: [1, 2] }] }, { ...valid, snapshots: [{ ...one, revision: 1.5 }] },
      { ...valid, snapshots: [{ ...one, key: 'hq/not-legacy' }] },
      { ...valid, snapshots: [{ ...one, digest: `sha256:${'0'.repeat(64)}` }] },
      { ...valid, snapshots: [one, one] }, { ...valid, provenance: [{ kind: 'workspace-local', key: 'unpinned' }] },
      { ...valid, blockedScopes: { keyPrefixes: [], projectIds: [], extra: true } },
    ];
    for (const input of cases) expect(await service.preview(input)).toMatchObject({ status: 'invalid' });
    expect(backing.getDocument).not.toHaveBeenCalled();
  });

  it('reads exactly one registry key and returns the direct absent-registry plan with two data-only puts', async () => {
    const forbidden = vi.fn(() => { throw new Error('Writer/listing invoked'); });
    const backing = { ...reader(), putDocument: forbidden, commitPuts: forbidden, listDocuments: forbidden,
      getBlob: forbidden, appendEvent: forbidden };
    const input = request();
    const result = planned(await createAdoptionPreflightService({ backing }).preview(input));
    expect(backing.getDocument.mock.calls).toEqual([[PROJECTS_REGISTRY_KEY]]);
    expect(forbidden).not.toHaveBeenCalled();
    expect(result).toEqual(planAdoption({ ...input, registry: { revision: null, value: null } }));
    expect(result.puts).toHaveLength(2);
    expect(result.puts.map(p => [p.key, p.expectedRevision])).toEqual([
      [PROJECTS_REGISTRY_KEY, null], [adoptionKey(result.adoptionId), null],
    ]);
    expect(result.puts[0].value.projects[0]).toEqual({ id: 'Original_ID:/É', identityOrigin: 'adopted-workspace-local',
      name: null, createdAt: null, registeredAt: time, adoptionId: result.adoptionId });
  });

  it('preserves current-registry CAS, existing projects and every direct-planner result', async () => {
    const registry = { revision: 4, value: { ...emptyRegistry(), projects: [existing()] } };
    const backing = reader(registry), input = request({ expectedRegistryRevision: 4 });
    const result = planned(await createAdoptionPreflightService({ backing }).preview(input));
    expect(result).toEqual(planAdoption({ ...input, registry }));
    expect(result.puts.map(p => p.expectedRevision)).toEqual([4, null]);
    expect(result.puts[0].value.projects.find(p => p.id === 'unrelated')).toEqual(existing());
    expect(registry.value.projects).toEqual([existing()]);
    expect(backing.getDocument.mock.calls).toEqual([[PROJECTS_REGISTRY_KEY]]);
  });

  it('accepts the structural document projection with ordinary backing metadata', async () => {
    const backing = { getDocument: vi.fn(async (_key: string) => ({ key: PROJECTS_REGISTRY_KEY, revision: 2,
      value: emptyRegistry(), namespace: 'workspace', updatedAt: time, valueDigest: sha256Bytes('registry') })) };
    const input = request({ expectedRegistryRevision: 2 });
    expect(await createAdoptionPreflightService({ backing }).preview(input))
      .toEqual(planAdoption({ ...input, registry: { revision: 2, value: emptyRegistry() } }));
  });

  it('reports stale present/absent revisions without retry, including exhausted current revisions', async () => {
    for (const [registry, expected] of [
      [{ revision: 4, value: emptyRegistry() }, 3], [{ revision: 4, value: emptyRegistry() }, null],
      [{ revision: null, value: null }, 1],
    ] as const) {
      const backing = reader(registry);
      expect(await createAdoptionPreflightService({ backing }).preview(request({ expectedRegistryRevision: expected })))
        .toEqual({ status: 'conflict', reason: 'registry-revision' });
      expect(backing.getDocument).toHaveBeenCalledTimes(1);
    }
    const backing = reader({ revision: Number.MAX_SAFE_INTEGER, value: emptyRegistry() });
    expect(await createAdoptionPreflightService({ backing }).preview(request({ expectedRegistryRevision: Number.MAX_SAFE_INTEGER })))
      .toMatchObject({ status: 'invalid' });
    expect(backing.getDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps noncanonical original snapshot bytes unchanged and detached from input and parsed backing', async () => {
    const raw = ' { "projects": [{ "createdAt": null, "name": null, "id": "Opaque:/É" }], "schema": "hq.design.projects.provisional-registry/v1" }\n';
    const one = snapshot(PROVISIONAL_KEY, raw, 8), before = one.bytes.slice();
    const registry = { revision: 2, value: { ...emptyRegistry(), projects: [existing()] } };
    const backingBefore = JSON.stringify(registry);
    const result = planned(await createAdoptionPreflightService({ backing: reader(registry) })
      .preview(request({ snapshots: [one], expectedRegistryRevision: 2 })));
    expect(result.classifications[0].originalBytes).toEqual(before);
    expect(result.classifications[0].originalBytes).not.toBe(one.bytes);
    expect(new TextDecoder().decode(result.classifications[0].originalBytes)).toBe(raw);
    expect(one.bytes).toEqual(before);
    expect(JSON.stringify(registry)).toBe(backingBefore);
    result.classifications[0].originalBytes.fill(0);
    Object.assign(result.puts[0].value.projects.find(p => p.id === 'unrelated')!, { name: 'Result mutation' });
    expect(one.bytes).toEqual(before);
    expect(JSON.stringify(registry)).toBe(backingBefore);
  });

  it('requires explicit provenance even for source-shaped links and never creates captures', async () => {
    const one = content('source-a');
    for (const provenance of [[], [proof('source-a')]]) {
      const input = request({ snapshots: [one], provenance });
      const result = planned(await createAdoptionPreflightService({ backing: reader() }).preview(input));
      expect(result).toEqual(planAdoption({ ...input, registry: { revision: null, value: null } }));
      expect(result.classifications[0]).toMatchObject(provenance.length
        ? { status: 'adoptable-source-derived', candidates: [{ id: 'source-a', name: null, createdAt: null }] }
        : { status: 'untouched', reason: 'unproven-source-derivation' });
      expect(result.puts[1].value.adopted).toHaveLength(provenance.length);
      expect(result.puts.map(p => p.key)).toEqual([PROJECTS_REGISTRY_KEY, adoptionKey(result.adoptionId)]);
    }
  });

  it('preserves blocked, unsupported, ambiguous, invalid and colliding classifications', async () => {
    const collision = 'shared', source = content(collision);
    const cases: [AdoptionPreflightRequest, RegistrySnapshot, string[]][] = [
      [request({ blockedScopes: { keyPrefixes: ['design.projects/'], projectIds: [] } }), { revision: null, value: null }, ['blocked-pending-import']],
      [request({ blockedScopes: { keyPrefixes: [], projectIds: ['Original_ID:/É'] } }), { revision: null, value: null }, ['blocked-pending-import']],
      [request({ snapshots: [snapshot('future', { schema: 'future/v3' })], provenance: [] }), { revision: null, value: null }, ['unsupported-schema']],
      [request({ provenance: [] }), { revision: null, value: null }, ['ambiguous']],
      [request({ snapshots: [snapshot('bad-json', '{')], provenance: [] }), { revision: null, value: null }, ['invalid']],
      [request({ snapshots: [provisional(collision), source], provenance: [{ kind: 'workspace-local', key: PROVISIONAL_KEY }, proof(collision)] }),
        { revision: null, value: null }, ['conflicting-id', 'conflicting-id']],
      [request({ expectedRegistryRevision: 3 }), { revision: 3, value: { ...emptyRegistry(), projects: [existing('Original_ID:/É')] } }, ['conflicting-id']],
    ];
    for (const [input, registry, reasons] of cases) {
      const result = planned(await createAdoptionPreflightService({ backing: reader(registry) }).preview(input));
      expect(result).toEqual(planAdoption({ ...input, registry }));
      expect(result.classifications.map(c => c.status === 'untouched' ? c.reason : c.status)).toEqual(reasons);
      expect(result.puts[1].value.adopted).toEqual([]);
    }
  });

  it('rejects malformed observations after one read, even when the requested revision is stale', async () => {
    const good = { key: PROJECTS_REGISTRY_KEY, revision: 4, value: emptyRegistry() };
    const observations: unknown[] = [undefined, [], { ...good, key: 'other' }, { ...good, revision: null },
      { ...good, revision: 0 }, { ...good, revision: 1.5 }, { ...good, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...good, value: null }, { ...good, value: { ...emptyRegistry(), schema: 'future/v2' } },
      { ...good, value: { ...emptyRegistry(), projects: [existing(), existing()] } },
      Object.defineProperty({ ...good }, 'value', { enumerable: true, get() { throw new Error('Getter ran'); } }),
    ];
    for (const observation of observations) {
      const backing = { getDocument: vi.fn(async (_key: string) => observation as typeof good) };
      expect(await createAdoptionPreflightService({ backing }).preview(request({ expectedRegistryRevision: 3 })))
        .toMatchObject({ status: 'invalid' });
      expect(backing.getDocument.mock.calls).toEqual([[PROJECTS_REGISTRY_KEY]]);
    }
  });

  it('maps rejected or synchronously thrown reads to unknown without retry or leaking an error', async () => {
    for (const getDocument of [vi.fn(async (_key: string) => { throw new Error('Read rejected'); }),
      vi.fn((_key: string): Promise<null> => { throw new Error('Read threw'); })]) {
      expect(await createAdoptionPreflightService({ backing: { getDocument } }).preview(request()))
        .toEqual({ status: 'unknown', phase: 'registry-read' });
      expect(getDocument.mock.calls).toEqual([[PROJECTS_REGISTRY_KEY]]);
    }
  });

  it('detaches every admitted array, byte buffer and scalar before a pending read', async () => {
    const one = provisional(), source = content('source-a');
    const snapshots = [one, source], evidenceKeys = [source.key];
    const local = { kind: 'workspace-local' as const, key: one.key };
    const sourceProof = { kind: 'proven-source-derivation' as const, key: source.key,
      projectId: 'source-a', sourceProjectId: 'source-a', evidenceKeys };
    const provenance = [local, sourceProof], keyPrefixes: string[] = [], projectIds: string[] = [];
    const input = { snapshots, provenance, blockedScopes: { keyPrefixes, projectIds },
      expectedRegistryRevision: null as number | null, registeredAt: time };
    const expected = planAdoption({ ...input, registry: { revision: null, value: null } });
    let resolveRead!: (value: null) => void;
    const backing = { getDocument: vi.fn((_key: string) => new Promise<null>(resolve => { resolveRead = resolve; })) };
    const pending = createAdoptionPreflightService({ backing }).preview(input);
    expect(backing.getDocument).toHaveBeenCalledTimes(1);
    one.bytes.fill(0); source.bytes.fill(0);
    Object.assign(one, { key: 'changed', revision: 99, digest: sha256Bytes('changed') });
    local.key = 'changed'; sourceProof.projectId = 'changed'; evidenceKeys.splice(0, 1, 'unpinned');
    snapshots.length = 0; provenance.length = 0; keyPrefixes.push('design.'); projectIds.push('source-a');
    input.blockedScopes = { keyPrefixes: ['other'], projectIds: ['other'] };
    input.expectedRegistryRevision = 99; input.registeredAt = '2026-01-03T00:00:00Z';
    resolveRead(null);
    expect(await pending).toEqual(expected);
  });

  it('preserves deterministic adoption identity across enumeration order and proposed planning times', async () => {
    const first = provisional(), second = snapshot('future', { schema: 'future/v2' });
    const service = createAdoptionPreflightService({ backing: reader() });
    const a = planned(await service.preview(request({ snapshots: [first, second] })));
    const b = planned(await service.preview(request({ snapshots: [second, first], registeredAt: '2026-01-03T00:00:00Z' })));
    expect(a.adoptionId).toBe(b.adoptionId);
    expect(a.classifications).toEqual(b.classifications);
    expect(b.puts[1].value.committedAt).toBe('2026-01-03T00:00:00Z');
    expect(planned(await service.preview(request({ snapshots: [{ ...first, revision: 18 }, second] }))).adoptionId).not.toBe(a.adoptionId);
  });
});

it('enforces aggregate count, byte, metadata and registry-capacity budgets with small fixtures', async () => {
  // Exercise the same imported classifier limits with small budgets instead of allocating 64 MiB.
  vi.resetModules();
  vi.doMock('./projects-registry.js', async () => ({ ...await vi.importActual<typeof import('./projects-registry.js')>('./projects-registry.js'),
    MAX_PROJECTS: 4, MAX_INPUT_BYTES: 2048 }));
  try {
    const { createAdoptionPreflightService: boundedService } = await import('./adoption-preflight-service.js');
    const backing = reader(), service = boundedService({ backing });
    expect(await boundedService({ backing: reader() }).preview(request())).toMatchObject({ status: 'planned' });
    const small = snapshot('a', { schema: 'future/v2' });
    for (const input of [request({ snapshots: Array(5).fill(small), provenance: [] }),
      request({ provenance: Array(5).fill({ kind: 'workspace-local', key: PROVISIONAL_KEY }) }),
      request({ blockedScopes: { keyPrefixes: [], projectIds: ['a', 'b', 'c', 'd', 'e'] } }),
      request({ snapshots: [snapshot('a', 'x'.repeat(1100)), snapshot('b', 'x'.repeat(1100))], provenance: [] }),
      request({ snapshots: [snapshot('a', 'x'.repeat(1600))], provenance: [],
        blockedScopes: { keyPrefixes: ['b'.repeat(256), 'c'.repeat(256)], projectIds: [] } }),
    ]) expect(await service.preview(input)).toMatchObject({ status: 'invalid' });
    expect(backing.getDocument).not.toHaveBeenCalled();
    const a = content('a'), b = content('b'), evidence = snapshot('evidence', { schema: 'future/v2' });
    expect(await service.preview(request({ snapshots: [a, b, evidence], provenance: ['a', 'b'].map(id => ({
      kind: 'proven-source-derivation', key: contentKey(id), projectId: id, sourceProjectId: id,
      evidenceKeys: [a.key, b.key, evidence.key],
    })) }))).toMatchObject({ status: 'invalid' });
    expect(backing.getDocument).not.toHaveBeenCalled();
    const candidates = snapshot(PROVISIONAL_KEY, { schema: PROVISIONAL_SCHEMA,
      projects: ['a', 'b', 'c', 'd'].map(id => ({ id, name: null, createdAt: null })) });
    const extra = content('e');
    expect(await service.preview(request({ snapshots: [candidates, extra],
      provenance: [{ kind: 'workspace-local', key: PROVISIONAL_KEY }, proof('e')] }))).toMatchObject({ status: 'invalid' });
    expect(backing.getDocument).not.toHaveBeenCalled();
    const full = { revision: 1, value: { ...emptyRegistry(), projects: ['a', 'b', 'c', 'd'].map(id => existing(id)) } };
    const current = reader(full);
    expect(await boundedService({ backing: current }).preview(request({ expectedRegistryRevision: 1 }))).toMatchObject({ status: 'invalid' });
    expect(current.getDocument).toHaveBeenCalledTimes(1);
    const largeRegistry = { revision: 1, value: { ...emptyRegistry(), projects: ['a', 'b', 'c', 'd'].map(id => ({ ...existing(id), name: 'n'.repeat(300) })) } };
    const metadataBacking = reader(largeRegistry);
    expect(await boundedService({ backing: metadataBacking }).preview(request({ snapshots: [snapshot('future', 'x'.repeat(700))],
      provenance: [], expectedRegistryRevision: 1 }))).toMatchObject({ status: 'invalid' });
    expect(metadataBacking.getDocument).toHaveBeenCalledTimes(1);
  } finally {
    vi.doUnmock('./projects-registry.js');
    vi.resetModules();
  }
});
