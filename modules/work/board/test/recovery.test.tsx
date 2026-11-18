import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createFixturePlanner, createWorkStore, MAX_REMEMBERED_REQUESTS, REPLAY_FEATURE } from '../../core';
import { createPlannerLive } from '../../live';
import { fixtureTransport } from '../../live/test/support';
import { createFeedback } from '../feedback';
import { APPLY_LABEL } from '../SyncStatus';
import { boardItems, clock, counter } from './fixtures';
import { Host } from './host';

// Recovery controls for unknown writes over the live adapter and the fixture Planner (all synthetic). Check now is a
// lookup that applies nothing; Apply appears only after a lookup proved the write never landed, and it goes through
// the replay route. Nothing is re-sent on its own.

afterEach(cleanup);

async function setup() {
  const now = clock();
  const fixture = createFixturePlanner({ items: boardItems(), now, newId: counter('item-'), features: [REPLAY_FEATURE] });
  const wire = fixtureTransport(fixture);
  const planner = createPlannerLive(wire.transport);
  const store = createWorkStore(planner.port, { now, newRequestId: counter('req-'), recovery: planner.recovery });
  await store.load();
  render(<Host store={store} feedback={createFeedback()} />);
  const modes = () => wire.calls.filter((c) => c.route === 'replay').map((c) => (c.params as { mode: string }).mode);
  return { fixture, wire, store, modes, device: fixture.port };
}

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;
const unconfirmed = () => screen.getByRole('region', { name: 'Unconfirmed changes' });
const checkNow = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check now' })); });

describe('Check now and Apply', () => {
  it('Check confirms a write that had landed by lookup alone; nothing is re-sent', async () => {
    const { wire, store, modes } = await setup();
    wire.next('move', 'lose-response');
    await act(async () => { await store.move('it-kite', 'considering', { place: 'top' }); });
    expect(within(card('it-kite')).getByText('Unconfirmed')).toBeTruthy();
    expect(within(unconfirmed()).getByText(/Check asks the Planner whether it was saved; nothing is re-sent/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: APPLY_LABEL })).toBeNull();
    await checkNow();
    expect(modes()).toEqual(['lookup']);
    expect(wire.calls.filter((c) => c.route === 'move')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Unconfirmed changes' })).toBeNull();
    expect(within(card('it-kite')).queryByText('Unconfirmed')).toBeNull();
  });

  it('Apply appears only after Check proved the write never landed, and saves it once', async () => {
    const { wire, store, modes, fixture } = await setup();
    wire.next('create', 'drop');
    await act(async () => { await store.create({ title: 'Oil the gate' }); });
    expect(screen.queryByRole('button', { name: APPLY_LABEL })).toBeNull();
    await checkNow();
    expect(within(unconfirmed()).getByText(/Checked · not saved\. Apply saves it now; the Planner applies it at most once/)).toBeTruthy();
    expect(fixture.control.stored().filter((i) => i.title === 'Oil the gate')).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: APPLY_LABEL })); });
    expect(modes()).toEqual(['lookup', 'resend']);
    expect(fixture.control.stored().filter((i) => i.title === 'Oil the gate')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Unconfirmed changes' })).toBeNull();
    expect(wire.calls.filter((c) => c.route === 'create')).toHaveLength(1);
  });

  it('an indeterminate Check offers no Apply and asks for a read-back; nothing is applied', async () => {
    const { wire, store, modes, fixture, device } = await setup();
    wire.next('create', 'drop');
    await act(async () => { await store.create({ title: 'Book the hall' }); });
    let item = fixture.control.stored().find((i) => i.id === 'it-pond')!;
    for (let i = 0; i < MAX_REMEMBERED_REQUESTS + 1; i += 1) item = (await device.markReviewed(item.id, item.revision, `other-${String(i).padStart(6, '0')}`)).item!;
    await checkNow();
    expect(within(unconfirmed()).getByText(/Cannot be checked · the Planner no longer keeps its record\. Read the board back/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: APPLY_LABEL })).toBeNull();
    await checkNow();
    expect(modes()).toEqual(['lookup']);
    expect(fixture.control.stored().filter((i) => i.title === 'Book the hall')).toHaveLength(0);
    expect(within(unconfirmed()).getByRole('button', { name: 'Stop tracking' })).toBeTruthy();
  });

  it('never shows the retired re-send wording', async () => {
    const { wire, store } = await setup();
    wire.next('patch', 'drop');
    await act(async () => { await store.patch('it-shed', { notes: 'Sanded.' }); });
    await checkNow();
    expect(screen.queryByText(/re-sending the same request/u)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Re-send same request' })).toBeNull();
  });
});
