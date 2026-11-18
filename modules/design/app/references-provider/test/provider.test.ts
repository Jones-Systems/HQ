import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReferenceEnvelope, ReferenceStatus } from '@hq/contracts';
import { parseReference, REFERENCE_STATUSES } from '../../../../../packages/contracts/src/index.ts';
import { formatDestination, parseDestination } from '../../../ui/src/navigation.ts';
import { createDesignReferenceProvider } from '../index.ts';
import type { DesignReferenceKind, DesignReferenceRead, DesignReferenceReads, DesignReferenceRecord } from '../index.ts';

const observedAt = '2026-01-15T12:00:00.000Z';
const kinds: readonly DesignReferenceKind[] = ['project', 'version', 'request', 'reference'];
const destinations: Record<DesignReferenceKind, string> = {
  project: 'projects/projects', version: 'review', request: 'requests', reference: 'resources',
};
const record = (kind: DesignReferenceKind): DesignReferenceRecord => ({
  kind, entityId: `${kind}-1`, projectId: 'project-a', title: `Synthetic ${kind}`,
  revision: 'revision-1', archived: false, destination: destinations[kind],
});
function envelope(kind: DesignReferenceKind): ReferenceEnvelope {
  const r = record(kind);
  return { version: 1, domain: 'design', kind, entityId: r.entityId, projectId: r.projectId,
    title: r.title, sourceRevision: r.revision, returnDestination: { domain: 'design', destination: destinations[kind] } };
}

/** Labelled synthetic read projection with forbidden capabilities exposed only to the recorder. */
class SyntheticReads implements DesignReferenceReads {
  readonly label = 'Synthetic — no storage or execution';
  readonly calls: string[] = [];
  writes = 0;
  executions = 0;
  records: readonly DesignReferenceRecord[] = kinds.map(record);
  failure = false;
  answer: DesignReferenceRead | undefined;
  async list(projectId: string) {
    this.calls.push(`list:${projectId}`);
    if (this.failure) throw new Error('Synthetic read failure');
    return this.records;
  }
  async read(kind: DesignReferenceKind, entityId: string, projectId: string): Promise<DesignReferenceRead> {
    this.calls.push(`read:${kind}:${entityId}:${projectId}`);
    if (this.failure) throw new Error('Synthetic read failure');
    if (this.answer) return this.answer;
    const found = this.records.find((r) => r.kind === kind && r.entityId === entityId);
    return found ? { status: 'found', record: found } : { status: 'missing' };
  }
  write() { this.writes += 1; throw new Error('Writes forbidden'); }
  execute() { this.executions += 1; throw new Error('Execution forbidden'); }
}

describe('Design reference provider over labelled synthetic reads', () => {
  for (const kind of kinds) it(`finds and resolves ${kind} without changing source bytes`, async () => {
    const reads = new SyntheticReads(); const provider = createDesignReferenceProvider(reads, () => observedAt);
    const before = JSON.stringify(reads.records);
    const found = await provider.find('SYNTHETIC', { projectId: 'project-a', kinds: [kind], limit: 10 });
    assert.equal(found.length, 1); assert.deepEqual(found[0], envelope(kind));
    assert.deepEqual(parseReference(found[0]), found[0]);
    const resolved = await provider.resolve(envelope(kind));
    assert.equal(resolved.status, 'available'); assert.equal(resolved.observedAt, observedAt);
    assert.equal(resolved.destination, destinations[kind]);
    assert.equal(JSON.stringify(reads.records), before);
    assert.equal(reads.writes, 0); assert.equal(reads.executions, 0);
  });

  it('filters project, kinds, title and limit even when the read adapter returns extra records', async () => {
    const reads = new SyntheticReads();
    reads.records = [{ ...record('project'), projectId: 'other' }, record('request'), record('request'), record('reference')];
    const provider = createDesignReferenceProvider(reads, () => observedAt);
    assert.deepEqual((await provider.find(' synthetic ', { projectId: 'project-a', limit: 1 })).map((r) => r.kind), ['request']);
    assert.equal((await provider.find('', { projectId: 'project-a', limit: 10 })).length, 2);
    assert.equal((await provider.find('reference', { projectId: 'project-a', kinds: ['request'], limit: 10 })).length, 0);
    assert.equal((await provider.find('', { projectId: 'other', limit: 10 })).length, 1);
    for (const limit of [0, -1, 0.5, Infinity, NaN]) assert.deepEqual(await provider.find('', { projectId: 'project-a', limit }), []);
    assert.deepEqual(await provider.find('', { projectId: 'project-a', kinds: [], limit: 10 }), []);
    assert.deepEqual(await provider.find('', { projectId: 'project-a', kinds: ['unsupported'], limit: 10 }), []);
  });

  it('covers all eight canonical statuses, stamped after each observation, without effects', async () => {
    const reads = new SyntheticReads(); let clock = 0;
    const provider = createDesignReferenceProvider(reads, () => `${observedAt}/${++clock}`);
    const outcomes: ReferenceStatus[] = [];
    const cases: readonly DesignReferenceRead[] = [
      { status: 'found', record: record('request') },
      { status: 'found', record: { ...record('request'), revision: 'revision-2' } },
      { status: 'found', record: { ...record('request'), archived: true } },
      { status: 'missing' },
      { status: 'found', record: { ...record('request'), projectId: 'project-b' } },
      { status: 'forbidden' }, { status: 'unavailable' }, { status: 'unknown' },
    ];
    for (const answer of cases) {
      reads.answer = answer;
      const r = await provider.resolve(envelope('request'));
      outcomes.push(r.status); assert.equal(r.observedAt, `${observedAt}/${outcomes.length}`);
      if (['archived', 'missing', 'forbidden', 'unavailable', 'unknown'].includes(r.status)) assert.equal(r.destination, undefined);
      if (r.status === 'moved') assert.equal(r.targetProjectId, 'project-b');
    }
    assert.deepEqual(outcomes, [...REFERENCE_STATUSES]);
    assert.equal(reads.writes, 0); assert.equal(reads.executions, 0);
  });

  it('does not hide failed search as empty or failed resolution as available', async () => {
    const reads = new SyntheticReads(); reads.failure = true;
    const provider = createDesignReferenceProvider(reads, () => observedAt);
    await assert.rejects(provider.find('', { projectId: 'project-a', limit: 10 }), /Synthetic read failure/u);
    assert.deepEqual(await provider.resolve(envelope('project')), { status: 'unavailable', observedAt });
  });

  it('reports missing, archived, moved and changed truthfully for every kind', async () => {
    const reads = new SyntheticReads(); const provider = createDesignReferenceProvider(reads, () => observedAt);
    for (const kind of kinds) {
      reads.answer = { status: 'missing' };
      assert.equal((await provider.resolve(envelope(kind))).status, 'missing');
      for (const [status, change] of [
        ['archived', { archived: true }], ['moved', { projectId: 'project-b' }], ['changed', { title: 'New title' }],
      ] satisfies readonly (readonly [ReferenceStatus, Partial<DesignReferenceRecord>])[]) {
        reads.answer = { status: 'found', record: { ...record(kind), ...change } };
        assert.equal((await provider.resolve(envelope(kind))).status, status);
      }
    }
  });

  it('does not guess unsupported identities or unavailable revision comparisons', async () => {
    const reads = new SyntheticReads(); const provider = createDesignReferenceProvider(reads, () => observedAt);
    for (const snapshot of [{ ...envelope('project'), domain: 'work' }, { ...envelope('project'), kind: 'unsupported' }] satisfies ReferenceEnvelope[]) {
      assert.equal((await provider.resolve(snapshot)).status, 'unknown');
    }
    assert.equal(reads.calls.length, 0);
    reads.answer = { status: 'found', record: record('reference') };
    assert.equal((await provider.resolve(envelope('project'))).status, 'unknown');
    reads.answer = { status: 'found', record: { ...record('project'), revision: undefined } };
    const unresolved = await provider.resolve(envelope('project'));
    assert.equal(unresolved.status, 'unknown'); assert.equal(unresolved.destination, undefined);
  });

  it('only emits destinations that round-trip through T14; no invented entity routes', async () => {
    const reads = new SyntheticReads(); const provider = createDesignReferenceProvider(reads, () => observedAt);
    for (const destination of ['projects/projects', 'review/compare', 'requests', 'resources', 'runs']) {
      reads.records = [{ ...record('request'), destination }];
      const r = await provider.resolve(envelope('request'));
      assert.equal(r.destination, formatDestination(parseDestination(destination)));
    }
    for (const destination of [undefined, 'home', 'https://example.invalid', 'requests/id/extra', 'review/Bad', 'review/', 'projects?entity=x']) {
      reads.records = [{ ...record('request'), destination }];
      assert.equal((await provider.resolve(envelope('request'))).destination, undefined);
      assert.deepEqual(await provider.find('', { projectId: 'project-a', limit: 10 }), []);
    }
  });

  it('excludes archived and malformed projections from search without changing them', async () => {
    const reads = new SyntheticReads(); const provider = createDesignReferenceProvider(reads, () => observedAt);
    reads.records = [{ ...record('request'), archived: true }, { ...record('project'), title: '' }];
    assert.deepEqual(await provider.find('', { projectId: 'project-a', limit: 10 }), []);
    assert.equal((await provider.resolve(envelope('project'))).status, 'unknown');
    assert.equal(reads.writes, 0); assert.equal(reads.executions, 0);
  });
});
