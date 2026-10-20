import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import type { ReferenceEnvelope } from '@hq/contracts';
import { createDesignReferenceReads } from '../reference-reads.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createTransportDouble } from './bridge-double.ts';
import { toJson, PROJECTS_KEY_ROOT } from '../../storage/index.ts';
import { createDesignReferenceProvider } from '../../references-provider/index.ts';
import type { DesignReferenceKind, DesignReferenceRecord } from '../../references-provider/index.ts';
import { createProjectContent, addView, addVersion } from '../../../projects/src/content.ts';
import { projectId, viewId, versionId } from '../../../projects/src/ids.ts';
import { contentKey } from '../../../projects/src/repository.ts';
import { newDraft, applyEdit, continuationOf } from '../../../requests/src/draft.ts';
import { brandId } from '../../../requests/src/validate.ts';
import { buildPacket } from '../../../requests/src/packet.ts';
import { FREEZE_SCHEMA } from '../../../requests/src/contract.ts';
import { digestOf } from '../../../requests/src/jcs.ts';
import { LIBRARY_DOCUMENT_KEY, LIBRARY_SCHEMA } from '../../../references/src/contract.ts';
import { parseLibraryDocument } from '../../../references/src/persist.ts';
import { formatDestination, parseDestination } from '../../../ui/src/navigation.ts';

const now = '2026-01-01T00:00:00.000Z';
const later = '2026-01-02T00:00:00.000Z';
const project = 'project-a';
const request = 'request-one';
const draftKey = `design/requests/${request}/draft`;
const reference = `ref_${'a'.repeat(64)}`;
const otherReference = `ref_${'b'.repeat(64)}`;
const source = (p = project, v = 'version-one') => ({ projectId: brandId<'ProjectId'>(p), viewId: brandId<'ViewId'>('view-home'), versionId: brandId<'VersionId'>(v), sourceRevision: 'revision-one' });
const draft = () => newDraft({ requestId: brandId(request), draftId: brandId('draft-one'), now, title: 'Synthetic request', sources: [source()] });
const record = (id = reference) => ({ id, kind: 'screenshot', source: { kind: 'url', url: 'https://example.com/' }, asset: null,
  capturedAt: now, capturedBy: 'owner-judged', nativeEvidence: null, title: 'Synthetic reference', notes: '', tags: ['synthetic'],
  rights: { status: 'unknown', basis: null, attribution: null, setBy: 'owner-judged', setAt: now },
  importedAt: now, lastImportedAt: now, importCount: 1, tombstonedAt: null });
function libraryValue() {
  return { schema: LIBRARY_SCHEMA, references: { [reference]: record(), [otherReference]: record(otherReference) }, collections: {},
    uses: { use_one: { id: 'use_one', referenceId: reference, projectId: project, viewId: null, purpose: 'Synthetic use', linkedAt: now, tombstonedAt: null } } };
}
function envelope(kind: DesignReferenceKind, entityId: string, title = 'Synthetic reference', revision?: string): ReferenceEnvelope {
  return { version: 1, domain: 'design', kind, entityId, projectId: project, title, returnDestination: { domain: 'design', destination: 'projects/projects' },
    ...(revision === undefined ? {} : { sourceRevision: revision }) };
}
async function fixture(t: TestContext) {
  const double = createTransportDouble();
  double.failWith((route) => route === 'event.read' ? { ok: true, value: { events: [], status: { state: 'ok' } } } : undefined);
  const bridge = createBridgeWorkspaceDocuments(double.transport);
  const reads = createDesignReferenceReads(bridge);
  const provider = createDesignReferenceProvider(reads, () => now);
  let baseline = '';
  const unchanged = () => {
    assert.deepEqual(double.calls.filter(({ route }) => !['doc.get', 'doc.list', 'blob.get', 'blob.has', 'event.read'].includes(route)), [], 'zero mutations or dispatch forwarded');
    assert.equal(JSON.stringify([...double.documents]), baseline, 'source bytes unchanged');
  };
  const seed = async (key: string, value: unknown) => {
    if (baseline !== '') unchanged();
    await bridge.putDocument(key, toJson(value));
    double.calls.length = 0;
    baseline = JSON.stringify([...double.documents]);
  };
  await seed(LIBRARY_DOCUMENT_KEY, libraryValue());
  t.after(unchanged);
  const found = async (kind: DesignReferenceKind, id: string): Promise<DesignReferenceRecord> => {
    const result = await reads.read(kind, id, project);
    assert.equal(result.status, 'found');
    assert.ok(result.status === 'found');
    return result.record;
  };
  return { double, bridge, reads, provider, seed, found };
}

it('version mapping: found, missing, invalid and unavailable; title and T14 destinations are pinned', async (t) => {
  const f = await fixture(t);
  const content = addVersion(addView(createProjectContent(projectId(project), now), { id: viewId('view-home'), title: 'Home', kind: 'page' }, now),
    { id: versionId('version-one'), viewId: viewId('view-home'), label: 'First', capture: { route: '/', viewport: { w: 1440, h: 900, dpr: 1 } }, origin: 'synthetic-fixture' }, now);
  await f.seed(PROJECTS_KEY_ROOT + contentKey(projectId(project)), content);
  assert.deepEqual(await f.found('version', 'version-one'), { kind: 'version', entityId: 'version-one', projectId: project, title: 'Home — First', revision: 'version-one', archived: false, destination: 'projects/projects' });
  assert.equal((await f.provider.resolve(envelope('version', 'version-one', 'Home — First', 'version-one'))).status, 'available');
  assert.equal((await f.provider.resolve(envelope('version', 'absent'))).status, 'missing');
  for (const value of [{ schema: 'hq.design.project-content/v99' }, { invalid: true }]) {
    await f.seed(PROJECTS_KEY_ROOT + contentKey(projectId(project)), value);
    assert.equal((await f.provider.resolve(envelope('version', 'version-one'))).status, 'unknown');
  }
  f.double.failWith(() => { throw new Error('Synthetic transport failure'); });
  assert.equal((await f.provider.resolve(envelope('version', 'version-one'))).status, 'unavailable');
  await assert.rejects(f.reads.list(project));
});

it('request membership, zero/mixed sources, moved and fresh draft identity', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.provider.resolve(envelope('request', request))).status, 'missing');
  const initial = draft();
  await f.seed(draftKey, initial);
  const first = await f.found('request', request);
  assert.equal(first.title, initial.title);
  assert.equal(first.revision, `request-draft:v1:${await digestOf([initial.draftId, initial.revision])}`);
  assert.deepEqual(await f.found('request', request), first);
  const saved = envelope('request', request, first.title, first.revision);
  assert.equal((await f.provider.resolve(saved)).status, 'available');
  await f.seed(draftKey, applyEdit(initial, { type: 'set-title', title: 'Edited request' }, later));
  assert.notEqual((await f.found('request', request)).revision, first.revision);
  assert.equal((await f.provider.resolve(saved)).status, 'changed');
  await f.seed(draftKey, { ...initial, draftId: 'draft-two', revision: 0 });
  assert.notEqual((await f.found('request', request)).revision, first.revision);
  await f.seed(draftKey, { ...initial, sources: [] });
  assert.equal((await f.provider.resolve(saved)).status, 'unknown');
  await f.seed(draftKey, { ...initial, sources: [source(), source('project-b', 'version-two')] });
  assert.equal((await f.provider.resolve(saved)).status, 'unknown');
  await f.seed(draftKey, { ...initial, sources: [source('project-b')] });
  assert.equal((await f.found('request', request)).projectId, 'project-b');
  assert.equal((await f.provider.resolve(saved)).status, 'moved');
});

it('interrupted freeze recovery is unknown without forwarding its attempted write', async (t) => {
  const f = await fixture(t);
  const consumed = applyEdit(draft(), { type: 'set-intent', intent: 'Synthetic intent' }, now);
  const packet = await buildPacket(consumed, brandId('packet-one'), now, null);
  await f.seed(`design/requests/${request}/packets/000001`, { schema: FREEZE_SCHEMA, packet,
    consumed: { draftId: consumed.draftId, revision: consumed.revision }, consumedDraft: consumed,
    continuation: continuationOf(packet, consumed, brandId('draft-two'), now) });
  await f.seed(draftKey, consumed);
  assert.equal((await f.provider.resolve(envelope('request', request))).status, 'unknown');
  await assert.rejects(f.reads.list(project));
});

it('partial or corrupt request reads fail closed and list/read transport failures are unavailable', async (t) => {
  const f = await fixture(t);
  await f.seed(draftKey, { invalid: true });
  assert.equal((await f.provider.resolve(envelope('request', request))).status, 'unknown');
  await f.seed(draftKey, draft());
  f.double.failWith((route) => route === 'event.read' ? { ok: true, value: { events: [], status: { state: 'corrupt', atSeq: 1, reason: 'Synthetic corruption' } } } : undefined);
  assert.equal((await f.provider.resolve(envelope('request', request))).status, 'unknown');
  f.double.failWith((route, params) => {
    if (route === 'doc.list' && 'prefix' in params && params.prefix.endsWith('/packets/')) return { ok: true, value: [`design/requests/${request}/packets/000001`] };
    if (route === 'event.read') return { ok: true, value: { events: [], status: { state: 'ok' } } };
  });
  assert.equal((await f.provider.resolve(envelope('request', request))).status, 'unknown');
  f.double.failWith((route) => { if (route === 'doc.list') throw new Error('Synthetic listing failure'); });
  assert.equal((await f.provider.resolve(envelope('request', request))).status, 'unavailable');
  await assert.rejects(f.reads.list(project));
});

it('reference live membership, archived, missing elsewhere and parse failures', async (t) => {
  const f = await fixture(t);
  const value = libraryValue();
  assert.equal((await f.provider.resolve(envelope('reference', reference))).status, 'available');
  assert.equal((await f.provider.resolve(envelope('reference', otherReference))).status, 'missing');
  assert.equal((await f.provider.resolve(envelope('reference', `ref_${'c'.repeat(64)}`))).status, 'missing');
  await f.seed(LIBRARY_DOCUMENT_KEY, { ...value, references: { ...value.references, [reference]: { ...value.references[reference], tombstonedAt: later } } });
  assert.equal((await f.provider.resolve(envelope('reference', reference))).status, 'archived');
  assert.equal((await f.reads.list(project)).length, 0);
  await f.seed(LIBRARY_DOCUMENT_KEY, { ...value, uses: { use_one: { ...value.uses.use_one, projectId: 'project-b' } } });
  assert.equal((await f.provider.resolve(envelope('reference', reference))).status, 'missing');
  await f.seed(LIBRARY_DOCUMENT_KEY, { ...value, uses: { use_one: { ...value.uses.use_one, tombstonedAt: later } } });
  assert.equal((await f.provider.resolve(envelope('reference', reference))).status, 'missing');
  for (const invalid of [{ schema: 'hq.design.references/v99' }, { invalid: true }]) {
    await f.seed(LIBRARY_DOCUMENT_KEY, invalid);
    assert.equal((await f.provider.resolve(envelope('reference', reference))).status, 'unknown');
  }
  f.double.failWith(() => { throw new Error('Synthetic transport failure'); });
  assert.equal((await f.provider.resolve(envelope('reference', reference))).status, 'unavailable');
});

it('reference token covers the complete validated record and excludes unrelated document state', async (t) => {
  const f = await fixture(t);
  const value = libraryValue();
  const parsed = parseLibraryDocument(value); assert.ok(parsed.status === 'ok');
  const first = await f.found('reference', reference);
  assert.equal(first.revision, `reference-record:v1:${await digestOf(parsed.state.references[reference])}`);
  assert.deepEqual(await f.found('reference', reference), first);
  const saved = envelope('reference', reference, first.title, first.revision);
  for (const delta of [{ notes: 'Changed notes' }, { tags: ['changed'] }, { rights: { ...record().rights, basis: 'Changed basis' } },
    { importedAt: later }, { lastImportedAt: later }, { importCount: 2 }]) {
    await f.seed(LIBRARY_DOCUMENT_KEY, { ...value, references: { ...value.references, [reference]: { ...value.references[reference], ...delta } } });
    assert.notEqual((await f.found('reference', reference)).revision, first.revision);
    assert.equal((await f.provider.resolve(saved)).status, 'changed');
  }
  for (const delta of [
    { references: { ...value.references, [otherReference]: { ...value.references[otherReference], notes: 'Unrelated edit' } } },
    { uses: { use_one: { ...value.uses.use_one, purpose: 'Changed use metadata' } } },
    { collections: { col_one: { id: 'col_one', name: 'Synthetic collection', description: '', referenceIds: [reference], createdAt: now, tombstonedAt: null } } },
    {},
  ]) {
    await f.seed(LIBRARY_DOCUMENT_KEY, { ...value, ...delta });
    assert.equal((await f.found('reference', reference)).revision, first.revision);
    assert.equal((await f.provider.resolve(saved)).status, 'available');
  }
});

it('hash failures return unknown with no omitted revision', async (t) => {
  const f = await fixture(t); await f.seed(draftKey, draft());
  t.mock.method(globalThis.crypto.subtle, 'digest', async () => { throw new Error('Synthetic hashing failure'); });
  for (const [kind, id] of [['request', request], ['reference', reference]] as const) {
    assert.deepEqual(await f.reads.read(kind, id, project), { status: 'unknown' });
    assert.equal((await f.provider.resolve(envelope(kind, id))).status, 'unknown');
  }
});

it('list returns live supported records in P with section-only T14 destinations; projects stay unknown', async (t) => {
  const f = await fixture(t); await f.seed(draftKey, draft());
  const content = addVersion(addView(createProjectContent(projectId(project), now), { id: viewId('view-home'), title: 'Home', kind: 'page' }, now),
    { id: versionId('version-one'), viewId: viewId('view-home'), label: 'First', capture: { route: '/', viewport: { w: 1440, h: 900, dpr: 1 } }, origin: 'synthetic-fixture' }, now);
  await f.seed(PROJECTS_KEY_ROOT + contentKey(projectId(project)), content);
  assert.equal((await f.provider.resolve(envelope('project', project))).status, 'unknown');
  const listed = await f.reads.list(project);
  assert.deepEqual(listed.map((r) => [r.kind, r.destination]), [['version', 'projects/projects'], ['request', 'requests/requests'], ['reference', 'resources/references']]);
  for (const r of listed) {
    assert.equal(r.projectId, project); assert.equal(r.archived, false);
    assert.ok(r.destination);
    assert.equal(formatDestination(parseDestination(r.destination)), r.destination);
  }
  assert.equal((await f.provider.find('', { projectId: project, limit: 10 })).length, 3);
  assert.deepEqual(await f.reads.list('project-b'), []);
});

it('unbridged observations are unavailable and list rejects without a fallback', async () => {
  const reads = createDesignReferenceReads(null);
  const provider = createDesignReferenceProvider(reads, () => now);
  for (const kind of ['project', 'version', 'request', 'reference'] as const) {
    assert.deepEqual(await reads.read(kind, 'synthetic', project), { status: 'unavailable' });
    assert.equal((await provider.resolve(envelope(kind, 'synthetic'))).status, 'unavailable');
  }
  await assert.rejects(reads.list(project));
});
