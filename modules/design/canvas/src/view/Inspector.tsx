import { useEffect, useState, type Dispatch } from 'react';
import type { NodeId, Rect } from '../contract.ts';
import type { Alignment, ZOrder } from '../arrangement.ts';
import type { ArrangementEdit, CanvasAction } from '../controller.ts';
import type { InspectorModel } from '../inspector.ts';

interface InspectorProps {
  readonly model: InspectorModel;
  readonly selection: readonly NodeId[];
  readonly gridSize: number;
  readonly gridSnap: boolean;
  readonly readOnly: boolean;
  /** Hidden placements, offered for re-showing when nothing is selected. */
  readonly hiddenIds: readonly string[];
  readonly dispatch: Dispatch<CanvasAction>;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Numeric field that commits on Enter or blur and reverts on Escape or invalid input. */
function NumberField({ label, value, disabled, min, onCommit }: { label: string; value: number; disabled: boolean; min?: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === '' || !Number.isFinite(parsed) || (min !== undefined && parsed < min)) { setText(String(round(value))); return; }
    if (parsed !== round(value)) onCommit(parsed);
  };
  return <label className="hq-inspector-field">
    <span>{label}</span>
    <input inputMode="decimal" value={text} disabled={disabled} aria-label={label}
      onChange={(event) => setText(event.target.value)} onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setText(String(round(value)));
      }} />
  </label>;
}

function FrameFields({ id, frame, disabled, edit }: { id: string; frame: Rect; disabled: boolean; edit: (change: ArrangementEdit) => void }) {
  const set = (patch: Partial<Rect>) => edit({ kind: 'set-frame', id, frame: patch });
  return <div className="hq-inspector-grid">
    <NumberField label="X" value={frame.x} disabled={disabled} onCommit={(x) => set({ x })} />
    <NumberField label="Y" value={frame.y} disabled={disabled} onCommit={(y) => set({ y })} />
    <NumberField label="W" value={frame.width} disabled={disabled} min={1} onCommit={(width) => set({ width })} />
    <NumberField label="H" value={frame.height} disabled={disabled} min={1} onCommit={(height) => set({ height })} />
  </div>;
}

const ALIGNMENTS: readonly [Alignment, string][] = [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const ORDERS: readonly [ZOrder, string][] = [['front', 'To front'], ['forward', 'Forward'], ['backward', 'Backward'], ['back', 'To back']];

function Row({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd>{value}</dd></>;
}

/** Inspector of useful canvas properties. Source identity is read-only; only arrangement fields edit. */
export function Inspector({ model, selection, gridSize, gridSnap, readOnly, hiddenIds, dispatch }: InspectorProps) {
  const edit = (change: ArrangementEdit) => dispatch({ type: 'edit', edit: change });
  const ids = [...selection];

  if (model.kind === 'empty') {
    return <section className="hq-inspector" aria-label="Inspector">
      <h2>Canvas</h2>
      <dl><Row label="Items" value={String(model.itemCount)} /><Row label="Artboards" value={String(model.artboardCount)} /></dl>
      <fieldset disabled={readOnly}>
        <legend>Grid</legend>
        <label className="hq-inspector-check"><input type="checkbox" checked={gridSnap} onChange={(event) => edit({ kind: 'grid', grid: { snap: event.target.checked } })} /> Snap to grid</label>
        <NumberField label="Grid size" value={gridSize} disabled={readOnly} min={1} onCommit={(size) => edit({ kind: 'grid', grid: { size: Math.round(size) } })} />
      </fieldset>
      {hiddenIds.length > 0 && <button type="button" disabled={readOnly}
        onClick={() => edit({ kind: 'hide', ids: hiddenIds, hidden: false })}>Show {hiddenIds.length} hidden item{hiddenIds.length === 1 ? '' : 's'}</button>}
    </section>;
  }

  const arrange = <fieldset disabled={readOnly} className="hq-inspector-actions">
    <legend>Arrange</legend>
    {model.kind === 'multiple' && <div role="group" aria-label="Align">
      {ALIGNMENTS.map(([alignment, text]) => <button key={alignment} type="button" onClick={() => edit({ kind: 'align', ids, alignment })}>Align {text.toLowerCase()}</button>)}
    </div>}
    {model.kind === 'multiple' && model.canDistribute && <div role="group" aria-label="Distribute">
      <button type="button" onClick={() => edit({ kind: 'distribute', ids, axis: 'horizontal' })}>Distribute horizontally</button>
      <button type="button" onClick={() => edit({ kind: 'distribute', ids, axis: 'vertical' })}>Distribute vertically</button>
    </div>}
    <div role="group" aria-label="Layer order">
      {ORDERS.map(([order, text]) => <button key={order} type="button" onClick={() => edit({ kind: 'reorder', ids, order })}>{text}</button>)}
    </div>
  </fieldset>;

  if (model.kind === 'multiple') {
    return <section className="hq-inspector" aria-label="Inspector">
      <h2>{model.count} selected</h2>
      <dl>
        <Row label="Bounds" value={`${round(model.bounds.x)}, ${round(model.bounds.y)} · ${round(model.bounds.width)} × ${round(model.bounds.height)}`} />
      </dl>
      <fieldset disabled={readOnly}>
        <label className="hq-inspector-check"><input type="checkbox" checked={model.locked === true}
          ref={(input) => { if (input) input.indeterminate = model.locked === null; }}
          onChange={(event) => edit({ kind: 'lock', ids, locked: event.target.checked })} /> Locked</label>
      </fieldset>
      {arrange}
    </section>;
  }

  if (model.kind === 'artboard') {
    return <section className="hq-inspector" aria-label="Inspector">
      <h2>Artboard</h2>
      <label className="hq-inspector-field is-wide"><span>Name</span>
        <input key={`${model.id}:${model.name}`} defaultValue={model.name} disabled={readOnly} aria-label="Artboard name"
          onBlur={(event) => edit({ kind: 'rename-artboard', id: model.id, name: event.target.value })}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </label>
      <FrameFields id={model.id} frame={model.frame} disabled={readOnly || model.locked} edit={edit} />
      <dl><Row label="Contains" value={`${model.childCount} item${model.childCount === 1 ? '' : 's'}`} /></dl>
      <fieldset disabled={readOnly}>
        <label className="hq-inspector-check"><input type="checkbox" checked={model.locked} onChange={(event) => edit({ kind: 'lock', ids, locked: event.target.checked })} /> Locked</label>
      </fieldset>
      {arrange}
    </section>;
  }

  return <section className="hq-inspector" aria-label="Inspector">
    <h2>{model.title}</h2>
    {model.sourceMessage && <p className="hq-inspector-warning" role="status">{model.sourceMessage}. The placement is kept.</p>}
    <dl>
      <Row label="Kind" value={model.itemKind ?? 'Unknown'} />
      <Row label="Provider" value={model.providerLabel ?? model.ref.providerId} />
      <Row label="Entity" value={model.ref.entityId} />
      <Row label="Pinned revision" value={model.ref.revision} />
      <Row label="Provenance" value={model.provenance ?? 'Unknown'} />
      {model.artboardName && <Row label="Artboard" value={model.artboardName} />}
      {model.intrinsicSize && <Row label="Intrinsic size" value={`${model.intrinsicSize.width} × ${model.intrinsicSize.height}`} />}
      {model.scale !== null && <Row label="Scale" value={`${round(model.scale * 100)}%`} />}
      {model.details.map((detail) => <Row key={detail.label} label={detail.label} value={detail.value} />)}
    </dl>
    <FrameFields id={model.id} frame={model.frame} disabled={readOnly || model.locked} edit={edit} />
    <fieldset disabled={readOnly}>
      <label className="hq-inspector-check"><input type="checkbox" checked={model.locked} onChange={(event) => edit({ kind: 'lock', ids, locked: event.target.checked })} /> Locked</label>
      <label className="hq-inspector-check"><input type="checkbox" checked={model.hidden} onChange={(event) => edit({ kind: 'hide', ids, hidden: event.target.checked })} /> Hidden</label>
      {model.intrinsicSize && <button type="button" disabled={model.locked}
        onClick={() => edit({ kind: 'set-frame', id: model.id, frame: { width: model.intrinsicSize!.width, height: model.intrinsicSize!.height } })}>Reset to intrinsic size</button>}
    </fieldset>
    {arrange}
  </section>;
}
