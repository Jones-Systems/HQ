import { describe, expect, it } from 'vitest';
import { isDestination, parseProjectContext, parseReference, type ReferenceEnvelope } from './index';

const reference: ReferenceEnvelope = {
  version: 1, domain: 'design', projectId: 'project-a', kind: 'decision', entityId: 'missing-decision',
  title: 'Keep the readable decision title', returnDestination: { domain: 'work', destination: 'board/review' },
  sourceRevision: 'revision-42', workspaceId: 'workspace-a',
};

describe('public context and reference boundary', () => {
  it('retains readable provenance without requiring target resolution', () => {
    expect(parseReference(JSON.parse(JSON.stringify(reference)))).toEqual(reference);
    expect(parseReference(reference)).not.toBe(reference);
    const { sourceRevision: _revision, workspaceId: _workspace, ...minimal } = reference;
    expect(parseReference(minimal)).toEqual(minimal);
  });

  it.each([
    { ...reference, version: 2 }, { ...reference, domain: 'unknown' },
    { ...reference, projectId: '' }, { ...reference, title: '' },
    { ...reference, returnDestination: { domain: 'work', destination: 'javascript:run()' } },
    { ...reference, returnDestination: { domain: 'work', destination: 'board', dispatch: true } },
    { ...reference, sourceRevision: undefined }, { ...reference, workspaceId: 5 },
    { ...reference, credential: 'unexpected' }, { ...reference, title: 'line\nbreak' },
    [], null,
  ])('rejects malformed, executable or unexpected reference data %#', (value) => {
    expect(parseReference(value)).toBeNull();
  });

  it('strictly parses project identity without carrying extra payload', () => {
    expect(parseProjectContext({ id: 'project-a', name: 'Example project' })).toEqual({ id: 'project-a', name: 'Example project' });
    expect(parseProjectContext({ id: 'project-a', name: 'Example', path: '/private' })).toBeNull();
    expect(parseProjectContext({ id: ' ', name: 'Example' })).toBeNull();
    expect(parseProjectContext({ id: 'project-a', name: 3 })).toBeNull();
    expect(parseProjectContext(Object.create({ id: 'project-a', name: 'Example' }))).toBeNull();
  });

  it('accepts module-local destinations and rejects remote or executable URLs', () => {
    expect(isDestination('decisions/one?view=history')).toBe(true);
    for (const value of ['https://example.com', '//example.com', '\\\\example.com', 'file:/private', 'home\nrun', '']) {
      expect(isDestination(value)).toBe(false);
    }
  });
});
