import { expect, it } from 'vitest';
import type { StoragePort } from '../state';
import { RECENT_PROJECTS_KEY, RECENT_PROJECTS_LIMIT, readRecentProjects, rememberProject } from './recent-projects';

function storage(value: string | null): StoragePort {
  return { getItem: key => (key === RECENT_PROJECTS_KEY ? value : null), setItem: () => {} };
}

it('reads valid, unique recent projects newest first and drops anything else', () => {
  const saved = JSON.stringify([
    { id: 'larkspur', name: 'Larkspur Tea Co.', extra: 'dropped' }, { id: 'larkspur', name: 'Duplicate' },
    { id: '', name: 'No id' }, { id: 'blank', name: '  ' }, { id: 7, name: 'Number id' }, null, 'text',
    { id: 'atlas', name: 'Atlas Week' },
  ]);
  expect(readRecentProjects(storage(saved))).toEqual([{ id: 'larkspur', name: 'Larkspur Tea Co.' }, { id: 'atlas', name: 'Atlas Week' }]);
});

it.each([null, '{broken', '{}', '"text"'])('treats a missing or malformed list as empty: %s', value => {
  expect(readRecentProjects(storage(value))).toEqual([]);
});

it('keeps reading when storage is blocked', () => {
  expect(readRecentProjects({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toEqual([]);
});

it('moves a reopened project to the front and keeps the list bounded', () => {
  let recent = readRecentProjects(storage(null));
  for (let index = 0; index < RECENT_PROJECTS_LIMIT + 2; index += 1) recent = rememberProject(recent, { id: `p${index}`, name: `Project ${index}` });
  expect(recent).toHaveLength(RECENT_PROJECTS_LIMIT);
  expect(recent[0]).toEqual({ id: `p${RECENT_PROJECTS_LIMIT + 1}`, name: `Project ${RECENT_PROJECTS_LIMIT + 1}` });
  recent = rememberProject(recent, { id: 'p4', name: 'Project 4 renamed' });
  expect(recent[0]).toEqual({ id: 'p4', name: 'Project 4 renamed' });
  expect(recent.filter(project => project.id === 'p4')).toHaveLength(1);
});
