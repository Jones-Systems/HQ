// React server-render checks of markup and attributes. No DOM or layout runs
// here, so these are not rendered-geometry or interaction evidence.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { AnnotationController, loadAnnotations } from '../src/controller.ts';
import { FakeAgentChannel, FakeClipboard, MemoryAnnotationStore, SequentialIds } from '../src/fakes.ts';
import { AnnotationToolbar } from '../src/ui/AnnotationToolbar.tsx';
import { AnnotationsPanel } from '../src/ui/AnnotationsPanel.tsx';
import { V1, frame, pickEvent } from './fixtures.ts';

const noop = () => undefined;

function toolbar(liveAvailable: boolean, tool: 'pick' | 'cite' | null) {
  return renderToStaticMarkup(<AnnotationToolbar tool={tool} liveAvailable={liveAvailable} canUndo={false} canRedo
    readOnly={false} pendingNote="" onTool={noop} onUndo={noop} onRedo={noop} onCopy={noop} onPendingNote={noop} />);
}

function button(markup: string, tool: string): string {
  const match = new RegExp(`<button[^>]*data-tool="${tool}"[^>]*>`, 'u').exec(markup);
  if (match === null) throw new Error(`no ${tool} button`);
  return match[0];
}

describe('annotation views', () => {
  test('Pick element and Cite text are separate toolbar controls', () => {
    const markup = toolbar(true, 'pick');
    expect(markup).toContain('>Pick element</button>');
    expect(markup).toContain('>Cite text</button>');
    expect(button(markup, 'pick')).toContain('aria-pressed="true"');
    expect(button(markup, 'cite')).toContain('aria-pressed="false"');
    for (const tool of ['ink', 'box', 'arrow', 'label', 'eraser']) expect(button(markup, tool)).toContain('aria-pressed="false"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Undo<\/button>/u);
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Redo<\/button>/u);
  });

  test('static captures disable Pick and Cite with a reason', () => {
    const markup = toolbar(false, null);
    expect(button(markup, 'pick')).toContain('disabled=""');
    expect(button(markup, 'pick')).toContain('needs a live preview');
    expect(button(markup, 'cite')).toContain('disabled=""');
    expect(button(markup, 'box')).not.toContain('disabled');
  });

  test('panel lists stable letters, Revisit state and projected overlay marks', async () => {
    const store = new MemoryAnnotationStore();
    const agent = new FakeAgentChannel();
    const controller = new AnnotationController(await loadAnnotations(store, V1), {
      ids: new SequentialIds(), clipboard: new FakeClipboard(), store, agent,
    });
    controller.setFrame(frame());
    controller.selectTool('pick');
    agent.emit(pickEvent);
    controller.selectTool('box');
    controller.draw('box', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    controller.selectTool('box');
    controller.draw('box', [{ x: 100, y: 400 }, { x: 140, y: 420 }], 'Tighten');
    const [, b, c] = controller.snapshot.editor.document.annotations;
    controller.remove(b!.id);
    controller.toggleRevisit(c!.id);

    const markup = renderToStaticMarkup(<AnnotationsPanel controller={controller}
      overlayFrame={{ viewport: { w: 1280, h: 800, dpr: 2 }, scroll: { x: 0, y: 300 }, zoom: 0.5 }} />);
    expect([...markup.matchAll(/<li data-letter="([A-Z]+)"/gu)].map((m) => m[1])).toEqual(['A', 'C']);
    expect(markup).toMatch(/<li data-letter="C"[\s\S]*?aria-pressed="true"[^>]*>Revisit<\/button>/u);
    expect(markup).toContain('Tighten');
    // C is a box at (100,400) source px; overlay = (source - scroll) * zoom.
    expect(markup).toMatch(/<g data-letter="C" data-status="exact"><rect x="50" y="50" width="20" height="10"/u);
    expect(markup).not.toContain('data-letter="B"');
  });
});
