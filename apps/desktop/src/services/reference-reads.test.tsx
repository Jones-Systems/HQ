// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as Work from '@hq/work';
import { resetWorkSessions } from '../../../../modules/work/nav';
import { createFixtureWorkspace } from '../../../../modules/social/core';
import { createServiceDomains } from './domains';

const unconfigured = { configured: false, policy: 'ok', transport: null } as const;
const configured = { configured: true, policy: 'ok', transport: 'loopback-http' } as const;
const props = { context: { id: 'hq-local', name: 'Synthetic workspace' }, destination: 'board', appearance: 'light' as const,
  desktop: { platform: 'browser' as const, versions: { electron: null } }, navigate: vi.fn() };
const unavailable = () => Promise.resolve({ ok: false as const, kind: 'unavailable' as const });

afterEach(() => { cleanup(); resetWorkSessions(); Work.setWorkSessionPort(null); vi.restoreAllMocks(); });

it('reference reads and the mounted Work use one example port; search does not bind a session', async () => {
  const planner = Work.examplePlanner();
  const example = vi.fn(() => planner);
  const bind = vi.spyOn(Work, 'setWorkSessionPort');
  const status = vi.fn(async () => unconfigured);
  const domains = createServiceDomains(() => ({ config: { status }, work: { call: unavailable }, social: { call: unavailable } }), { planner: example });
  const before = await domains.referenceReads.work.snapshot();
  expect(bind).not.toHaveBeenCalled();
  render(<domains.Work {...props} />);
  await screen.findByRole('region', { name: 'Work service' });
  await vi.waitFor(() => expect(bind).toHaveBeenCalledWith(planner, { example: true }));
  expect(example).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenCalledTimes(1);
  expect((await domains.referenceReads.work.snapshot()).items).toEqual(before.items);
});

it('Social reads share the selected example including later changes', async () => {
  const fixture = createFixtureWorkspace();
  const example = vi.fn(() => fixture.port);
  const domains = createServiceDomains(() => ({ config: { status: async () => unconfigured }, work: { call: unavailable }, social: { call: unavailable } }), { social: example });
  const before = await domains.referenceReads.social.snapshot();
  const draft = before.content[0]!;
  fixture.controls.editElsewhere(draft.id, { title: 'Changed synthetic draft' });
  expect((await domains.referenceReads.social.snapshot()).content.find(row => row.id === draft.id)?.title).toBe('Changed synthetic draft');
  expect(example).toHaveBeenCalledTimes(1);
});

it('failed live reads never select examples, even if configuration changes before a later read', async () => {
  let configuration: typeof configured | typeof unconfigured = configured;
  const status = vi.fn(async () => configuration);
  const planner = vi.fn(() => Work.examplePlanner());
  const social = vi.fn(() => createFixtureWorkspace().port);
  const domains = createServiceDomains(() => ({ config: { status }, work: { call: unavailable }, social: { call: unavailable } }), { planner, social });
  await expect(domains.referenceReads.work.snapshot()).rejects.toBeDefined();
  await expect(domains.referenceReads.social.snapshot()).rejects.toBeDefined();
  configuration = unconfigured;
  await expect(domains.referenceReads.work.snapshot()).rejects.toBeDefined();
  await expect(domains.referenceReads.social.snapshot()).rejects.toBeDefined();
  expect(planner).not.toHaveBeenCalled(); expect(social).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledTimes(2);
});

it('missing or failed configuration remains unavailable and never creates examples', async () => {
  const planner = vi.fn(() => Work.examplePlanner());
  const social = vi.fn(() => createFixtureWorkspace().port);
  for (const getServices of [() => undefined, () => ({ config: { status: async () => { throw Error('Unavailable'); } }, work: { call: unavailable }, social: { call: unavailable } })]) {
    const domains = createServiceDomains(getServices, { planner, social });
    await expect(domains.referenceReads.work.snapshot()).rejects.toBeDefined();
    await expect(domains.referenceReads.social.snapshot()).rejects.toMatchObject({ error: { kind: 'unavailable' } });
  }
  expect(planner).not.toHaveBeenCalled(); expect(social).not.toHaveBeenCalled();
});
