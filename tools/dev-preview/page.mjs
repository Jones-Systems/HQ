// Functions that run inside the renderer page. Each is self-contained (no closure over module
// scope): session.mjs sends `(${fn})(${JSON.stringify(arg)})` through CDP Runtime.evaluate.

/**
 * Finds visible, clickable elements by accessible name and returns where to click.
 * spec: { text?, selector?, scope?: string[], contains?, nth?, act? }
 * Search order: `selector` alone, or each `scope` container in turn, then the whole document.
 * With `act`, the match is scrolled into view and hit-tested so a covered target is reported.
 */
export function findInPage(spec) {
  const CLICKABLE = 'button, a, input, select, textarea, summary, [role="button"], [role="tab"], [role="link"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [tabindex]';
  const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const nameOf = element => squash(
    element.getAttribute('aria-label')
    || (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ')
    || element.innerText || element.textContent
    || element.getAttribute('title') || element.getAttribute('placeholder') || element.value || '');
  const visible = element => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const wanted = typeof spec.text === 'string' ? spec.text.toLowerCase() : null;
  const matches = element => {
    if (wanted === null) return true;
    const name = nameOf(element).toLowerCase();
    return spec.contains ? name.includes(wanted) : name === wanted;
  };
  const unique = list => [...new Set(list)];
  const pools = [];
  if (spec.selector) pools.push({ scoped: false, list: [...document.querySelectorAll(spec.selector)] });
  else {
    for (const scope of spec.scope ?? []) {
      pools.push({ scoped: true, scope, list: unique([...document.querySelectorAll(scope)].flatMap(root => [...root.querySelectorAll(CLICKABLE)])) });
    }
    pools.push({ scoped: false, list: [...document.querySelectorAll(CLICKABLE)] });
  }
  for (const pool of pools) {
    const found = pool.list.filter(visible).filter(matches);
    if (!found.length) continue;
    const element = found[spec.nth ?? 0];
    if (!element) return { count: found.length, missingNth: true };
    const result = { count: found.length, tag: element.tagName.toLowerCase(), name: nameOf(element).slice(0, 100), scoped: pool.scoped, ...(pool.scope ? { scope: pool.scope } : {}) };
    if (spec.act) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const box = element.getBoundingClientRect();
      const x = Math.min(Math.max(box.x + box.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(box.y + box.height / 2, 1), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      Object.assign(result, {
        x, y, hit: !!top && (top === element || element.contains(top)),
        disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
        ...(top && top !== element && !element.contains(top) ? { covered: `${top.tagName.toLowerCase()}${top.className && typeof top.className === 'string' ? '.' + top.className.trim().split(/\s+/)[0] : ''}` } : {}),
      });
    }
    return result;
  }
  return { count: 0 };
}

/** Is this text visible anywhere on the page (rendered text or an aria-label)? Case-insensitive, substring. */
export function textVisibleInPage(spec) {
  const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = squash(spec.text);
  if (squash(document.body.innerText).includes(wanted)) return true;
  return [...document.querySelectorAll('[aria-label]')].some(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && squash(element.getAttribute('aria-label')).includes(wanted);
  });
}

/** The selected navigation items, for confirming that a click landed. */
export function currentInPage(spec) {
  const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const names = [...document.querySelectorAll(spec.current)].map(element => squash(
    element.getAttribute('aria-label') || element.innerText || element.textContent || element.getAttribute('title')));
  const wanted = String(spec.name).toLowerCase();
  const main = document.querySelector('main');
  return { names, match: names.some(name => name.toLowerCase().includes(wanted)), hasContent: !!main && !main.hidden && squash(main.innerText).length > 0 };
}

/**
 * Waits (bounded by spec.timeout ms) for fonts, finite animations and loading indicators, then two
 * frames. Infinite animations (spinners) are counted, not waited for; any indicator still showing at
 * the deadline is returned in `pending`.
 */
export async function settleInPage(spec) {
  const started = performance.now();
  const visible = element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };
  const pendingNow = () => {
    const found = [];
    for (const element of document.querySelectorAll(spec.busy.selectors.join(','))) {
      if (visible(element)) found.push(`${element.tagName.toLowerCase()}${typeof element.className === 'string' && element.className ? `.${element.className.trim().split(/\s+/)[0]}` : ''}`);
    }
    const pattern = new RegExp(spec.busy.textPattern, 'i');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue.trim();
      const parent = walker.currentNode.parentElement;
      if (text && text.length < 80 && pattern.test(text) && parent && !['SCRIPT', 'STYLE'].includes(parent.tagName) && visible(parent)) found.push(`text "${text}"`);
    }
    return [...new Set(found)].slice(0, 5);
  };
  const left = () => Math.max(0, spec.timeout - (performance.now() - started));
  const bounded = promise => Promise.race([Promise.resolve(promise).then(() => true, () => true), new Promise(resolve => setTimeout(() => resolve(false), left()))]);
  const fonts = await bounded(document.fonts.ready);
  let waited = 0;
  let infinite = 0;
  let animationsDone = true;
  for (let round = 0; round < 5 && left() > 0; round++) {
    const running = document.getAnimations().filter(animation => animation.playState === 'running');
    const finite = running.filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
    infinite = running.length - finite.length;
    if (!finite.length) break;
    waited += finite.length;
    animationsDone = await bounded(Promise.allSettled(finite.map(animation => animation.finished)));
    if (!animationsDone) break;
  }
  let pending = pendingNow();
  while (pending.length && left() > 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
    pending = pendingNow();
  }
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 250);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
  });
  return { fonts, waitedAnimations: waited, infiniteAnimations: infinite, animationsDone, pending, ms: Math.round(performance.now() - started) };
}

/** What a manifest records about the page at the moment of a screenshot. */
export function pageStateInPage(spec) {
  const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  return {
    theme: document.documentElement.dataset.theme ?? null,
    scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    viewport: { width: innerWidth, height: innerHeight },
    current: [...document.querySelectorAll(spec.current)].map(element => squash(element.getAttribute('aria-label') || element.innerText || element.textContent || element.getAttribute('title'))),
    electron: window.hqDesktop?.versions?.electron ?? null,
  };
}

/** Rendered something yet? Used to decide the app has mounted. */
export function mountedInPage(spec) {
  return document.readyState === 'complete' && !!document.querySelector(spec.mounted);
}
