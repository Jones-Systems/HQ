import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createActiveProjectStore, resolveDesignProject } from '../active-project.ts';
import { annotationSessionFor, canvasFor, compareFor, contentFor, projectsFor } from '../workspace.ts';

describe('active project', () => {
  it('notifies once per change and falls back to the shell context', () => {
    const store = createActiveProjectStore();
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    const shell = { id: 'shell', name: 'Shell' };
    assert.equal(resolveDesignProject(shell, store.current()), shell);
    store.set({ id: 'p1', name: 'One' });
    store.set({ id: 'p1', name: 'One' });
    assert.equal(calls, 1);
    assert.deepEqual(resolveDesignProject(shell, store.current()), { id: 'p1', name: 'One' });
    store.set({ id: 'shell', name: 'Shell' });
    assert.equal(resolveDesignProject(shell, store.current()), shell);
  });
});

describe('example workspace project created in Projects', () => {
  it('opens Review over its own content, not the synthetic seed', async () => {
    const shell = { id: 'project-delta', name: 'Delta (synthetic)' };
    const controller = await projectsFor(shell);
    assert.deepEqual(await controller.createProject('Spring tasting launch'), { ok: true });
    const created = controller.getSnapshot().active;
    assert.ok(created);
    const project = { id: created.projectId, name: 'Spring tasting launch' };
    assert.deepEqual(await controller.addView('Landing', 'page'), { ok: true });
    assert.equal(controller.getSnapshot().registry.projects.length, 2, 'the shell project and the created project are both listed');

    const { content, example } = await contentFor(project);
    assert.equal(example, false);
    assert.deepEqual(content.views.map((item) => item.title), ['Landing']);
    assert.equal(content.versions.length, 0);

    const canvas = await canvasFor(project);
    assert.ok(canvas);
    assert.equal(canvas.registry.catalog(canvas.projectId).flatMap(({ items }) => items).some((item) => /synthetic/iu.test(item.title)), false);
    assert.equal(compareFor(project).getSnapshot().comparison.panels.length, 0);
    assert.equal(await annotationSessionFor(project), null);

    const seeded = await contentFor(shell);
    assert.equal(seeded.example, true);
    assert.ok(seeded.content.versions.length >= 4);
  });
});
