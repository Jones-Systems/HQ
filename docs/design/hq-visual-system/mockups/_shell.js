// Mockup chrome builder for the HQ visual-system pages. Illustrative only: no storage, network or work dispatch.
// Query: ?theme=light|dark|system  &drawer=open  &slots=design (T0 state: Social/Work unavailable)
// After fonts settle it writes positions of [data-evidence] elements into document.title as JSON for
// tools/render_evidence.sh; that is the only reason the title changes.
(() => {
  const ICON = {
    design: '<path d="M4 7.5h16M4 16.5h16M7.5 4v16M16.5 4v16"/>',
    social: '<circle cx="12" cy="12" r="2.2"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
    work: '<rect x="3.5" y="4" width="4.6" height="10" rx="1.2"/><rect x="9.7" y="4" width="4.6" height="16" rx="1.2"/><rect x="15.9" y="4" width="4.6" height="7" rx="1.2"/>',
    settings: '<circle cx="12" cy="12" r="2.6"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
    sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
    system: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    sep: '<path d="m9 6 6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    cmd: '<path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H17.5A2.5 2.5 0 1 0 15 6.5V17.5A2.5 2.5 0 1 0 17.5 15H6.5A2.5 2.5 0 1 0 9 17.5Z"/>',
  };
  const svg = (name, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${ICON[name]}</svg>`;
  window.hqIcon = svg;

  const params = new URLSearchParams(location.search);
  const body = document.body;
  const domain = body.dataset.domain;
  const choiceParam = params.get('theme');
  let choice = ['light', 'dark', 'system'].includes(choiceParam) ? choiceParam : (body.dataset.defaultTheme || 'dark');
  const media = matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;
  const slots = (params.get('slots') || 'design,social,work').split(',');

  function applyTheme() {
    // Same rule as the T0 shell: always write the resolved theme to <html data-theme>.
    root.dataset.theme = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
    root.dataset.appearance = choice;
    document.querySelectorAll('[data-appearance-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.appearanceChoice === choice)));
    const compact = document.querySelector('.hq-appearance-compact');
    if (compact) {
      compact.innerHTML = svg(choice === 'system' ? 'system' : choice === 'dark' ? 'moon' : 'sun') + svg('chevron');
      compact.setAttribute('aria-label', `Appearance: ${choice[0].toUpperCase() + choice.slice(1)}`);
    }
  }
  media.addEventListener('change', applyTheme);

  const keep = (href) => `${href}${choiceParam ? `?theme=${choice}` : ''}`;
  const labels = { design: 'Design', social: 'Social', work: 'Work' };
  const rail = ['design', 'social', 'work'].map((d) => {
    const available = slots.includes(d);
    const current = d === domain ? ' aria-current="page"' : '';
    if (!available) return `<a class="hq-rail-item" role="link" aria-disabled="true" tabindex="0" title="${labels[d]} is not installed in this build">${svg(d)}<span>${labels[d]}</span></a>`;
    return `<a class="hq-rail-item" href="${keep(`${d}.html`)}"${current}>${svg(d)}<span>${labels[d]}</span></a>`;
  }).join('');

  const save = body.dataset.save || 'saved';
  const saveHtml = {
    saved: `<span class="hq-save" role="status">${svg('check')}Saved 14:02</span>`,
    saving: `<span class="hq-save hq-save--saving" role="status"><span class="hq-spinner"></span>Saving…</span>`,
    unsaved: `<span class="hq-save hq-save--unsaved" role="status">Unsaved changes</span>`,
  }[save];

  const secnav = document.getElementById('secnav').innerHTML;
  const main = document.getElementById('main').innerHTML;
  const app = document.createElement('div');
  app.className = 'hq-app';
  app.innerHTML = `
    <header class="hq-titlebar">
      <span class="mock-traffic" aria-hidden="true"><i></i><i></i><i></i></span>
      <button class="hq-btn hq-btn--ghost hq-btn--sm hq-btn--icon hq-drawer-toggle" aria-label="Show ${labels[domain]} navigation" aria-expanded="false">${svg('sidebar')}</button>
      <span class="hq-mark">HQ</span>
      <span class="hq-divider-v" aria-hidden="true"></span>
      <button class="hq-context" aria-haspopup="menu" title="Project context: change explicitly">
        <span class="hq-eyebrow">Project</span><strong>Larkspur Tea Co.</strong>${svg('chevron')}
      </button>
      <nav class="hq-crumbs" aria-label="Location"><span class="hq-crumb-domain">${labels[domain]}</span>${svg('sep', 'class="hq-crumb-sep"')}<span aria-current="page">${body.dataset.crumb}</span></nav>
      <span class="hq-spacer"></span>
      ${saveHtml}
      <button class="hq-btn hq-btn--secondary hq-btn--sm" aria-label="Search" aria-keyshortcuts="Meta+K">${svg('search')}<span class="hq-search-label" aria-hidden="true">Search</span><span class="hq-kbd" aria-hidden="true">${svg('cmd')}K</span></button>
      <div class="hq-segmented hq-appearance-full" role="radiogroup" aria-label="Appearance" data-evidence="appearance-control">
        <button role="radio" data-appearance-choice="light" aria-label="Light" title="Light">${svg('sun')}</button>
        <button role="radio" data-appearance-choice="dark" aria-label="Dark" title="Dark">${svg('moon')}</button>
        <button role="radio" data-appearance-choice="system" aria-label="System" title="System">${svg('system')}</button>
      </div>
      <button class="hq-btn hq-btn--ghost hq-btn--sm hq-appearance-compact" aria-haspopup="menu"></button>
    </header>
    <nav class="hq-rail" aria-label="Domains">${rail}<span class="hq-spacer"></span>
      <a class="hq-rail-item" href="#" aria-label="Settings">${svg('settings')}</a></nav>
    <div class="hq-sheet">
      <aside class="hq-secnav" aria-label="${labels[domain]} navigation">${secnav}</aside>
      <main class="hq-main">${main}</main>
    </div>
    <div class="hq-scrim"></div>`;
  body.prepend(app);

  app.querySelectorAll('[data-appearance-choice]').forEach((b) => b.addEventListener('click', () => { choice = b.dataset.appearanceChoice; applyTheme(); }));
  app.querySelector('.hq-appearance-compact').addEventListener('click', () => {
    choice = { light: 'dark', dark: 'system', system: 'light' }[choice]; applyTheme();
  });
  const toggle = app.querySelector('.hq-drawer-toggle');
  // Compact drawer: focus moves into the navigation on open and returns to the toggle on close.
  const setDrawer = (open, moveFocus = true) => {
    const wasOpen = app.classList.contains('is-drawer-open');
    app.classList.toggle('is-drawer-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (!moveFocus || open === wasOpen) return;
    if (open) (app.querySelector('.hq-secnav [aria-current="page"]') || app.querySelector('.hq-secnav a, .hq-secnav button'))?.focus();
    else toggle.focus();
  };
  toggle.addEventListener('click', () => setDrawer(!app.classList.contains('is-drawer-open')));
  app.querySelector('.hq-scrim').addEventListener('click', () => setDrawer(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.classList.contains('is-drawer-open')) setDrawer(false); });
  if (params.get('drawer') === 'open') setDrawer(true, false);
  applyTheme();

  // setTimeout rather than requestAnimationFrame: headless virtual time does not always schedule frames.
  document.fonts.ready.then(() => setTimeout(() => {
    const rects = {};
    document.querySelectorAll('[data-evidence]').forEach((el) => {
      const r = el.getBoundingClientRect();
      rects[el.dataset.evidence] = [r.x, r.y, r.width, r.height];
    });
    document.title = JSON.stringify({ hqEvidence: 1, theme: root.dataset.theme, appearance: choice, fonts: document.fonts.check('13px "IBM Plex Sans"'), rects });
  }, 50));
})();
