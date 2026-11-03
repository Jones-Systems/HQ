import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arrangementKey, decodeArrangement } from '../../../canvas/src/codec.ts';
import type { Description } from '../../../canvas/src/providers.ts';
import { canvasFor, canvasProjectIdFor, contentFor, discoveryEnv, flowsFor, projectsFor, shellProjectIdFor } from '../workspace.ts';

describe('canvas project id grammar', () => {
  it('uses a shell id unchanged when the canvas accepts it', () => {
    assert.equal(canvasProjectIdFor('project-alpha'), 'project-alpha');
    assert.equal(shellProjectIdFor(canvasProjectIdFor('project-alpha')!), 'project-alpha');
  });

  it('encodes ids the canvas would reject reversibly, without collisions', () => {
    for (const id of ['Alpha site/2026', 'naïve project', '日本語', 'a b']) {
      const encoded = canvasProjectIdFor(id);
      assert.ok(encoded !== null && /^p~[0-9a-f]+$/u.test(encoded), id);
      assert.equal(shellProjectIdFor(encoded), id);
    }
    assert.notEqual(canvasProjectIdFor('a b'), canvasProjectIdFor('a_b'));
  });

  it('re-encodes a shell id that already looks like an encoding, so it can never alias another project', () => {
    const literal = canvasProjectIdFor('p~6162')!;
    assert.notEqual(literal, 'p~6162');
    assert.equal(shellProjectIdFor(literal), 'p~6162');
    assert.notEqual(literal, canvasProjectIdFor('ab'));
  });

  it('returns null for an id too long to encode instead of truncating it', () => {
    assert.equal(canvasProjectIdFor('x y'.repeat(30)), null);
  });
});

describe('composed workspace', () => {
  const project = { id: 'project-alpha', name: 'Alpha (synthetic)' };

  it('seeds project content for the shell project id itself, all of it labelled synthetic-fixture', async () => {
    const { content } = await contentFor(project);
    assert.equal(content.projectId, 'project-alpha');
    assert.ok(content.versions.length >= 4);
    assert.ok(content.versions.every((version) => version.origin === 'synthetic-fixture'));
  });

  it('binds the seeded flow\'s screens exactly to the project versions it pins, and loads their thumbnails', async () => {
    const flows = await flowsFor(project);
    assert.equal(flows.flow.projectId, 'project-alpha');
    assert.deepEqual(flows.binding.screens.map((screen) => screen.binding), ['exact', 'exact']);
    assert.deepEqual([flows.warm.loaded, flows.warm.failed], [2, []]);
  });

  it('places items from all three providers on the canvas and every placement resolves to its exact pinned revision', async () => {
    const env = await canvasFor(project);
    assert.ok(env);
    const text = await env.storage.readDocument('workspace', arrangementKey(env.canvasId));
    const decoded = decodeArrangement(text!);
    assert.ok(decoded.ok);
    if (!decoded.ok) return;
    const providers = new Set(decoded.arrangement.items.map((item) => item.ref.providerId));
    assert.deepEqual([...providers].sort(), ['hq.design.components', 'hq.design.flows', 'hq.design.project-versions']);
    for (const item of decoded.arrangement.items) {
      const described: Description = env.registry.describe(item.ref);
      assert.equal(described.status, 'ready', item.ref.entityId);
      if (described.status === 'ready') assert.match(described.providerLabel, /\((fake|synthetic)\)$/u);
    }
    assert.equal(decoded.arrangement.projectId, 'project-alpha');
  });

  it('keeps project identity for a shell id the canvas cannot hold verbatim', async () => {
    const odd = { id: 'Odd project/id', name: 'Odd (synthetic)' };
    const env = await canvasFor(odd);
    assert.ok(env);
    assert.match(env.projectId, /^p~/u);
    const flows = await flowsFor(odd);
    assert.equal(flows.flow.projectId, odd.id);
    const versions = env.registry.catalog(env.projectId).flatMap(({ items }) => items);
    assert.ok(versions.some((item) => item.details?.some((detail) => detail.label === 'Project' && detail.value === odd.id)));
  });

  it('opens Projects over the cached catalog and the cache is never written', async () => {
    const controller = await projectsFor(project);
    const { cache, readPort } = await discoveryEnv();
    assert.ok(controller.getSnapshot().catalog.length > 0);
    assert.equal(cache.writes, 0);
    assert.equal(readPort.status().cache, 'warm');
    assert.equal(readPort.status().tag.status, 'synthetic');
  });

  it('is memoised per project so a domain switch remounts over the same state', () => {
    assert.equal(canvasFor(project), canvasFor(project));
    assert.equal(contentFor(project), contentFor(project));
    assert.notEqual(contentFor(project), contentFor({ id: 'project-beta', name: 'Beta' }));
  });
});

describe('native project discovery', () => {
  it('starts empty, chooses through native UI, refreshes real catalog data, and forgets without source deletion', async () => {
    const { createBridgedDiscovery } = await import('../bridged-discovery.ts');
    const { fixtureSnapshot } = await import('../../../discovery/src/fakes.ts');
    const { LOCAL_HOST_ID } = await import('../../../discovery/src/adapters/local-directory.ts');
    const calls: { route: string; params: unknown }[] = [];
    let chosen = false;
    let generation = 0;
    let value: unknown = null;
    const transport = { async call(route: string, params: { value?: unknown }) {
      calls.push({ route, params });
      if (route === 'catalog.chooseRoot') chosen = true;
      if (route === 'catalog.forget') chosen = false;
      if (['catalog.roots', 'catalog.chooseRoot', 'catalog.forget'].includes(route)) {
        return { ok: true, value: chosen ? [{ rootId: 'fictional-root', label: 'Example projects' }] : [] };
      }
      if (route === 'cache.put') { value = params.value; return { ok: true, value: {} }; }
      if (route === 'cache.get') return { ok: true, value: value === null ? null : { value } };
      if (route === 'catalog.snapshot') return { ok: true, value: await fixtureSnapshot(LOCAL_HOST_ID, ++generation, [{ path: 'example', name: 'Example repository', previews: [] }]) };
      throw new Error(`Unexpected route: ${route}`);
    } } as unknown as import('@hq/contracts/services').DesignServiceTransport;
    const env = await createBridgedDiscovery(transport);
    assert.equal(env.readPort.current().length, 0);
    assert.equal(calls.some((call) => call.route === 'catalog.snapshot'), false);
    assert.equal(env.tag.status, 'cached');
    await env.chooseRoot();
    assert.deepEqual(calls.find((call) => call.route === 'catalog.chooseRoot')?.params, {});
    assert.deepEqual(env.readPort.current().map((entry) => entry.displayName), ['Example repository']);
    await env.refresh();
    assert.equal(generation, 2);
    await env.forget();
    assert.equal(env.readPort.current().length, 0);
    assert.equal(env.roots().length, 0);
    assert.equal(Object.keys(env.service.getState().catalog.records).length, 0);
    assert.equal(calls.some((call) => call.route === 'catalog.preview' || call.route.startsWith('doc.')), false);
  });

  it('reports an unavailable desktop catalog without loading synthetic records', async () => {
    const { createBridgedDiscovery } = await import('../bridged-discovery.ts');
    const transport = { async call() { return { ok: false, kind: 'unavailable' }; } } as import('@hq/contracts/services').DesignServiceTransport;
    await assert.rejects(createBridgedDiscovery(transport), /unavailable/u);
  });
});
