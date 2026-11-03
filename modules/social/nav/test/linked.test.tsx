import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferencePort, ReferenceResolution, ReferenceStatus } from '@hq/ui';
import { FEATURE_HQ_REFERENCES, FIXTURE_IDS, FIXTURE_OTHER_PROJECT_ID, FIXTURE_PROJECT_ID, type WorkspaceSnapshot } from '../../core';
import { createWorkbenchFixture } from '../../workbench/fixtures/examples';
import { LinkedAcrossHq } from '../LinkedAcrossHq';

afterEach(cleanup);

const NOW = () => new Date('2026-10-20T12:00:00Z');
const OBSERVED = '2026-10-20T12:00:00Z';
const answer = (status: ReferenceStatus, extra: Partial<ReferenceResolution> = {}): ReferenceResolution => ({ status, observedAt: OBSERVED, ...extra });

interface Mount {
  readonly open: ReturnType<typeof vi.fn<ReferencePort['open']>>;
  readonly resolve: ReturnType<typeof vi.fn<ReferencePort['resolve']>>;
  readonly navigate: ReturnType<typeof vi.fn<(destination: string) => void>>;
  readonly user: ReturnType<typeof userEvent.setup>;
}

/** Mounts Linked across HQ on the example snapshot, whose steeping thread links a Work item and a Social run. */
async function mount(options: {
  readonly resolve?: ReferencePort['resolve'];
  readonly references?: boolean;
  readonly projectId?: string;
  readonly edit?: (snapshot: WorkspaceSnapshot) => WorkspaceSnapshot;
} = {}): Promise<Mount> {
  const snapshot = await createWorkbenchFixture({ features: [FEATURE_HQ_REFERENCES], clock: NOW }).port.snapshot();
  const open = vi.fn<ReferencePort['open']>();
  const resolve = vi.fn<ReferencePort['resolve']>(options.resolve ?? (async () => answer('available')));
  const navigate = vi.fn<(destination: string) => void>();
  const references: ReferencePort = { find: async () => [], resolve, open };
  render(
    <LinkedAcrossHq
      snapshot={(options.edit ?? ((value) => value))(snapshot)} brand={null} projectId={options.projectId ?? FIXTURE_PROJECT_ID}
      {...(options.references === false ? {} : { references })} navigate={navigate}
    />,
  );
  return { open, resolve, navigate, user: userEvent.setup() };
}

const work = () => screen.getByRole('button', { name: 'Open Plan the cupping hour' }) as HTMLButtonElement;
const run = () => screen.getByRole('button', { name: 'Open Signal inbox · Neighborhood tea' }) as HTMLButtonElement;
/** The line tied to a button by aria-describedby, or null when there is none. */
const reasonOf = (button: HTMLElement) => {
  const id = button.getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent ?? null : null;
};
const row = () => within(screen.getByText('Plan the cupping hour').closest('li')!);

describe('Linked across HQ: Open matches what is known', () => {
  it('enables Open for a record that resolved as available in this project, and opens it with a way back', async () => {
    const s = await mount();
    await waitFor(() => expect(work().disabled).toBe(false));
    expect(reasonOf(work())).toBeNull();
    expect(row().getByText('Available')).toBeTruthy();
    await s.user.click(work());
    expect(s.open).toHaveBeenCalledTimes(1);
    expect(s.open).toHaveBeenCalledWith(expect.objectContaining({ title: 'Plan the cupping hour', domain: 'work' }), { label: 'Social overview', to: { domain: 'social', destination: 'overview' } });
    expect(s.navigate).not.toHaveBeenCalled();
  });

  it.each<[ReferenceStatus, string]>([
    ['unavailable', "Work can't be reached, so this can't be opened right now."],
    ['missing', "Work no longer has this record, so it can't be opened."],
    ['forbidden', "HQ isn't allowed to open this Work record."],
    ['unknown', "Its status couldn't be confirmed, so it can't be opened right now."],
  ])('disables Open for a link that resolved as %s, with the reason tied to the button', async (status, reason) => {
    const s = await mount({ resolve: async () => answer(status) });
    await waitFor(() => expect(row().getByText(status[0]!.toUpperCase() + status.slice(1))).toBeTruthy());
    expect(work().disabled).toBe(true);
    expect(reasonOf(work())).toBe(reason);
    await s.user.click(work());
    expect(s.open).not.toHaveBeenCalled();
    expect(s.navigate).not.toHaveBeenCalled();
  });

  it('still opens a record that changed since it was linked, or was archived', async () => {
    for (const status of ['changed', 'archived'] as const) {
      const s = await mount({ resolve: async () => answer(status) });
      await waitFor(() => expect(work().disabled).toBe(false));
      await s.user.click(work());
      expect(s.open).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it('says Not checked yet while the answer is pending, and treats a failed read as unreachable', async () => {
    await mount({ resolve: () => new Promise<ReferenceResolution>(() => undefined) });
    expect(work().disabled).toBe(true);
    expect(reasonOf(work())).toBe('Not checked yet.');
    expect(row().getByText('Not checked')).toBeTruthy();
    cleanup();

    await mount({ resolve: async () => { throw new Error('offline'); } });
    await waitFor(() => expect(reasonOf(work())).toBe("Work can't be reached, so this can't be opened right now."));
    expect(work().disabled).toBe(true);
  });

  it('keeps a moved record, and every link into another project, read-only', async () => {
    await mount({ resolve: async () => answer('moved', { targetProjectId: FIXTURE_OTHER_PROJECT_ID }) });
    await waitFor(() => expect(row().getByText('Another project')).toBeTruthy());
    expect(work().disabled).toBe(true);
    expect(reasonOf(work())).toBe('Another project: read-only. HQ stays in this project.');
    cleanup();

    const s = await mount({ projectId: FIXTURE_OTHER_PROJECT_ID });
    expect(work().disabled).toBe(true);
    expect(run().disabled).toBe(true);
    expect(reasonOf(work())).toBe('Another project: read-only. HQ stays in this project.');
    expect(s.resolve).not.toHaveBeenCalled();
  });

  it('checks again when Open is chosen, and refuses if the answer has since changed', async () => {
    let status: ReferenceStatus = 'available';
    const s = await mount({ resolve: async () => answer(status) });
    await waitFor(() => expect(work().disabled).toBe(false));
    status = 'unavailable';
    await s.user.click(work());
    expect(s.open).not.toHaveBeenCalled();
    await waitFor(() => expect(work().disabled).toBe(true));
    expect(reasonOf(work())).toBe("Work can't be reached, so this can't be opened right now.");
    expect(s.navigate).not.toHaveBeenCalled();
  });

  it('is disabled with its reason when the shell has no reference service', async () => {
    const s = await mount({ references: false });
    expect(work().disabled).toBe(true);
    expect(reasonOf(work())).toBe("Opening needs the HQ reference service, which isn't connected here.");
    await s.user.click(work());
    expect(s.open).not.toHaveBeenCalled();
  });

  it('opens a Social run that is in this workspace, and disables one that is not', async () => {
    const s = await mount({ references: false });
    expect(run().disabled).toBe(false);
    expect(reasonOf(run())).toBeNull();
    await s.user.click(run());
    expect(s.navigate).toHaveBeenCalledWith(`runs/${FIXTURE_IDS.exampleRun}`);
    cleanup();

    const missing = await mount({ references: false, edit: (snapshot) => ({ ...snapshot, runs: [] }) });
    expect(run().disabled).toBe(true);
    expect(reasonOf(run())).toBe("This run isn't in the latest read of the workspace, so it can't be opened from here.");
    await missing.user.click(run());
    expect(missing.navigate).not.toHaveBeenCalled();
  });
});
