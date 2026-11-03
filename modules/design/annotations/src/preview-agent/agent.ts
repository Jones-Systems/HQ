/**
 * Preview agent: a pure DOM script for injection into isolated world 1001.
 * It has no Node, IPC or application access of its own; root passes
 * a `post` function and drives `setMode`/`resolve` through its typed bridge.
 *
 * Pick mode emits only `element-picked`; Cite mode emits only `text-cited`.
 * All geometry is reported in document CSS pixels with the live frame.
 */
import type {
  AgentEvent,
  ExactTarget,
  ExactResolveRequest,
  ExactResolveResult,
  ExactResolution,
  AgentFrame,
  AgentMode,
  AgentResolution,
  Rect,
  ResolveRequest,
  ResolveResult,
} from './types.ts';
import { elementPath, textHash } from './dom-path.ts';
import { locateQuote, quoteContext } from './text-quote.ts';

export interface AgentHost {
  post(event: AgentEvent): void;
}

export interface PreviewAgent {
  readonly mode: AgentMode;
  readonly generation: number;
  setMode(mode: AgentMode, generation?: number): void;
  mutationCounter(): number;
  setHighlightHidden(hidden: boolean): void;
  resolveExact(requests: readonly ExactResolveRequest[]): ExactResolution;
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
  if (win.top !== win.self) throw new Error('Preview agent requires the main frame');
  const doc = win.document;
  // Capture isolated-realm intrinsics, never target-owned method overrides.
  const realm = win as Window & typeof globalThis;
  const elementRect = realm.Element.prototype.getBoundingClientRect;
  const clientRects = realm.Range.prototype.getClientRects;
  let generation = 0;
  let disposed = false;
  let highlightHidden = false;
  let highlightDisplay = 'none';
  let mutations = 0;
  const identities = new WeakMap<Node, number>();
  let nextIdentity = 1;
  const nodeId = (node: Node): number => {
    let id = identities.get(node);
    if (id === undefined) { id = nextIdentity++; identities.set(node, id); }
    return id;
  };
  const settleMs = options.citeSettleMs ?? 500;
  let mode: AgentMode = 'off';
  let highlight: HTMLElement | null = null;
  let lastCite = '';
  let citeTimer: number | null = null;

  const countMutations = (records: readonly MutationRecord[]): void => {
    for (const record of records) {
      if (record.target === highlight) continue;
      const changed = [...record.addedNodes, ...record.removedNodes];
      if (record.type === 'childList' && changed.length > 0 && changed.every((node) => node === highlight)) continue;
      mutations += 1;
    }
  };
  const observer = new realm.MutationObserver(countMutations);
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const mutationCounter = (): number => {
    countMutations(observer.takeRecords());
    return mutations;
  };

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
    Array.from(clientRects.call(range))
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
    highlightDisplay = 'none';
    if (highlight !== null) highlight.style.display = 'none';
  };

  const pickTarget = (event: Event): Element | null => {
    const target = event.target;
    if (!isElement(target) || target.hasAttribute(HIGHLIGHT_ATTR)) return null;
    return target;
  };

  const onPointerMove = (event: Event): void => {
    if (disposed || mode !== 'pick' || !event.isTrusted) return;
    const target = pickTarget(event);
    if (target === null) return hideHighlight();
    const rect = elementRect.call(target);
    highlightDisplay = 'block';
    Object.assign(ensureHighlight().style, {
      display: highlightHidden ? 'none' : highlightDisplay, left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
  };

  const swallow = (event: Event): void => {
    if (disposed || mode !== 'pick' || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onPickClick = (event: Event): void => {
    if (disposed || mode !== 'pick' || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = pickTarget(event);
    if (target === null) return;
    host.post({
      type: 'element-picked',
      generation,
      snapshot: elementSnapshot(target),
      target: {
        kind: 'element',
        path: elementPath(target, isUniqueId),
        rect: toSource(elementRect.call(target)),
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
    host.post({ type: 'text-cited', generation, snapshot: textSnapshot(index, start, end, trimmed), target: { kind: 'text', quote, prefix, suffix, rects: rangeRects(trimmed) }, frame: frame() });
  };

  const onCiteEnd = (event: Event): void => {
    if (disposed || mode !== 'cite' || !event.isTrusted) return;
    cancelCite();
    citeTimer = win.setTimeout(emitCite, settleMs);
  };

  const onPress = (event: Event): void => {
    if (disposed || !event.isTrusted) return;
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
      return { found: true, rects: [toSource(elementRect.call(element))], textHash: textHash(element.textContent ?? '') };
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

  const elementSnapshot = (element: Element): ExactTarget => ({
    identity: `element:${nodeId(element)}`,
    text: element.textContent ?? '',
    rects: [toSource(elementRect.call(element))],
  });

  const textSnapshot = (index: TextIndex, start: number, end: number, range: Range): ExactTarget => ({
    identity: `text:${index.nodes.flatMap((node, i) => {
      const from = Math.max(0, start - index.starts[i]!);
      const to = Math.min(node.data.length, end - index.starts[i]!);
      return from < to ? [`${nodeId(node)}:${from}:${to}`] : [];
    }).join('|')}`,
    text: index.text.slice(start, end),
    rects: rangeRects(range),
  });

  const exactOne = (index: TextIndex, request: ExactResolveRequest): ExactResolveResult => {
    let snapshot: ExactTarget;
    if (request.kind === 'element') {
      let matches: NodeListOf<Element>;
      try { matches = doc.querySelectorAll(request.path); } catch { return { found: false }; }
      if (matches.length !== 1) return { found: false };
      const element = matches[0]!;
      if (request.textHash !== undefined && textHash(element.textContent ?? '') !== request.textHash) return { found: false };
      snapshot = elementSnapshot(element);
    } else {
      if (request.quote.length === 0) return { found: false };
      const matches: ExactTarget[] = [];
      for (let start = index.text.indexOf(request.quote); start !== -1; start = index.text.indexOf(request.quote, start + 1)) {
        const end = start + request.quote.length;
        if (!index.text.slice(0, start).endsWith(request.prefix) || !index.text.slice(end).startsWith(request.suffix)) continue;
        const from = positionAt(index, start);
        const to = positionAt(index, end);
        if (from === null || to === null) continue;
        const range = doc.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        const candidate = textSnapshot(index, start, end, range);
        if (request.identity === undefined || candidate.identity === request.identity) matches.push(candidate);
        if (matches.length > 1) return { found: false };
      }
      if (matches.length !== 1) return { found: false };
      snapshot = matches[0]!;
    }
    if (request.identity !== undefined && request.identity !== snapshot.identity) return { found: false };
    return { found: true, ...snapshot };
  };

  const listeners: ReadonlyArray<readonly [string, (event: Event) => void]> = [
    ['pointermove', onPointerMove],
    ['pointerdown', onPress],
    ['mousedown', onPress],
    ['mouseup', (event) => (mode === 'pick' ? swallow(event) : onCiteEnd(event))],
    ['click', onPickClick],
    ['dblclick', swallow],
    ['auxclick', swallow],
    ['keyup', onCiteEnd],
  ];
  for (const [type, listener] of listeners) win.addEventListener(type, listener, true);

  return {
    get mode() {
      return mode;
    },
    get generation() { return generation; },
    setMode(next: AgentMode, nextGeneration = generation + 1): void {
      if (disposed) throw new Error('Preview agent disposed');
      if (!Number.isSafeInteger(nextGeneration) || nextGeneration < generation) throw new RangeError('Invalid mode generation');
      cancelCite();
      generation = nextGeneration;
      mode = next;
      lastCite = '';
      hideHighlight();
    },
    frame,
    mutationCounter,
    setHighlightHidden(hidden: boolean): void {
      highlightHidden = hidden;
      if (highlight !== null) highlight.style.display = hidden ? 'none' : highlightDisplay;
    },
    resolveExact(requests: readonly ExactResolveRequest[]): ExactResolution {
      if (disposed) throw new Error('Preview agent disposed');
      if (requests.length > 50) throw new RangeError('At most 50 resolution requests');
      const index = indexText();
      const results = requests.map((request) => exactOne(index, request));
      return { generation, frame: frame(), mutationCounter: mutationCounter(), results };
    },
    resolve(requests: readonly ResolveRequest[]): AgentResolution {
      const index = indexText();
      return { frame: frame(), results: requests.map((request) => resolveOne(index, request)) };
    },
    dispose(): void {
      disposed = true;
      observer.disconnect();
      cancelCite();
      mode = 'off';
      for (const [type, listener] of listeners) win.removeEventListener(type, listener, true);
      highlight?.remove();
      highlight = null;
    },
  };
}
