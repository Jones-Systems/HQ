import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FlowDocument, ScreenId } from '../src/contract.ts';
import type { EdgeResolution } from '../src/edges.ts';
import { layoutFlowMap } from '../src/map.ts';
import { createPlayer, type StepOutcome } from '../src/player.ts';
import { checkout, randomFlow } from './fixtures.ts';

/** What the map promises for an edge, in the vocabulary of player outcomes. */
function expected(resolution: EdgeResolution): string {
  switch (resolution.status) {
    case 'ok': return `navigated:${resolution.to}`;
    case 'back': return 'back';
    case 'exit': return `exit:${resolution.url}`;
    case 'broken': return `broken:${resolution.reason}`;
  }
}
function observed(outcome: StepOutcome): string {
  switch (outcome.kind) {
    case 'navigated': return `navigated:${outcome.to}`;
    case 'back': case 'back-unavailable': return 'back';
    case 'exit': return `exit:${outcome.url}`;
    case 'broken': return `broken:${outcome.reason}`;
    case 'entered': return 'entered';
  }
}

function assertAgreement(flow: FlowDocument): number {
  const map = layoutFlowMap(flow);
  const player = createPlayer(flow);
  const mapById = new Map(map.edges.map((edge) => [edge.id, edge]));
  assert.equal(mapById.size, flow.hotspots.length, 'one map edge per hotspot, none dropped');

  // Every screen offers in the player exactly the edges the map draws from it.
  for (const screen of flow.screens) {
    const offered = player.hotspotsOn(screen.id).map((hotspot) => hotspot.id);
    const drawn = map.edges.filter((edge) => edge.from === screen.id).map((edge) => edge.id);
    assert.deepEqual(offered, drawn, `${flow.id} ${screen.id}`);
  }

  // Activating every map edge from its source screen yields what the map says.
  let checked = 0;
  for (const edge of map.edges) {
    if (!edge.fromExists) {
      // Orphan edges are reported by the map; the player can never traverse them.
      for (const screen of flow.screens) {
        const state = player.reduce(player.reduce(player.initial(), { type: 'start', screenId: screen.id }), { type: 'activate', hotspotId: edge.id });
        assert.equal(state.notice?.kind, 'not-on-screen');
      }
      continue;
    }
    const entered = player.reduce(player.initial(), { type: 'start', screenId: edge.from });
    const after = player.reduce(entered, { type: 'activate', hotspotId: edge.id });
    const step = after.steps.at(-1)!;
    assert.equal(step.edgeId, edge.id);
    assert.equal(observed(step.outcome), expected(edge.resolution), `${flow.id} ${edge.id}`);
    checked += 1;
  }

  // Exhaustive exploration from the start: every transition the player makes is a map edge.
  if (player.initial().current !== null) {
    const seen = new Set<ScreenId>([flow.start]);
    const queue: ScreenId[] = [flow.start];
    while (queue.length > 0) {
      const from = queue.shift()!;
      for (const hotspot of player.hotspotsOn(from)) {
        const state = player.reduce(player.reduce(player.initial(), { type: 'start', screenId: from }), { type: 'activate', hotspotId: hotspot.id });
        const step = state.steps.at(-1)!;
        const edge = mapById.get(step.edgeId!);
        assert.ok(edge && edge.from === from, `player edge ${hotspot.id} is on the map`);
        assert.equal(observed(step.outcome), expected(edge.resolution));
        if (step.outcome.kind === 'navigated' && !seen.has(step.outcome.to)) { seen.add(step.outcome.to); queue.push(step.outcome.to); }
      }
    }
    const reachable = new Set(map.nodes.filter((node) => node.reachable).map((node) => node.screenId));
    assert.deepEqual([...seen].sort(), [...reachable].sort(), 'map reachability matches player exploration');
  }
  return checked;
}

describe('flow map and player agree on every edge', () => {
  it('for the synthetic checkout fixture', () => {
    assert.equal(assertAgreement(checkout()), 9);
  });

  it('for 300 generated flows covering ok, back, exit, broken, ambiguous and orphan edges', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 300; seed += 1) {
      const flow = randomFlow(seed);
      assertAgreement(flow);
      for (const edge of layoutFlowMap(flow).edges) kinds.add(edge.fromExists ? expected(edge.resolution).split(':')[0]! + (edge.resolution.status === 'broken' ? `:${edge.resolution.reason}` : '') : 'orphan');
    }
    for (const kind of ['navigated', 'back', 'exit', 'broken:missing-screen', 'broken:undeclared-route', 'broken:undeclared-state', 'broken:ambiguous-route', 'orphan']) {
      assert.ok(kinds.has(kind), `generator covered ${kind}`);
    }
  });
});
