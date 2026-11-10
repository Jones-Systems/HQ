import { Button } from '@hq/ui';
import type { CSSProperties } from 'react';
import type { Tool } from '../editor.ts';

export interface ToolbarProps {
  readonly tool: Tool | null;
  /** False for static captures; Pick and Cite need the live preview agent. */
  readonly liveAvailable: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readOnly: boolean;
  readonly pendingNote: string;
  readonly onTool: (tool: Tool | null) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onCopy: () => void;
  readonly onPendingNote: (note: string) => void;
}

interface ToolSpec {
  readonly tool: Tool;
  readonly label: string;
  readonly shortcut: string;
  readonly hint: string;
}

/** Pick and Cite are deliberately separate controls with separate shortcuts. */
export const TOOL_SPECS: readonly ToolSpec[] = [
  { tool: 'pick', label: 'Pick element', shortcut: 'P', hint: 'Click an element in the preview' },
  { tool: 'cite', label: 'Cite text', shortcut: 'C', hint: 'Select text in the preview' },
  { tool: 'ink', label: 'Ink', shortcut: 'I', hint: 'Draw freehand' },
  { tool: 'box', label: 'Box', shortcut: 'B', hint: 'Drag a rectangle' },
  { tool: 'arrow', label: 'Arrow', shortcut: 'A', hint: 'Drag from tail to head' },
  { tool: 'label', label: 'Label', shortcut: 'L', hint: 'Click to place the note text' },
  { tool: 'eraser', label: 'Eraser', shortcut: 'E', hint: 'Click a drawn mark to erase it' },
];

const bar: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 8,
  borderBottom: '1px solid var(--line)', background: 'var(--surface)', fontSize: 12,
};
const separator: CSSProperties = { width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 4px' };

export function AnnotationToolbar(props: ToolbarProps) {
  const { tool, liveAvailable, readOnly } = props;
  return <div role="toolbar" aria-label="Annotation tools" style={bar}>
    {TOOL_SPECS.map((spec) => {
      const needsLive = spec.tool === 'pick' || spec.tool === 'cite';
      const disabled = readOnly || (needsLive && !liveAvailable);
      const active = tool === spec.tool;
      return <Button size="sm" key={spec.tool} type="button" data-tool={spec.tool} aria-pressed={active}
        aria-keyshortcuts={spec.shortcut} disabled={disabled} variant={active ? 'primary' : 'secondary'}
        title={needsLive && !liveAvailable ? `${spec.label} needs a live preview` : `${spec.hint} (${spec.shortcut})`}
        onClick={() => props.onTool(active ? null : spec.tool)}>{spec.label}</Button>;
    })}
    <span style={separator} aria-hidden="true" />
    <Button size="sm" type="button" disabled={readOnly || !props.canUndo} aria-keyshortcuts="Control+Z Meta+Z" onClick={props.onUndo}>Undo</Button>
    <Button size="sm" type="button" disabled={readOnly || !props.canRedo} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" onClick={props.onRedo}>Redo</Button>
    <span style={separator} aria-hidden="true" />
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
      Note for next mark
      <input type="text" value={props.pendingNote} disabled={readOnly} maxLength={4000}
        onChange={(event) => props.onPendingNote(event.target.value)}
        style={{ minWidth: 160, color: 'var(--hq-text)', background: 'var(--hq-surface)', border: '1px solid var(--hq-border-control)', borderRadius: 7, padding: '6px 10px', font: 'inherit' }} />
    </label>
    <Button size="sm" type="button" onClick={props.onCopy}>Copy</Button>
  </div>;
}

/** Maps a key press to a tool; returns undefined for unrelated keys. */
export function toolForKey(key: string): Tool | undefined {
  return TOOL_SPECS.find((spec) => spec.shortcut.toLowerCase() === key.toLowerCase())?.tool;
}
