import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SectionStateHandle } from '../../contract.ts';
import { createDesignCore } from '../../src/domain-core.ts';
import { createFakeShell, createFakeStorage } from '../../src/fakes.ts';
import { DEFAULT_LAYOUT, resizePanel } from '../../src/panels.ts';
import { MAX_SECTION_STATE, sessionKey } from '../../src/session.ts';

/** Labelled fake sections: they keep transient UI state only through their handle, like real sections. */
function mountFakeSections(canvas: SectionStateHandle, requests: SectionStateHandle) {
  return {
    canvas: (canvas.read() ?? { viewport: { x: 0, y: 0, zoom: 1 }, selection: [] }) as { viewport: { x: number; y: number; zoom: number }; selection: string[] },
    draft: (requests.read() ?? { text: '' }) as { text: string },
  };
}

test('Design→Social→Design with the shell fake restores draft, canvas viewport and selection', () => {
  const storage = createFakeStorage();
  const shell = createFakeShell({ id: 'alpha', name: 'Alpha' });
  const core = createDesignCore(storage);
  shell.onDomainChange((from) => { if (from === 'design') core.deactivate(); });

  // First mount: the user edits.
  const handles = () => [core.sessions.sectionHandle('alpha', 'canvas'), core.sessions.sectionHandle('alpha', 'requests')] as const;
  let [canvas, requests] = handles();
  assert.deepEqual(mountFakeSections(canvas, requests).draft, { text: '' });
  assert.ok(canvas.write({ viewport: { x: -320, y: 140, zoom: 1.75 }, selection: ['v-hero-2', 'v-hero-3'] }));
  assert.ok(requests.write({ text: 'Tighten the hero spacing' }));
  core.sessions.setPanels('alpha', resizePanel(DEFAULT_LAYOUT, 'sidebar', 64, 1400));

  // Switch away: the shell unmounts Design. Handles are dropped like an unmounted tree.
  shell.switchDomain('social');
  canvas = undefined as never; requests = undefined as never;
  shell.switchDomain('design');

  [canvas, requests] = handles();
  const restored = mountFakeSections(canvas, requests);
  assert.deepEqual(restored.canvas, { viewport: { x: -320, y: 140, zoom: 1.75 }, selection: ['v-hero-2', 'v-hero-3'] });
  assert.deepEqual(restored.draft, { text: 'Tighten the hero spacing' });
  assert.equal(core.sessions.get('alpha').panels.sidebar.size, 304);

  // Leaving Design wrote chrome state to its own key only, and submitted nothing.
  assert.deepEqual([...new Set(storage.writes.map((w) => w.key))], [sessionKey('alpha')]);
  assert.equal(storage.writes.length, 1);
  assert.deepEqual(shell.projectRequests, []);
});

test('a fresh Design instance restores the same state from storage (serialize/restore)', () => {
  const storage = createFakeStorage();
  const first = createDesignCore(storage);
  first.sessions.sectionHandle('alpha', 'requests').write({ text: 'Draft survives reload' });
  first.sessions.setLastSection('alpha', 'review', 'compare');
  first.deactivate();

  const second = createDesignCore(storage);
  assert.deepEqual(second.sessions.sectionHandle('alpha', 'requests').read(), { text: 'Draft survives reload' });
  assert.equal(second.sessions.get('alpha').lastSection.review, 'compare');
  assert.equal(second.sessions.persistence('alpha').status, 'ok');

  const text = first.serialize('alpha')!;
  const third = createDesignCore(null);
  assert.deepEqual(third.restore('alpha', text), { status: 'restored' });
  assert.deepEqual(third.sessions.sectionHandle('alpha', 'requests').read(), { text: 'Draft survives reload' });
  assert.equal(third.restore('beta', text).status, 'rejected', 'state never crosses projects');
});

test('projects keep separate sessions', () => {
  const core = createDesignCore(createFakeStorage());
  core.sessions.sectionHandle('alpha', 'requests').write({ text: 'alpha draft' });
  assert.equal(core.sessions.sectionHandle('beta', 'requests').read(), undefined);
});

test('unknown sections are preserved through restore and flush', () => {
  const storage = createFakeStorage();
  const core = createDesignCore(storage);
  core.sessions.sectionHandle('alpha', 'not-installed-here').write({ keep: true });
  core.deactivate();
  const again = createDesignCore(storage);
  again.sessions.sectionHandle('alpha', 'canvas').write({ zoom: 2 });
  again.deactivate();
  assert.deepEqual(JSON.parse(storage.data.get(sessionKey('alpha'))!).sections, { 'not-installed-here': { keep: true }, canvas: { zoom: 2 } });
});

for (const [label, stored] of [
  ['a newer schema', JSON.stringify({ schema: 'hq.design.ui-session/v2', projectId: 'alpha' })],
  ['corrupt JSON', '{"schema":'],
] as const) {
  test(`${label} is held read-only until the user explicitly starts fresh`, () => {
    const storage = createFakeStorage({ [sessionKey('alpha')]: stored });
    const core = createDesignCore(storage);
    assert.equal(core.sessions.persistence('alpha').status, 'held');
    core.sessions.sectionHandle('alpha', 'requests').write({ text: 'new' });
    core.deactivate();
    assert.equal(storage.data.get(sessionKey('alpha')), stored, 'held text is not overwritten');
    assert.equal(storage.writes.length, 0);
    core.sessions.startFresh('alpha');
    core.deactivate();
    assert.equal(storage.writes.length, 1);
    assert.equal(JSON.parse(storage.data.get(sessionKey('alpha'))!).sections.requests.text, 'new');
  });
}

test('oversized or non-JSON section state is rejected, never truncated', () => {
  const core = createDesignCore(createFakeStorage());
  const handle = core.sessions.sectionHandle('alpha', 'canvas');
  assert.equal(handle.write('x'.repeat(MAX_SECTION_STATE + 1)), false);
  assert.equal(handle.write({ n: Number.NaN } as never), false);
  assert.equal(handle.write(new Date() as never), false);
  assert.equal(handle.read(), undefined);
});

test('a failing storage keeps in-memory state and reports unavailable', () => {
  const storage = createFakeStorage();
  storage.failWrites = true;
  const core = createDesignCore(storage);
  core.sessions.sectionHandle('alpha', 'requests').write({ text: 'still here' });
  core.deactivate();
  assert.equal(core.sessions.persistence('alpha').status, 'unavailable');
  assert.deepEqual(core.sessions.sectionHandle('alpha', 'requests').read(), { text: 'still here' });
  storage.failWrites = false;
  core.deactivate();
  assert.equal(core.sessions.persistence('alpha').status, 'ok', 'a later successful write recovers');
});

test('unchanged writes do not dirty the session', () => {
  const storage = createFakeStorage();
  const core = createDesignCore(storage);
  const handle = core.sessions.sectionHandle('alpha', 'canvas');
  handle.write({ zoom: 1 });
  core.deactivate();
  handle.write({ zoom: 1 });
  core.deactivate();
  assert.equal(storage.writes.length, 1);
});
