import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JsonValue, UiStatePort } from '../../../ui/contract.ts';
import { createDesignCore } from '../../../ui/src/domain-core.ts';
import { createFakeStorage } from '../../../ui/src/fakes.ts';
import { sessionKey } from '../../../ui/src/session.ts';
import { CANVAS_SESSION_SECTION, canvasSessionToJson, createDeactivate, guardedLocalStorage, parseCanvasSession } from '../session.ts';

const GOOD = { camera: { x: -120.5, y: 40, zoom: 0.75 }, selection: ['item-a', 'board-1'], focusId: 'item-a' };

describe('canvas session state', () => {
  it('round-trips camera, selection and focus through JSON', () => {
    assert.deepEqual(parseCanvasSession(canvasSessionToJson(GOOD)), GOOD);
    assert.deepEqual(parseCanvasSession(canvasSessionToJson({ ...GOOD, selection: [], focusId: null })), { ...GOOD, selection: [], focusId: null });
  });

  it('rejects anything but the exact shape, with finite numbers and a positive zoom', () => {
    const bad: JsonValue[] = [
      null, 'x', [], {}, { ...GOOD, extra: 1 }, { camera: GOOD.camera, selection: [] },
      { ...GOOD, camera: { x: 0, y: 0, zoom: 0 } }, { ...GOOD, camera: { x: 0, y: 0, zoom: -1 } },
      { ...GOOD, camera: { x: 0, y: 0, zoom: 1, extra: 1 } }, { ...GOOD, camera: { x: '0', y: 0, zoom: 1 } },
      { ...GOOD, selection: [1] }, { ...GOOD, selection: [''] }, { ...GOOD, selection: ['a\u0000'] },
      { ...GOOD, selection: Array.from({ length: 1001 }, (_, i) => `n${i}`) }, { ...GOOD, focusId: 3 }, { ...GOOD, focusId: '' },
    ];
    for (const value of bad) assert.equal(parseCanvasSession(value), undefined, JSON.stringify(value)?.slice(0, 60));
    assert.equal(parseCanvasSession(undefined), undefined);
  });
});

describe('domain switch restore through the T14 session store', () => {
  it('restores canvas camera and selection after Design is left and re-entered, from the one session key', () => {
    const storage = createFakeStorage();
    const first = createDesignCore(storage);
    const handle = first.sessions.sectionHandle('project-alpha', CANVAS_SESSION_SECTION);
    assert.equal(handle.write(canvasSessionToJson(GOOD)), true);
    createDeactivate(first)();
    assert.deepEqual(storage.writes.map((write) => write.key), [sessionKey('project-alpha')]);
    assert.equal(sessionKey('project-alpha'), 'hq.design.ui-session.v1:project-alpha');

    const second = createDesignCore(storage);
    const restored = parseCanvasSession(second.sessions.sectionHandle('project-alpha', CANVAS_SESSION_SECTION).read());
    assert.deepEqual(restored, GOOD);
  });

  it('keeps state per project and never leaks a canvas session into another project', () => {
    const storage = createFakeStorage();
    const core = createDesignCore(storage);
    core.sessions.sectionHandle('project-alpha', CANVAS_SESSION_SECTION).write(canvasSessionToJson(GOOD));
    core.deactivate();
    const other = createDesignCore(storage).sessions.sectionHandle('project-beta', CANVAS_SESSION_SECTION).read();
    assert.equal(other, undefined);
  });

  it('ignores a hand-edited canvas session instead of passing it to the canvas', () => {
    const storage = createFakeStorage();
    const core = createDesignCore(storage);
    core.sessions.sectionHandle('project-alpha', CANVAS_SESSION_SECTION).write({ camera: { x: 1, y: 1, zoom: 0 }, selection: [], focusId: null });
    assert.equal(parseCanvasSession(core.sessions.sectionHandle('project-alpha', CANVAS_SESSION_SECTION).read()), undefined);
  });
});

describe('deactivate', () => {
  it('is idempotent: the second call writes nothing', () => {
    const storage = createFakeStorage();
    const core = createDesignCore(storage);
    core.sessions.sectionHandle('project-alpha', CANVAS_SESSION_SECTION).write(canvasSessionToJson(GOOD));
    const deactivate = createDeactivate(core);
    deactivate();
    const afterFirst = storage.writes.length;
    deactivate();
    deactivate();
    assert.equal(afterFirst, 1);
    assert.equal(storage.writes.length, afterFirst);
  });

  it('writes only Design session keys, so leaving Design cannot submit or touch anything else', () => {
    const storage = createFakeStorage({ 'hq.appearance.v1': 'dark', 'hq.navigation.v1:project-alpha': '{}' });
    const core = createDesignCore(storage);
    core.sessions.sectionHandle('project-alpha', 'compare').write({ draft: 'unsent note' });
    createDeactivate(core)();
    assert.ok(storage.writes.every((write) => write.key.startsWith('hq.design.ui-session.v1:')));
    assert.equal(storage.data.get('hq.appearance.v1'), 'dark');
  });

  it('never throws into the shell when storage fails', () => {
    const storage = createFakeStorage();
    const core = createDesignCore(storage);
    core.sessions.sectionHandle('project-alpha', 'compare').write({ x: 1 });
    storage.failWrites = true;
    assert.doesNotThrow(() => createDeactivate(core)());
    assert.doesNotThrow(() => createDeactivate({ deactivate: () => { throw new Error('boom'); } })());
  });
});

describe('guarded localStorage', () => {
  const memory: UiStatePort = { getItem: () => null, setItem: () => undefined };
  it('returns the storage when it is usable', () => {
    assert.equal(guardedLocalStorage({ localStorage: memory }), memory);
  });
  it('returns null when reading the property throws (disabled or sandboxed storage)', () => {
    const host = { get localStorage(): UiStatePort { throw new DOMException('denied', 'SecurityError'); } };
    assert.equal(guardedLocalStorage(host), null);
  });
  it('returns null when there is no window or the object is not a storage', () => {
    assert.equal(guardedLocalStorage(undefined), null);
    assert.equal(guardedLocalStorage({}), null);
    assert.equal(guardedLocalStorage({ localStorage: {} as UiStatePort }), null);
  });
});
