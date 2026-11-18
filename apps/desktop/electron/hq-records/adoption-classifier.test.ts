import { describe, expect, it } from 'vitest';
import { sha256Bytes } from './canonical.js';
import {
  classifySnapshots, CONTENT_SCHEMA, contentKey, planAdoption, PROVISIONAL_KEY, PROVISIONAL_SCHEMA,
  type BlockedScopes, type IdentityProvenance, type SyntheticSnapshot,
} from './adoption-classifier.js';
import { emptyRegistry, MAX_INPUT_BYTES, MAX_PROJECTS } from './projects-registry.js';

const time = '2026-01-02T03:04:05.000Z';
const noBlocks: BlockedScopes = { keyPrefixes: [], projectIds: [] };
const local: IdentityProvenance = { kind: 'workspace-local', key: PROVISIONAL_KEY };
const legacy = (id = 'Legacy:/É') => ({ id, name: 'Original', createdAt: time });
function snapshot(key: string, value: unknown, revision = 1): SyntheticSnapshot {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  return { key, revision, digest: sha256Bytes(bytes), bytes };
}
const provisional = (projects: unknown[] = [legacy()]) => snapshot(PROVISIONAL_KEY, { schema: PROVISIONAL_SCHEMA, projects });
const content = (projectId = 'source-a') => ({ schema: CONTENT_SCHEMA, projectId, views: [], versions: [], links: [], updatedAt: time });
const sourceProof = (id = 'source-a', evidenceKeys = [contentKey(id)]): IdentityProvenance => ({
  kind: 'proven-source-derivation', key: contentKey(id), projectId: id, sourceProjectId: id, evidenceKeys,
});
const plan = (snapshots: SyntheticSnapshot[], provenance: IdentityProvenance[] = [local], blockedScopes = noBlocks) => planAdoption({
  snapshots, provenance, blockedScopes, registry: { revision: null, value: null }, expectedRegistryRevision: null, registeredAt: time,
});
function classifications(snapshots: SyntheticSnapshot[], provenance: IdentityProvenance[] = [local], blockedScopes = noBlocks) {
  const result = classifySnapshots(snapshots, provenance, blockedScopes);
  if (result.status !== 'classified') throw new Error(result.reason);
  return result.classifications;
}

describe('synthetic identity classification', () => {
  it('adopts parsed provisional v1 with exact IDs and unknown metadata remaining null', () => {
    const original = provisional([legacy(), { id: 'unknown_metadata', name: null, createdAt: null }]);
    const result = classifications([original]);
    expect(result[0]).toMatchObject({ status: 'adoptable-workspace-local', pin: { key: PROVISIONAL_KEY, revision: 1, digest: original.digest },
      candidates: [{ id: 'Legacy:/É', name: 'Original', createdAt: time }, { id: 'unknown_metadata', name: null, createdAt: null }] });
    expect(result[0].originalBytes).toEqual(original.bytes);
    expect(result[0].originalBytes).not.toBe(original.bytes);
    const planned = plan([original]);
    expect(planned.status).toBe('planned');
    if (planned.status !== 'planned') throw new Error('Expected plan');
    expect(planned.puts[0].value.projects).toMatchObject([
      { id: 'Legacy:/É', registeredAt: time, adoptionId: planned.adoptionId },
      { id: 'unknown_metadata', name: null, createdAt: null, registeredAt: time },
    ]);
  });

  it('requires explicit proof for source-derived identity, never mere source equality, links or fixture views', () => {
    const shaped = { ...content(), views: [{ id: 'v', title: 'Synthetic view', kind: 'screen', createdAt: time }],
      links: [{ projectId: 'source-a', sourceProjectId: 'source-a', linkedAt: time, observedRevision: null }] };
    const input = snapshot(contentKey('source-a'), shaped);
    expect(classifications([input], [])[0]).toMatchObject({ status: 'untouched', reason: 'unproven-source-derivation' });
    expect(classifications([input], [sourceProof()])[0]).toMatchObject({ status: 'adoptable-source-derived',
      candidates: [{ id: 'source-a', identityOrigin: 'adopted-source-derived', name: null, createdAt: null }] });
    const unrelated = { ...sourceProof(), projectId: 'other' } as IdentityProvenance;
    expect(classifications([input], [unrelated])[0]).toMatchObject({ status: 'untouched', reason: 'unproven-source-derivation' });
    expect(classifySnapshots([input], [{ ...sourceProof(), evidenceKeys: ['unpinned'] } as IdentityProvenance], noBlocks)).toMatchObject({ status: 'invalid' });
    expect(classifications([input], [sourceProof(), sourceProof()])[0]).toMatchObject({ status: 'untouched', reason: 'ambiguous' });
  });

  it('leaves unsupported, malformed, ambiguous, mis-keyed and invalid legacy records untouched', () => {
    const cases: [SyntheticSnapshot, IdentityProvenance[], string][] = [
      [snapshot(PROVISIONAL_KEY, { schema: 'hq.design.projects.provisional-registry/v2', projects: [legacy()] }), [local], 'unsupported-schema'],
      [snapshot('bad-json', '{"schema":'), [], 'invalid'],
      [provisional(), [], 'ambiguous'],
      [snapshot('other-registry', { schema: PROVISIONAL_SCHEMA, projects: [legacy()] }), [{ kind: 'workspace-local', key: 'other-registry' }], 'ambiguous'],
      [provisional([legacy(), legacy()]), [local], 'conflicting-id'],
      [provisional([{ ...legacy(), name: '' }]), [local], 'invalid'],
      [provisional([{ ...legacy(), createdAt: '2026-02-30T00:00:00Z' }]), [local], 'invalid'],
      [provisional([{ ...legacy(), extra: 'unknown' }]), [local], 'invalid'],
      [snapshot(contentKey('other'), content()), [], 'conflicting-id'],
      [snapshot(contentKey('source-a'), { ...content(), extra: true }), [], 'invalid'],
      [snapshot(contentKey('source-a'), { ...content(), views: [{ id: 'v' }] }), [], 'invalid'],
      [provisional([legacy('hq-local')]), [local], 'invalid'],
      [snapshot(PROVISIONAL_KEY, '{"schema":"hq.design.projects.provisional-registry/v1","projects":[],"projects":[]}'), [local], 'ambiguous'],
    ];
    for (const [input, provenance, reason] of cases) {
      expect(classifications([input], provenance)[0], reason).toMatchObject({ status: 'untouched', reason });
    }
  });

  it('keeps explicit blocked keys and project scopes untouched without adopting part of their document', () => {
    const input = provisional([legacy('a'), legacy('b')]);
    for (const blocks of [{ keyPrefixes: ['design.projects/'], projectIds: [] }, { keyPrefixes: [], projectIds: ['b'] }]) {
      expect(classifications([input], [local], blocks)[0]).toMatchObject({ status: 'untouched', reason: 'blocked-pending-import' });
      const result = plan([input], [local], blocks);
      if (result.status !== 'planned') throw new Error('Expected untouched plan');
      expect(result.puts[0].value.projects).toEqual([]);
      expect(result.puts[1].value.untouched).toEqual([{ key: PROVISIONAL_KEY, reason: 'blocked-pending-import' }]);
    }
    const unproven = snapshot(contentKey('source-a'), content());
    expect(classifications([unproven], [], { keyPrefixes: [], projectIds: ['source-a'] })[0])
      .toMatchObject({ status: 'untouched', reason: 'blocked-pending-import' });
  });

  it('refuses every colliding candidate, including collisions with the existing registry', () => {
    const inputs = [provisional([legacy('source-a')]), snapshot(contentKey('source-a'), content())];
    const evidence = [local, sourceProof()];
    const result = classifications(inputs, evidence);
    expect(result).toHaveLength(2);
    expect(result.every(c => c.status === 'untouched' && c.reason === 'conflicting-id')).toBe(true);
    const existing = classifySnapshots([inputs[1]], [sourceProof()], noBlocks, ['source-a']);
    expect(existing).toMatchObject({ status: 'classified', classifications: [{ status: 'untouched', reason: 'conflicting-id' }] });
  });

  it('treats shell hq-local as scope only and never synthesizes a project from it', () => {
    const shell = snapshot('shell/context', { schema: 'hq.shell.context/v1', id: 'hq-local', name: 'Scope' });
    const result = plan([shell], []);
    expect(result.status).toBe('planned');
    if (result.status === 'planned') {
      expect(result.puts[0].value.projects).toEqual([]);
      expect(result.puts[1].value.adopted).toEqual([]);
    }
  });

  it('bounds snapshot count, total candidate count, bytes, provenance and safe document revisions', () => {
    const one = provisional();
    expect(classifySnapshots(Array.from({ length: MAX_PROJECTS + 1 }, () => one), [], noBlocks)).toMatchObject({ status: 'invalid' });
    expect(classifySnapshots([{ ...one, bytes: new Uint8Array(MAX_INPUT_BYTES + 1) }], [local], noBlocks)).toMatchObject({ status: 'invalid' });
    expect(classifySnapshots([one, one], [local], noBlocks)).toMatchObject({ status: 'invalid' });
    expect(classifySnapshots([one], Array.from({ length: MAX_PROJECTS + 1 }, () => local), noBlocks)).toMatchObject({ status: 'invalid' });
    for (const revision of [0, 1.1, Number.MAX_SAFE_INTEGER + 1, -1]) {
      expect(classifySnapshots([{ ...one, revision }], [local], noBlocks)).toMatchObject({ status: 'invalid' });
    }
    expect(classifications([{ ...one, revision: Number.MAX_SAFE_INTEGER }])[0].pin.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(classifySnapshots([{ ...one, digest: `sha256:${'0'.repeat(64)}` }], [local], noBlocks)).toMatchObject({ status: 'invalid' });
    const tooMany = provisional(Array.from({ length: MAX_PROJECTS + 1 }, (_, index) => legacy(`p-${index}`)));
    expect(classifications([tooMany])[0]).toMatchObject({ status: 'untouched', reason: 'invalid' });
    const atLimit = provisional(Array.from({ length: MAX_PROJECTS }, (_, index) => legacy(`p-${index}`)));
    const extra = snapshot(contentKey('source-extra'), content('source-extra'));
    expect(classifySnapshots([atLimit, extra], [local, sourceProof('source-extra')], noBlocks)).toMatchObject({ status: 'invalid' });
    const invalidUtf8 = new Uint8Array([0xff]);
    expect(classifications([{ key: 'bad-utf8', revision: 1, bytes: invalidUtf8, digest: sha256Bytes(invalidUtf8) }], [])[0])
      .toMatchObject({ status: 'untouched', reason: 'invalid' });
  });
});

describe('pure bounded adoption plans', () => {
  it('preserves original noncanonical bytes, pins and IDs, with only two allowed future puts', () => {
    const raw = ' { "projects": [ { "createdAt": null, "name": null, "id": "Original_ID:/É" } ], "schema": "hq.design.projects.provisional-registry/v1" }\n';
    const original = snapshot(PROVISIONAL_KEY, raw, 17);
    const before = original.bytes.slice();
    const result = plan([original]);
    if (result.status !== 'planned') throw new Error('Expected adoption plan');
    expect(result.adoptionId).toMatch(/^adopt-[0-9a-f]{32}$/u);
    expect(result.puts.map(p => p.key)).toEqual(['hq/projects/registry', `hq/projects/adoptions/${result.adoptionId}`]);
    expect(result.puts.map(p => p.expectedRevision)).toEqual([null, null]);
    expect(result.puts[1].value.inputs).toEqual([{ key: PROVISIONAL_KEY, revision: 17, digest: original.digest }]);
    expect(result.classifications[0].originalBytes).toEqual(before);
    expect(original.bytes).toEqual(before);
    expect(result.puts[0].value.projects[0]).toEqual({ id: 'Original_ID:/É', identityOrigin: 'adopted-workspace-local',
      name: null, createdAt: null, registeredAt: time, adoptionId: result.adoptionId });
  });

  it('changes deterministic adoption identity on any pinned revision/digest change and ignores input enumeration order', () => {
    const a = provisional(), b = snapshot('unsupported/b', { schema: 'future/v9' }, 7);
    const first = plan([a, b]), reversed = plan([b, a]);
    if (first.status !== 'planned' || reversed.status !== 'planned') throw new Error('Expected plans');
    expect(first).toEqual(reversed);
    for (const updated of [{ ...a, revision: 2 }, snapshot(PROVISIONAL_KEY, `${new TextDecoder().decode(a.bytes)} `),
      { ...b, revision: 8 }, snapshot(b.key, { schema: 'future/v10' }, 7)]) {
      const changed = updated.key === a.key ? plan([updated, b]) : plan([a, updated]);
      if (changed.status !== 'planned') throw new Error('Expected changed plan');
      expect(changed.adoptionId).not.toBe(first.adoptionId);
    }
    const later = planAdoption({ snapshots: [a, b], provenance: [local], blockedScopes: noBlocks,
      registry: { revision: null, value: null }, expectedRegistryRevision: null, registeredAt: '2026-01-03T00:00:00Z' });
    if (later.status !== 'planned') throw new Error('Expected later plan');
    expect(later.adoptionId).toBe(first.adoptionId);
  });

  it('returns no plan on stale CAS and retains existing registered records byte-exact', () => {
    const prior = { id: 'existing', identityOrigin: 'hq-created', name: 'Existing', createdAt: time, registeredAt: time, adoptionId: null };
    const input = { snapshots: [provisional()], provenance: [local], blockedScopes: noBlocks,
      registry: { revision: 4, value: { ...emptyRegistry(), projects: [prior] } }, expectedRegistryRevision: 3, registeredAt: time };
    expect(planAdoption(input)).toEqual({ status: 'conflict', reason: 'registry-revision' });
    const result = planAdoption({ ...input, expectedRegistryRevision: 4 });
    if (result.status !== 'planned') throw new Error('Expected current plan');
    expect(result.puts[0].expectedRevision).toBe(4);
    expect(result.puts[0].value.projects.find(p => p.id === 'existing')).toEqual(prior);
    expect(input.registry.value.projects).toEqual([prior]);
  });

  it('records ambiguous provenance as unproven in the closed adoption audit record', () => {
    const result = plan([provisional()], []);
    if (result.status !== 'planned') throw new Error('Expected untouched audit plan');
    expect(result.classifications[0]).toMatchObject({ status: 'untouched', reason: 'ambiguous' });
    expect(result.puts[1].value.untouched).toEqual([{ key: PROVISIONAL_KEY, reason: 'unproven-source-derivation' }]);
  });
});
