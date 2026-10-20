/**
 * FAKE minimal DOM for Node tests of the preview agent's event routing.
 * Layout is synthetic (rects are assigned, not computed); this is never
 * rendered-geometry evidence. Real browser checks live in test/browser/.
 */

export interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function domRect(rect: FakeRect) {
  return { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => rect };
}

export class FakeText {
  readonly nodeType = 3;
  parentNode: FakeElement | null = null;
  data: string;
  /** Synthetic per-character box: each char is `charWidth` wide on one line. */
  box: FakeRect = { left: 0, top: 0, width: 0, height: 16 };
  constructor(data: string) {
    this.data = data;
  }
}

export class FakeElement {
  readonly nodeType = 1;
  readonly tagName: string;
  id = '';
  parentElement: FakeElement | null = null;
  parentNode: FakeElement | null = null;
  readonly childNodes: (FakeElement | FakeText)[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  box: FakeRect = { left: 0, top: 0, width: 0, height: 0 };
  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }
  get textContent(): string {
    return this.childNodes.map((n) => (n instanceof FakeText ? n.data : n.textContent)).join('');
  }
  appendChild<T extends FakeElement | FakeText>(child: T): T {
    child.parentNode = this;
    if (child instanceof FakeElement) child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  remove(): void {
    const parent = this.parentNode;
    if (parent === null) return;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
    this.parentNode = null;
    this.parentElement = null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  getBoundingClientRect() {
    return domRect(this.box);
  }
}

function textNodes(root: FakeElement): FakeText[] {
  const out: FakeText[] = [];
  const walk = (node: FakeElement | FakeText) => {
    if (node instanceof FakeText) out.push(node);
    else node.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

function allElements(root: FakeElement): FakeElement[] {
  const out: FakeElement[] = [root];
  for (const child of root.children) out.push(...allElements(child));
  return out;
}

/** Supports only the selector grammar produced by elementPath. */
function matches(root: FakeElement, selector: string): FakeElement[] {
  const segments = selector.split(' > ');
  let current: FakeElement[] = [];
  segments.forEach((segment, i) => {
    if (segment.startsWith('#')) {
      current = allElements(root).filter((el) => el.id === segment.slice(1));
      return;
    }
    const m = /^([a-z0-9]+)(?::nth-of-type\((\d+)\))?$/u.exec(segment);
    if (m === null) throw new SyntaxError(`Unsupported selector ${segment}`);
    const tag = m[1]!.toUpperCase();
    const nth = m[2] === undefined ? null : Number(m[2]);
    if (i === 0) {
      current = allElements(root).filter((el) => el.tagName === tag);
      return;
    }
    current = current.flatMap((parent) => {
      const same = parent.children.filter((el) => el.tagName === tag);
      return nth === null ? same : same[nth - 1] === undefined ? [] : [same[nth - 1]!];
    });
  });
  return current;
}

export class FakeRange {
  startContainer: FakeElement | FakeText | null = null;
  startOffset = 0;
  endContainer: FakeElement | FakeText | null = null;
  endOffset = 0;
  readonly #doc: FakeDocument;
  constructor(doc: FakeDocument) {
    this.#doc = doc;
  }
  setStart(node: FakeElement | FakeText, offset: number): void {
    this.startContainer = node;
    this.startOffset = offset;
  }
  setEnd(node: FakeElement | FakeText, offset: number): void {
    this.endContainer = node;
    this.endOffset = offset;
  }
  #global(node: FakeElement | FakeText, offset: number): number {
    const nodes = textNodes(this.#doc.body);
    let at = 0;
    for (const text of nodes) {
      if (text === node) return at + offset;
      at += text.data.length;
    }
    if (node === this.#doc.body && offset === 0) return 0;
    throw new Error('Fake range supports text containers or body start only');
  }
  toString(): string {
    const all = textNodes(this.#doc.body).map((t) => t.data).join('');
    return all.slice(this.#global(this.startContainer!, this.startOffset), this.#global(this.endContainer!, this.endOffset));
  }
  /** One synthetic rect per touched text node, 8px per character. */
  getClientRects() {
    const out = [];
    let at = 0;
    const start = this.#global(this.startContainer!, this.startOffset);
    const end = this.#global(this.endContainer!, this.endOffset);
    for (const text of textNodes(this.#doc.body)) {
      const from = Math.max(start, at);
      const to = Math.min(end, at + text.data.length);
      if (from < to) out.push(domRect({ left: text.box.left + (from - at) * 8, top: text.box.top, width: (to - from) * 8, height: text.box.height }));
      at += text.data.length;
    }
    return out;
  }
}

export class FakeDocument {
  readonly documentElement = new FakeElement('html');
  readonly body = new FakeElement('body');
  constructor() {
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
  createRange(): FakeRange {
    return new FakeRange(this);
  }
  querySelector(selector: string): FakeElement | null {
    return matches(this.documentElement, selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return matches(this.documentElement, selector);
  }
  createTreeWalker(root: FakeElement) {
    const nodes = textNodes(root);
    let i = -1;
    return { nextNode: () => nodes[++i] ?? null };
  }
}

type Listener = (event: FakeEvent) => void;

export class FakeEvent {
  readonly type: string;
  readonly target: unknown;
  defaultPrevented = false;
  propagationStopped = false;
  constructor(type: string, target: unknown) {
    this.type = type;
    this.target = target;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopImmediatePropagation(): void {
    this.propagationStopped = true;
  }
}

export class FakeWindow {
  readonly document = new FakeDocument();
  innerWidth = 1280;
  innerHeight = 800;
  devicePixelRatio = 1;
  scrollX = 0;
  scrollY = 0;
  selection: { isCollapsed: boolean; rangeCount: number; getRangeAt: (i: number) => FakeRange } | null = null;
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #timers = new Map<number, () => void>();
  #nextTimer = 1;
  /** Page-level handlers that run after capture listeners unless propagation stopped. */
  readonly pageHandled: string[] = [];

  /** Manual timers: nothing runs until flushTimers(). */
  setTimeout(callback: () => void): number {
    const id = this.#nextTimer++;
    this.#timers.set(id, callback);
    return id;
  }
  clearTimeout(id: number): void {
    this.#timers.delete(id);
  }
  get pendingTimers(): number {
    return this.#timers.size;
  }
  flushTimers(): void {
    const due = [...this.#timers.values()];
    this.#timers.clear();
    for (const callback of due) callback();
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.#listeners.get(type)?.delete(listener);
  }
  getSelection() {
    return this.selection;
  }
  dispatch(type: string, target: unknown): FakeEvent {
    const event = new FakeEvent(type, target);
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
      if (event.propagationStopped) break;
    }
    if (!event.propagationStopped) this.pageHandled.push(type);
    return event;
  }
  listenerCount(): number {
    let n = 0;
    for (const set of this.#listeners.values()) n += set.size;
    return n;
  }
  /** Selects [start, end) of a text node. */
  selectText(node: FakeText, start: number, end: number): void {
    const range = this.document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    this.selection = { isCollapsed: start === end, rangeCount: 1, getRangeAt: () => range };
  }
}

/** Synthetic page: header, main with two paragraphs and two buttons. */
export function buildPage(win: FakeWindow) {
  const { document: doc } = win;
  const main = doc.body.appendChild(doc.createElement('main'));
  const intro = main.appendChild(doc.createElement('p'));
  const introText = intro.appendChild(new FakeText('Ship the plan. Review the plan today.'));
  introText.box = { left: 20, top: 100, width: 0, height: 16 };
  const actions = main.appendChild(doc.createElement('div'));
  const save = actions.appendChild(doc.createElement('button'));
  save.appendChild(new FakeText('Save'));
  save.box = { left: 20, top: 200, width: 80, height: 32 };
  const cancel = actions.appendChild(doc.createElement('button'));
  cancel.appendChild(new FakeText('Cancel'));
  cancel.box = { left: 110, top: 200, width: 80, height: 32 };
  return { main, intro, introText, save, cancel };
}
