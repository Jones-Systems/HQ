import type { ComponentSource, RenderInput } from '../contract.ts';
import { propsToCss } from '../model/props.ts';
import { embedScript, embedStyle, escapeAttribute, scriptJson } from '../model/html.ts';
import { tokensToCss } from '../model/tokens.ts';

/**
 * Review-layer sandbox document. A component runs in an iframe with
 * `sandbox="allow-scripts"` only, so its document has an opaque origin: it
 * cannot read `window.parent`/`top` or the parent's preload globals, cannot
 * reach storage or cookies, and has no Node. Its own CSP denies network,
 * nested frames, forms and base rewriting.
 *
 * Note: an about:srcdoc document also inherits the embedding document's CSP.
 * The shell CSP therefore applies on top of this one (see README).
 */

export const SANDBOX_CHANNEL = 'hq.design.component-sandbox/v1';

/** The only sandbox token HQ grants. */
export const SANDBOX_TOKENS = ['allow-scripts'] as const;

/** Tokens that would break isolation or let a component act outside its frame. */
export const FORBIDDEN_SANDBOX_TOKENS = [
  'allow-same-origin', 'allow-top-navigation', 'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols', 'allow-popups', 'allow-popups-to-escape-sandbox',
  'allow-forms', 'allow-modals', 'allow-downloads', 'allow-storage-access-by-user-activation',
  'allow-presentation', 'allow-orientation-lock', 'allow-pointer-lock',
] as const;

export const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** Permissions policy for the frame element; every powerful feature is denied. */
export const SANDBOX_ALLOW = [
  'camera', 'microphone', 'geolocation', 'clipboard-read', 'clipboard-write', 'display-capture',
  'fullscreen', 'payment', 'usb', 'serial', 'hid', 'midi', 'screen-wake-lock',
].map((feature) => `${feature} 'none'`).join('; ');

export interface SandboxFrameAttributes {
  readonly sandbox: string;
  readonly srcdoc: string;
  readonly allow: string;
  readonly referrerPolicy: 'no-referrer';
  readonly title: string;
  readonly width: number;
  readonly height: number;
}

export function validateSandboxTokens(tokens: string): readonly string[] {
  const list = tokens.split(/\s+/u).filter((token) => token.length > 0);
  const forbidden = list.filter((token) => (FORBIDDEN_SANDBOX_TOKENS as readonly string[]).includes(token));
  if (forbidden.length > 0) throw new Error(`Sandbox tokens ${forbidden.join(', ')} would break component isolation.`);
  const unknown = list.filter((token) => !(SANDBOX_TOKENS as readonly string[]).includes(token));
  if (unknown.length > 0) throw new Error(`Sandbox tokens ${unknown.join(', ')} are not granted to components.`);
  return list;
}

/**
 * Review bootstrap: reports ready/size/errors to the host and applies sampled
 * motion frames. It is part of the review layer and never ships in a product.
 */
function bootstrap(nonce: string): string {
  return `(() => {
  const CHANNEL = ${scriptJson(SANDBOX_CHANNEL)};
  const NONCE = ${scriptJson(nonce)};
  const post = (type, detail) => parent.postMessage({ channel: CHANNEL, nonce: NONCE, type, detail }, '*');
  addEventListener('error', (event) => post('error', { message: String(event.message).slice(0, 500) }));
  addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.nonce !== NONCE || data.type !== 'motion-frame') return;
    const styles = data.detail && data.detail.styles;
    if (!styles || typeof styles !== 'object') return;
    for (const node of document.querySelectorAll('[data-motion-target]')) {
      const style = styles[node.getAttribute('data-motion-target')];
      if (!style) continue;
      if (typeof style.opacity === 'string') node.style.opacity = style.opacity;
      if (typeof style.transform === 'string') node.style.transform = style.transform;
    }
  });
  const report = () => {
    const root = document.documentElement;
    post('size', { width: Math.ceil(root.scrollWidth), height: Math.ceil(root.scrollHeight) });
  };
  addEventListener('load', () => { report(); post('ready', {}); });
})();`;
}

export interface SandboxDocumentOptions {
  readonly nonce: string;
  /** Extra script appended after the component, for isolation probes only. */
  readonly probe?: string;
}

/** Builds the srcdoc for one render input. The component source is only read. */
export function buildSandboxDocument(source: ComponentSource, input: RenderInput, options: SandboxDocumentOptions): string {
  if (input.componentId !== source.componentId || input.sourceRevision !== source.revision || input.sourceDigest !== source.digest) {
    throw new Error('Render input is bound to a different component revision.');
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(options.nonce)) throw new Error('Sandbox nonce is invalid.');
  const scheme = source.colorScheme;
  const background = scheme === 'dark' ? '#111' : '#fff';
  const foreground = scheme === 'dark' ? '#f4f4f4' : '#111';
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(SANDBOX_CSP)}">`,
    `<meta name="color-scheme" content="${scheme}">`,
    `<style>:root{color-scheme:${scheme};background:${background};color:${foreground}}body{margin:0}</style>`,
    `<style>${embedStyle(tokensToCss(input.tokens))}${embedStyle(propsToCss(source, input.props))}</style>`,
    `<style>${embedStyle(source.styles)}</style>`,
    `<script>${embedScript(bootstrap(options.nonce))}</script>`,
    '</head><body>',
    `<div id="hq-component-root">${source.markup}</div>`,
    `<script type="application/json" id="hq-component-props">${scriptJson(input.props)}</script>`,
    `<script type="application/json" id="hq-component-tokens">${scriptJson(input.tokens)}</script>`,
    source.script.trim().length === 0 ? '' : `<script>(function (root, props, tokens) {\n${embedScript(source.script)}\n})(document.getElementById('hq-component-root'), Object.freeze(JSON.parse(document.getElementById('hq-component-props').textContent)), Object.freeze(JSON.parse(document.getElementById('hq-component-tokens').textContent)));</script>`,
    options.probe === undefined ? '' : `<script>${embedScript(options.probe)}</script>`,
    '</body></html>',
  ].join('');
}

export function sandboxFrameAttributes(source: ComponentSource, input: RenderInput, options: SandboxDocumentOptions): SandboxFrameAttributes {
  const sandbox = SANDBOX_TOKENS.join(' ');
  validateSandboxTokens(sandbox);
  return {
    sandbox,
    srcdoc: buildSandboxDocument(source, input, options),
    allow: SANDBOX_ALLOW,
    referrerPolicy: 'no-referrer',
    title: `${source.name} component preview (sandboxed)`,
    width: source.size.width,
    height: source.size.height,
  };
}

/** A nonce identifies one frame's messages. It is not an authority token. */
export function createSandboxNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
