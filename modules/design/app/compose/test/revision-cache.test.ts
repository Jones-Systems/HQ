import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProjectContentEvents } from '../content-events.ts';
import { perProjectRevision } from '../revision-cache.ts';

const a = { id: 'project-a', name: 'A' };
const b = { id: 'project-b', name: 'B' };

function gated() {
  let builds = 0;
  const releases: (() => void)[] = [];
  const build = (project: { id: string }, selection: string | undefined) => {
    builds += 1;
    const label = `${project.id}:${selection ?? '-'}:${builds}`;
    return new Promise<string>((resolve) => releases.push(() => resolve(label)));
  };
  return { build, builds: () => builds, releaseAll: () => { while (releases.length) releases.shift()!(); } };
}

describe('revision-keyed caches', () => {
  it('returns the same promise until the project changes, then builds exactly once more', async () => {
    const events = createProjectContentEvents();
    let builds = 0;
    const get = perProjectRevision(events, async (project) => `${project.id}#${++builds}`);
    const first = get(a);
    assert.equal(get(a), first, 'stable identity: React use() must not see a new promise on every render');
    assert.equal(await first, 'project-a#1');
    events.notify('project-a');
    const second = get(a);
    assert.notEqual(second, first);
    assert.equal(get(a), second);
    assert.equal(await second, 'project-a#2');
    assert.equal(builds, 2);
  });

  it('does not rebuild one project for another project’s change, and keeps projects apart', async () => {
    const events = createProjectContentEvents();
    let builds = 0;
    const get = perProjectRevision(events, async (project) => `${project.id}#${++builds}`);
    const forA = get(a);
    const forB = get(b);
    events.notify('project-b');
    events.notify('project-unrelated');
    assert.equal(get(a), forA);
    assert.notEqual(get(b), forB);
    assert.equal(builds, 3);
  });

  it('caches a failure for the revision (no read loop while suspended) and retries after the next change', async () => {
    const events = createProjectContentEvents();
    let builds = 0;
    const get = perProjectRevision(events, async () => { builds += 1; if (builds === 1) throw new Error('storage lost'); return 'recovered'; });
    const failed = get(a);
    await assert.rejects(failed, /storage lost/u);
    assert.equal(get(a), failed);
    assert.equal(builds, 1);
    events.notify('project-a');
    assert.equal(await get(a), 'recovered');
  });

  it('keeps selections apart and drops the oldest beyond the cap', async () => {
    const events = createProjectContentEvents();
    let builds = 0;
    const get = perProjectRevision(events, async (_project, selection) => `${selection}#${++builds}`, { maxSelections: 2 });
    const one = get(a, { selection: 'one' });
    const two = get(a, { selection: 'two' });
    assert.notEqual(one, two);
    assert.equal(get(a, { selection: 'one' }), one);
    get(a, { selection: 'three' });
    assert.equal(get(a, { selection: 'two' }) === two, false, 'the least recently used selection was dropped');
    assert.equal(await get(a, { selection: 'three' }), 'three#3');
  });

  it('answers a view still showing an older revision with the value that already resolved, never the pending one', async () => {
    const events = createProjectContentEvents();
    const { build, releaseAll } = gated();
    const get = perProjectRevision(events, build);
    const initial = get(a, { revision: 0 });
    releaseAll();
    assert.equal(await initial, 'project-a:-:1');
    events.notify('project-a');
    const fresh = get(a, { revision: 1 });
    assert.notEqual(fresh, initial, 'the up-to-date request builds the new value and waits for it');
    assert.equal(get(a, { revision: 0 }), initial, 'a mounted view keeps its content while the refresh runs');
    assert.equal(get(a, { revision: 1 }), fresh);
    releaseAll();
    assert.equal(await fresh, 'project-a:-:2');
    // Once the new value resolved, a late stale request is served the fresher value and nothing is rebuilt.
    assert.equal(get(a, { revision: 0 }), fresh);
  });

  it('with nothing resolved yet, a stale request waits for the build in flight instead of starting another', async () => {
    const events = createProjectContentEvents();
    const { build, builds, releaseAll } = gated();
    const get = perProjectRevision(events, build);
    const first = get(a);
    events.notify('project-a');
    assert.equal(get(a, { revision: 0 }), first);
    assert.equal(builds(), 1);
    releaseAll();
    await first;
  });

  it('never reads beyond the live revision', () => {
    const events = createProjectContentEvents();
    const { build, builds } = gated();
    const get = perProjectRevision(events, build);
    const first = get(a, { revision: 99 });
    assert.equal(get(a), first);
    assert.equal(builds(), 1);
  });

  it('keep policy: a value that follows changes itself survives them; a failed build is retried', async () => {
    const events = createProjectContentEvents();
    let builds = 0;
    const get = perProjectRevision(events, async () => { builds += 1; if (builds === 1) throw new Error('storage lost'); return { stateful: builds }; }, { onChange: 'keep' });
    const failed = get(a);
    await assert.rejects(failed, /storage lost/u);
    assert.equal(get(a), failed, 'the failure holds until something changes');
    events.notify('project-a');
    const built = get(a);
    assert.deepEqual(await built, { stateful: 2 });
    events.notify('project-a');
    events.notify('project-a');
    assert.equal(get(a), built, 'a successful value is kept across changes');
    assert.equal(builds, 2);
  });
});
