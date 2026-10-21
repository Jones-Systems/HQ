/** Saved flow captures are read back only by their exact digest, and only as verified PNG bytes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { ProjectContext } from '@hq/contracts';
import { createBridgedWorkspace } from '../bridged-workspace.ts';
import { readCapture } from '../flow-captures.ts';

const png = (seed: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(seed)]);
const digestOf = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('flow capture images', () => {
  it('returns an object URL only for PNG bytes whose hash is the requested digest', async () => {
    const bytes = png('home');
    const digest = digestOf(bytes);
    const requested: string[] = [];
    const ready = await readCapture(async (value) => { requested.push(value); return bytes; }, digest);
    assert.deepEqual(requested, [digest]);
    assert.equal(ready.status, 'ready');
    if (ready.status === 'ready') { assert.match(ready.url, /^blob:/u); URL.revokeObjectURL(ready.url); }
    assert.deepEqual(await readCapture(async () => png('other'), digest), { status: 'unreadable' }, 'different bytes are never shown for this screen');
    const text = new TextEncoder().encode('not an image');
    assert.deepEqual(await readCapture(async () => text, digestOf(text)), { status: 'unreadable' });
    assert.deepEqual(await readCapture(async () => null, digest), { status: 'missing' });
    assert.deepEqual(await readCapture(async () => { throw new Error('bridge unavailable'); }, digest), { status: 'unreadable' });
  });

  it('bridged flows read captures through the workspace blob store by exact digest, read-only', async () => {
    const reads: string[] = [];
    const documents = {
      kind: 'workspace', namespace: 'workspace',
      async getDocument() { return null; },
      async putDocument(): Promise<never> { throw new Error('flows listing must not write'); },
      async listDocuments() { return []; },
      async getBlob(digest: string) { reads.push(digest); return null; },
    } as unknown as Parameters<typeof createBridgedWorkspace>[0];
    const env = await createBridgedWorkspace(documents).flowsFor({ id: 'project-synthetic', name: 'Synthetic' } as ProjectContext);
    assert.deepEqual(env.flows, []);
    const digest = `sha256:${'a'.repeat(64)}`;
    assert.equal(await env.readCapture!(digest), null);
    assert.deepEqual(reads, [digest]);
    const documentOnly = { ...documents, getBlob: undefined } as unknown as Parameters<typeof createBridgedWorkspace>[0];
    assert.equal((await createBridgedWorkspace(documentOnly).flowsFor({ id: 'project-synthetic', name: 'Synthetic' } as ProjectContext)).readCapture, null);
  });
});
