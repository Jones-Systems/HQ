import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addVersion, addView, assertAppendOnly, createProjectContent, linkSource, parseProjectContent, renameView,
  stableStringify, summarize, versionsOf, VersionMutationError, type CaptureBinding, type ProjectContent,
} from '../src/content.ts';
import { InvalidIdError, projectId, sourceProjectId, versionId, viewId } from '../src/ids.ts';
import { ProjectContentRepository, ReadOnlyContentError, contentKey } from '../src/repository.ts';
import { createProvisionalLocalRegistry, PROVISIONAL_REGISTRY_PROVENANCE } from '../src/registry.ts';
import { StorageConflictError } from '../src/contract.ts';
import { createFakeClock, createSpyStorage, previewRefFor, sequentialIds, syntheticPng } from '../fakes/index.ts';

const NOW = '2026-01-01T00:00:00.000Z';
const capture = (route: string): CaptureBinding => ({ route, viewport: { w: 1440, h: 900, dpr: 2 }, sourceRevision: 'rev-1' });
const P = projectId('project-a');
const HOME = viewId('view-home');
const SETTINGS = viewId('view-settings');

function twoViews(): ProjectContent {
  let content = createProjectContent(P, NOW);
  content = addView(content, { id: HOME, title: 'Home', kind: 'page' }, NOW);
  content = addView(content, { id: SETTINGS, title: 'Settings', kind: 'screen' }, NOW);
  return content;
}

describe('identifiers', () => {
  test('validate shape and never derive from titles', () => {
    assert.equal(projectId('hq-local'), 'hq-local');
    assert.throws(() => projectId(''), InvalidIdError);
    assert.throws(() => projectId(' padded '), InvalidIdError);
    assert.throws(() => projectId('x'.repeat(161)), InvalidIdError);
    assert.throws(() => viewId('line\nbreak'), InvalidIdError);
  });
});

describe('project content', () => {
  test('a project holds several views, each with its own ordered versions', () => {
    let content = twoViews();
    content = addVersion(content, { id: versionId('v-1'), viewId: HOME, label: 'First', capture: capture('/'), origin: 'owner-created' }, NOW);
    content = addVersion(content, { id: versionId('v-2'), viewId: SETTINGS, label: 'First', capture: capture('/settings'), origin: 'owner-created' }, NOW);
    content = addVersion(content, { id: versionId('v-3'), viewId: HOME, label: 'Second', capture: capture('/'), origin: 'owner-created', basedOn: versionId('v-1') }, NOW);
    assert.equal(content.views.length, 2);
    assert.deepEqual(versionsOf(content, HOME).map((version) => [version.id, version.ordinal]), [['v-1', 1], ['v-3', 2]]);
    assert.deepEqual(versionsOf(content, SETTINGS).map((version) => [version.id, version.ordinal]), [['v-2', 1]]);
  });

  test('adding a version keeps earlier versions identical and frozen', () => {
    const first = addVersion(twoViews(), { id: versionId('v-1'), viewId: HOME, label: 'First', capture: capture('/'), origin: 'owner-created' }, NOW);
    const before = stableStringify(first.versions[0]);
    const second = addVersion(first, { id: versionId('v-2'), viewId: HOME, label: 'Second', capture: capture('/'), origin: 'owner-created' }, NOW);
    assert.equal(second.versions[0], first.versions[0], 'earlier version carried by reference');
    assert.equal(stableStringify(second.versions[0]), before);
    assert.ok(Object.isFrozen(second.versions[0]) && Object.isFrozen(second.versions[0]!.capture.viewport));
    assert.throws(() => { (second.versions[0] as { label: string }).label = 'edited'; }, TypeError);
    assert.doesNotThrow(() => assertAppendOnly(first, second));
  });

  test('append-only guard refuses edited, removed or reordered versions', () => {
    let content = addVersion(twoViews(), { id: versionId('v-1'), viewId: HOME, label: 'First', capture: capture('/'), origin: 'owner-created' }, NOW);
    content = addVersion(content, { id: versionId('v-2'), viewId: HOME, label: 'Second', capture: capture('/'), origin: 'owner-created' }, NOW);
    const edited = { ...content, versions: [{ ...content.versions[0]!, label: 'Rewritten' }, content.versions[1]!] };
    const recaptured = { ...content, versions: [{ ...content.versions[0]!, capture: capture('/other') }, content.versions[1]!] };
    const removed = { ...content, versions: [content.versions[1]!] };
    const reordered = { ...content, versions: [content.versions[1]!, content.versions[0]!] };
    for (const next of [edited, recaptured, removed, reordered]) assert.throws(() => assertAppendOnly(content, next), VersionMutationError);
  });

  test('renaming a view leaves its versions untouched', () => {
    const content = addVersion(twoViews(), { id: versionId('v-1'), viewId: HOME, label: 'First', capture: capture('/'), origin: 'owner-created' }, NOW);
    const renamed = renameView(content, HOME, 'Landing', NOW);
    assert.equal(renamed.views[0]!.title, 'Landing');
    assert.equal(renamed.versions[0], content.versions[0]);
    assert.doesNotThrow(() => assertAppendOnly(content, renamed));
  });

  test('strict parse round-trips and reports a future schema instead of coercing it', () => {
    const content = linkSource(addVersion(twoViews(), { id: versionId('v-1'), viewId: HOME, label: 'First', capture: capture('/'), origin: 'owner-created' }, NOW),
      sourceProjectId('src-1'), 'rev-9', NOW);
    const parsed = parseProjectContent(JSON.parse(JSON.stringify(content)));
    assert.equal(parsed.status, 'ok');
    assert.equal(stableStringify(parsed.status === 'ok' ? parsed.content : null), stableStringify(content));
    assert.deepEqual(parseProjectContent({ ...content, schema: 'hq.design.project-content/v2' }), { status: 'unsupported-schema', schema: 'hq.design.project-content/v2' });
    assert.equal(parseProjectContent({ ...content, extra: true }).status, 'invalid');
    const gap = { ...content, versions: [{ ...content.versions[0]!, ordinal: 2 }] };
    assert.equal(parseProjectContent(JSON.parse(JSON.stringify(gap))).status, 'invalid');
  });

  test('summary cover is the newest version with a thumbnail', async () => {
    const ref = await previewRefFor(syntheticPng(3));
    let content = addVersion(twoViews(), { id: versionId('v-1'), viewId: HOME, label: 'A', capture: capture('/'), thumbnail: ref, origin: 'synthetic-fixture' }, NOW);
    content = addVersion(content, { id: versionId('v-2'), viewId: HOME, label: 'B', capture: capture('/'), origin: 'owner-created' }, NOW);
    const summary = summarize(content);
    assert.equal(summary.cover?.digest, ref.digest);
    assert.equal(summary.versionCount, 2);
  });
});

describe('content repository', () => {
  test('persisting a new version leaves earlier version bytes identical in storage', async () => {
    const storage = createSpyStorage();
    const repository = new ProjectContentRepository(storage, createFakeClock());
    await repository.update(P, (content, now) => addView(content, { id: HOME, title: 'Home', kind: 'page' }, now));
    await repository.update(P, (content, now) => addVersion(content, { id: versionId('v-1'), viewId: HOME, label: 'First', capture: capture('/'), origin: 'owner-created' }, now));
    const firstVersionText = JSON.stringify((JSON.parse(storage.raw('workspace', contentKey(P))!) as ProjectContent).versions[0]);
    await repository.update(P, (content, now) => addVersion(content, { id: versionId('v-2'), viewId: HOME, label: 'Second', capture: capture('/'), origin: 'owner-created' }, now));
    const stored = JSON.parse(storage.raw('workspace', contentKey(P))!) as ProjectContent;
    assert.equal(stored.versions.length, 2);
    assert.equal(JSON.stringify(stored.versions[0]), firstVersionText);
    assert.deepEqual(storage.writes().map((call) => `${call.namespace}:${call.key}`), Array(3).fill(`workspace:${contentKey(P)}`));
  });

  test('a change that rewrites history is refused before any write', async () => {
    const storage = createSpyStorage();
    const repository = new ProjectContentRepository(storage, createFakeClock());
    await repository.update(P, (content, now) => addVersion(addView(content, { id: HOME, title: 'Home', kind: 'page' }, now),
      { id: versionId('v-1'), viewId: HOME, label: 'First', capture: capture('/'), origin: 'owner-created' }, now));
    const writes = storage.writes().length;
    await assert.rejects(repository.update(P, (content) => ({ ...content, versions: [{ ...content.versions[0]!, label: 'Edited' }] })), VersionMutationError);
    assert.equal(storage.writes().length, writes);
  });

  test('future schema and invalid documents open read-only and are never rewritten', async () => {
    const storage = createSpyStorage();
    storage.seed('workspace', contentKey(P), { schema: 'hq.design.project-content/v9', projectId: P, anything: true });
    const repository = new ProjectContentRepository(storage, createFakeClock());
    assert.equal((await repository.load(P)).status, 'unsupported-schema');
    await assert.rejects(repository.update(P, (content) => content), ReadOnlyContentError);
    assert.equal(storage.writes().length, 0);
  });

  test('a concurrent writer surfaces as a conflict instead of being overwritten', async () => {
    const storage = createSpyStorage();
    const repository = new ProjectContentRepository(storage, createFakeClock());
    const first = await repository.update(P, (content, now) => addView(content, { id: HOME, title: 'Home', kind: 'page' }, now));
    await repository.update(P, (content, now) => addView(content, { id: SETTINGS, title: 'Settings', kind: 'page' }, now));
    await assert.rejects(repository.update(P, (content) => content, { revision: first.revision }), StorageConflictError);
  });
});

describe('provisional local registry', () => {
  test('labels device-local storage and keeps duplicate names as distinct projects', async () => {
    const storage = createSpyStorage();
    const registry = createProvisionalLocalRegistry({ storage, clock: createFakeClock(), ids: sequentialIds() });
    assert.equal(registry.provenance, PROVISIONAL_REGISTRY_PROVENANCE);
    assert.equal(registry.provenance.kind, 'provisional-local');
    assert.equal(registry.provenance.label, 'Projects saved on this device');
    const a = await registry.create({ name: 'Checkout' });
    const b = await registry.create({ name: 'Checkout' });
    assert.notEqual(a.id, b.id);
    assert.ok(!a.id.includes('Checkout'), 'id is not derived from the name');
    assert.deepEqual((await registry.list()).map((record) => record.id), [a.id, b.id]);
    assert.ok(storage.writes().every((call) => call.namespace === 'workspace' && call.key.startsWith('design.projects/')));
  });
});
