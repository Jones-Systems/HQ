import { describe, expect, it } from 'vitest';
import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import { createFixtureWorkspace, FEATURE_HQ_BRAND_PROJECT, fictionalSeed, FIXTURE_IDS, recordCalls } from '../core';
import { createSocialReferenceProvider } from './index';

const projectId = 'fixture-project';
const now = () => new Date('2026-10-20T12:00:00Z');
function setup() {
  const fixture = createFixtureWorkspace({ features: [FEATURE_HQ_BRAND_PROJECT], clock: now });
  const recorder = recordCalls(fixture.port);
  return { ...fixture, recorder, provider: createSocialReferenceProvider(recorder.port, projectId, now) };
}

describe('read-only Social references', () => {
  it('finds valid project-scoped drafts, brands and runs with kind and limit filters, without writing', async () => {
    const { recorder, provider } = setup();
    const found = await provider.find('', { projectId, limit: 30 });
    expect(new Set(found.map((item) => item.kind))).toEqual(new Set(['draft', 'brand', 'run']));
    expect(found.every((item) => parseReference(item))).toBe(true);
    expect(found.some((item) => item.entityId === FIXTURE_IDS.openDay)).toBe(false);
    expect(await provider.find('autumn', { projectId, kinds: ['draft'], limit: 1 })).toHaveLength(1);
    expect(await provider.find('', { projectId: 'elsewhere', limit: 30 })).toEqual([]);
    expect(await provider.find('', { projectId, limit: -1 })).toEqual([]);
    expect(recorder.calls().map((call) => call.method)).toEqual(['snapshot', 'snapshot']);
    expect(recorder.callsOf('execution')).toEqual([]);
  });

  it('resolves available, changed, archived, missing and moved, preserving observedAt', async () => {
    const { controls, recorder, provider } = setup();
    const found = await provider.find('Autumn', { projectId, limit: 30 });
    const envelope = found[0]!;
    expect(await provider.resolve(envelope)).toMatchObject({ status: 'available', latestRevision: '3', observedAt: '2026-10-20T12:00:00+00:00' });
    controls.editElsewhere(FIXTURE_IDS.autumnBlend, { title: 'Changed fictional draft' });
    expect(await provider.resolve(envelope)).toMatchObject({ status: 'changed', latestRevision: '4' });
    expect(envelope.title).toBe('Autumn blend tasting notes');
    const archived = (await provider.find('Summer', { projectId, limit: 1 }))[0]!;
    expect(await provider.resolve(archived)).toMatchObject({ status: 'archived' });
    expect(await provider.resolve({ ...envelope, entityId: 'absent' })).toMatchObject({ status: 'missing' });
    expect(await provider.resolve({ ...envelope, entityId: FIXTURE_IDS.openDay })).toMatchObject({ status: 'moved', targetProjectId: 'fixture-other-project' });
    expect(recorder.calls().every((call) => call.method === 'snapshot')).toBe(true);
    expect(recorder.callsOf('execution')).toEqual([]);
  });

  it('reports forbidden, unavailable and unknown truthfully, including unsupported envelopes', async () => {
    const { controls, recorder, provider } = setup();
    const envelope = (await provider.find('Autumn', { projectId, limit: 1 }))[0]!;
    for (const kind of ['forbidden', 'unavailable', 'unknown'] as const) {
      controls.failNext('snapshot', kind === 'unknown' ? { kind, attemptedAt: now().toISOString() } : { kind });
      expect(await provider.resolve(envelope)).toEqual({ status: kind, observedAt: now().toISOString() });
    }
    recorder.clear();
    expect(await provider.resolve({ ...envelope, kind: 'unsupported' })).toMatchObject({ status: 'unknown' });
    expect(await provider.resolve({ ...envelope, domain: 'work' })).toMatchObject({ status: 'unknown' });
    expect(recorder.calls()).toEqual([]);
  });

  it('resolves a run beyond the bounded workspace list by read, never execution', async () => {
    const seed = fictionalSeed();
    const old = seed.runs.find((run) => run.record.id === FIXTURE_IDS.exampleRun)!.record;
    const fixture = createFixtureWorkspace({ clock: now });
    const recorder = recordCalls({ ...fixture.port, snapshot: async () => ({ ...await fixture.port.snapshot(), runs: [] }) });
    const provider = createSocialReferenceProvider(recorder.port, projectId, now);
    const envelope: ReferenceEnvelope = { version: 1, domain: 'social', kind: 'run', projectId,
      entityId: old.id, title: 'Old snapshot', returnDestination: { domain: 'social', destination: 'library' } };
    expect(await provider.resolve(envelope)).toMatchObject({ status: 'changed', latestRevision: '2026-10-18', destination: `runs/${old.id}` });
    expect(recorder.calls().map((call) => call.method)).toEqual(['snapshot', 'run']);
    expect(recorder.callsOf('execution')).toEqual([]);
  });
});
