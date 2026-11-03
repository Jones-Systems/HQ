import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toastStore } from '@hq/ui';
import type { ModulePort } from '@hq/contracts';
import {
  FIXTURE_PROJECT_ID, recordCalls, resetSocialSessions, socialSession, type FixtureOptions, type RecordedPort,
} from '../../core';
import { createWorkbenchFixture } from '../../workbench/fixtures/examples';
import { toolDraft, workbenchView } from '../../workbench/state';
import { NOT_SAVED } from '../sources/ImportDetail';
import { EXAMPLE_FILE_NAMES } from '../sources/examples';
import { SOURCES_PROPOSED, SocialDomain } from '..';

const NOW = () => new Date('2026-10-20T12:00:00Z');
/** The proposed source-registry feature: advertised or not, HQ reads no registry. */
const FEATURE_HQ_SOURCES = 'hq-sources-v1';
const CONTEXT = { id: FIXTURE_PROJECT_ID, name: 'Larkspur project' };

afterEach(() => {
  cleanup();
  resetSocialSessions();
  toastStore.dismiss();
  localStorage.removeItem('hq.social.sidebar.v1');
});

interface Setup {
  readonly recorded: RecordedPort;
  readonly navigate: ReturnType<typeof vi.fn<(destination: string) => void>>;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly destination: () => string;
  readonly remount: () => void;
}

function setup({ destination = 'sources', example = true, features }: { destination?: string; example?: boolean; features?: string[] } = {}): Setup {
  const fixture = createWorkbenchFixture({ ...(features ? { features } : {}), clock: NOW } satisfies FixtureOptions);
  const recorded = recordCalls(fixture.port);
  const navigate = vi.fn<(destination: string) => void>();
  let current = destination;
  let bump: () => void = () => {};
  function Shell() {
    const [where, setWhere] = useState(destination);
    const [generation, setGeneration] = useState(0);
    current = where;
    bump = () => act(() => setGeneration((value) => value + 1));
    const port: ModulePort = {
      context: CONTEXT, destination: where, appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } },
      navigate: (next) => { navigate(next); setWhere(next); },
    };
    return <SocialDomain key={generation} {...port} port={recorded.port} {...(example ? { example: true } : {})} now={NOW} />;
  }
  render(<Shell />);
  return { recorded, navigate, user: userEvent.setup(), destination: () => current, remount: () => bump() };
}

const effects = (s: Setup) => s.recorded.calls().filter((call) => call.class === 'execution' || (call.class === 'content' && call.method !== 'snapshot'));
const chooser = () => screen.getByLabelText('Choose JSON or JSON Lines files to check', { selector: 'input' });
const file = (content: string, name: string) => new File([content], name, { type: 'application/json' });

const FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1', title: 'A fictional feed', as_of: '2026-10-01',
  items: [{ id: 'a1', title: 'First fictional item' }, { id: 'a2', title: 'Second fictional item' }],
}, null, 2);

describe('Sources import desk', () => {
  it('checks a valid file on this device, labels it unsaved and offers the workbenches that read it', async () => {
    const s = setup();
    await s.user.upload(chooser(), file(FEED, 'feed.json'));

    // The result takes focus, says what was found and that nothing was saved or sent.
    const heading = await screen.findByRole('heading', { level: 2, name: 'feed.json' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const detail = within(heading.closest('article')!);
    expect(detail.getByText('Valid')).toBeTruthy();
    expect(detail.getByText(/Valid JSON · 2 records\. Checked on this device; nothing was uploaded or sent\./u)).toBeTruthy();
    expect(detail.getByText('Data as of').nextElementSibling!.textContent).toBe('2026-10-01');
    expect(detail.getByText('Saved').nextElementSibling!.textContent).toBe(NOT_SAVED);
    expect(NOT_SAVED).toBe('Not saved: needs the source registry');
    expect(screen.getByRole('heading', { level: 2, name: 'This session' })).toBeTruthy();

    // A JSON Feed is recognized for the signal inbox.
    expect(detail.getByRole('button', { name: /^Open in Signal inbox/u })).toBeTruthy();
    expect(effects(s)).toHaveLength(0);
    expect(s.navigate).not.toHaveBeenCalled();
  });

  it('opens a recognized file in its workbench: loads the form, goes there, and runs nothing', async () => {
    const s = setup();
    await s.user.upload(chooser(), file(FEED, 'feed.json'));
    await s.user.click(await screen.findByRole('button', { name: /^Open in Signal inbox/u }));

    expect(s.destination()).toBe('workbenches/x-intelligence');
    const draft = toolDraft(workbenchView(socialSession(FIXTURE_PROJECT_ID).getState()), 'x-intelligence', NOW());
    expect(draft.mode).toBe('form');
    expect(draft.form.tool).toBe('x-intelligence');
    if (draft.form.tool === 'x-intelligence') {
      expect(draft.form.fields.feed?.origin).toMatchObject({ kind: 'file', name: 'feed.json' });
      expect(draft.form.fields.feed?.value).toStrictEqual(JSON.parse(FEED));
    }
    const toasts = toastStore.getSnapshot();
    expect(toasts.map((toast) => toast.title)).toContain('Loaded feed.json into Signal inbox');
    expect(toasts.find((toast) => toast.id === 'social-handoff:x-intelligence')?.description).toMatch(/^Nothing has run\./u);
    // Loading a form is a local edit: no execution and no content write, and the run still needs a click.
    expect(effects(s)).toHaveLength(0);
  });

  it('reports a syntax error with its line and column, moves focus to it, and keeps nothing', async () => {
    const s = setup();
    await s.user.upload(chooser(), file('{\n  "items": [\n    { "id": "a" }\n    { "id": "b" }\n  ]\n}\n', 'broken.json'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Can't import this file/u);
    expect(alert.textContent).toMatch(/broken\.json/u);
    expect(alert.textContent).toMatch(/line 4, column 5/iu);
    expect(alert.textContent).toContain('Nothing was saved or sent.');
    await waitFor(() => expect(alert.closest('.sd-problem')).toBe(document.activeElement));
    expect(screen.queryByRole('heading', { level: 2, name: 'This session' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'How it works' })).toBeTruthy();
    expect(effects(s)).toHaveLength(0);
  });

  it('turns away blank, empty and oversized files with a plain reason that names the file and never echoes its contents', async () => {
    const s = setup();
    for (const [upload, reason] of [
      [file('   \n', 'blank.json'), 'This file is empty: it has no JSON in it.'],
      [file('', 'zero.json'), 'This file is empty.'],
      [file(`"${'x'.repeat(2_000_001)}"`, 'large.json'), 'This file is larger than 2 MB. The Social service accepts at most 2,000,000 bytes per run.'],
    ] as const) {
      await s.user.upload(chooser(), upload);
      const alert = await screen.findByRole('alert');
      await waitFor(() => expect(alert.textContent).toContain(reason));
      expect(alert.textContent).toContain(upload.name);
      expect(alert.textContent).toContain('Nothing was saved or sent.');
      expect(alert.textContent).not.toContain('xxxx');
    }
    expect(screen.queryByRole('heading', { level: 2, name: 'This session' })).toBeNull();
    expect(effects(s)).toHaveLength(0);
  });

  it('keeps imports for the session across a domain remount, and removes one on request', async () => {
    const s = setup();
    await s.user.upload(chooser(), file(FEED, 'feed.json'));
    await screen.findByRole('heading', { level: 2, name: 'feed.json' });

    s.remount();
    const again = await screen.findByRole('heading', { level: 2, name: 'feed.json' });
    expect(again).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'This session' })).toBeTruthy();

    await s.user.click(screen.getByRole('button', { name: 'Remove from this session' }));
    expect(screen.queryByRole('heading', { level: 2, name: 'feed.json' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'How it works' })).toBeTruthy();
  });

  it('checks a file dropped on the drop zone and reacts to drag-over', async () => {
    setup();
    const zone = screen.getByRole('region', { name: 'Drop a file to check it' });
    const dragged = { dataTransfer: { types: ['Files'], files: [] as File[], dropEffect: 'none' } };
    fireEvent.dragEnter(zone, dragged);
    expect(zone.hasAttribute('data-dragging')).toBe(true);
    expect(within(zone).getByText('Release to check it here.')).toBeTruthy();
    fireEvent.dragLeave(zone, { ...dragged, relatedTarget: document.body });
    expect(zone.hasAttribute('data-dragging')).toBe(false);

    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file(FEED, 'dropped.json')] } });
    expect(await screen.findByRole('heading', { level: 2, name: 'dropped.json' })).toBeTruthy();
    expect(zone.hasAttribute('data-dragging')).toBe(false);
  });

  it('offers the fictional example files in the example workspace only', async () => {
    const s = setup();
    expect(EXAMPLE_FILE_NAMES).toStrictEqual(['example-signal-items.json', 'example-broken-feed.json']);
    await s.user.click(screen.getByRole('button', { name: 'Use fictional example' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'example-signal-items.json' })).toBeTruthy();
    expect(screen.getByText('Example data', { selector: '.sd-detail .sx-tag' })).toBeTruthy();
    await s.user.click(screen.getByRole('button', { name: 'Try a broken file' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/line 5, column 5/iu);
    cleanup();
    resetSocialSessions();

    setup({ example: false });
    expect(screen.queryByRole('button', { name: 'Use fictional example' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try a broken file' })).toBeNull();
  });

  it('lists places a bare list could go as the user’s choice, not as a recognized match', async () => {
    const s = setup();
    await s.user.upload(chooser(), file(JSON.stringify([{ a: 1 }, { a: 2 }]), 'rows.json'));
    const heading = await screen.findByRole('heading', { level: 2, name: 'rows.json' });
    const detail = within(heading.closest('article')!);
    expect(detail.getByText(/can't tell from this file's contents which workbench reads it/u)).toBeTruthy();
    expect(detail.getByText(/^Where it could go \(\d+\)$/u)).toBeTruthy();
    expect(effects(s)).toHaveLength(0);
  });

  it('keeps saved sources proposed and calls nothing, even when the service advertises hq-sources-v1', async () => {
    const plain = setup();
    expect(screen.getByText(SOURCES_PROPOSED)).toBeTruthy();
    expect(plain.recorded.calls().every((call) => call.method === 'snapshot')).toBe(true);
    cleanup();
    resetSocialSessions();

    const advertised = setup({ features: [FEATURE_HQ_SOURCES] });
    expect(await screen.findByText(/hq-sources-v1, but HQ can't read a source registry yet/u)).toBeTruthy();
    expect(screen.queryByText(SOURCES_PROPOSED)).toBeNull();
    expect(advertised.recorded.calls().every((call) => call.method === 'snapshot')).toBe(true);
  });
});
