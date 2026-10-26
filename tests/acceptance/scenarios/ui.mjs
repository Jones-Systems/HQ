import assert from 'node:assert/strict';

export function uiDriver(context) {
  const evaluate = expression => context.cdp().evaluate(expression);
  async function click(text, scope = 'body') {
    const expression = `(() => { const root = document.querySelector(${JSON.stringify(scope)}); const buttons = [...(root?.querySelectorAll('button') ?? [])].filter(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(text)} && !b.disabled); if (buttons.length !== 1) return false; buttons[0].scrollIntoView({block:'center'}); buttons[0].click(); return true; })()`;
    await context.until(() => evaluate(`(() => { const root = document.querySelector(${JSON.stringify(scope)}); return [...(root?.querySelectorAll('button') ?? [])].filter(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(text)} && !b.disabled).length === 1; })()`), `unique enabled ${text}`);
    assert.equal(await evaluate(expression), true);
  }
  async function fill(label, value) {
    const found = await evaluate(`(() => { const labels = [...document.querySelectorAll('label')].filter(l => l.textContent.trim() === ${JSON.stringify(label)}); if (labels.length !== 1) return false; const input = labels[0].control ?? labels[0].querySelector('input'); if (!input || input.disabled) return false; input.scrollIntoView({block:'center'}); input.focus(); input.select(); return true; })()`);
    assert.equal(found, true, `input ${label}`);
    await context.cdp().send('Input.insertText', { text: value });
    assert.equal(await evaluate('document.activeElement.value'), value);
  }
  async function sources() {
    await click('Settings', 'aside[aria-label="HQ navigation"]');
    await context.until(() => evaluate(`!!document.querySelector('section[aria-label="Project sources"]')`), 'Project sources settings');
  }
  async function readSources(route) {
    assert.ok(['status', 'list'].includes(route));
    const result = await evaluate(`window.hqServices.sources.call(${JSON.stringify(route)}, {})`);
    assert.equal(result?.ok, true, `source ${route} readback`);
    return result.value;
  }
  async function sourceRow(label, state) {
    return context.until(async () => {
      const statuses = await readSources('status');
      const source = statuses.find(item => item.label === label);
      const shown = await evaluate(`(() => { const rows = [...document.querySelectorAll('section[aria-label="Project sources"] .wiki-manager-source')]; const r = rows.find(r => r.querySelector('strong')?.textContent === ${JSON.stringify(label)}); return !!r && r.textContent.includes(${JSON.stringify(`· ${state} ·`)}) && [...r.querySelectorAll('button')].every(b => !b.disabled); })()`);
      return source?.state === state && shown && source;
    }, `${label} ${state} in UI and main`);
  }
  return { evaluate, click, fill, sources, readSources, sourceRow };
}
