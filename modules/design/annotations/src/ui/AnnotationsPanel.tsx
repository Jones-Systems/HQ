import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { AnnotationId, AnnotationRef } from '../contract.ts';
import type { AnnotationController } from '../controller.ts';
import type { OverlayFrame } from '../geometry.ts';
import type { AnchorStatus } from '../resolution.ts';
import { AnnotationOverlay } from './AnnotationOverlay.tsx';
import { AnnotationToolbar, toolForKey } from './AnnotationToolbar.tsx';

const STATUS_TEXT: Readonly<Record<AnchorStatus, string>> = {
  exact: 'Anchored',
  reflowed: 'Re-found at a new position',
  changed: 'Element text changed',
  'frame-mismatch': 'Different viewport width; shown at captured position',
  missing: 'Not found in this render',
  'other-version': 'Bound to another version',
};

function summary(annotation: AnnotationRef): string {
  const { target } = annotation.anchor;
  if (target.kind === 'text') return `“${target.quote.replace(/\s+/gu, ' ').trim()}”`;
  if (target.kind === 'element') return target.path.split(' > ').slice(-2).join(' > ');
  return annotation.kind[0]!.toUpperCase() + annotation.kind.slice(1);
}

export interface AnnotationListProps {
  readonly annotations: readonly AnnotationRef[];
  readonly revisit: ReadonlySet<string>;
  readonly statuses: ReadonlyMap<string, AnchorStatus>;
  readonly selectedId: string | null;
  readonly readOnly: boolean;
  readonly revisitOnly: boolean;
  readonly onRevisitOnly: (value: boolean) => void;
  readonly onSelect: (id: AnnotationId) => void;
  readonly onNote: (id: AnnotationId, note: string) => void;
  readonly onToggleRevisit: (id: AnnotationId) => void;
  readonly onDelete: (id: AnnotationId) => void;
}

const row: CSSProperties = { display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 8, padding: 10, borderBottom: '1px solid var(--line)' };
const small: CSSProperties = { border: '1px solid var(--line)', borderRadius: 5, padding: '3px 8px', background: 'transparent', fontSize: 11 };

/** Edits locally and commits once on blur, so one note edit is one undo step. */
function NoteField({ letter, note, readOnly, onCommit }: { letter: string; note: string; readOnly: boolean; onCommit: (note: string) => void }) {
  const [draft, setDraft] = useState(note);
  useEffect(() => setDraft(note), [note]);
  return <textarea aria-label={`Note for ${letter}`} value={draft} readOnly={readOnly} rows={2} maxLength={4000}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== note) onCommit(draft); }}
    style={{ width: '100%', marginTop: 6, font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid var(--line)', borderRadius: 5 }} />;
}

export function AnnotationList(props: AnnotationListProps) {
  const visible = props.revisitOnly ? props.annotations.filter((a) => props.revisit.has(a.id)) : props.annotations;
  return <section aria-label="Annotations" style={{ fontSize: 12 }}>
    <label style={{ display: 'flex', gap: 6, padding: 10, color: 'var(--muted)' }}>
      <input type="checkbox" checked={props.revisitOnly} onChange={(event) => props.onRevisitOnly(event.target.checked)} />
      Show Revisit only
    </label>
    {visible.length === 0 ? <p style={{ padding: 10, margin: 0 }}>No annotations yet.</p> : null}
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {visible.map((annotation) => {
        const marked = props.revisit.has(annotation.id);
        const status = props.statuses.get(annotation.id);
        return <li key={annotation.id} data-letter={annotation.letter} aria-current={props.selectedId === annotation.id ? 'true' : undefined}
          style={{ ...row, background: props.selectedId === annotation.id ? 'var(--selected)' : undefined }}>
          <button type="button" onClick={() => props.onSelect(annotation.id)} aria-label={`Select annotation ${annotation.letter}`}
            style={{ ...small, fontWeight: 700, padding: '3px 0' }}>{annotation.letter}</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ overflowWrap: 'anywhere' }}><strong>{annotation.kind}</strong> {summary(annotation)}</div>
            {status !== undefined && status !== 'exact' ? <div style={{ color: 'var(--muted)' }}>{STATUS_TEXT[status]}</div> : null}
            <NoteField letter={annotation.letter} note={annotation.note} readOnly={props.readOnly} onCommit={(note) => props.onNote(annotation.id, note)} />
          </div>
          <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
            <button type="button" style={small} aria-pressed={marked} disabled={props.readOnly} onClick={() => props.onToggleRevisit(annotation.id)}>Revisit</button>
            <button type="button" style={small} disabled={props.readOnly} onClick={() => props.onDelete(annotation.id)}>Delete</button>
          </div>
        </li>;
      })}
    </ol>
  </section>;
}

export interface AnnotationsPanelProps {
  readonly controller: AnnotationController;
  /** Current display frame of the preview/capture this panel overlays. */
  readonly overlayFrame: OverlayFrame;
  /** The preview or capture surface, rendered beneath the overlay. */
  readonly children?: ReactNode;
  readonly title?: string;
}

/** Composition entry for root: toolbar, overlaid surface and list over one controller. */
export function AnnotationsPanel({ controller, overlayFrame, children, title }: AnnotationsPanelProps) {
  const snapshot = useSyncExternalStore((listener) => controller.subscribe(listener), () => controller.snapshot, () => controller.snapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revisitOnly, setRevisitOnly] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const { editor, readOnly, resolved, pendingNote } = snapshot;
  const { document } = editor;
  const revisit = new Set<string>(document.revisit);
  const statuses = new Map<string, AnchorStatus>(resolved.map((r) => [r.annotation.id, r.status]));
  // Annotations without a resolution yet are shown at their stored geometry.
  const shown = document.annotations.map((annotation) => resolved.find((r) => r.annotation === annotation)
    ?? { annotation, status: 'exact' as const, rects: annotation.anchor.target.kind === 'element' ? [annotation.anchor.target.rect]
      : annotation.anchor.target.kind === 'text' ? annotation.anchor.target.rects
        : annotation.anchor.target.kind === 'region' ? [annotation.anchor.target.rect] : [],
    points: annotation.anchor.target.kind === 'ink' ? annotation.anchor.target.points : [] });

  useEffect(() => {
    void controller.refreshResolution();
  }, [controller, document.annotations, snapshot.frame]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) controller.redo();
      else controller.undo();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') return void controller.selectTool(null);
    const tool = toolForKey(event.key);
    if (tool !== undefined) controller.selectTool(editor.tool === tool ? null : tool);
  };

  const copy = () => {
    controller.copy(title === undefined ? undefined : { title }).then(() => setCopied('copied'), () => setCopied('failed'));
  };

  return <div onKeyDown={onKeyDown} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
    <div style={{ gridColumn: '1 / -1' }}>
      <AnnotationToolbar tool={editor.tool} liveAvailable={controller.canPickOrCite} canUndo={editor.past.length > 0} canRedo={editor.future.length > 0}
        readOnly={readOnly} pendingNote={pendingNote} onPendingNote={(note) => controller.setPendingNote(note)} onTool={(tool) => controller.selectTool(tool)}
        onUndo={() => controller.undo()} onRedo={() => controller.redo()} onCopy={copy} />
      {readOnly ? <p role="status" style={{ margin: 8 }}>These annotations use an unsupported or invalid format and are read-only.</p> : null}
      <span role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {copied === 'copied' ? 'Annotations copied' : copied === 'failed' ? 'Copy failed' : ''}
      </span>
    </div>
    <div style={{ position: 'relative', minHeight: 240 }}>
      {children}
      <AnnotationOverlay frame={overlayFrame} tool={editor.tool} resolved={shown} revisit={revisit} selectedId={selectedId} readOnly={readOnly}
        onDraw={(kind, points) => controller.draw(kind, points)}
        onErase={(point, radius) => controller.erase(point, radius)} onSelect={setSelectedId} />
    </div>
    <aside style={{ borderLeft: '1px solid var(--line)', overflow: 'auto', background: 'var(--surface)' }}>
      <AnnotationList annotations={document.annotations} revisit={revisit} statuses={statuses} selectedId={selectedId} readOnly={readOnly}
        revisitOnly={revisitOnly} onRevisitOnly={setRevisitOnly} onSelect={setSelectedId}
        onNote={(id, note) => controller.setNote(id, note)} onToggleRevisit={(id) => controller.toggleRevisit(id)}
        onDelete={(id) => controller.remove(id)} />
    </aside>
  </div>;
}
