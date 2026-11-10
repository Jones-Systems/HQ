import { useEffect, useState } from 'react';
import type { DesignSectionProps } from '../../../contract.ts';
import { captureFixture, pngDataUrl } from '../../png.ts';

type CanvasState = {
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly selection: readonly string[];
};
const INITIAL: CanvasState = { viewport: { x: 0, y: 0, zoom: 1 }, selection: [] };
const CAPTURE = pngDataUrl(captureFixture());
// Producer preview with its own fixed colours; no scripts (sandbox="").
const PREVIEW = '<!doctype html><body style="margin:0;background:#fffbe6;color:#1a1a1a;font:14px sans-serif">'
  + '<div style="padding:12px">Producer preview</div><div style="height:40px;background:#7a2cff"></div></body>';
const ARTBOARDS = ['v-hero-1', 'v-hero-2'] as const;

function read(value: unknown): CanvasState {
  return typeof value === 'object' && value !== null && 'viewport' in value && 'selection' in value ? value as CanvasState : INITIAL;
}

/** LABELLED FAKE canvas: viewport and selection live only in the chrome's section state handle. */
export function FakeCanvas({ state, surface, onCommand }: DesignSectionProps) {
  const [canvas, setCanvas] = useState(() => read(state.read()));
  const update = (next: CanvasState) => { setCanvas(next); state.write(next); };
  const pan = (dx: number, dy: number) => update({ ...canvas, viewport: { ...canvas.viewport, x: canvas.viewport.x + dx, y: canvas.viewport.y + dy } });
  const zoom = (factor: number) => update({ ...canvas, viewport: { ...canvas.viewport, zoom: Math.round(canvas.viewport.zoom * factor * 100) / 100 } });
  useEffect(() => onCommand((id) => { if (id === 'fit') update({ ...canvas, viewport: INITIAL.viewport }); }));

  return <div className="fake-section" data-fake-section="canvas">
    <p className="fake-label">FAKE canvas fixture. Not the real T3 canvas.</p>
    <div className="fake-toolbar" role="toolbar" aria-label="Canvas view">
      <button type="button" onClick={() => pan(-40, 0)}>Pan left</button>
      <button type="button" onClick={() => pan(40, 0)}>Pan right</button>
      <button type="button" onClick={() => zoom(1.25)}>Zoom in</button>
      <button type="button" onClick={() => zoom(0.8)}>Zoom out</button>
      <output data-testid="viewport">x {canvas.viewport.x}, y {canvas.viewport.y}, zoom {canvas.viewport.zoom}</output>
      <output data-testid="selection">Selected: {canvas.selection.join(', ') || 'none'}</output>
    </div>
    <div className="fake-board">
      {ARTBOARDS.map((id) => <button type="button" key={id} className="fake-artboard" aria-pressed={canvas.selection.includes(id)}
        onClick={(event) => {
          const selection = event.shiftKey
            ? (canvas.selection.includes(id) ? canvas.selection.filter((item) => item !== id) : [...canvas.selection, id])
            : [id];
          update({ ...canvas, selection });
        }}>
        <span>{id}</span>
        <img {...surface('capture')} data-testid={`capture-${id}`} src={CAPTURE} width={192} height={120} alt={`Capture of ${id}`} />
      </button>)}
      <iframe {...surface('preview')} data-testid="preview" title="Producer preview" sandbox="" srcDoc={PREVIEW} width={240} height={120} />
    </div>
  </div>;
}
