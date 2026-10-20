/**
 * Preview agent: a pure DOM script that root bundles into the preview
 * preload. It has no Node, IPC or application access of its own; root passes
 * a `post` function and drives `setMode`/`resolve` through its typed bridge.
 *
 * Pick mode emits only `element-picked`; Cite mode emits only `text-cited`.
 * All geometry is reported in document CSS pixels with the live frame.
 */
import type {
  AgentEvent,
  AgentFrame,
  AgentMode,
  AgentResolution,
  Rect,
  ResolveRequest,
  ResolveResult,
} from '../contract.ts';
import { elementPath, textHash } from './dom-path.ts';
import { locateQuote, quoteContext } from './text-quote.ts';

export interface AgentHost {
  post(event: AgentEvent): void;
}

export interface PreviewAgent {
  readonly mode: AgentMode;
  setMode(mode: AgentMode): void;
  frame(): AgentFrame;
  resolve(requests: readonly ResolveRequest[]): AgentResolution;
  dispose(): void;
}

export interface AgentOptions {
  /**
   * Delay after the last mouseup/keyup before a citation is reported, so a
   * double or triple click reports only its final selection. Defaults to 500ms,
   * a common double-click interval.
   */
  readonly citeSettleMs?: number;
}

const MAX_RECTS = 200;
const MAX_QUOTE = 2000;
const HIGHLIGHT_ATTR = 'data-hq-annotation-agent';
/** Text in these elements is not rendered and never enters citations. */
const UNRENDERED = 'script, style, noscript, template';

interface TextIndex {
  readonly text: string;
  readonly nodes: readonly Text[];
  readonly starts: readonly number[];
}

export function installPreviewAgent(win: Window, host: AgentHost, options: AgentOptions = {}): PreviewAgent {
  const doc = win.document;
  const settleMs = options.citeSettleMs ?? 500;
  let mode: AgentMode = 'off';
  let highlight: HTMLElement | null = null;
  let lastCite = '';
  let citeTimer: number | null = null;

  const frame = (): AgentFrame => ({
    viewport: { w: win.innerWidth, h: win.innerHeight, dpr: win.devicePixelRatio || 1 },
    scroll: { x: win.scrollX, y: win.scrollY },
  });

  const toSource = (rect: DOMRect): Rect => ({
    x: rect.left + win.scrollX,
    y: rect.top + win.scrollY,
    width: rect.width,
    height: rect.height,
  });

  const isUniqueId = (id: string): boolean => doc.querySelectorAll(`#${id}`).length === 1;

  const isElement = (node: unknown): node is Element =>
    typeof node === 'object' && node !== null && (node as Node).nodeType === 1;

  const indexText = (): TextIndex => {
    const nodes: Text[] = [];
    const starts: number[] = [];
    let text = '';
    const root = doc.body ?? doc.documentElement;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.parentElement?.closest?.(UNRENDERED)) continue;
      const value = (node as Text).data;
      nodes.push(node as Text);
      starts.push(text.length);
      text += value;
    }
    return { text, nodes, starts };
  };

  /** Maps a DOM boundary point to an offset in the indexed text. */
  const offsetIn = (index: TextIndex, container: Node, offset: number): number => {
    const direct = index.nodes.indexOf(container as Text);
    if (direct !== -1) return index.starts[direct]! + Math.min(offset, index.nodes[direct]!.data.length);
    // Element (or unindexed) container: the first indexed text at or after the point.
    const point = doc.createRange();
    point.setStart(container, offset);
    for (let i = 0; i < index.nodes.length; i += 1) {
      if (point.comparePoint(index.nodes[i]!, 0) >= 0) return index.starts[i]!;
    }
    return index.text.length;
  };

  const positionAt = (index: TextIndex, offset: number): { node: Text; offset: number } | null => {
    for (let i = index.nodes.length - 1; i >= 0; i -= 1) {
      if (index.starts[i]! <= offset) return { node: index.nodes[i]!, offset: offset - index.starts[i]! };
    }
    return null;
  };

  const rangeRects = (range: Range): Rect[] =>
    Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .slice(0, MAX_RECTS)
      .map(toSource);

  const ensureHighlight = (): HTMLElement => {
    if (highlight !== null) return highlight;
    const box = doc.createElement('div');
    box.setAttribute(HIGHLIGHT_ATTR, 'highlight');
    box.setAttribute('aria-hidden', 'true');
    Object.assign(box.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', boxSizing: 'border-box',
      border: '2px solid #2563eb', background: 'rgba(37, 99, 235, 0.12)', display: 'none',
    });
    doc.documentElement.appendChild(box);
    highlight = box;
    return box;
  };

  const hideHighlight = (): void => {
    if (highlight !== null) highlight.style.display = 'none';
  };

  const pickTarget = (event: Event): Element | null => {
    const target = event.target;
    if (!isElement(target) || target.hasAttribute(HIGHLIGHT_ATTR)) return null;
    return target;
  };

  const onPointerMove = (event: Event): void => {
    if (mode !== 'pick') return;
    const target = pickTarget(event);
    if (target === null) return hideHighlight();
    const rect = target.getBoundingClientRect();
    Object.assign(ensureHighlight().style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
  };

  const swallow = (event: Event): void => {
    if (mode !== 'pick') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onPickClick = (event: Event): void => {
    if (mode !== 'pick') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = pickTarget(event);
    if (target === null) return;
    host.post({
      type: 'element-picked',
      target: {
        kind: 'element',
        path: elementPath(target, isUniqueId),
        rect: toSource(target.getBoundingClientRect()),
        textHash: textHash(target.textContent ?? ''),
      },
      frame: frame(),
    });
  };

  const cancelCite = (): void => {
    if (citeTimer !== null) win.clearTimeout(citeTimer);
    citeTimer = null;
  };

  const emitCite = (): void => {
    citeTimer = null;
    if (mode !== 'cite') return;
    const selection = win.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const index = indexText();
    const rawStart = offsetIn(index, range.startContainer, range.startOffset);
    const rawEnd = offsetIn(index, range.endContainer, range.endOffset);
    const raw = index.text.slice(rawStart, rawEnd);
    // Trim boundary whitespace so the quote matches what the user sees.
    const start = rawStart + (raw.length - raw.trimStart().length);
    const quote = raw.trim().slice(0, MAX_QUOTE);
    if (quote.length === 0) return;
    const end = start + quote.length;
    const key = `${start}:${end}`;
    if (key === lastCite) return;
    lastCite = key;
    const startPos = positionAt(index, start);
    const endPos = positionAt(index, end);
    if (startPos === null || endPos === null) return;
    const trimmed = doc.createRange();
    trimmed.setStart(startPos.node, startPos.offset);
    trimmed.setEnd(endPos.node, endPos.offset);
    const { prefix, suffix } = quoteContext(index.text, start, end);
    host.post({ type: 'text-cited', target: { kind: 'text', quote, prefix, suffix, rects: rangeRects(trimmed) }, frame: frame() });
  };

  const onCiteEnd = (): void => {
    if (mode !== 'cite') return;
    cancelCite();
    citeTimer = win.setTimeout(emitCite, settleMs);
  };

  const onPress = (event: Event): void => {
    if (mode === 'pick') swallow(event);
    else if (mode === 'cite') cancelCite();
  };

  const relocateByHash = (path: string, hash: string): Element | null => {
    const tag = /([a-z][a-z0-9-]*)(?::nth-of-type\(\d+\))?$/iu.exec(path)?.[1];
    if (tag === undefined) return null;
    const matches = Array.from(doc.querySelectorAll(tag)).filter((el) => textHash(el.textContent ?? '') === hash);
    return matches.length === 1 ? matches[0]! : null;
  };

  const resolveOne = (index: TextIndex, request: ResolveRequest): ResolveResult => {
    if (request.kind === 'element') {
      let element: Element | null = null;
      try {
        element = doc.querySelector(request.path);
      } catch {
        element = null;
      }
      const hash = element === null ? null : textHash(element.textContent ?? '');
      if (request.textHash !== undefined && hash !== request.textHash) {
        // The structural path missed or now points at different content:
        // relocate only when exactly one same-tag element carries the hash.
        const relocated = relocateByHash(request.path, request.textHash);
        if (relocated !== null) element = relocated;
      }
      if (element === null) return { found: false };
      return { found: true, rects: [toSource(element.getBoundingClientRect())], textHash: textHash(element.textContent ?? '') };
    }
    const match = locateQuote(index.text, request.quote, request.prefix, request.suffix);
    if (match === null) return { found: false };
    const startPos = positionAt(index, match.start);
    const endPos = positionAt(index, match.end);
    if (startPos === null || endPos === null) return { found: false };
    const range = doc.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    return { found: true, rects: rangeRects(range) };
  };

  const listeners: ReadonlyArray<readonly [string, (event: Event) => void]> = [
    ['pointermove', onPointerMove],
    ['pointerdown', onPress],
    ['mousedown', onPress],
    ['mouseup', (event) => (mode === 'pick' ? swallow(event) : onCiteEnd())],
    ['click', onPickClick],
    ['dblclick', swallow],
    ['auxclick', swallow],
    ['keyup', () => onCiteEnd()],
  ];
  for (const [type, listener] of listeners) win.addEventListener(type, listener, true);

  return {
    get mode() {
      return mode;
    },
    setMode(next: AgentMode): void {
      cancelCite();
      mode = next;
      lastCite = '';
      hideHighlight();
    },
    frame,
    resolve(requests: readonly ResolveRequest[]): AgentResolution {
      const index = indexText();
      return { frame: frame(), results: requests.map((request) => resolveOne(index, request)) };
    },
    dispose(): void {
      cancelCite();
      mode = 'off';
      for (const [type, listener] of listeners) win.removeEventListener(type, listener, true);
      highlight?.remove();
      highlight = null;
    },
  };
}
