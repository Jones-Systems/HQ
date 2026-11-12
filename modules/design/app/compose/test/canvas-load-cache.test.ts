import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PreviewBytes, PreviewRef, ThumbnailPort } from '../../../projects/src/contract.ts';
import type { ProjectContent } from '../../../projects/src/content.ts';
import { flowItemKey } from '../../../flows/src/canvas.ts';
import type { FlowId } from '../../../flows/src/contract.ts';
import { captureKey, createCaptureCache, createFlowCache, createLoadCache, summarizeFlow, type Loaded } from '../canvas-load-cache.ts';
import { projectVersionEntity } from '../project-versions.ts';
import { contentFor } from '../workspace.ts';

const project = { id: 'project-captures', name: 'Captures (synthetic)' };
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Waits for work that crosses several turns, such as hashing a thumbnail, instead of guessing how many it takes. */
async function until(done: () => boolean): Promise<void> {
  for (let turns = 0; turns < 500 && !done(); turns += 1) await settled();
  assert.ok(done(), 'timed out waiting for the cache');
}
const loaded = (cache: { peek(key: string): { status: string } }, ...keys: string[]) => () => keys.every((key) => cache.peek(key).status !== 'loading');

async function seeded() {
  const env = await contentFor(project);
  const version = env.content.versions.find((item) => item.viewId === 'project-captures-home')!;
  return { env, version, entityId: projectVersionEntity(project.id, version.viewId as string) };
}

describe('load cache', () => {
  it('reports loading, then the value, and keeps the object stable between changes', async () => {
    let release!: (value: string) => void;
    const cache = createLoadCache<string>(() => new Promise((resolve) => { release = resolve; }));
    const changes: string[] = [];
    cache.subscribe(() => changes.push(cache.peek('a').status));
    const before = cache.peek('a');
    assert.equal(before.status, 'loading');
    assert.equal(cache.peek('a'), before, 'the same object while nothing changed');
    cache.want('a');
    cache.want('a');
    release('hello');
    await settled();
    assert.deepEqual(cache.peek('a'), { status: 'ready', value: 'hello' });
    assert.deepEqual(changes, ['ready'], 'one load per key, one change notified');
  });

  it('keeps a failure until it is retried, and retries only what failed', async () => {
    let fail = true;
    let calls = 0;
    const cache = createLoadCache<number>(async (key) => { calls += 1; if (key === 'bad' && fail) throw new Error('no'); return calls; });
    cache.want('bad');
    cache.want('good');
    await settled();
    assert.equal(cache.peek('bad').status, 'failed');
    assert.equal(cache.peek('good').status, 'ready');
    cache.want('bad');
    assert.equal(calls, 2, 'wanting a failed key again does not retry on its own');
    fail = false;
    cache.retryFailed();
    assert.equal(cache.peek('bad').status, 'loading');
    await settled();
    assert.equal(cache.peek('bad').status, 'ready');
    assert.equal(calls, 3, 'the loaded key was not loaded again');
  });

  it('ignores answers after it is disposed and aborts what is in flight', async () => {
    let signal!: AbortSignal;
    let release!: (value: string) => void;
    const cache = createLoadCache<string>((_key, given) => { signal = given; return new Promise((resolve) => { release = resolve; }); });
    let notified = 0;
    cache.subscribe(() => { notified += 1; });
    cache.want('a');
    cache.dispose();
    assert.equal(signal.aborted, true);
    release('late');
    await settled();
    assert.equal(notified, 0);
    assert.equal(cache.peek('a').status, 'loading');
  });

  it('loads again after it is disposed, as a development remount on the same object needs', async () => {
    const signals: AbortSignal[] = [];
    const cache = createLoadCache<string>(async (key, given) => { signals.push(given); return `loaded ${key}`; });
    cache.want('a');
    cache.dispose();
    cache.want('a');
    await settled();
    assert.deepEqual(cache.peek('a'), { status: 'ready', value: 'loaded a' });
    assert.equal(signals.length, 2, 'the second want loads for real');
    assert.equal(signals[0]!.aborted, true);
    assert.equal(signals[1]!.aborted, false, 'a fresh signal for the new life');
  });
});

describe('capture thumbnails', () => {
  it('reads the verified thumbnail of a version as a data URL, through fresh project content', async () => {
    const { env, version, entityId } = await seeded();
    let reads = 0;
    const cache = createCaptureCache({
      readContent: async () => { reads += 1; return env.content; },
      thumbnails: { readThumbnail: (ref, signal) => env.thumbnails.readThumbnail(ref, signal) },
    });
    const key = captureKey(entityId, version.id as string);
    cache.want(key);
    assert.equal(cache.peek(key).status, 'loading');
    await until(loaded(cache, key));
    const first = cache.peek(key);
    assert.equal(first.status, 'ready');
    const value = (first as Extract<Loaded<unknown>, { status: 'ready' }>).value as { url: string } | null;
    assert.match(value!.url, /^data:image\/png;base64,/u);
    const other = env.content.versions.find((item) => item.id !== version.id)!;
    const otherKey = captureKey(projectVersionEntity(project.id, other.viewId as string), other.id as string);
    cache.want(otherKey);
    await until(loaded(cache, otherKey));
    assert.equal(reads, 1, 'the content is read once for every item that asks');
  });

  it('says "none" for a version that has no thumbnail, and fails for one the project does not hold', async () => {
    const { env, version, entityId } = await seeded();
    const { thumbnail: _dropped, ...withoutThumbnail } = version;
    const content = { ...env.content, versions: env.content.versions.map((item) => (item === version ? withoutThumbnail : item)) } as ProjectContent;
    const cache = createCaptureCache({ readContent: async () => content, thumbnails: env.thumbnails });
    const none = captureKey(entityId, version.id as string);
    const missing = captureKey(entityId, 'no-such-version');
    cache.want(none);
    cache.want(missing);
    await until(loaded(cache, none, missing));
    assert.deepEqual(cache.peek(none), { status: 'ready', value: null });
    assert.equal(cache.peek(missing).status, 'failed');
    assert.equal(cache.peek(captureKey('not-an-entity', 'x')).status, 'loading', 'an unknown key is only loading until it is wanted');
    cache.want(captureKey('not-an-entity', 'x'));
    await until(loaded(cache, captureKey('not-an-entity', 'x')));
    assert.equal(cache.peek(captureKey('not-an-entity', 'x')).status, 'failed');
  });

  it('refuses a thumbnail whose bytes do not match their reference', async () => {
    const { env, version, entityId } = await seeded();
    const tampered: ThumbnailPort = {
      async readThumbnail(ref: PreviewRef, signal: AbortSignal): Promise<PreviewBytes> {
        const real = await env.thumbnails.readThumbnail(ref, signal);
        const bytes = real.bytes.slice();
        bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) % 256;
        return { mediaType: real.mediaType, bytes };
      },
    };
    const cache = createCaptureCache({ readContent: async () => env.content, thumbnails: tampered });
    const key = captureKey(entityId, version.id as string);
    cache.want(key);
    await until(loaded(cache, key));
    assert.equal(cache.peek(key).status, 'failed', 'a digest mismatch is a failure, never a picture');
  });

  it('retries a failure against freshly read content', async () => {
    const { env, version, entityId } = await seeded();
    let reads = 0;
    let content: ProjectContent = { ...env.content, versions: [] };
    const cache = createCaptureCache({ readContent: async () => { reads += 1; return content; }, thumbnails: env.thumbnails });
    const key = captureKey(entityId, version.id as string);
    cache.want(key);
    await until(loaded(cache, key));
    assert.equal(cache.peek(key).status, 'failed', 'the version was not in the content yet');
    content = env.content;
    cache.retryFailed();
    await until(loaded(cache, key));
    assert.equal(cache.peek(key).status, 'ready', 'once Projects has it, a retry finds it');
    assert.equal(reads, 2);
  });
});

describe('flow summaries', () => {
  it('shows a flow by its title and step count, read once per flow', async () => {
    const reads: string[] = [];
    const cache = createFlowCache(async (flowId) => {
      reads.push(flowId);
      return summarizeFlow({ title: 'Checkout', screens: [{}, {}, {}] as never });
    });
    const key = flowItemKey('flow-map', 'flow-1' as FlowId);
    cache.want(key);
    cache.want(key);
    await settled();
    assert.deepEqual(cache.peek(key), { status: 'ready', value: { title: 'Checkout', steps: 3 } });
    assert.deepEqual(reads, ['flow-1']);
  });

  it('fails for a key that is not a flow item instead of asking the repository', async () => {
    let asked = false;
    const cache = createFlowCache(async () => { asked = true; return { title: 'x', steps: 0 }; });
    cache.want('hq.design.components/button');
    await settled();
    assert.equal(cache.peek('hq.design.components/button').status, 'failed');
    assert.equal(asked, false);
  });
});
