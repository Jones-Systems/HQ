/** Rights mapping, tightening and publishability for the reference graph. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { GraphCaptureCandidate, TreeImportOutcome } from '../src/graph-contract.ts';
import { deriveSubjectId } from '../src/graph-identity.ts';
import { capturesOfSubject } from '../src/graph-ops.ts';
import {
  HQ_RIGHTS_VOCABULARY, isGraphPublishable, mapDeclaredRights, publishBlock, REA_RIGHTS_VOCABULARY, RIGHTS_VOCABULARIES,
  STUDY_RIGHTS_VOCABULARY,
} from '../src/rights.ts';
import { issuesOf, openGraph, pageCapture, PERMITTED, websiteTree } from './graph-fixtures.ts';

const ok = (outcome: TreeImportOutcome) => { assert.equal(outcome.ok, true, JSON.stringify(outcome)); return outcome; };
const one = (rights?: GraphCaptureCandidate['rights']) => websiteTree({
  pages: [{ url: 'https://example.com/p', title: 'P', captures: [pageCapture('p', rights === undefined ? {} : { rights })] }],
});
const capture = async (graph: Awaited<ReturnType<typeof openGraph>>['graph']) =>
  capturesOfSubject(graph.state, await deriveSubjectId({ kind: 'page', url: 'https://example.com/p' }))[0]!;

describe('distinct source rights vocabularies map conservatively', () => {
  test('the registry is the explicit mapping table', () => {
    const table = Object.fromEntries(Object.entries(RIGHTS_VOCABULARIES).map(([vocabulary, values]) => [
      vocabulary, Object.fromEntries(Object.entries(values).map(([value, mapping]) => [value, `${mapping.effective}${mapping.private ? '+private' : ''}`])),
    ]));
    assert.deepEqual(table, {
      [HQ_RIGHTS_VOCABULARY]: { permitted: 'permitted', restricted: 'restricted', unknown: 'unknown' },
      [STUDY_RIGHTS_VOCABULARY]: {
        'public-domain': 'permitted', licensed: 'permitted', 'study-only': 'restricted', internal: 'restricted',
        private: 'restricted+private', unreviewed: 'unknown',
      },
      [REA_RIGHTS_VOCABULARY]: {
        cleared: 'permitted', 'attribution-required': 'unknown', 'non-commercial': 'restricted', private: 'restricted+private', unknown: 'unknown',
      },
    });
  });

  test('unregistered vocabularies, unregistered values and prototype keys are unknown, never permitted', () => {
    for (const [vocabulary, value] of [
      ['producer.study-corpus/v1', 'Licensed'], ['producer.study-corpus/v2', 'licensed'], ['nope/v1', 'permitted'],
      [HQ_RIGHTS_VOCABULARY, 'constructor'], ['__proto__', 'permitted'], [HQ_RIGHTS_VOCABULARY, '__proto__'], ['', ''],
    ] as const) {
      assert.deepEqual(mapDeclaredRights(vocabulary, value), { effective: 'unknown', private: false }, `${vocabulary} ${value}`);
    }
  });

  test('a producer word is kept verbatim next to its mapped status', async () => {
    const { graph } = await openGraph();
    ok(await graph.importTree(one({ vocabulary: STUDY_RIGHTS_VOCABULARY, value: 'licensed', basis: 'synthetic licence note' })));
    const { rights } = await capture(graph);
    assert.deepEqual(rights.declared, { vocabulary: STUDY_RIGHTS_VOCABULARY, value: 'licensed' });
    assert.equal(rights.effective, 'permitted');
    assert.equal(rights.setBy, 'agent-reported');
    assert.equal(isGraphPublishable(rights), true);
  });

  test('a grant without a stated basis is rejected rather than defaulted', async () => {
    const { graph } = await openGraph();
    const outcome = await graph.importTree(one({ vocabulary: HQ_RIGHTS_VOCABULARY, value: 'permitted' }));
    assert.deepEqual(issuesOf(outcome), [{ field: 'pages[0].captures[0].rights.basis', code: 'required-when-permitted' }]);
  });

  test('conditional or study-only words never grant', async () => {
    for (const [vocabulary, value, blocked] of [
      [REA_RIGHTS_VOCABULARY, 'attribution-required', 'rights-unknown'], [REA_RIGHTS_VOCABULARY, 'non-commercial', 'rights-restricted'],
      [STUDY_RIGHTS_VOCABULARY, 'study-only', 'rights-restricted'], [STUDY_RIGHTS_VOCABULARY, 'private', 'private'],
      [STUDY_RIGHTS_VOCABULARY, 'made-up-value', 'rights-unknown'],
    ] as const) {
      const { graph } = await openGraph();
      ok(await graph.importTree(one({ vocabulary, value, basis: 'synthetic' })));
      const { rights } = await capture(graph);
      assert.equal(isGraphPublishable(rights), false, value);
      assert.equal(publishBlock(rights), blocked, value);
    }
  });

  test('a capture with no rights statement is unknown', async () => {
    const { graph } = await openGraph();
    ok(await graph.importTree(one()));
    const { rights } = await capture(graph);
    assert.equal(rights.effective, 'unknown');
    assert.equal(publishBlock(rights), 'rights-unknown');
  });
});

describe('unknown rights cannot become permitted', () => {
  test('re-importing a permitted statement over unknown rights changes nothing', async () => {
    const { graph } = await openGraph();
    ok(await graph.importTree(one()));
    const again = await graph.importTree(one(PERMITTED));
    assert.equal(again.ok && again.captures[0]!.status, 'observed-again');
    assert.deepEqual(again.ok && again.captures[0]!.differences, ['rights']);
    assert.equal((await capture(graph)).rights.effective, 'unknown');
  });

  test('only the owner path can grant, and it records owner-judged', async () => {
    const { graph } = await openGraph();
    ok(await graph.importTree(one()));
    const { id } = await capture(graph);
    assert.deepEqual(await graph.setCaptureRights(id, { vocabulary: HQ_RIGHTS_VOCABULARY, value: 'permitted' }), { ok: false, code: 'required-when-permitted' });
    assert.equal((await graph.setCaptureRights(id, PERMITTED)).ok, true);
    const { rights } = await capture(graph);
    assert.equal(rights.effective, 'permitted');
    assert.equal(rights.setBy, 'owner-judged');
  });

  test('an importer cannot claim an owner judgement on rights', async () => {
    const { graph } = await openGraph();
    const outcome = await graph.importTree(one({ ...PERMITTED, setBy: 'owner-judged' } as never));
    assert.deepEqual(issuesOf(outcome), [{ field: 'pages[0].captures[0].rights.setBy', code: 'not-allowed' }]);
  });

  test('a later non-grant tightens an agent-reported grant but never an owner judgement', async () => {
    const restricted = { vocabulary: HQ_RIGHTS_VOCABULARY, value: 'restricted' } as const;
    const agent = await openGraph();
    ok(await agent.graph.importTree(one(PERMITTED)));
    const tightened = await agent.graph.importTree(one(restricted));
    assert.deepEqual(tightened.ok && tightened.captures[0]!.differences, ['rights-tightened']);
    assert.equal((await capture(agent.graph)).rights.effective, 'restricted');

    const owner = await openGraph();
    ok(await owner.graph.importTree(one(PERMITTED)));
    assert.equal((await owner.graph.setCaptureRights((await capture(owner.graph)).id, PERMITTED)).ok, true);
    const held = await owner.graph.importTree(one(restricted));
    assert.deepEqual(held.ok && held.captures[0]!.differences, ['rights']);
    assert.equal((await capture(owner.graph)).rights.effective, 'permitted');
  });

  test('re-importing without a rights statement never tightens or loosens', async () => {
    const { graph } = await openGraph();
    ok(await graph.importTree(one(PERMITTED)));
    const again = await graph.importTree(one());
    assert.equal(again.ok && again.status, 'unchanged');
    assert.equal((await capture(graph)).rights.effective, 'permitted');
  });
});
