import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_IDS, createFixtureWorkspace, recordCalls, resetSocialSessions, socialSession, useSocialSession, workspaceSnapshot,
  type FixtureOptions, type RecordedPort,
} from '../../core';
import { BrandManager, SocialContent } from '..';

afterEach(() => {
  cleanup();
  resetSocialSessions();
  localStorage.removeItem('hq.social.library-panel.v1');
  vi.restoreAllMocks();
});

const NOW = () => new Date('2026-10-20T12:00:00Z');

function setup(destination = 'library', options: FixtureOptions = {}) {
  const fixture = createFixtureWorkspace(options);
  const recorded = recordCalls(fixture.port);
  const visited: string[] = [];
  let go: (destination: string) => void = () => undefined;
  function Host({ initial }: { initial: string }) {
    const [current, setCurrent] = useState(initial);
    go = (next) => act(() => setCurrent(next));
    return <SocialContent port={recorded.port} projectId="fixture-project" destination={current} now={NOW} navigate={(next) => { visited.push(next); setCurrent(next); }} />;
  }
  const view = render(<Host initial={destination} />);
  return { ...fixture, recorded, visited, view, go: (next: string) => go(next), Host, user: userEvent.setup() };
}

function methods(recorded: RecordedPort) {
  return recorded.calls().map((call) => call.method);
}

function expectNoExecution(recorded: RecordedPort) {
  expect(recorded.callsOf('execution')).toEqual([]);
}

describe('Social content: states', () => {
  it('shows loading, then the library from one workspace read', async () => {
    const { recorded } = setup();
    expect(screen.getByText('Loading the Social workspace…')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ })).toBeTruthy();
    expect(screen.queryByText('Summer iced tea recap')).toBeNull();
    expect(screen.getByText(/Last synced/)).toBeTruthy();
    expect(methods(recorded)).toEqual(['snapshot']);
  });

  it('shows an empty library with one primary action', async () => {
    setup('library', { seed: { brands: [{ id: 'default', name: 'My workspace' }], content: [], runs: [] } });
    expect(await screen.findByText('No drafts yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New draft' }).length).toBeGreaterThan(0);
  });

  it('shows an unreachable service without data, and recovers on Try again', async () => {
    const fixture = createFixtureWorkspace();
    fixture.controls.setUnavailable(true);
    render(<SocialContent port={fixture.port} projectId="p" destination="library" navigate={() => undefined} />);
    expect(await screen.findByText('The Social service is unreachable')).toBeTruthy();
    fixture.controls.setUnavailable(false);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ })).toBeTruthy();
  });

  it('shows a load error that is not an outage as an error', async () => {
    const fixture = createFixtureWorkspace();
    fixture.controls.failNext('snapshot', { kind: 'forbidden' });
    render(<SocialContent port={fixture.port} projectId="p" destination="library" navigate={() => undefined} />);
    expect(await screen.findByText('The workspace could not be loaded')).toBeTruthy();
  });

  it('keeps stale data visible, labelled offline, and pauses saving', async () => {
    const { controls, recorded, user } = setup(`library/${FIXTURE_IDS.autumnBlend}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' kept');
    controls.setUnavailable(true);
    await act(() => socialSession('fixture-project').load(recorded.port));
    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(screen.getByText(/showing data last synced/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toMatch(/ kept$/u);
    controls.setUnavailable(false);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.queryByText('Offline')).toBeNull());
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Social content: library and editor', () => {
  it('creates a draft with one save and opens it by its stored ID', async () => {
    const { recorded, visited, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'New draft' }));
    expect(visited.at(-1)).toBe('library/new');
    expect(await screen.findByRole('heading', { name: 'New draft' })).toBeTruthy();
    await user.type(screen.getByLabelText('Title'), '  Cupping hour invitation  ');
    await user.type(screen.getByLabelText('Body'), 'Bring a mug.');
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(visited.at(-1)).toMatch(/^library\/[0-9a-f]{32}$/u));
    expect(methods(recorded)).toEqual(['saveDraft']);
    expect(await screen.findByRole('heading', { name: 'Edit draft' })).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Cupping hour invitation');
    expect(screen.getByText(/Saved v1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Cupping hour invitation/ })).toBeTruthy();
    expectNoExecution(recorded);
  });

  it('shows the service validation message on the field and keeps the text', async () => {
    const { user } = setup('library/new');
    await screen.findByRole('heading', { name: 'New draft' });
    await user.type(screen.getByLabelText('Body'), 'Text without a title');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Title must be text, 1–200 characters');
    expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('Text without a title');
  });

  it('shows saving while the save is in flight', async () => {
    let release: () => void = () => undefined;
    let hold = false;
    const { user } = setup(`library/${FIXTURE_IDS.openDay}`, { delay: () => (hold ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve()) });
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' Bring a friend.');
    hold = true;
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findAllByText('Saving…')).not.toHaveLength(0);
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).readOnly).toBe(true);
    hold = false;
    await act(async () => release());
    expect(await screen.findByText(/Saved v2/)).toBeTruthy();
  });

  it('handles a version conflict without overwriting, then saves mine as a copy', async () => {
    const { controls, recorded, visited, user } = setup(`library/${FIXTURE_IDS.autumnBlend}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    const body = screen.getByLabelText('Body');
    await user.clear(body);
    await user.type(body, 'My rewrite');
    const theirs = controls.editElsewhere(FIXTURE_IDS.autumnBlend, { body: 'Their rewrite' });
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Changed elsewhere.')).toBeTruthy();
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('My rewrite');
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toEqual(theirs);

    await user.click(screen.getByRole('button', { name: 'Save mine as a copy' }));
    await waitFor(() => expect(visited.at(-1)).not.toBe(`library/${FIXTURE_IDS.autumnBlend}`));
    const copy = controls.inspect().content.find((draft) => draft.body === 'My rewrite')!;
    expect(copy.id).not.toBe(FIXTURE_IDS.autumnBlend);
    expect(visited.at(-1)).toBe(`library/${copy.id}`);
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toEqual(theirs);
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });

  it('loads their version only after confirmation', async () => {
    const { controls, user } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' mine');
    controls.editElsewhere(FIXTURE_IDS.openDay, { body: 'Theirs' });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await user.click(await screen.findByRole('button', { name: 'Load their version' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Load their version' }));
    await waitFor(() => expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('Theirs'));
    expect(screen.queryByText('Changed elsewhere.')).toBeNull();
  });

  it('keeps my text and says so when loading their version fails', async () => {
    const { controls, user } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' mine');
    controls.editElsewhere(FIXTURE_IDS.openDay, { body: 'Theirs' });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await user.click(await screen.findByRole('button', { name: 'Load their version' }));
    controls.setUnavailable(true);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Load their version' }));
    expect(await screen.findByText(/Could not load their version/u)).toBeTruthy();
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toMatch(/ mine$/u);
    expect(screen.getByText('Changed elsewhere.')).toBeTruthy();
  });

  it('archives and restores with one versioned save each', async () => {
    const { controls, recorded, user } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByRole('button', { name: 'Restore' });
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.openDay)).toMatchObject({ archived: 1, version: 2 });
    expect(screen.queryByRole('button', { name: /Sourdough starter open day/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Archived' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(await screen.findByRole('button', { name: 'Actions for Sourdough starter open day' }));
    await user.click(screen.getByRole('menuitem', { name: 'Restore' }));
    await screen.findByText('Restored “Sourdough starter open day”.');
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.openDay)).toMatchObject({ archived: 0, version: 3 });
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });

  it('keeps the archive flag unchanged when archiving hits a conflict', async () => {
    const { controls, user } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    controls.editElsewhere(FIXTURE_IDS.openDay, { body: 'Theirs' });
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Changed elsewhere.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.openDay)?.archived).toBe(0);
  });

  it('keeps unsaved text across a domain switch (remount) without reloading', async () => {
    const { recorded, view, Host, user } = setup(`library/${FIXTURE_IDS.slowerRhythm}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), 'Half-written thought');
    expect(screen.getByText('Unsaved changes', { selector: '[role="status"]' })).toBeTruthy();
    view.unmount(); // The shell remounts the module on every domain switch.
    render(<Host initial={`library/${FIXTURE_IDS.slowerRhythm}`} />);
    expect((await screen.findByLabelText('Body') as HTMLTextAreaElement).value).toBe('Half-written thought');
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
    expect(methods(recorded)).toEqual(['snapshot']);
    expectNoExecution(recorded);
  });

  it('reports an unknown save result and checks it with one read, never re-saving', async () => {
    const { controls, recorded, user } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' extra');
    controls.failNext('saveDraft', { kind: 'unknown', attemptedAt: '2026-10-20T12:00:00Z' });
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Save result unknown')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/the save did not happen/)).toBeTruthy();
    expect(methods(recorded)).toEqual(['saveDraft', 'snapshot']);
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toMatch(/ extra$/u);
  });

  it('refuses Save and Ctrl+S after an unknown save until a check says the save did not happen', async () => {
    const { controls, recorded, user } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' extra');
    controls.failNext('saveDraft', { kind: 'unknown', attemptedAt: '2026-10-20T12:00:00Z' });
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Save result unknown')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await user.click(screen.getByLabelText('Body'));
    await user.keyboard('{Control>}s{/Control}');
    expect(methods(recorded)).toEqual(['saveDraft']);
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/the save did not happen/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(methods(recorded)).toEqual(['saveDraft', 'snapshot', 'saveDraft']));
  });

  it('keeps Close unavailable and the text fields focusable while a save is in flight', async () => {
    let release: () => void = () => undefined;
    let gate: Promise<void> = Promise.resolve();
    const { controls, user } = setup(`library/${FIXTURE_IDS.openDay}`, { delay: () => gate });
    await screen.findByRole('heading', { name: 'Edit draft' });
    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.type(body, ' extra');
    gate = new Promise((resolve) => { release = resolve; });
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Saving…', { selector: '[role="status"]' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
    expect(body.disabled).toBe(false);
    expect(body.readOnly).toBe(true);
    expect(document.activeElement).toBe(body);
    act(() => release());
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.openDay)?.version).toBe(2));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('labels a citation as not saved when the service lacks hq-references-v1, and refuses to drop it', async () => {
    const citation = {
      version: 1 as const, domain: 'social' as const, projectId: 'fixture-project', kind: 'run', entityId: FIXTURE_IDS.exampleRun,
      title: 'Signal inbox · Neighborhood tea', returnDestination: { domain: 'social' as const, destination: 'library' }, sourceRevision: '2026-10-18',
    };
    socialSession('fixture-project').openEditor('new', null, { title: 'From research', body: '', brand_id: 'default', channel: 'General', planned_date: '', archived: 0, links: [citation] });
    const { recorded, user } = setup('library/new', { features: [] });
    await screen.findByRole('heading', { name: 'New draft' });
    expect(screen.getByText('Linked across HQ')).toBeTruthy();
    expect(screen.getByText('Not saved')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot save links yet');
    expect(recorded.calls().filter((call) => call.outcome === 'ok').map((call) => call.method)).toEqual(['snapshot']);
  });

  it('shows stored links read-only when the service supports them', async () => {
    setup(`library/${FIXTURE_IDS.steepingThread}`);
    expect(await screen.findByText('Linked across HQ')).toBeTruthy();
    expect(screen.getByText('Plan the cupping hour')).toBeTruthy();
  });
});

describe('Social content: brands', () => {
  it('lists the built-in brand as present and adds a brand with one call and one read', async () => {
    const fixture = createFixtureWorkspace();
    const recorded = recordCalls(fixture.port);
    const session = socialSession('brands');
    await session.load(recorded.port);
    recorded.clear();
    const user = userEvent.setup();
    function Brands() {
      const { state } = useSocialSession('brands');
      const snapshot = workspaceSnapshot(state.workspace);
      return snapshot ? <BrandManager session={session} port={recorded.port} snapshot={snapshot} /> : null;
    }
    render(<Brands />);
    const list = screen.getByRole('list', { name: 'Brands' });
    expect(within(list).getByText('My workspace').closest('li')?.textContent).toContain('Built in');

    await user.click(screen.getByRole('button', { name: 'Add brand' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Brand name must be text, 1–80 characters');
    expect(recorded.calls()).toEqual([]);

    await user.type(screen.getByLabelText('New brand name'), '  Fernhill Seed Library ');
    await user.click(screen.getByRole('button', { name: 'Add brand' }));
    expect(await screen.findByText('Added Fernhill Seed Library.')).toBeTruthy();
    expect(await within(list).findByText('Fernhill Seed Library')).toBeTruthy();
    expect(methods(recorded)).toEqual(['addBrand', 'snapshot']);
    expectNoExecution(recorded);
  });
});


describe('Library panel layout', () => {
  it('remembers the list width and preserves unsaved editor text while the list is closed', async () => {
    const { user, recorded, view, Host } = setup(`library/${FIXTURE_IDS.autumnBlend}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' still editing');
    const grip = screen.getByRole('separator', { name: 'Resize draft list' });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(grip.getAttribute('aria-valuenow')).toBe('348');
    grip.focus();
    fireEvent.keyDown(grip, { key: 'Home' });
    expect(document.activeElement).toBe(grip);
    expect(screen.queryByRole('list', { name: 'Drafts' })).toBeNull();
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toMatch(/ still editing$/u);
    view.unmount();
    render(<Host initial={`library/${FIXTURE_IDS.autumnBlend}`} />);
    await screen.findByRole('heading', { name: 'Edit draft' });
    const restoredGrip = screen.getByRole('separator', { name: 'Resize draft list' });
    expect(restoredGrip.getAttribute('aria-valuenow')).toBe('0');
    await user.click(screen.getByRole('button', { name: 'Show draft list' }));
    expect(restoredGrip.getAttribute('aria-valuenow')).toBe('348');
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toMatch(/ still editing$/u);
    expect(methods(recorded)).toEqual(['snapshot']);
    expectNoExecution(recorded);
  });
});
