// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ModulePort, ReferenceEnvelope } from '@hq/contracts';
import { parseReference, REFERENCE_STATUSES } from '@hq/contracts';
import type { HqServices, WorkServiceRoute, WorkServiceTransport } from '@hq/contracts/services';
import { ReferenceChip } from '@hq/ui';
import * as Work from '@hq/work';
import { createFixturePlanner, EXAMPLE_SETTINGS, HQ_REFERENCES_FEATURE, normalizeFields } from '../../../modules/work/core';
import { resetWorkSessions } from '../../../modules/work/nav';
import { resetViewMemory } from '../../../modules/work/views/env';
import { viewItems, VIEW_TODAY } from '../../../modules/work/views/fixtures';
import { resetSocialSessions, FIXTURE_IDS, FEATURE_HQ_REFERENCES, FEATURE_HQ_BRAND_PROJECT } from '../../../modules/social/core';
import { createWireStub } from '../../../modules/social/live/test/wire-stub';
import { addDraftLink, UNSAVED_LINKS } from '../../../modules/social/content/links';
import { createWorkExport } from '../electron/work-export';
import * as exportClient from './services/work-export';
import { createServiceDomains, SERVICE_DOMAINS } from './services/domains';
import { REFERENCE_PROVIDERS } from './reference-providers';
import { createReferencePort, RESOLUTION_MAX_AGE } from './references';
import { App } from './App';
import { MODULES } from './modules';
import { navigationKey } from './state';

const projectId = 'hq-local';
const configured = { configured: true, policy: 'ok', transport: 'loopback-http' } as const;
const props = (destination = 'settings'): ModulePort => ({ context: { id: projectId, name: 'Synthetic project' }, destination,
  appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: vi.fn() });
const socialEnvelope = (): ReferenceEnvelope => ({ version: 1, domain: 'social', projectId, kind: 'draft', entityId: FIXTURE_IDS.autumnBlend,
  title: 'Autumn blend tasting notes', sourceRevision: '3', returnDestination: { domain: 'social', destination: `library/${FIXTURE_IDS.autumnBlend}` } });

function fixture(features: readonly string[] = [FEATURE_HQ_REFERENCES]) {
  const social = createWireStub({ features: [...features], clock: () => new Date() });
  const item = { ...viewItems(VIEW_TODAY)[0]!, title: 'Synthetic reference card', references: [] };
  const planner = createFixturePlanner({ items: [item], settings: { ...EXAMPLE_SETTINGS }, features: [HQ_REFERENCES_FEATURE] });
  const calls: { route: WorkServiceRoute; params: unknown }[] = [];
  const saved: Uint8Array[] = [];
  const exported: Uint8Array[] = [];
  let saveResult = true;
  const mainExport = createWorkExport({ get: () => new URL('http://127.0.0.1:1') }, async bytes => {
    saved.push(bytes.slice()); return { saved: saveResult };
  }, async url => {
    const state = await planner.port.snapshot();
    const bytes = new TextEncoder().encode(url.pathname.endsWith('.md') ? '# Synthetic Planner export\n' : JSON.stringify({ items: state.items, settings: state.settings }));
    exported.push(bytes.slice()); return { ok: true, status: 200, body: bytes, replayed: false };
  });
  const work: WorkServiceTransport = { async call(route, params) {
    calls.push({ route, params: structuredClone(params) });
    if (route === 'export') return mainExport(params);
    const state = await planner.port.snapshot();
    if (route === 'state') return { ok: true, status: 200, body: { items: state.items, settings: state.settings, state_version: state.stateVersion,
      server_time: new Date().toISOString(), api: 2, features: [HQ_REFERENCES_FEATURE], request_retention: { max: 2000, evicted_through_version: 0 } }, replayed: false };
    if (route === 'version') return { ok: true, status: 200, body: { state_version: state.stateVersion }, replayed: false };
    if (route === 'history') return { ok: true, status: 200, body: { history: [] }, replayed: false };
    if (route === 'patch' && 'patch' in params) {
      const fields = normalizeFields(params.patch, { creating: false, features: [HQ_REFERENCES_FEATURE] });
      if (!fields.ok) return { ok: true, status: 400, body: { errors: fields.errors }, replayed: false };
      const { status, ...patch } = fields.value;
      if (status !== undefined) return { ok: true, status: 400, body: { error: 'Use the move route' }, replayed: false };
      const result = await planner.port.patch(params.id, params.revision, patch, params.requestId);
      return { ok: true, status: 200, body: { item: result.item, state_version: result.stateVersion }, replayed: false };
    }
    return { ok: false, kind: 'unavailable' };
  } };
  const services: HqServices = { work, social: social.transport,
    config: { status: async () => configured, set: async () => configured },
    design: { call: async () => ({ ok: false, kind: 'unavailable' }) } };
  Object.defineProperty(window, 'hqServices', { configurable: true, value: services });
  const envelope: ReferenceEnvelope = { version: 1, domain: 'work', projectId, kind: 'item', entityId: item.id,
    title: item.title, sourceRevision: String(item.revision), returnDestination: { domain: 'work', destination: `item/${item.id}` } };
  const noExecution = () => {
    expect(social.callsTo('submitRun')).toEqual([]);
    expect(calls.filter(c => !['state', 'version', 'history', 'patch', 'export'].includes(c.route))).toEqual([]);
  };
  return { services, social, planner, item, envelope, calls, saved, exported, noExecution, setSaved: (value: boolean) => { saveResult = value; } };
}
beforeEach(() => {
  resetWorkSessions(); resetViewMemory(); resetSocialSessions(); localStorage.clear();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { cleanup(); resetWorkSessions(); resetSocialSessions(); resetViewMemory(); vi.restoreAllMocks(); vi.useRealTimers(); Reflect.deleteProperty(window, 'hqServices'); localStorage.clear(); });

it('live Work forwards one stable export client; only explicit JSON/Markdown clicks send and bytes equal Planner', async () => {
  const f = fixture(); const construct = vi.spyOn(exportClient, 'createWorkExportClient'); const mounted = vi.spyOn(Work, 'WorkModule');
  const domains = createServiceDomains(() => f.services);
  const first = render(<domains.Work {...props()} />);
  const json = await screen.findByRole('button', { name: 'Export JSON' });
  expect(construct).toHaveBeenCalledTimes(1);
  const port = construct.mock.results[0]!.value;
  expect(mounted.mock.calls.every(([p]) => p.workExport === port)).toBe(true);
  expect(f.calls.filter(c => c.route === 'export')).toEqual([]);
  fireEvent.click(json);
  await screen.findByText('Planner status 200 · Saved.');
  expect(f.saved[0]).toEqual(f.exported[0]);
  f.setSaved(false);
  fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));
  await screen.findByText('Planner status 200 · Cancelled. Nothing saved.');
  expect(f.saved[1]).toEqual(f.exported[1]);
  expect(f.calls.filter(c => c.route === 'export').map(c => c.params)).toEqual([{ format: 'json' }, { format: 'markdown' }]);
  first.rerender(<domains.Work {...props('board')} />);
  first.unmount(); render(<domains.Work {...props()} />);
  await screen.findByRole('button', { name: 'Export JSON' });
  expect(construct).toHaveBeenCalledTimes(1);
  expect(mounted.mock.calls.every(([p]) => p.workExport === port)).toBe(true);
  expect(f.calls.filter(c => c.route === 'export')).toHaveLength(2);
  expect(document.body.textContent).not.toContain('planning-export.');
  f.noExecution();
});

it('example has no export port and unavailable does not mount Work; neither constructs or sends', async () => {
  const f = fixture(); const construct = vi.spyOn(exportClient, 'createWorkExportClient'); const mounted = vi.spyOn(Work, 'WorkModule');
  const example = createServiceDomains(() => ({ ...f.services, config: { ...f.services.config, status: async () => ({ configured: false, policy: 'ok', transport: null }) } }));
  const view = render(<example.Work {...props()} />);
  const button = await screen.findByRole('button', { name: 'Export JSON' });
  expect(button.hasAttribute('disabled')).toBe(true); fireEvent.click(button);
  expect(mounted.mock.calls.every(([p]) => p.workExport === undefined)).toBe(true);
  view.unmount(); mounted.mockClear();
  const unavailable = createServiceDomains(() => undefined);
  render(<unavailable.Work {...props()} />);
  await screen.findByText('Work: Unavailable — service is not configured correctly.');
  expect(mounted).not.toHaveBeenCalled(); expect(construct).not.toHaveBeenCalled();
  expect(f.calls.filter(c => c.route === 'export')).toEqual([]); f.noExecution();
});

it('actual forwarded export port strips unexpected paths and bytes before returning to the Work renderer', async () => {
  const f = fixture(); const mounted = vi.spyOn(Work, 'WorkModule');
  const services: HqServices = { ...f.services, work: { call: async (route, params) => route === 'export'
    ? { ok: true, status: 201, body: { saved: false, path: '/synthetic/never-render', bytes: [1, 2] }, replayed: false }
    : f.services.work.call(route, params) } };
  const domains = createServiceDomains(() => services); render(<domains.Work {...props()} />);
  await screen.findByRole('button', { name: 'Export JSON' });
  const port = mounted.mock.calls.at(-1)?.[0].workExport; expect(port).toBeDefined();
  const forwarded = vi.spyOn(port!, 'export');
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
  await screen.findByText('Planner status 201 · Cancelled. Nothing saved.');
  expect(await forwarded.mock.results[0]!.value).toEqual({ ok: true, status: 201, body: { saved: false }, replayed: false });
  expect(document.body.textContent).not.toContain('/synthetic/never-render'); f.noExecution();
});

it('registered providers read fresh source revisions, preserve source bytes and expose Design support limits', async () => {
  const f = fixture(); expect(MODULES.work).toBe(SERVICE_DOMAINS.Work);
  expect(REFERENCE_PROVIDERS.map(p => p.domain)).toEqual(['design', 'social', 'work']);
  const work = REFERENCE_PROVIDERS.find(p => p.domain === 'work')!;
  const social = REFERENCE_PROVIDERS.find(p => p.domain === 'social')!;
  const before = JSON.stringify((await f.planner.port.snapshot()).items);
  const first = await work.resolve(f.envelope); expect(first).toMatchObject({ status: 'available', latestRevision: f.envelope.sourceRevision });
  expect(Number.isFinite(Date.parse(first.observedAt))).toBe(true);
  await work.find('', { projectId, limit: 30 });
  expect(JSON.stringify((await f.planner.port.snapshot()).items)).toBe(before);
  await f.planner.port.patch(f.item.id, f.item.revision, { title: 'Changed source card' }, 'fixture-change-001');
  expect(await work.resolve(f.envelope)).toMatchObject({ status: 'changed', latestRevision: String(f.item.revision + 1) });
  const found = await social.find('Autumn', { projectId, limit: 30 }); expect(found).toHaveLength(1);
  expect(await social.resolve(found[0]!)).toMatchObject({ status: 'available' });
  const design = REFERENCE_PROVIDERS.find(p => p.domain === 'design')!;
  // This test renderer has no Design bridge at module construction: all reads unavailable.
  expect(await design.resolve({ ...f.envelope, domain: 'design', kind: 'project' })).toMatchObject({ status: 'unavailable' });
  // Registered Design's projection supports section-only destinations and never claims project identity.
  expect(design.kinds).toContain('project');
  const nav = { projectId: () => projectId, open: vi.fn(), notice: vi.fn() };
  const port = createReferencePort(REFERENCE_PROVIDERS, nav);
  expect(await port.resolve({ ...f.envelope, kind: 'unregistered' })).toMatchObject({ status: 'unknown' });
  expect(nav.open).not.toHaveBeenCalled(); f.noExecution();
});

it('Social draft ↔ Work card open/Back preserves source state; explicit snapshot update and unlink touch only the source', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date());
  const f = fixture();
  const linked = await f.planner.port.patch(f.item.id, f.item.revision,
    { references: [{ id: 'backlink1', kind: 'hq', label: 'Social draft', target: socialEnvelope() }] }, 'fixture-backlink-001');
  expect(linked.item).toBeDefined();
  const target = { ...f.envelope, sourceRevision: String(linked.item!.revision) };
  localStorage.setItem(navigationKey(projectId), JSON.stringify({ domain: 'social', destinations: {
    social: `library/${FIXTURE_IDS.autumnBlend}`, work: 'board', design: 'home', wiki: 'home',
  } }));
  render(<App />);
  const body = await screen.findByLabelText('Body');
  const originalBody = body.getAttribute('value') ?? (body instanceof HTMLTextAreaElement ? body.value : '');
  fireEvent.change(screen.getByLabelText('Serialized HQ reference'), { target: { value: JSON.stringify(target) } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reference' }));
  await waitFor(() => expect(f.social.service.controls.inspect().content.find(d => d.id === FIXTURE_IDS.autumnBlend)?.links).toEqual([target]));
  fireEvent.change(body, { target: { value: `${originalBody} Synthetic unsaved text.` } });
  const beforeOpen = JSON.stringify(f.social.service.controls.inspect());
  const cardBefore = JSON.stringify((await f.planner.port.snapshot()).items);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Synthetic reference card' }));
  await screen.findByRole('textbox', { name: 'Card title' });
  expect(JSON.stringify(f.social.service.controls.inspect())).toBe(beforeOpen);
  fireEvent.click(screen.getByRole('button', { name: /Back to Autumn blend tasting notes/ }));
  await waitFor(() => expect(screen.getByLabelText('Body')).toHaveProperty('value', `${originalBody} Synthetic unsaved text.`));
  expect(JSON.stringify((await f.planner.port.snapshot()).items)).toBe(cardBefore);
  // A clean Work reference opens Social, then Back restores Work's unsaved capture text.
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Domains' })).getByRole('button', { name: 'Work' }));
  fireEvent.click(await screen.findByRole('article', { name: 'Synthetic reference card' }));
  await screen.findByRole('textbox', { name: 'Card title' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Capture to Inbox' }), { target: { value: 'Keep this capture' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Open Autumn blend tasting notes' }));
  await screen.findByLabelText('Body');
  fireEvent.click(screen.getByRole('button', { name: /Back to Synthetic reference card/ }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Capture to Inbox' })).toHaveProperty('value', 'Keep this capture'));
  expect(f.calls.filter(c => c.route === 'export')).toEqual([]);
  expect(JSON.stringify((await f.planner.port.snapshot()).items)).toBe(cardBefore);
  // Target edits never silently change the source envelope.
  await f.planner.port.patch(f.item.id, linked.item!.revision, { title: 'Updated target title' }, 'fixture-target-edit-001');
  vi.setSystemTime(Date.now() + RESOLUTION_MAX_AGE + 1000);
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Domains' })).getByRole('button', { name: 'Social' }));
  await screen.findByLabelText('Body');
  fireEvent.click(screen.getByRole('button', { name: 'Check references' }));
  await screen.findByText('Changed', { exact: true });
  expect(f.social.service.controls.inspect().content.find(d => d.id === FIXTURE_IDS.autumnBlend)?.links).toEqual([target]);
  const targetBytes = JSON.stringify((await f.planner.port.snapshot()).items);
  fireEvent.click(screen.getByRole('button', { name: 'Update snapshot Synthetic reference card' }));
  await waitFor(() => expect(f.social.service.controls.inspect().content.find(d => d.id === FIXTURE_IDS.autumnBlend)?.links?.[0]?.title).toBe('Updated target title'));
  fireEvent.click(screen.getByRole('button', { name: 'Unlink Updated target title' }));
  await waitFor(() => expect(f.social.service.controls.inspect().content.find(d => d.id === FIXTURE_IDS.autumnBlend)?.links).toEqual([]));
  expect(JSON.stringify((await f.planner.port.snapshot()).items)).toBe(targetBytes);
  expect(f.calls.filter(c => c.route === 'export')).toEqual([]); f.noExecution();
  vi.useRealTimers();
});

it('all eight statuses render with observedAt and fingerprints; mismatch and stale observations never navigate', async () => {
  const f = fixture(); const work = REFERENCE_PROVIDERS.find(p => p.domain === 'work')!;
  const social = REFERENCE_PROVIDERS.find(p => p.domain === 'social')!;
  const outcomes = [await work.resolve(f.envelope)];
  const edited = await f.planner.port.patch(f.item.id, f.item.revision, { title: 'Changed' }, 'fixture-status-edit');
  outcomes.push(await work.resolve(f.envelope));
  await f.planner.port.setArchived(f.item.id, edited.item!.revision, true, 'fixture-status-archive');
  outcomes.push(await work.resolve(f.envelope), await work.resolve({ ...f.envelope, entityId: 'missing-item' }));
  const moved = fixture([FEATURE_HQ_BRAND_PROJECT]);
  outcomes.push(await social.resolve(socialEnvelope()));
  moved.social.service.controls.failNext('snapshot', { kind: 'forbidden' }); outcomes.push(await social.resolve(socialEnvelope()));
  moved.social.service.controls.setUnavailable(true); outcomes.push(await social.resolve(socialEnvelope()));
  const open = vi.fn(); const notice = vi.fn();
  const port = createReferencePort(REFERENCE_PROVIDERS, { projectId: () => projectId, open, notice });
  outcomes.push(await port.resolve({ ...f.envelope, kind: 'unregistered' }));
  expect(outcomes.map(o => o.status)).toEqual(REFERENCE_STATUSES);
  for (const resolution of outcomes) {
    expect(Number.isFinite(Date.parse(resolution.observedAt))).toBe(true);
    const view = render(<ReferenceChip envelope={f.envelope} resolution={resolution} projectId={projectId} now={Date.now()} onOpen={vi.fn()} />);
    expect(view.container.querySelector('[data-reference-status]')?.getAttribute('data-reference-status')).toBe(resolution.status);
    expect(view.container.querySelector('time')?.getAttribute('datetime')).toBe(resolution.observedAt);
    expect(view.container.textContent).toContain(`Snapshot revision ${f.envelope.sourceRevision}`); view.unmount();
  }
  const context = { label: 'Source', to: { domain: 'social', destination: 'library' } } as const;
  port.open({ ...f.envelope, projectId: 'another-project' }, context);
  expect(open).not.toHaveBeenCalled(); expect(notice).toHaveBeenCalledTimes(1);
  const stale = render(<ReferenceChip envelope={f.envelope} resolution={outcomes[0]} projectId={projectId} now={Date.parse(outcomes[0]!.observedAt) + RESOLUTION_MAX_AGE + 1} onOpen={open} />);
  expect(stale.container.querySelector('[data-reference-status]')?.getAttribute('data-reference-status')).toBe('unknown');
  fireEvent.click(screen.getByRole('button', { name: 'Open Synthetic reference card' })); expect(open).not.toHaveBeenCalled();
  f.noExecution(); moved.noExecution();
});

it('source-owned links enforce dedup and 30 maximum; Planner export/import preserves exact envelopes', async () => {
  const f = fixture();
  let links: ReferenceEnvelope[] = [];
  for (let i = 0; i < 30; i++) links = addDraftLink(links, { ...f.envelope, entityId: `item-${i}` }, projectId);
  expect(links).toHaveLength(30);
  expect(() => addDraftLink(links, { ...links[0]!, title: 'Different snapshot' }, projectId)).toThrow('Already linked');
  expect(() => addDraftLink(links, f.envelope, projectId)).toThrow('30-link limit');
  expect(() => addDraftLink([], { ...f.envelope, projectId: 'another' }, projectId)).toThrow('read-only');
  const refs = links.map((target, i) => ({ id: `link-${i.toString().padStart(3, '0')}`, kind: 'hq' as const, label: target.title, target }));
  const valid = normalizeFields({ references: refs }, { creating: false, features: [HQ_REFERENCES_FEATURE] }); expect(valid.ok).toBe(true);
  expect(normalizeFields({ references: [...refs, refs[0]] }, { creating: false, features: [HQ_REFERENCES_FEATURE] }).ok).toBe(false);
  await f.planner.port.patch(f.item.id, f.item.revision, { references: refs }, 'fixture-export-links');
  await f.services.work.call('export', { format: 'json' });
  expect(f.saved[0]).toEqual(f.exported[0]);
  const imported = JSON.parse(new TextDecoder().decode(f.saved[0]));
  const hydrated = createFixturePlanner({ items: imported.items, settings: imported.settings, features: [HQ_REFERENCES_FEATURE] });
  const roundTrip = (await hydrated.port.snapshot()).items[0]!.references;
  expect(JSON.stringify(roundTrip)).toBe(JSON.stringify(refs));
  for (const ref of roundTrip) { expect(ref.kind).toBe('hq'); if (ref.kind === 'hq') expect(parseReference(ref.target)).toEqual(ref.target); }
  f.noExecution();
});

it('Social links remain visibly unsaved without qualified service capability', async () => {
  const f = fixture([]); const domains = createServiceDomains(() => f.services);
  const refs = createReferencePort(REFERENCE_PROVIDERS, { projectId: () => projectId, open: vi.fn(), notice: vi.fn() });
  render(<domains.Social {...props(`library/${FIXTURE_IDS.autumnBlend}`)} references={refs} />);
  await screen.findByText(UNSAVED_LINKS);
  expect(screen.getByRole('button', { name: 'Link to…' }).hasAttribute('disabled')).toBe(true);
  expect(f.social.callsTo('saveContent')).toEqual([]); expect(f.calls.filter(c => c.route === 'export')).toEqual([]); f.noExecution();
});


it('bridged Design project kind stays unknown, section destinations are bounded, and failed reads never list fakes', async () => {
  fixture(); vi.resetModules();
  const publicDesign = await import('../../../modules/design/app/index.ts');
  const provider = publicDesign.createDesignReferenceProvider(publicDesign.designReferenceReads, () => new Date().toISOString());
  expect(await provider.resolve({ ...socialEnvelope(), domain: 'design', kind: 'project' })).toMatchObject({ status: 'unknown' });
  await expect(publicDesign.designReferenceReads.list(projectId)).rejects.toBeDefined();
  await expect(provider.find('', { projectId, limit: 30 })).rejects.toBeDefined();
  // The predecessor's bridge-backed mapping suite pins projects/projects,
  // requests/requests and resources/references. These are section destinations,
  // never an entity-specific route or a claim of canonical project support.
});
