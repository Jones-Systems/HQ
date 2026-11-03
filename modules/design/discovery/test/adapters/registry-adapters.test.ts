import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostId, rootId, isoTime } from '../../src/contract.ts';
import { sha256Hex, utf8 } from '../../src/jcs.ts';
import { mapJonesProjects, type RegistryContext } from '../../src/adapters/jones-projects.ts';
import { mapGalleryIndex, type GalleryRegistryRead } from '../../src/adapters/gallery-index.ts';

const context: RegistryContext = { hostId: hostId('synthetic-host'), rootId: rootId('synthetic-root'),
  generation: 4, observedAt: isoTime('2026-10-20T00:00:00Z'), hostFingerprint: 'synthetic-fingerprint' };
const project = { id: 'b9f5f255-c2e7-4c53-a295-a788651ba950', title: 'Example', workspaceRoot: '/synthetic/example',
  repositoryIdentity: null, scripts: [] };
const script = { id: 'preview', name: 'Preview', command: 'never-execute-this', icon: 'play', runOnWorktreeCreate: true };
const baseUrl = 'https://gallery.example.test/gallery/';
const galleryEntry = { id: 'direction-a', title: 'Example', presentationType: 'app', launchHref: 'viewer.html?direction=direction-a',
  capabilities: { viewer: true, system: false, compare: false, flow: false, review: false } };
function index(entry: Record<string, unknown> = galleryEntry) {
  return { schema: 'gallery-index/v1', title: 'Synthetic', summary: '', projects: [
    { id: 'sample', name: 'Example', sourceType: 'collection', runtimeRelease: 'r1', collectionHref: 'projects/sample/', entries: [entry] },
  ] };
}
function collection(state: Record<string, unknown> = { id: 'default', source: 'web-prototype', url: 'sites/app/index.html' }) {
  return { variations: [{ id: 'direction-a', presentation: { type: 'app', chrome: 'embedded',
    params: { screen: 'screen' }, query: { direction: 'a' }, route: { reflects: ['screen'] },
  screens: [{ id: 'home', title: 'Home', states: [state] }] } }] };
}
async function fixture(data: unknown = index(), content?: unknown): Promise<GalleryRegistryRead> {
  const files: Record<string, Uint8Array> = { 'data/gallery-index.json': utf8(JSON.stringify(data)) };
  if (content !== undefined) files['projects/sample/data/collection.json'] = utf8(JSON.stringify(content));
  const hashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, bytes]) => [key, await sha256Hex(bytes)])));
  return { baseUrl, complete: true, files, manifestBytes: utf8(JSON.stringify({ schema: 'gallery-registry-export/v1', algorithm: 'sha256', files: hashes })) };
}

test('Jones identities ignore titles and paths, but include environment/root; completeness requires coverage and exhausted pagination', async () => {
  const first = await mapJonesProjects({ projects: [project], nextCursor: null }, context, { complete: true });
  const renamed = await mapJonesProjects({ projects: [{ ...project, title: 'Renamed', workspaceRoot: '/synthetic/moved' }], nextCursor: null }, context);
  assert.equal(first.entries[0]!.sourceProjectId, renamed.entries[0]!.sourceProjectId);
  assert.equal(first.entries[0]!.displayName, 'Example');
  assert.deepEqual(first.entries[0]!.repoIdentity, { localOnly: true });
  assert.equal(first.complete, true); assert.equal(renamed.complete, false);
  assert.equal((await mapJonesProjects({ projects: [project], nextCursor: 20 }, context, { complete: true })).complete, false);
  for (const changed of [{ ...context, hostId: hostId('other-host') }, { ...context, rootId: rootId('other-root') }]) {
    assert.notEqual((await mapJonesProjects({ projects: [project], nextCursor: null }, changed)).entries[0]!.sourceProjectId, first.entries[0]!.sourceProjectId);
  }
  const duplicateNames = await mapJonesProjects({ projects: [project, { ...project, id: 'different' }], nextCursor: null }, context);
  assert.notEqual(duplicateNames.entries[0]!.sourceProjectId, duplicateNames.entries[1]!.sourceProjectId);
  assert.equal(first.entries[0]!.metadata.launchStatus, 'unavailable');
});

test('actual Jones shape normalizes Git remote and reads script preview without deriving revision or executing commands', async () => {
  const actual = { ...project, updatedAt: '2026-10-20T00:00:00Z',
    repositoryIdentity: { canonicalKey: 'synthetic-canonical-key', locator: { source: 'git-remote', remoteName: 'origin', remoteUrl: 'https://EXAMPLE.test/team/project.git' }, rootPath: '/synthetic/example' },
    scripts: [{ ...script, previewUrl: 'http://127.0.0.1:4000/app', autoOpenPreview: true }] };
  const snapshot = await mapJonesProjects({ projects: [actual], nextCursor: null }, context);
  assert.deepEqual(snapshot.entries[0]!.repoIdentity, { localOnly: false, normalizedRemote: 'example.test/team/project' });
  assert.equal(snapshot.entries[0]!.metadata.experienceKind, 'website');
  assert.equal(snapshot.entries[0]!.revision, undefined);
  assert.equal(snapshot.entries[0]!.metadata.launchUrl, 'http://127.0.0.1:4000/app');
  assert.equal(snapshot.entries[0]!.metadata.command, undefined);
  assert.equal(snapshot.entries[0]!.metadata.autoOpenPreview, undefined);
});

test('Jones ambiguous script previews require explicit binding while duplicate URLs and null previews do not', async () => {
  const scripts = [{ ...script, previewUrl: 'https://example.test/a' }, { ...script, id: 'second', previewUrl: 'https://example.test/b' }];
  const ambiguous = await mapJonesProjects({ projects: [{ ...project, scripts }], nextCursor: null }, context);
  assert.equal(ambiguous.entries[0]!.metadata.launchStatus, 'unavailable');
  assert.equal(ambiguous.entries[0]!.metadata.launchUrl, undefined);
  assert.match(String(ambiguous.entries[0]!.metadata.holdReason), /explicit binding/);
  const shared = await mapJonesProjects({ projects: [{ ...project, scripts: [scripts[0]!, { ...script, id: 'second', previewUrl: 'https://example.test/a' }, { ...script, id: 'third', previewUrl: null, autoOpenPreview: null }] }], nextCursor: null }, context);
  assert.equal(shared.entries[0]!.metadata.launchUrl, 'https://example.test/a');
});

test('Jones rejects malformed identities, duplicates, bounds, unsafe URLs and invalid snapshot context', async () => {
  for (const previewUrl of ['http://remote.example.test/app', 'https://user:pass@example.test/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://example.test/with space']) {
    await assert.rejects(mapJonesProjects({ projects: [{ ...project, scripts: [{ ...script, previewUrl }] }], nextCursor: null }, context));
  }
  for (const projects of [[{ ...project, id: '../escape' }], [project, project], [{ ...project, title: 'a'.repeat(161) }], Array(1001).fill(project)]) {
    await assert.rejects(mapJonesProjects({ projects, nextCursor: null }, context));
  }
  for (const source of ['unknown', 'git-remote']) {
    await assert.rejects(mapJonesProjects({ projects: [{ ...project, repositoryIdentity: { canonicalKey: 'key', locator: { source, remoteName: 'origin', remoteUrl: 'https://user:pass@example.test/repo' } } }], nextCursor: null }, context));
  }
  await assert.rejects(mapJonesProjects({ projects: [project], nextCursor: -1 }, context));
  await assert.rejects(mapJonesProjects({ projects: [project], nextCursor: null }, { ...context, generation: -1 }));
});

test('gallery direct app URL comes from verified collection directory and declared query, never viewer chrome', async () => {
  const snapshot = await mapGalleryIndex(await fixture(index(), collection()), context);
  const entry = snapshot.entries[0]!;
  assert.equal(snapshot.complete, true);
  assert.equal(entry.metadata.launchUrl, `${baseUrl}projects/sample/sites/app/index.html?direction=a&screen=home`);
  assert.equal(entry.metadata.experienceKind, 'web-prototype');
  assert.equal(entry.metadata.selectedScreenId, 'home');
  assert.equal(entry.metadata.selectedStateId, 'default');
  assert.equal(entry.metadata.stateId, null);
  assert.equal(entry.metadata.selectionBasis, 'first-declared');
  assert.equal(entry.metadata.inventoryIntegrity, 'sha256-verified');
  assert.equal(entry.metadata.collectionId, 'sample');
  assert.equal(entry.metadata.collectionName, 'Example');
  assert.equal(entry.relativePath, 'sample/direction-a');
  assert.equal(entry.revision, 'r1');
  assert.equal(entry.metadata.provenance, undefined);
  const renamed = index({ ...galleryEntry, title: 'New title' });
  renamed.projects[0]!.name = 'Renamed collection';
  assert.equal((await mapGalleryIndex(await fixture(renamed, collection()), context)).entries[0]!.sourceProjectId, entry.sourceProjectId);
});

test('gallery viewer without direct proof remains held; missing files never imply missing projects', async () => {
  const read = await fixture();
  const snapshot = await mapGalleryIndex(read, context);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.entries[0]!.metadata.launchStatus, 'unavailable');
  assert.equal(snapshot.entries[0]!.metadata.launchUrl, undefined);
  const webViewer = await mapGalleryIndex(await fixture(index({ ...galleryEntry, presentationType: 'website' })), context);
  assert.equal(webViewer.entries[0]!.metadata.launchStatus, 'unavailable');
  const manifest = JSON.parse(new TextDecoder().decode(read.manifestBytes));
  manifest.files['missing.json'] = 'a'.repeat(64);
  assert.equal((await mapGalleryIndex({ ...read, manifestBytes: utf8(JSON.stringify(manifest)) }, context)).complete, false);
});

test('gallery website href resolves at base and screens/image states remain stills', async () => {
  const website = await mapGalleryIndex(await fixture(index({ ...galleryEntry, presentationType: 'website', launchHref: 'sites/home.html' })), context);
  assert.equal(website.entries[0]!.metadata.launchUrl, `${baseUrl}sites/home.html`);
  for (const read of [await fixture(index({ ...galleryEntry, presentationType: 'screens' })), await fixture(index(), collection({ id: 'default', src: 'images/home.png' }))]) {
    const entry = (await mapGalleryIndex(read, context)).entries[0]!;
    assert.equal(entry.metadata.experienceKind, 'stills');
    assert.equal(entry.metadata.launchUrl, undefined);
  }
});

test('gallery hashes cover exact bytes and reject changed, unlisted or oversized files', async () => {
  const read = await fixture();
  await assert.rejects(mapGalleryIndex({ ...read, files: { ...read.files, 'data/gallery-index.json': utf8(JSON.stringify(index(), null, 2)) } }, context), /hash mismatch/);
  await assert.rejects(mapGalleryIndex({ ...read, files: { ...read.files, 'unlisted.json': utf8('{}') } }, context), /hash mismatch/);
  await assert.rejects(mapGalleryIndex({ ...read, manifestBytes: new Uint8Array(2 * 1024 * 1024 + 1) }, context), /oversized/);
  await assert.rejects(mapGalleryIndex({ ...read, manifestBytes: utf8('{') }, context));
  await assert.rejects(mapGalleryIndex({ ...read, manifestBytes: utf8(JSON.stringify({ schema: 'gallery-registry-export/v1', algorithm: 'sha256', files: { '../escape': 'a'.repeat(64) } })) }, context), /path/);
});

test('gallery rejects unsafe URLs, duplicate IDs and unproved route declarations', async () => {
  for (const launchHref of ['http://remote.example.test/', 'https://user:pass@example.test/', 'file:///tmp/app']) {
    await assert.rejects(mapGalleryIndex(await fixture(index({ ...galleryEntry, launchHref })), context));
  }
  const duplicate = index(); duplicate.projects[0]!.entries.push(galleryEntry);
  await assert.rejects(mapGalleryIndex(await fixture(duplicate), context), /Duplicate/);
  const bad = collection(); bad.variations[0]!.presentation.route.reflects = [];
  await assert.rejects(mapGalleryIndex(await fixture(index(), bad), context), /Unproved/);
  const badState = collection({ id: 'default', source: 'web-prototype', url: 'http://remote.example.test/app' });
  await assert.rejects(mapGalleryIndex(await fixture(index(), badState), context), /Unsupported/);
});


test('gallery pages open the first declared document at the collection directory, with bounded selection metadata', async () => {
  const content = { variations: [{ id: 'direction-a', presentation: { type: 'pages', layoutWidth: 1440, layoutHeight: 900,
    pages: [{ id: 'home', title: 'Home', url: 'sites/public/variations/v1/index.html' },
      { id: 'weddings', title: 'Weddings', url: 'sites/public/variations/v1/weddings.html' }] } }] };
  const snapshot = await mapGalleryIndex(await fixture(index({ ...galleryEntry, presentationType: 'pages' }), content), context);
  const entry = snapshot.entries[0]!;
  assert.equal(entry.metadata.launchUrl, `${baseUrl}projects/sample/sites/public/variations/v1/index.html`);
  assert.equal(entry.metadata.experienceKind, 'website');
  assert.equal(entry.metadata.selectedPageId, 'home');
  assert.equal(entry.metadata.pageCount, 2);
  assert.equal(entry.metadata.selectionBasis, 'first-declared');
  assert.equal(entry.metadata.stateId, null);
  assert.equal(entry.metadata.launchStatus, 'available');
  content.variations[0]!.presentation.pages[1]!.url = 'http://remote.example.test/weddings';
  await assert.rejects(mapGalleryIndex(await fixture(index({ ...galleryEntry, presentationType: 'pages' }), content), context), /Unsupported/);
});

test('gallery single website presentation resolves its direct URL and missing pages evidence stays held', async () => {
  const content = { variations: [{ id: 'direction-a', presentation: { type: 'website', url: 'sites/home/index.html' } }] };
  const read = await fixture(index({ ...galleryEntry, presentationType: 'website' }), content);
  assert.equal((await mapGalleryIndex(read, context)).entries[0]!.metadata.launchUrl, `${baseUrl}projects/sample/sites/home/index.html`);
  const missing = await mapGalleryIndex(await fixture(index({ ...galleryEntry, presentationType: 'pages' })), context);
  assert.equal(missing.complete, false);
  assert.equal(missing.entries[0]!.metadata.launchStatus, 'unavailable');
});


test('gallery inventory admits large exported registries while metadata reads stay bounded and partial', async () => {
  const read = await fixture();
  const manifest = JSON.parse(new TextDecoder().decode(read.manifestBytes));
  for (let i = 0; i < 1904; i++) manifest.files[`previews/item-${i}.png`] = 'a'.repeat(64);
  const snapshot = await mapGalleryIndex({ ...read, manifestBytes: utf8(JSON.stringify(manifest)) }, context);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.entries.length, 1);
});


test('external registry entries use declared websites and hold remote HTTP without blocking other projects', async () => {
  const data = index({ ...galleryEntry, presentationType: 'external', launchHref: 'http://remote.example.test/' });
  data.projects[0]!.sourceType = 'external';
  const held = (await mapGalleryIndex(await fixture(data), context)).entries[0]!;
  assert.equal(held.metadata.experienceKind, 'website');
  assert.equal(held.metadata.launchUrl, undefined);
  assert.match(String(held.metadata.holdReason), /HTTPS/);
  data.projects[0]!.entries[0]!.launchHref = 'https://external.example.test/';
  const available = (await mapGalleryIndex(await fixture(data), context)).entries[0]!;
  assert.equal(available.metadata.launchUrl, 'https://external.example.test/');
});
