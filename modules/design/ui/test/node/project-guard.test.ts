import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReference } from '@hq/contracts';
import { buildCommands } from '../../src/palette.ts';
import { cancelSwitch, classifyReference, confirmSwitch, INITIAL_GUARD, proposeSwitch } from '../../src/project-guard.ts';
import { createFakeShell } from '../../src/fakes.ts';
import { chromeView } from './fixtures.ts';

test('switching project context requires an explicit confirmation of that exact proposal', () => {
  const shell = createFakeShell({ id: 'alpha', name: 'Alpha' });
  let guard = proposeSwitch(INITIAL_GUARD, 'alpha', 'beta', 'Beta', 'palette');
  assert.equal(guard.pending?.projectId, 'beta');
  assert.deepEqual(shell.projectRequests, [], 'a proposal alone never reaches the shell');

  const stale = guard.pending!.token;
  guard = proposeSwitch(guard, 'alpha', 'gamma', 'Gamma', 'reference');
  const staleResult = confirmSwitch(guard, stale);
  assert.equal(staleResult.request, null, 'a replaced prompt cannot be confirmed');

  const confirmed = confirmSwitch(guard, guard.pending!.token);
  assert.equal(confirmed.request, 'gamma');
  if (confirmed.request) shell.requestProjectContext(confirmed.request);
  assert.equal(confirmSwitch(confirmed.state, guard.pending!.token).request, null, 'double confirm sends nothing');
  assert.deepEqual(shell.projectRequests, ['gamma']);
  assert.equal(shell.getSnapshot().context.id, 'alpha', 'the shell, not Design, applies the switch');
});

test('cancel and same-project proposals leave nothing pending', () => {
  const guard = proposeSwitch(INITIAL_GUARD, 'alpha', 'beta', 'Beta', 'section');
  assert.equal(cancelSwitch(guard).pending, null);
  assert.equal(proposeSwitch(guard, 'alpha', 'alpha', 'Alpha', 'palette').pending, null);
});

test('a reference into another project is classified, never followed', () => {
  const reference = parseReference({
    version: 1, domain: 'design', projectId: 'beta', kind: 'version', entityId: 'v-1', title: 'Hero v1',
    returnDestination: { domain: 'work', destination: 'board' },
  })!;
  assert.deepEqual(classifyReference(reference, 'alpha'), { type: 'other-project', projectId: 'beta' });
  assert.deepEqual(classifyReference(reference, 'beta'), { type: 'same-project', kind: 'version', entityId: 'v-1' });
  assert.deepEqual(classifyReference({ ...reference, domain: 'social' }, 'beta'), { type: 'foreign-domain', domain: 'social' });
});

test('palette project entries are keyed by id, exclude the current project, and only propose', () => {
  const commands = buildCommands({
    ...chromeView(), sections: [], currentProjectId: 'alpha',
    projects: [{ id: 'alpha', name: 'Site' }, { id: 'beta', name: 'Site' }, { id: 'gamma', name: 'Site' }],
  });
  const projects = commands.filter((c) => c.group === 'Projects');
  assert.deepEqual(projects.map((c) => c.id), ['project:beta', 'project:gamma'], 'same titles are not merged');
  assert.ok(projects.every((c) => c.action.type === 'propose-project'));
});
