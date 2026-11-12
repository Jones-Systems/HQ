// Integrated after captures in the desktop preview shell at 1280×800 (fictional example workspace only).
const url = 'http://127.0.0.1:5310/';
const ready = { waitFor: "document.readyState === 'complete' && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Social')" };
const social = [ready, { click: 'Social', after: 1200 }, { waitFor: "!!document.querySelector('.sd-main h1')" }];
const nav = (name) => ({ eval: `[...document.querySelectorAll('.sd-nav-item')].find(e => e.textContent.trim().startsWith(${JSON.stringify(name)}))?.click()`, after: 900 });
// The preview harness's own overlay is not part of HQ; hide it so it doesn't cover the page.
const hideHarness = { eval: "document.querySelectorAll('aside[aria-label=\"Preview controls\"]').forEach(e => e.setAttribute('hidden', ''))", after: 100 };
const page = (name) => [...social, hideHarness, nav(name)];
const press = (label) => ({ eval: `[...document.querySelectorAll('.sd-main button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()).startsWith(${JSON.stringify(label)}))?.click()`, after: 900 });
const views = (theme) => [
  { name: `after-overview-${theme}`, theme, steps: page('Overview') },
  { name: `after-sources-${theme}`, theme, steps: page('Sources') },
  { name: `after-sources-matched-${theme}`, theme, steps: [...page('Sources'), press('Use fictional example'), { after: 600 }] },
  { name: `after-workbenches-${theme}`, theme, steps: page('Workbenches') },
  { name: `after-workbench-writing-${theme}`, theme, steps: [...page('Workbenches'), press('Open Writing studio'), press('Load example'), press('Run'), { after: 2600 }] },
  { name: `after-library-${theme}`, theme, steps: page('Library') },
  { name: `after-library-draft-${theme}`, theme, steps: [...page('Library'), press('Autumn blend tasting notes')] },
  { name: `after-calendar-${theme}`, theme, steps: page('Calendar') },
  { name: `after-runs-${theme}`, theme, steps: page('Run history') },
  { name: `after-run-receipt-${theme}`, theme, steps: [...page('Run history'), press('Open receipt 00000004')] },
  { name: `after-channels-${theme}`, theme, steps: page('Channels & accounts') },
];
export default { url, shots: [...views('light'), ...views('dark')] };
