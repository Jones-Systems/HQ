/** Browser-mode geometry only; rendered layout evidence comes from an actual runtime. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NODE_HEIGHT, NODE_WIDTH, layoutFlowMap } from '../src/map.ts';
import { checkout, randomFlow } from './fixtures.ts';

describe('flow map layout', () => {
  it('places columns by depth from the start and marks the start', () => {
    const map = layoutFlowMap(checkout());
    const column = Object.fromEntries(map.nodes.map((node) => [node.screenId, node.column]));
    assert.deepEqual(column, { cart: 0, 'cart-empty': 1, checkout: 1, 'checkout-error': 2, done: 2 });
    assert.deepEqual(map.nodes.filter((node) => node.isStart).map((node) => node.screenId), ['cart']);
  });

  it('anchors every resolved edge on its source and target node edges, forward or backward', () => {
    for (const flow of [checkout(), ...Array.from({ length: 100 }, (_, n) => randomFlow(n + 1))]) {
      const map = layoutFlowMap(flow);
      const nodes = new Map(map.nodes.map((node) => [node.screenId, node]));
      for (const edge of map.edges) {
        if (!edge.segment || edge.resolution.status !== 'ok') continue;
        const source = nodes.get(edge.from)!;
        const target = nodes.get(edge.resolution.to)!;
        assert.ok([source.x, source.x + NODE_WIDTH].includes(edge.segment.x1), `${flow.id} ${edge.id} leaves a source side`);
        assert.ok([target.x, target.x + NODE_WIDTH].includes(edge.segment.x2), `${flow.id} ${edge.id} reaches a target side`);
        assert.ok(edge.segment.y1 >= source.y && edge.segment.y1 <= source.y + NODE_HEIGHT);
        assert.ok(edge.segment.y2 >= target.y && edge.segment.y2 <= target.y + NODE_HEIGHT);
        if (target.column > source.column) assert.ok(edge.segment.x2 > edge.segment.x1, 'forward edges point right');
        else assert.equal(edge.segment.x1, source.x, 'backward edges leave from the left side');
      }
      for (const node of map.nodes) assert.ok(node.x + NODE_WIDTH <= map.width && node.y + NODE_HEIGHT <= map.height);
    }
  });

  it('keeps unreachable screens visible in a trailing column', () => {
    const flow = randomFlow(7);
    const map = layoutFlowMap(flow);
    const trailing = Math.max(...map.nodes.map((node) => node.column));
    for (const node of map.nodes.filter((item) => !item.reachable)) assert.equal(node.column, trailing);
    assert.equal(map.nodes.length, flow.screens.length);
  });
});
