import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src';
import { KitPage, type Appearance } from './KitPage';
import './kit.css';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme');
const only = params.get('only');

/** Waits until every iframe's srcdoc document and its stylesheet have loaded. */
async function framesReady(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = [...document.querySelectorAll('iframe')].every((frame) => {
      const doc = frame.contentDocument;
      return doc?.readyState === 'complete' && doc.styleSheets.length > 0;
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('srcdoc frames did not load (check the CSP frame-src result)');
}

function clean(style: CSSStyleDeclaration) {
  return { filter: style.filter, mixBlendMode: style.mixBlendMode, opacity: style.opacity };
}

/** Measurements for the evidence record: computed scheme, alteration properties and frame media queries. */
async function probe() {
  await framesReady();
  const measure = (el: HTMLElement) => {
    const style = getComputedStyle(el);
    const child = el.firstElementChild as HTMLElement;
    const frame = el.querySelector('iframe');
    const rect = el.getBoundingClientRect();
    let ancestorAltered = false;
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.filter !== 'none' || s.mixBlendMode !== 'normal' || s.opacity !== '1') ancestorAltered = true;
    }
    return {
      id: el.dataset.kitId ?? el.dataset.kitControl,
      kind: el.dataset.hqContent ?? null,
      recorded: el.dataset.hqRecordedScheme ?? null,
      pinned: el.style.getPropertyValue('--hq-content-scheme') || null,
      colorScheme: style.colorScheme,
      childColorScheme: getComputedStyle(child).colorScheme,
      background: style.backgroundColor,
      well: clean(style),
      child: clean(getComputedStyle(child)),
      ancestorAltered,
      frameDark: frame ? frame.contentWindow!.matchMedia('(prefers-color-scheme: dark)').matches : null,
      frameBackground: frame ? getComputedStyle(frame.contentDocument!.body).backgroundColor : null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  };
  return {
    theme: document.documentElement.dataset.theme ?? null,
    osDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    chromeScheme: getComputedStyle(document.documentElement).colorScheme,
    chromeCanvas: getComputedStyle(document.body).backgroundColor,
    dpr: window.devicePixelRatio,
    scrollY: window.scrollY,
    wells: [...document.querySelectorAll<HTMLElement>('[data-hq-content]')].map(measure),
    controls: [...document.querySelectorAll<HTMLElement>('[data-kit-control]')].map(measure),
  };
}

window.hqKit = { ...window.hqKit, probe };

/** `?probe`: for a headless browser without automation, cycle Light, Dark and System and write the results to the DOM. */
async function probeIntoDom() {
  const results: Record<string, unknown> = {};
  for (const appearance of ['light', 'dark', 'system'] as const) {
    window.hqKit!.setAppearance!(appearance);
    await new Promise((resolve) => setTimeout(resolve, 300));
    results[appearance] = await probe();
  }
  const out = document.createElement('pre');
  out.id = 'kit-probe';
  out.textContent = JSON.stringify({ userAgent: navigator.userAgent, results });
  document.body.append(out);
}
if (params.has('probe')) setTimeout(() => { void probeIntoDom(); }, 300);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KitPage
      initial={theme === 'light' || theme === 'dark' ? theme : 'system' satisfies Appearance}
      only={only === 'wells' || only === 'primitives' ? only : undefined}
    />
  </StrictMode>,
);
