// Integrated after captures in the desktop preview shell at 760×560: the icon rail and narrow layouts (F7 X6).
const url = 'http://127.0.0.1:5310/';
const ready = { waitFor: "document.readyState === 'complete' && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Social')" };
const social = [ready, { click: 'Social', after: 1200 }, { waitFor: "!!document.querySelector('.sd-main h1')" }];
const nav = (name) => ({ eval: `[...document.querySelectorAll('.sd-nav-item')].find(e => (e.getAttribute('title') || e.textContent.trim()).startsWith(${JSON.stringify(name)}))?.click()`, after: 900 });
const page = (name) => [...social, nav(name)];
const press = (label) => ({ eval: `[...document.querySelectorAll('.sd-main button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()).startsWith(${JSON.stringify(label)}))?.click()`, after: 900 });
// The preview harness's own overlay is not part of HQ; hide it so it doesn't cover the page.
const hideHarness = { eval: "document.querySelectorAll('aside[aria-label=\"Preview controls\"]').forEach(e => e.setAttribute('hidden', ''))", after: 100 };
export default { url, width: 760, height: 560, shots: [
  { name: 'after-760-overview-light', steps: [...page('Overview'), hideHarness] },
  { name: 'after-760-workbench-light', steps: [...page('Workbenches'), press('Open Writing studio'), press('Load example'), press('Run'), { after: 2600 }, hideHarness] },
  { name: 'after-760-library-draft-light', steps: [...page('Library'), press('Autumn blend tasting notes'), hideHarness] },
  { name: 'after-760-library-draft-dark', theme: 'dark', steps: [...page('Library'), press('Autumn blend tasting notes'), hideHarness] },
  { name: 'after-760-calendar-light', steps: [...page('Calendar'), hideHarness] },
  { name: 'after-760-calendar-dark', theme: 'dark', steps: [...page('Calendar'), hideHarness] },
  { name: 'after-760-run-receipt-light', steps: [...page('Run history'), press('Open receipt 00000004'), hideHarness] },
  { name: 'after-760-reduced-calendar-light', reducedMotion: true, steps: [...page('Calendar'), hideHarness] },
] };
