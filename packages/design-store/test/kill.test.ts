import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { JsonValue, StoragePort } from '../src/contract.ts';
import { documentKey, streamId } from '../src/ids.ts';
import { canonicalize } from '../src/jcs.ts';
import { open, scratch, WORKSPACE } from './helpers.ts';

const CHILD = fileURLToPath(new URL('./fixtures/kill-child.ts', import.meta.url));

async function seed(t: TestContext, label: string): Promise<string> {
  const root = join(scratch(t), label);
  const { store } = await open(root);
  await store.putDocument(WORKSPACE, documentKey('draft'), { body: 'old text' });
  await store.putDocument(WORKSPACE, documentKey('scratch'), { temp: true });
  await store.appendEvent(WORKSPACE, streamId('decisions'), { type: 'proposed', payload: { candidate: 'c1' } });
  await store.close();
  return root;
}

async function observe(root: string): Promise<string> {
  const { store } = await open(root);
  try {
    return canonicalize(await snapshot(store));
  } finally {
    await store.close();
  }
}

async function snapshot(store: StoragePort): Promise<JsonValue> {
  const documents: Record<string, JsonValue> = {};
  for (const id of await store.listDocuments(WORKSPACE)) documents[id] = (await store.getDocument(WORKSPACE, id))?.value ?? null;
  const events = (await store.readEvents(WORKSPACE, streamId('decisions'))).events.map((event) => event.payload);
  return { documents, events };
}

/** Runs the child until it parks before mutating call `pauseAt`, then SIGKILLs it. */
function runChild(root: string, scenario: string, pauseAt: number): Promise<'killed' | 'done'> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD, root, scenario, String(pauseAt)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    let outcome: 'killed' | 'done' | null = null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (outcome === null && output.includes('PAUSED')) {
        outcome = 'killed';
        child.kill('SIGKILL');
      } else if (outcome === null && output.includes('DONE')) {
        outcome = 'done';
      }
    });
    child.stderr.on('data', (chunk: string) => {
      errors += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (outcome === 'killed' && signal === 'SIGKILL') resolve('killed');
      else if (outcome === 'done' && code === 0) resolve('done');
      else reject(new Error(`child exited code=${String(code)} signal=${String(signal)} output=${output} errors=${errors}`));
    });
  });
}

describe('SIGKILL of a real writer process at every write stage', () => {
  // Minimum stages: put = temp write, fsync, rename, dir fsync; append into an existing stream = append, fsync.
  for (const [scenario, minimumKills] of [['put', 4], ['commit', 10], ['append', 2]] as const) {
    it(`${scenario}: the reopened store holds the old or the new state`, async (t) => {
      const oldState = await observe(await seed(t, 'old'));
      const newRoot = await seed(t, 'new');
      assert.equal(await runChild(newRoot, scenario, -1), 'done');
      const newState = await observe(newRoot);
      assert.notEqual(oldState, newState);
      let kills = 0;
      for (let pauseAt = 0; ; pauseAt += 1) {
        const root = await seed(t, `kill-${pauseAt}`);
        const outcome = await runChild(root, scenario, pauseAt);
        const state = await observe(root);
        assert.ok(state === oldState || state === newState, `kill before call ${pauseAt} produced a mixed state ${state}`);
        if (outcome === 'done') break;
        kills += 1;
      }
      t.diagnostic(`${kills} real SIGKILL stages`);
      assert.ok(kills >= minimumKills, `expected at least ${minimumKills} kill stages, saw ${kills}`);
    });
  }
});
