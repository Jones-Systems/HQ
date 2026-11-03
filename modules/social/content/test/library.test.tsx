import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toastStore } from '@hq/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_IDS, createFixtureWorkspace, recordCalls, resetSocialSessions, socialSession, type FixtureOptions } from '../../core';
import { SocialContent } from '..';

afterEach(() => {
  cleanup();
  resetSocialSessions();
  toastStore.dismiss();
  localStorage.removeItem('hq.social.library-panel.v1');
  vi.restoreAllMocks();
});

const NOW = () => new Date('2026-10-20T12:00:00Z');

function setup(destination = 'library', options: FixtureOptions = {}) {
  const fixture = createFixtureWorkspace(options);
  const recorded = recordCalls(fixture.port);
  const visited: string[] = [];
  function Host() {
    const [current, setCurrent] = useState(destination);
    return <SocialContent port={recorded.port} projectId="fixture-project" destination={current} now={NOW} navigate={(next) => { visited.push(next); setCurrent(next); }} />;
  }
  const view = render(<Host />);
  return { ...fixture, recorded, visited, view, user: userEvent.setup() };
}

const rowsOf = () => within(screen.getByRole('list', { name: 'Drafts' })).getAllByRole('listitem');
const filters = () => within(screen.getByRole('group', { name: 'Filter drafts' }));
const figure = () => document.querySelector<HTMLElement>('.soc-preview')!;

describe('Library: list and filters', () => {
  it('lists active drafts as rows with a title, brand, a planned-date chip or "No date yet", and no second New draft', async () => {
    setup();
    await screen.findByRole('list', { name: 'Drafts' });
    expect(rowsOf()).toHaveLength(4);
    const autumn = screen.getByRole('button', { name: /^Autumn blend tasting notes/ });
    expect(autumn.textContent).toContain('Larkspur Tea Co.');
    expect(autumn.textContent).toContain('24 Oct');
    expect(screen.getByRole('button', { name: /^Steeping times thread/ }).textContent).toContain('No date yet');
    // Standalone, the Library has no page header, so its own list head keeps the one New draft.
    expect(screen.getAllByRole('button', { name: 'New draft' })).toHaveLength(1);
  });

  it('switches between Active, Archived and All with a segmented control, and shows the choice', async () => {
    const { user } = setup();
    await screen.findByRole('list', { name: 'Drafts' });
    const active = filters().getByRole('button', { name: 'Active' });
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Summer iced tea recap')).toBeNull();
    await user.click(filters().getByRole('button', { name: 'Archived' }));
    expect(filters().getByRole('button', { name: 'Archived' }).getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByRole('button', { name: /^Summer iced tea recap/ })).toBeTruthy();
    expect(rowsOf()).toHaveLength(1);
    await user.click(filters().getByRole('button', { name: 'All' }));
    expect(rowsOf()).toHaveLength(5);
  });

  it('filters by channel and brand, offers Clear, and says when nothing matches', async () => {
    const { user } = setup();
    await screen.findByRole('list', { name: 'Drafts' });
    expect(filters().queryByRole('button', { name: 'Clear' })).toBeNull();
    await user.selectOptions(filters().getByRole('combobox', { name: 'Channel' }), 'X');
    expect(rowsOf()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Steeping times thread/ })).toBeTruthy();
    await user.click(filters().getByRole('button', { name: 'Clear' }));
    expect(rowsOf()).toHaveLength(4);
    expect(filters().queryByRole('button', { name: 'Clear' })).toBeNull();

    await user.selectOptions(filters().getByRole('combobox', { name: 'Channel' }), 'Reddit');
    expect(await screen.findByText('No drafts match these filters')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowsOf()).toHaveLength(4);
  });

  it('searches titles and bodies', async () => {
    const { user } = setup();
    await screen.findByRole('list', { name: 'Drafts' });
    await user.type(filters().getByLabelText('Search'), 'sourdough');
    expect(rowsOf()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Sourdough starter open day/ })).toBeTruthy();
  });

  it('marks a row whose draft has unsaved text, and keeps the mark after the editor is left', async () => {
    const { user, visited } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    const list = screen.getByRole('list', { name: 'Drafts' });
    expect(within(list).queryByText('Unsaved changes')).toBeNull();
    await user.type(screen.getByLabelText('Body'), ' More.');
    expect(within(list).getByText('Unsaved changes')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to all drafts' }));
    expect(visited.at(-1)).toBe('library');
    expect(socialSession('fixture-project').getState().editors[FIXTURE_IDS.openDay]).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Drafts' })).getByText('Unsaved changes')).toBeTruthy();
  });
});

describe('Library: composer', () => {
  it('updates the channel preview in place as the text and channel change', async () => {
    const { user } = setup(`library/${FIXTURE_IDS.autumnBlend}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    const card = figure();
    expect(card.dataset.channel).toBe('LinkedIn');
    expect(card.textContent).toContain('Three cups, three steeping times.');
    expect(card.textContent).toContain('Not posted');
    expect(card.textContent).toContain('Planned 24 Oct 2026');
    await user.type(screen.getByLabelText('Body'), ' #tea');
    expect(figure()).toBe(card);
    expect(card.querySelector('.soc-post-body')?.textContent).toContain('October? #tea');
    expect(card.querySelector('.soc-post-token')?.textContent).toBe('#tea');
    await user.selectOptions(screen.getByLabelText('Channel'), 'General');
    expect(figure()).toBe(card);
    expect(card.dataset.channel).toBe('General');
    expect(screen.getByText(/No length guide for General/)).toBeTruthy();
  });

  it('calls the length guide illustrative, marks the overflow in the preview, and never blocks the save', async () => {
    const { user, controls } = setup(`library/${FIXTURE_IDS.steepingThread}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    expect(screen.getByText(/illustrative limit for X, not a platform rule/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'x'.repeat(300) } });
    expect(screen.getByText(/300 \/ 280 characters/)).toBeTruthy();
    expect(document.querySelector('.soc-count')?.textContent).toContain('20 over · illustrative limit for X');
    expect(figure().querySelector('.soc-post-flag')?.textContent).toBe('20 characters past the illustrative 280');
    expect(figure().querySelector('.soc-post-over')?.textContent).toHaveLength(20);
    expect(document.querySelector('.soc-count')?.getAttribute('data-state')).toBe('over');
    expect(screen.getByText(/20 over the illustrative 280-character limit/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.steepingThread)?.version).toBe(2));
  });

  it('walks the save bar from Unsaved through Saving… to Saved with the version and time, and raises an 8 s toast that never says posted', async () => {
    let release: () => void = () => undefined;
    let hold = false;
    const { user } = setup(`library/${FIXTURE_IDS.openDay}`, { delay: () => (hold ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve()) });
    await screen.findByRole('heading', { name: 'Edit draft' });
    expect(screen.getByText('Saved v1', { exact: false, selector: '[role="status"]' })).toBeTruthy();
    await user.type(screen.getByLabelText('Body'), ' Bring a friend.');
    expect(screen.getByText('Unsaved changes', { selector: '[role="status"]' })).toBeTruthy();
    hold = true;
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saving…', { selector: '[role="status"]' })).toBeTruthy();
    hold = false;
    await act(async () => release());
    expect(await screen.findByText(/Saved v2 · /)).toBeTruthy();
    const saved = toastStore.getSnapshot().find((record) => record.id === `social-draft-saved:${FIXTURE_IDS.openDay}`);
    expect(saved).toMatchObject({ tone: 'success', duration: 8000, title: 'Saved “Sourdough starter open day”', meta: 'Version 2 · nothing was posted' });
    expect(`${saved?.title} ${saved?.meta}`).not.toMatch(/scheduled|published|live|connected/iu);
  });

  it('saves with the keyboard shortcut', async () => {
    const { user, controls } = setup(`library/${FIXTURE_IDS.openDay}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    const body = screen.getByLabelText('Body');
    await user.type(body, ' Shortcut.');
    fireEvent.keyDown(body, { key: 's', ctrlKey: true });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.openDay)?.version).toBe(2));
  });

  it('puts a validation error on the field that caused it, moves focus there and keeps the text', async () => {
    const { user } = setup('library/new');
    await screen.findByRole('heading', { name: 'New draft' });
    await user.type(screen.getByLabelText('Body'), 'Text without a title');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain('Title must be text');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Title')));
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('Text without a title');
  });

  it('shows a conflict in the save bar, with the text kept and no overwrite', async () => {
    const { user, controls } = setup(`library/${FIXTURE_IDS.autumnBlend}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    await user.type(body, ' Mine.');
    controls.editElsewhere(FIXTURE_IDS.autumnBlend, { body: 'Theirs' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const notice = (await screen.findByText('Changed elsewhere.')).closest('.soc-savebar')!;
    expect(within(notice as HTMLElement).getByRole('button', { name: 'Load their version' })).toBeTruthy();
    expect(within(notice as HTMLElement).getByRole('button', { name: 'Save mine as a copy' })).toBeTruthy();
    expect(body.value).toContain('Mine.');
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.body).toBe('Theirs');
  });

  it('opens a draft started from a run without replacing it, and shows where it came from', async () => {
    const citation = {
      version: 1 as const, domain: 'social' as const, projectId: 'fixture-project', kind: 'run', entityId: FIXTURE_IDS.exampleRun,
      title: 'Signal inbox · Neighborhood tea', returnDestination: { domain: 'social' as const, destination: 'library' }, sourceRevision: '2026-10-18',
    };
    socialSession('fixture-project').openEditor('new', null, { title: 'From research', body: 'Cold brew is rising.', brand_id: 'default', channel: 'General', planned_date: '', archived: 0, links: [citation] });
    const { recorded } = setup('library/new');
    await screen.findByRole('heading', { name: 'New draft' });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('From research');
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('Cold brew is rising.');
    const origin = screen.getByRole('group', { name: 'Where this draft came from' });
    expect(origin.textContent).toContain('From run · Signal inbox · Neighborhood tea · 18 Oct 2026');
    expect(origin.textContent).toContain('saved with the draft');
    expect(recorded.callsOf('execution')).toEqual([]);
  });

  it('keeps an open "new" editor when the Library mounts again', async () => {
    const session = socialSession('fixture-project');
    session.openEditor('new', null, { title: 'Half a thought', body: '', brand_id: 'default', channel: 'X', planned_date: '', archived: 0 });
    setup('library/new');
    await screen.findByRole('heading', { name: 'New draft' });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Half a thought');
    expect(session.getState().editors.new?.fields.channel).toBe('X');
  });
});
