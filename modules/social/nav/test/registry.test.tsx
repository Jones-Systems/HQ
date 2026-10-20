/// <reference path="../../../../apps/desktop/src/environment.d.ts" />
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SocialDefault, { SocialModule } from '@hq/social';
import { App } from '../../../../apps/desktop/src/App';
import { MODULES } from '../../../../apps/desktop/src/modules';
import { localToday, monthLabel, shiftMonth } from '../../content';
import { FIXTURE_IDS, recordCalls, resetSocialSessions, type RecordedPort } from '../../core';
import { createWorkbenchFixture } from '../../workbench/fixtures/examples';
import { setSocialWorkspacePort } from '..';

/**
 * test.social-domain.001: the actual Social descriptor mounts through T0's registry inside the real shell
 * (`App` → `MODULES.social`), which remounts the module on every domain switch. Every Social port call is
 * recorded, so restoration is proved with zero execution and no writes.
 */

let recorded: RecordedPort;

beforeEach(() => {
  window.localStorage.clear();
  resetSocialSessions();
  recorded = recordCalls(createWorkbenchFixture().port);
  setSocialWorkspacePort(recorded.port);
});

afterEach(() => {
  cleanup();
  resetSocialSessions();
  setSocialWorkspacePort(null);
  delete document.documentElement.dataset.theme;
});

const user = () => userEvent.setup();
const rail = () => within(screen.getByRole('navigation', { name: 'Domains' }));
const side = () => within(screen.getByRole('complementary', { name: 'Social workspace' }));
const main = () => screen.getByRole('main');
const writes = () => recorded.calls().filter((call) => call.method !== 'snapshot' && call.class === 'content');

async function switchDomain(name: 'Design' | 'Social' | 'Work') {
  await user().click(rail().getByRole('button', { name }));
  expect(rail().getByRole('button', { name }).getAttribute('aria-current')).toBe('page');
}

/** Design → Social → Work → Social, checking the module really remounted each time. */
async function roundTrip(check: () => Promise<void> | void) {
  const before = main().firstElementChild;
  await switchDomain('Design');
  expect(await screen.findByRole('navigation', { name: 'Design' })).toBeTruthy();
  await switchDomain('Social');
  expect(main().firstElementChild).not.toBe(before);
  await check();
  const second = main().firstElementChild;
  await switchDomain('Work');
  expect(screen.queryByRole('navigation', { name: 'Social' })).toBeNull();
  await switchDomain('Social');
  expect(main().firstElementChild).not.toBe(second);
  await check();
}

describe('Social descriptor in the T0 registry', () => {
  it('is the registry entry for the social domain, as a named and a default export', () => {
    expect(MODULES.social).toBe(SocialModule);
    expect(SocialDefault).toBe(SocialModule);
  });

  it('mounts under the shell context with the shell destination and labels the example workspace', async () => {
    render(<App />);
    await switchDomain('Social');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
    expect(side().getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText(/^Fictional example workspace/u)).toBeTruthy();
    expect(screen.getByText(/^No account connection, posting, live collection or scheduling\./u)).toBeTruthy();
    expect(recorded.callsOf('execution')).toHaveLength(0);
  });

  it('restores page, filters, selection, brand and unsaved text across Design → Social → Work → Social with zero execution', async () => {
    render(<App />);
    await switchDomain('Social');
    await screen.findByRole('heading', { level: 1, name: 'Overview' });

    await user().selectOptions(side().getByLabelText('Brand'), FIXTURE_IDS.larkspur);
    await user().click(side().getByRole('button', { name: 'Library' }));
    const filters = within(await screen.findByRole('group', { name: 'Filter drafts' }));
    await user().selectOptions(filters.getByLabelText('Channel'), 'LinkedIn');
    await user().type(filters.getByLabelText('Search'), 'autumn');
    await user().click(screen.getByRole('button', { name: /^Autumn blend tasting notes/u }));
    const body = await screen.findByLabelText('Body');
    await user().type(body, ' A fourth cup for November.');
    const callsBefore = recorded.calls().length;

    await roundTrip(async () => {
      expect(side().getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBe('page');
      expect((side().getByLabelText('Brand') as HTMLSelectElement).value).toBe(FIXTURE_IDS.larkspur);
      const group = within(await screen.findByRole('group', { name: 'Filter drafts' }));
      expect((group.getByLabelText('Brand') as HTMLSelectElement).value).toBe(FIXTURE_IDS.larkspur);
      expect((group.getByLabelText('Channel') as HTMLSelectElement).value).toBe('LinkedIn');
      expect((group.getByLabelText('Search') as HTMLInputElement).value).toBe('autumn');
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Autumn blend tasting notes');
      expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('Three cups, three steeping times. Which one tastes like October? A fourth cup for November.');
      expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
    });

    // The remounts reused the session: no further reads, no writes, no execution.
    expect(recorded.calls().length).toBe(callsBefore);
    expect(recorded.calls().filter((call) => call.method === 'snapshot')).toHaveLength(1);
    expect(writes()).toHaveLength(0);
    expect(recorded.callsOf('execution')).toHaveLength(0);
  });

  it('restores a workbench draft and remembers each section destination with zero execution', async () => {
    render(<App />);
    await switchDomain('Social');
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    await user().click(side().getByRole('button', { name: 'Workbenches' }));
    await user().click(await screen.findByRole('button', { name: 'Open Writing studio' }));
    await screen.findByRole('heading', { level: 1, name: 'Writing studio' });
    await user().type(screen.getByLabelText('Rough notes'), 'A cupping hour, kept across domains');

    const nextMonth = monthLabel(shiftMonth(localToday(new Date()).slice(0, 7), 1));
    await user().click(side().getByRole('button', { name: 'Calendar' }));
    await user().click(await screen.findByRole('button', { name: 'Next month' }));
    await screen.findByRole('heading', { level: 2, name: nextMonth });
    await user().click(side().getByRole('button', { name: 'Workbenches' }));
    await screen.findByRole('heading', { level: 1, name: 'Writing studio' });

    await roundTrip(async () => {
      expect(side().getByRole('button', { name: 'Workbenches' }).getAttribute('aria-current')).toBe('page');
      await screen.findByRole('heading', { level: 1, name: 'Writing studio' });
      expect((screen.getByLabelText('Rough notes') as HTMLTextAreaElement).value).toBe('A cupping hour, kept across domains');
    });

    // The Calendar item returns to the month left open, not to the default month.
    await user().click(side().getByRole('button', { name: 'Calendar' }));
    expect(await screen.findByRole('heading', { level: 2, name: nextMonth })).toBeTruthy();
    expect(writes()).toHaveLength(0);
    expect(recorded.callsOf('execution')).toHaveLength(0);
  });

  it('follows the appearance the shell resolves without reading the OS theme itself', async () => {
    render(<App />);
    await user().selectOptions(screen.getByLabelText('Appearance'), 'dark');
    await switchDomain('Social');
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await act(async () => {});
    expect(recorded.callsOf('execution')).toHaveLength(0);
  });
});
