/** Synthetic fixtures only; no real projects, paths or captures. */
import { annotationId, versionId } from '../src/contract.ts';
import type { AgentEvent, AnnotationId, SourceFrame } from '../src/contract.ts';
import { createEditor, emptyDocument, reduce } from '../src/editor.ts';
import type { EditorAction, EditorState, Outcome } from '../src/editor.ts';

export const V1 = versionId('ver-synthetic-1');
export const V2 = versionId('ver-synthetic-2');

export function frame(overrides: Partial<SourceFrame> = {}): SourceFrame {
  return {
    versionId: V1,
    route: '/settings',
    state: 'default',
    viewport: { w: 1280, h: 800, dpr: 1 },
    scroll: { x: 0, y: 0 },
    captureDigest: 'sha256:synthetic-capture',
    ...overrides,
  };
}

export const pickEvent: AgentEvent = {
  type: 'element-picked',
  target: { kind: 'element', path: 'html > body > main > div > button:nth-of-type(1)', rect: { x: 20, y: 500, width: 80, height: 32 }, textHash: 'fnv1a32:00000001' },
  frame: { viewport: { w: 1280, h: 800, dpr: 1 }, scroll: { x: 0, y: 300 } },
};

export const citeEvent: AgentEvent = {
  type: 'text-cited',
  target: { kind: 'text', quote: 'Review the plan', prefix: 'Ship the plan. ', suffix: ' today.', rects: [{ x: 140, y: 400, width: 120, height: 16 }] },
  frame: { viewport: { w: 1280, h: 800, dpr: 1 }, scroll: { x: 0, y: 300 } },
};

let counter = 0;
export function nextId(): AnnotationId {
  counter += 1;
  return annotationId(`fixture-${counter}`);
}

/** Applies actions in order, asserting nothing; returns final state and outcomes. */
export function run(state: EditorState, actions: readonly EditorAction[]): { state: EditorState; outcomes: Outcome[] } {
  const outcomes: Outcome[] = [];
  let current = state;
  for (const action of actions) {
    const result = reduce(current, action);
    current = result.state;
    outcomes.push(result.outcome);
  }
  return { state: current, outcomes };
}

export function freshEditor(): EditorState {
  return createEditor(emptyDocument(V1));
}

export function withTool(state: EditorState, tool: EditorState['tool']): EditorState {
  return reduce(state, { type: 'select-tool', tool }).state;
}
