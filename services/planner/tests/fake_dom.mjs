// A deliberately tiny DOM stand-in so view render functions can run under
// Node without a browser. It records structure and text; it does not do
// layout, CSS selectors beyond simple id/class/attribute lookups, or events.

class Node {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  get parentElement() { return this.parentNode; }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((n) => n instanceof Element); }
  get lastElementChild() { return this.children.at(-1) || null; }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.children;
    return sibs[sibs.indexOf(this) + 1] || null;
  }

  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(value) {
    this.childNodes.forEach((n) => { n.parentNode = null; });
    this.childNodes = [];
    if (value !== '' && value != null) this.append(new Text(String(value)));
  }

  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === 'string' ? new Text(n) : n;
      if (node.parentNode) node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  prepend(...nodes) {
    const rest = this.childNodes;
    this.childNodes = [];
    this.append(...nodes);
    this.childNodes.push(...rest);
  }

  insertBefore(node, ref) {
    if (node.parentNode) node.remove();
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    node.parentNode = this;
    if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
    return node;
  }

  after(node) { this.parentNode?.insertBefore(node, this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null); }

  remove() {
    if (!this.parentNode) return;
    const list = this.parentNode.childNodes;
    list.splice(list.indexOf(this), 1);
    this.parentNode = null;
  }

  replaceChildren(...nodes) {
    this.textContent = '';
    this.append(...nodes);
  }

  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
}

class Text extends Node {
  constructor(text) {
    super();
    this.data = text;
  }

  get textContent() { return this.data; }
}

function matches(el, selector) {
  return selector.split(',').some((part) => {
    const sel = part.trim();
    let m;
    if ((m = /^#([\w-]+)$/.exec(sel))) return el.id === m[1];
    if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel))) {
      return m[2] === undefined ? el.hasAttribute(m[1]) : el.getAttribute(m[1]) === m[2];
    }
    if ((m = /^([a-z]*)((?:\.[\w-]+)*)$/.exec(sel))) {
      const tagOk = !m[1] || el.tagName.toLowerCase() === m[1];
      const classes = m[2].split('.').filter(Boolean);
      return tagOk && classes.every((c) => el.classList.contains(c));
    }
    return false;
  });
}

class ClassList {
  constructor(el) { this.el = el; }
  get list() { return this.el.className.split(/\s+/).filter(Boolean); }
  add(...c) { this.el.className = [...new Set([...this.list, ...c])].join(' '); }
  remove(...c) { this.el.className = this.list.filter((x) => !c.includes(x)).join(' '); }
  toggle(c, force) {
    const on = force === undefined ? !this.contains(c) : force;
    if (on) this.add(c); else this.remove(c);
    return on;
  }

  contains(c) { return this.list.includes(c); }
}

function datasetProxy(el) {
  const toAttr = (k) => `data-${k.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
  return new Proxy({}, {
    get: (_, k) => el.getAttribute(toAttr(k)) ?? undefined,
    set: (_, k, v) => { el.setAttribute(toAttr(k), String(v)); return true; },
    ownKeys: () => Object.keys(el.attrs).filter((a) => a.startsWith('data-'))
      .map((a) => a.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}

class Element extends Node {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.className = '';
    this.classList = new ClassList(this);
    this.dataset = datasetProxy(this);
    this.style = { setProperty() {} };
    this.listeners = {};
    Object.assign(this, {
      id: '', value: '', checked: false, disabled: false, hidden: false, type: '', title: '', href: '',
      tabIndex: -1, maxLength: -1, rows: 2, placeholder: '', required: false, min: '', max: '', step: '',
      download: '', target: '', rel: '', scope: '', accept: '', open: false, files: [], spellcheck: true,
      selectionStart: 0, selectionEnd: 0, scrollTop: 0, scrollLeft: 0, scrollHeight: 0,
    });
  }

  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return k === 'id' ? this.id || null : this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  focus() { globalThis.document.activeElement = this; }
  blur() {}
  closest(sel) { for (let n = this; n instanceof Element; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (matches(c, sel)) out.push(c); walk(c); });
    walk(this);
    return out;
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }; }
  setSelectionRange() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

export function installFakeDom() {
  const body = new Element('body');
  const html = new Element('html');
  html.append(body);
  const storage = new Map();
  const doc = {
    body,
    documentElement: html,
    activeElement: body,
    hidden: false,
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    createTextNode: (t) => new Text(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    addEventListener() {},
    removeEventListener() {},
    elementFromPoint: () => null,
    dispatchEvent() {},
  };
  Object.assign(globalThis, {
    document: doc,
    Node,
    window: { matchMedia: () => ({ matches: false }), innerWidth: 1280, innerHeight: 800, addEventListener() {}, scrollBy() {} },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    CSS: { escape: (s) => s },
    getComputedStyle: () => ({ overflowX: 'visible', overflowY: 'visible' }),
    location: { hash: '', origin: 'http://127.0.0.1:8765', pathname: '/' },
  });
  return doc;
}
