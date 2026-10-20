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
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toMatch(/ kept$/u);
    controls.setUnavailable(false);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.queryByText('Offline')).toBeNull());
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(visited.at(-1)).toMatch(/^library\/[0-9a-f]{32}$/u));
    expect(methods(recorded)).toEqual(['saveDraft']);
    expect(await screen.findByRole('heading', { name: 'Edit draft' })).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Cupping hour invitation');
    expect(screen.getByText(/Saved · version 1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Cupping hour invitation/ })).toBeTruthy();
    expectNoExecution(recorded);
  });

  it('shows the service validation message on the field and keeps the text', async () => {
    const { user } = setup('library/new');
    await screen.findByRole('heading', { name: 'New draft' });
    await user.type(screen.getByLabelText('Body'), 'Text without a title');
    await user.click(screen.getByRole('button', { name: 'Save' }));
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('Saving…')).not.toHaveLength(0);
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).disabled).toBe(true);
    hold = false;
    await act(async () => release());
    expect(await screen.findByText(/Saved · version 2/)).toBeTruthy();
  });

  it('handles a version conflict without overwriting, then saves mine as a copy', async () => {
    const { controls, recorded, visited, user } = setup(`library/${FIXTURE_IDS.autumnBlend}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    const body = screen.getByLabelText('Body');
    await user.clear(body);
    await user.type(body, 'My rewrite');
    const theirs = controls.editElsewhere(FIXTURE_IDS.autumnBlend, { body: 'Their rewrite' });
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Save' }));
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Load their version' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Load their version' }));
    await waitFor(() => expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('Theirs'));
    expect(screen.queryByText('Changed elsewhere.')).toBeNull();
  });

  it('archives and restores with one versioned save each', async () => {
    const { controls, recorded, user } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByRole('button', { name: 'Restore' });
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.openDay)).toMatchObject({ archived: 1, version: 2 });
    expect(screen.queryByRole('button', { name: /Sourdough starter open day/ })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Show'), 'archived');
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Save result unknown')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/the save did not happen/)).toBeTruthy();
    expect(methods(recorded)).toEqual(['saveDraft', 'snapshot']);
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toMatch(/ extra$/u);
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot save links yet');
    expect(recorded.calls().filter((call) => call.outcome === 'ok').map((call) => call.method)).toEqual(['snapshot']);
  });

  it('shows stored links read-only when the service supports them', async () => {
    setup(`library/${FIXTURE_IDS.steepingThread}`);
    expect(await screen.findByText('Linked across HQ')).toBeTruthy();
    expect(screen.getByText('Plan the cupping hour')).toBeTruthy();
  });
});

describe('Social content: calendar', () => {
  it('states that planned dates are editorial intent and never says scheduled', async () => {
    setup('calendar/2026-10');
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy();
    expect(screen.getByText(/Planned dates are editorial intent/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/scheduled|published|connected/iu);
  });

  it('moves a draft by keyboard with exactly one versioned save, and undoes it', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10');
    const chip = await screen.findByRole('button', { name: /^Autumn blend tasting notes/ });
    recorded.clear();
    chip.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Planned date'), { target: { value: '2026-10-28' } });
    await user.click(within(dialog).getByRole('button', { name: 'Move to date' }));
    expect(await screen.findByText('Moved “Autumn blend tasting notes” to 28 Oct 2026.')).toBeTruthy();
    expect(methods(recorded)).toEqual(['saveDraft']);
    expect(recorded.calls()[0]!.args[0]).toMatchObject({ id: FIXTURE_IDS.autumnBlend, version: 3, planned_date: '2026-10-28', body: 'Three cups, three steeping times. Which one tastes like October?' });
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-28', version: 4 });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText(/Undone/)).toBeTruthy();
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-24', version: 5 });
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });

  it('clears a date into the No date yet tray', async () => {
    const { controls, user } = setup('calendar/2026-10');
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear date' }));
    expect(await screen.findByText('Cleared the planned date of “Autumn blend tasting notes”.')).toBeTruthy();
    const tray = screen.getByRole('complementary', { name: 'No date yet' });
    expect(within(tray).getByRole('button', { name: /^Autumn blend tasting notes/ })).toBeTruthy();
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planned_date).toBe('');
  });

  it('moves a draft by pointer drag with one versioned save', async () => {
    const { controls, recorded } = setup('calendar/2026-10');
    const chip = await screen.findByRole('button', { name: /^Steeping times thread/ });
    const target = document.querySelector('[data-drop-date="2026-10-15"]')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    recorded.clear();
    fireEvent.pointerDown(chip, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.click(chip);
    expect(await screen.findByText('Moved “Steeping times thread” to 15 Oct 2026.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(methods(recorded)).toEqual(['saveDraft']);
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.steepingThread)?.planned_date).toBe('2026-10-15');
  });

  it('refuses to move a draft with unsaved edits instead of conflicting with them', async () => {
    const { recorded, go, user } = setup(`library/${FIXTURE_IDS.autumnBlend}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' (draft edit)');
    go('calendar/2026-10');
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText('Planned date'), { target: { value: '2026-10-30' } });
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Move to date' }));
    expect(await screen.findByText(/has unsaved edits in the Library/)).toBeTruthy();
    expect(recorded.calls()).toEqual([]);
  });

  it('reports a move conflict without an Undo', async () => {
    const { controls, user } = setup('calendar/2026-10');
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    controls.editElsewhere(FIXTURE_IDS.autumnBlend, { title: 'Autumn blend tasting notes' });
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear date' }));
    expect(await screen.findByText(/Not moved: This draft changed in another window/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('navigates months by destination only', async () => {
    const { recorded, visited, user } = setup('calendar/2026-12');
    await user.click(await screen.findByRole('button', { name: 'Next month' }));
    expect(visited.at(-1)).toBe('calendar/2027-01');
    expect(await screen.findByRole('heading', { name: 'January 2027' })).toBeTruthy();
    expect(methods(recorded)).toEqual(['snapshot']);
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

import { FEATURE_HQ_EDITORIAL_TIMEBOX, PortFailure, fictionalSeed, type Draft } from '../../core';
import { changeDraft } from '../actions';

describe('Social calendar service-backed timeboxes', () => {
  async function showView(user: ReturnType<typeof userEvent.setup>, name: 'Month' | 'Week' | 'Day') {
    const group = await screen.findByRole('group', { name: 'Calendar view' });
    for (let click = 0; click < 3; click += 1) {
      if (within(group).queryByRole('button', { name })) return;
      await user.click(within(group).getByRole('button'));
    }
    throw new Error(`Calendar did not cycle to ${name}`);
  }
  const timedSeed = () => {
    const seed = fictionalSeed();
    seed.content = seed.content.map((draft) => draft.id === FIXTURE_IDS.autumnBlend
      ? { ...draft, planned_date: '2026-10-20', planning_slot: { start: '09:00', duration_minutes: 30, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } } : draft);
    return seed;
  };
  it('cycles one view button Month to Week to Day to Month without saving', async () => {
    const { recorded, user } = setup('calendar/2026-10');
    const group = await screen.findByRole('group', { name: 'Calendar view' });
    for (const [before, after, columns] of [['Month', 'Week', 7], ['Week', 'Day', 1], ['Day', 'Month', 0]] as const) {
      expect(within(group).getAllByRole('button')).toHaveLength(1);
      await user.click(within(group).getByRole('button', { name: before }));
      expect(within(group).getByRole('button', { name: after })).toBeTruthy();
      expect(document.querySelectorAll('[data-time-day]')).toHaveLength(columns);
    }
    expect(methods(recorded)).toEqual(['snapshot']);
    expectNoExecution(recorded);
  });

  it('drags all-day into a scrolled time grid, then moves vertically with one save per release and Undo', async () => {
    const seed = fictionalSeed();
    seed.content = seed.content.map((draft) => draft.id === FIXTURE_IDS.autumnBlend ? { ...draft, planned_date: '2026-10-20' } : draft);
    const { controls, recorded, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX], seed });
    await showView(user, 'Day');
    const rect = { x: 88, y: -236, left: 88, top: -236, right: 888, bottom: 916, width: 800, height: 1152, toJSON: () => ({}) };
    const columns = document.querySelector('.hq-calendar-time-columns')!;
    const day = document.querySelector('[data-time-day="2026-10-20"]')!;
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(day, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(day);
    const chip = screen.getByRole('button', { name: /^Autumn blend tasting notes/ });
    recorded.clear();
    fireEvent.pointerDown(chip, { pointerId: 10, button: 0, clientX: 300, clientY: 40 });
    fireEvent.pointerMove(chip, { pointerId: 10, clientX: 300, clientY: 196 });
    expect(methods(recorded)).toEqual([]);
    fireEvent.pointerUp(chip, { pointerId: 10, clientX: 300, clientY: 196 });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toMatchObject({ start: '09:00', duration_minutes: 30 }));
    expect(methods(recorded)).toEqual(['saveDraft']);
    const timed = await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:00 a\.m\./ });
    fireEvent.pointerDown(timed, { pointerId: 11, button: 0, clientX: 300, clientY: 196 });
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 300, clientY: 244 });
    expect(methods(recorded)).toEqual(['saveDraft']);
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 300, clientY: 244 });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toMatchObject({ start: '10:00', duration_minutes: 30 }));
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot?.start).toBe('09:00'));
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });

  it('accepts a native HTML drop from the undated tray into scrolled time slots with a 30 minute default', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    await showView(user, 'Day');
    const draft = screen.getByRole('button', { name: /^Steeping times thread/ });
    const day = document.querySelector('[data-time-day="2026-10-20"]')!;
    vi.spyOn(day, 'getBoundingClientRect').mockReturnValue({ x: 88, y: -236, left: 88, top: -236, right: 888, bottom: 916, width: 800, height: 1152, toJSON: () => ({}) });
    const payload = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => payload.set(type, value), getData: (type: string) => payload.get(type) ?? '',
      get types() { return [...payload.keys()]; } };
    recorded.clear();
    fireEvent.dragStart(draft, { dataTransfer });
    fireEvent.dragOver(day, { dataTransfer });
    expect(methods(recorded)).toEqual([]);
    // Happy DOM has no DragEvent constructor; MouseEvent preserves client coordinates plus the native drag payload.
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 300, clientY: 436 });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    fireEvent(day, drop);
    await waitFor(() => expect(controls.inspect().content.find((item) => item.id === FIXTURE_IDS.steepingThread)).toMatchObject({ planned_date: '2026-10-20', planning_slot: { start: '14:00', duration_minutes: 30 } }));
    expect(methods(recorded)).toEqual(['saveDraft']);
    expectNoExecution(recorded);
  });
  it('assigns a 30 minute time via the accessible dialog and Undo restores date-only state', async () => {
    const { recorded, controls, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Set time' }));
    expect((screen.getByLabelText('Duration (minutes)') as HTMLInputElement).value).toBe('30');
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Save planning time' }));
    await screen.findByRole('button', { name: 'Undo' });
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toMatchObject({ start: '09:00', duration_minutes: 30 });
    expect(methods(recorded)).toEqual(['saveDraft']);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText(/Undone/);
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toBeNull();
    expectNoExecution(recorded);
  });
  it('uses shared keyboard moves and resize with one atomic save and exact Undo', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX], seed: timedSeed() });
    await showView(user, 'Week');
    const event = await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:00 a\.m\./ });
    recorded.clear();
    fireEvent.keyDown(event, { altKey: true, key: 'ArrowDown' });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot?.start).toBe('09:15'));
    expect(methods(recorded)).toEqual(['saveDraft']);
    fireEvent.keyDown(await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:15 a\.m\./ }), { altKey: true, shiftKey: true, key: 'ArrowDown' });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot?.duration_minutes).toBe(45));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText(/Undone/);
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toMatchObject({ start: '09:15', duration_minutes: 30 });
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });
  it('previews pointer movement without saving, commits on drop, and clears time into all-day', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX], seed: timedSeed() });
    await showView(user, 'Week');
    const event = await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:00 a\.m\./ });
    const columns = document.querySelector('.hq-calendar-time-columns')!;
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 1152, width: 700, height: 1152, toJSON: () => ({}) });
    const day = document.querySelector('[data-time-day="2026-10-21"]')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(day);
    recorded.clear();
    fireEvent.pointerDown(event, { button: 0, pointerId: 7, clientX: 150, clientY: 432 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 250, clientY: 456 });
    expect(methods(recorded)).toEqual([]);
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 250, clientY: 456 });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-21', planning_slot: { start: '09:30', duration_minutes: 30 } }));
    expect(methods(recorded)).toEqual(['saveDraft']);
    const moved = await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:30 a\.m\./ });
    const allDay = document.querySelector('[data-grid-all-day="2026-10-22"]')!;
    vi.mocked(document.elementFromPoint).mockReturnValue(allDay);
    fireEvent.pointerDown(moved, { button: 0, pointerId: 8, clientX: 250, clientY: 456 });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 350, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 350, clientY: 10 });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-22', planning_slot: null }));
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });
  it('keeps unsupported time planning read-only and the collapsed tray a drop target', async () => {
    const { recorded, user } = setup('calendar/2026-10', { features: [] });
    await showView(user, 'Day');
    expect(screen.getByText(/Timed planning needs a newer Social service/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Collapse undated drafts' }));
    expect(document.querySelector('[data-calendar-remove]')).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Undated drafts tray width' }).getAttribute('aria-valuenow')).toBe('0');
    expect(methods(recorded)).toEqual(['snapshot']);
  });
  it('reconciles a lost timed-save response by one read, never by another save', async () => {
    const fixture = createFixtureWorkspace({ features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    const session = socialSession('lost-time');
    await session.load(fixture.port);
    const draft = workspaceSnapshot(session.getState().workspace)!.content.find((item) => item.id === FIXTURE_IDS.autumnBlend)!;
    const save = vi.fn(async (input: Parameters<typeof fixture.port.saveDraft>[0]) => {
      await fixture.port.saveDraft(input);
      throw new PortFailure({ kind: 'unknown', attemptedAt: NOW().toISOString() });
    });
    const snapshot = vi.fn(fixture.port.snapshot);
    const port = { ...fixture.port, saveDraft: save, snapshot };
    const slot = { start: '09:00', duration_minutes: 30, timezone: 'UTC' };
    const result = await changeDraft(session, port, draft, { planning_slot: slot }, true);
    expect(result).toMatchObject({ ok: true, draft: { planning_slot: slot, version: draft.version + 1 } });
    expect(save).toHaveBeenCalledTimes(1); expect(snapshot).toHaveBeenCalledTimes(1);
  });
  it('refuses a changed slot during unknown recovery instead of treating matching text as success', async () => {
    const fixture = createFixtureWorkspace({ features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    const session = socialSession('changed-time'); await session.load(fixture.port);
    const draft = workspaceSnapshot(session.getState().workspace)!.content.find((item) => item.id === FIXTURE_IDS.autumnBlend)!;
    const slot = { start: '09:00', duration_minutes: 30, timezone: 'UTC' };
    const saveDraft = vi.fn(async (_input: Parameters<typeof fixture.port.saveDraft>[0]): Promise<Draft> => {
      fixture.controls.editElsewhere(draft.id, { planning_slot: { ...slot, duration_minutes: 60 } });
      throw new PortFailure({ kind: 'unknown', attemptedAt: NOW().toISOString() });
    });
    const result = await changeDraft(session, { ...fixture.port, saveDraft }, draft, { planning_slot: slot }, true);
    expect(result).toMatchObject({ ok: false, reconciliation: 'changed', error: { kind: 'unknown' } });
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });
});
