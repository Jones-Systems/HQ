import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@hq/ui';
import type { Appearance } from '@hq/contracts';
import type { ServiceConfigTransport } from '@hq/contracts/services';
import { type DataSource } from './services/data-source-status';
import { useDataSources } from './settings/DataSources';
import { AppearancePanel } from './appearance/AppearancePanel';
import type { PaletteController } from './appearance/usePalette';
import { CATEGORIES, CATEGORY_GROUPS, type SettingsCategory } from './settings/categories';
import { Overview } from './settings/Overview';
import { ServicesPanel } from './settings/ServicesPanel';
import { WikiPanel } from './settings/WikiPanel';
import { ProjectSources } from './settings/ProjectSources';
import { Updates } from './settings/Updates';
import { useProjectStatus } from './settings/project-status';
import { Icon } from './settings/parts';
import { projectsSummary } from './settings/status';
import './connections/connections.css';
import './settings/settings.css';

/** Social and Work targets land on the shared services panel; the row is highlighted and scrolled into view. */
const categoryFor = (target: DataSource | 'appearance' | null): SettingsCategory =>
  target === 'social' || target === 'work' ? 'services' : target === 'wiki' ? 'wiki' : target === 'appearance' ? 'appearance' : 'overview';
const highlightFor = (target: DataSource | 'appearance' | null): DataSource | null => target && target !== 'appearance' ? target : null;

/** Existing endpoint values stay in native configuration and are never read into this page. */
export function ServiceSettings({ config, onClose, returnLabel = 'Design', target = null, appearance = 'system', onAppearanceChange, palette, dark = false }: {
  config?: ServiceConfigTransport; onClose: () => void; returnLabel?: string; target?: DataSource | 'appearance' | null;
  appearance?: Appearance; onAppearanceChange?: (value: Appearance) => void;
  /** Dark palette presets and colour edits; `dark` is the resolved theme the palette applies to. */
  palette?: PaletteController; dark?: boolean;
}) {
  const [category, setCategory] = useState<SettingsCategory>(categoryFor(target));
  const [highlight, setHighlight] = useState<DataSource | null>(highlightFor(target));
  const title = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const headingId = `settings-${category}-heading`;
  const { statuses } = useDataSources();
  const project = useProjectStatus();
  const descriptions = useId();

  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => { setCategory(categoryFor(target)); setHighlight(highlightFor(target)); }, [target]);
  // A new category starts at the top and puts focus on its heading; the first render keeps focus on the page title.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (scroller.current) scroller.current.scrollTop = 0;
    document.getElementById(headingId)?.focus({ preventScroll: true });
  }, [category, headingId]);
  useEffect(() => {
    if (highlight && category !== 'overview') document.getElementById(`settings-${highlight}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight, category]);

  const open = (next: SettingsCategory, row: DataSource | null = null) => { setHighlight(row); setCategory(next); };
  const onNavKey = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    const items = [...(nav.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (!items.length || current < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : step ? (current + step + items.length) % items.length : -1;
    if (next < 0) return;
    event.preventDefault(); items[next]!.focus();
  };

  // A trailing shape on a category that needs attention; its words come from the button's description.
  const attention: Partial<Record<SettingsCategory, string>> = {
    ...(statuses.social.tone === 'bad' || statuses.work.tone === 'bad' ? { services: 'Needs attention' } : {}),
    ...(statuses.wiki.tone === 'bad' ? { wiki: 'Needs attention' } : {}),
    ...(project.sources && ['warning', 'unavailable'].includes(projectsSummary(project.sources).chip.tone) ? { projects: 'Needs attention' } : {}),
  };
  const label = CATEGORIES.find(item => item.id === category)!.label;

  return <section className="settings-page" role="region" aria-label="Settings page" onKeyDown={event => {
    const element = event.target;
    if (event.key === 'Escape' && !event.defaultPrevented && !(element instanceof HTMLElement && element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) {
      event.preventDefault(); onClose();
    }
  }}>
    <header className="settings-header">
      <div><h1 ref={title} tabIndex={-1}>Settings</h1><span aria-hidden="true" className="settings-crumb"> / {label}</span></div>
      <Button size="sm" variant="ghost" onClick={onClose}>← Back to {returnLabel}</Button>
    </header>
    <div className="settings-layout">
      <nav className="settings-categories" aria-label="Settings categories" ref={nav} onKeyDown={onNavKey}>
        {CATEGORY_GROUPS.map(group => <div key={group.label} className="settings-nav-group" role="group" aria-label={group.label}>
          <span className="settings-nav-eyebrow" aria-hidden="true">{group.label}</span>
          {group.items.map(item => <button key={item.id} type="button" aria-current={category === item.id ? 'page' : undefined} aria-describedby={attention[item.id] ? `${descriptions}-${item.id}` : undefined} onClick={() => open(item.id)}>
            <Icon name={item.icon} /><span className="settings-nav-label">{item.label}</span>
            {attention[item.id] && <><i className="settings-nav-status" aria-hidden="true" /><span id={`${descriptions}-${item.id}`} className="hq-sr-only">{attention[item.id]}</span></>}
          </button>)}
        </div>)}
      </nav>
      <div className="settings-scroll" ref={scroller}>
        <div className="settings-content hq-enter-rise" key={category} role="region" aria-labelledby={headingId}>
          {category === 'overview' ? <Overview headingId={headingId} project={project} onManage={open} />
            : category === 'services' ? <ServicesPanel headingId={headingId} config={config} selected={highlight === 'social' || highlight === 'work' ? highlight : null} />
            : category === 'wiki' ? <WikiPanel headingId={headingId} admin={window.hqServices?.wikiAdmin} selected={highlight === 'wiki'} />
            : category === 'projects' ? <ProjectSources headingId={headingId} />
            : category === 'updates' ? <Updates headingId={headingId} />
            : <AppearancePanel headingId={headingId} appearance={appearance} onAppearanceChange={onAppearanceChange} palette={palette} dark={dark} />}
        </div>
      </div>
    </div>
  </section>;
}
