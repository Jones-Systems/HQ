import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SYNTHETIC_BUTTON } from '../src/fixtures.ts';
import { createSourceRevision } from '../src/model/source.ts';
import { webCryptoDigest } from '../src/model/jcs.ts';
import { resolveRenderInput } from '../src/model/props.ts';
import { componentRenderRequest } from '../src/runner.ts';
import { createFakeComponentRunner } from '../src/workspace/fake-runner.ts';

test('digest-only runner request and explicitly synthetic lifecycle', async () => {
  const source = await createSourceRevision(SYNTHETIC_BUTTON, 1, webCryptoDigest);
  const input = resolveRenderInput(source, null, null, {}, {});
  const request = await componentRenderRequest(source, input);
  assert.deepEqual(Object.keys(request).sort(), ['componentId', 'digest', 'renderInputDigest', 'revision']);
  assert.deepEqual(await componentRenderRequest(source, input), request);
  await assert.rejects(componentRenderRequest(source, { ...input, sourceRevision: 2 }));
  const runner = createFakeComponentRunner();
  assert.match(runner.label, /FAKE/);
  const result = await runner.render(request);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  const run = result.value;
  await runner.place(run, { x: 0, y: 0, width: 320, height: 200, visible: true });
  const capture = await runner.capture(run);
  assert.equal(capture.status, 'ok');
  if (capture.status === 'ok') {
    assert.equal(capture.value.evidence, 'synthetic');
    assert.equal(capture.value.renderInputDigest, request.renderInputDigest);
    assert.equal(capture.value.viewport.width, 320);
  }
  await runner.close(run);
  await assert.rejects(runner.capture(run));
  assert.deepEqual(runner.calls, ['render', 'place', 'capture', 'close']);
});
