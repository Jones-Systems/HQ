import { expect, it } from 'vitest';
import { CONTENT_SCHEMA, contentKey, PROVISIONAL_KEY } from './adoption-classifier.js';
import { emptyRegistry } from './projects-registry.js';
import { canGenericWrite, canWriteContent, D2_ORDERING_PLAN } from './write-fence.js';

const time = '2026-01-02T03:04:05.000Z';
const registry = { ...emptyRegistry(), projects: [{ id: 'registered', identityOrigin: 'adopted-workspace-local',
  name: null, createdAt: null, registeredAt: time, adoptionId: 'adopt-a' }] };
const view = { id: 'view-1', title: 'Example', kind: 'screen', createdAt: time };
const version = (id = 'version-1', ordinal = 1) => ({ id, viewId: 'view-1', ordinal, label: 'Example', createdAt: time,
  capture: { route: '/', viewport: { w: 800, h: 600, dpr: 1 } }, origin: 'synthetic-fixture' });
const content = () => ({ schema: CONTENT_SCHEMA, projectId: 'registered', views: [view], versions: [version()], links: [], updatedAt: time });
const input = () => ({ registry, projectId: 'registered', key: contentKey('registered'), actualRevision: 3,
  expectedRevision: 3, previous: content(), next: { ...content(), versions: [version(), version('version-2', 2)] } });

it('states D2 ordering only and leaves schema floor, recovery reader and cutover unimplemented', () => {
  expect(D2_ORDERING_PLAN).toEqual(['barrier', 'schema1-reconciliation', 'facade-visible-preflight-and-diagnostics',
    'recheck-pins', 'copy-forward-schema2-publish', 'verify', 'main-writer-fence']);
  expect(Object.isFrozen(D2_ORDERING_PLAN)).toBe(true);
});

it('refuses generic reserved/content writes and makes provisional registry read-only once fenced', () => {
  for (const actor of ['main', 'renderer', 'import'] as const) {
    expect(canGenericWrite({ actor, key: 'hq/projects/registry', mainWriterFenced: false })).toBe(false);
    expect(canGenericWrite({ actor, key: 'hq/future/key', mainWriterFenced: true })).toBe(false);
    expect(canGenericWrite({ actor, key: contentKey('registered'), mainWriterFenced: false })).toBe(false);
    expect(canGenericWrite({ actor, key: PROVISIONAL_KEY, mainWriterFenced: true })).toBe(false);
    expect(canGenericWrite({ actor, key: PROVISIONAL_KEY, mainWriterFenced: false })).toBe(true);
  }
});

it('accepts validated registered append-only content against the same expected CAS revision', () => {
  const request = input();
  expect(canWriteContent(request)).toBe(true);
  expect(canWriteContent({ ...request, actualRevision: null, expectedRevision: null, previous: null })).toBe(true);
  expect(request.registry).toEqual(registry);
  expect(request.previous.versions).toEqual([version()]);
});

it('preserves legacy fractional viewport values without relaxing canonical HQ record numbers', () => {
  const fractional = { ...version(), capture: { viewport: { dpr: 1.5, h: 600, w: 800 }, route: '/' } };
  const request = { ...input(), previous: { ...content(), versions: [fractional] },
    next: { ...content(), versions: [{ ...fractional, capture: { route: '/', viewport: { w: 800, h: 600, dpr: 1.5 } } }, version('version-2', 2)] } };
  expect(canWriteContent(request)).toBe(true);
  expect(canWriteContent({ ...request, next: { ...request.next, versions: [{ ...fractional, capture: { route: '/', viewport: { w: 800, h: 600, dpr: 2 } } }] } })).toBe(false);
});

it('refuses unregistered IDs, key/identity mismatches, missing/unsafe/stale pins and edited history', () => {
  const original = input();
  for (const patch of [
    { registry: emptyRegistry() }, { projectId: 'hq-local' }, { projectId: 'source-id' }, { key: contentKey('other') },
    { expectedRevision: 2 }, { expectedRevision: 3.5 }, { expectedRevision: 0 },
    { actualRevision: null, expectedRevision: null }, { previous: null },
    { actualRevision: Number.MAX_SAFE_INTEGER, expectedRevision: Number.MAX_SAFE_INTEGER },
    { next: { ...original.next, projectId: 'other' } },
    { next: { ...original.next, versions: [version('replacement'), version('version-2', 2)] } },
    { next: { ...original.next, versions: [version('version-2', 2), version()] } },
    { next: { ...original.next, versions: [] } },
    { next: { ...original.next, versions: [{ ...version(), label: 'edited' }, version('version-2', 2)] } },
    { next: { ...original.next, views: [] } },
    { next: { ...original.next, versions: [version(), version('version-2', 3)] } },
    { next: { ...original.next, extra: true } },
  ]) expect(canWriteContent({ ...original, ...patch })).toBe(false);
});

it('does not turn source associations or content writes into automatic registration', () => {
  const request = input();
  const linked = { ...request.next, links: [{ projectId: 'registered', sourceProjectId: 'unregistered-source', linkedAt: time, observedRevision: null }] };
  expect(canWriteContent({ ...request, registry: emptyRegistry(), next: linked })).toBe(false);
  expect(emptyRegistry().projects).toEqual([]);
});
