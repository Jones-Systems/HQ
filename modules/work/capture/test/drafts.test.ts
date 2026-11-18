import { describe, expect, it } from 'vitest';
import { setup, writes } from '../../board/test/fixtures';

describe('HQ drafts (RW-10)', () => {
  it('keeping a draft sends nothing', async () => {
    const env = await setup();
    const draft = env.drafts.add({ title: 'Patch the hammock', status: 'inbox' });
    expect(env.drafts.getState().drafts).toEqual([draft]);
    expect(writes(env.calls)).toEqual([]);
  });

  it('Send drafts creates each draft once, oldest first, and clears the sent ones', async () => {
    const env = await setup();
    env.drafts.add({ title: 'Patch the hammock', status: 'inbox' });
    env.drafts.add({ title: 'Wash the bird bath', status: 'next' });
    const summary = await env.drafts.sendAll(env.store);
    expect(summary).toEqual({ sent: 2, unconfirmed: 0, kept: 0, stopped: false });
    expect(writes(env.calls).map((c) => [c.method, (c.args[0] as { title: string }).title])).toEqual([
      ['create', 'Patch the hammock'], ['create', 'Wash the bird bath'],
    ]);
    expect(env.drafts.getState().drafts).toEqual([]);
  });

  it('stops at the first unavailable answer and keeps every remaining draft', async () => {
    const env = await setup();
    env.drafts.add({ title: 'Patch the hammock' });
    env.drafts.add({ title: 'Wash the bird bath' });
    env.faults.next('unavailable');
    const summary = await env.drafts.sendAll(env.store);
    expect(summary).toEqual({ sent: 0, unconfirmed: 0, kept: 2, stopped: true });
    expect(writes(env.calls)).toHaveLength(1);
    expect(env.drafts.getState().drafts.map((d) => d.error)).toEqual(['The Planner is unavailable; nothing was sent.', undefined]);
  });

  it('keeps a draft the Planner rejects, with its reason', async () => {
    const env = await setup();
    env.drafts.add({ title: 'x'.repeat(201) });
    const summary = await env.drafts.sendAll(env.store);
    expect(summary.kept).toBe(1);
    expect(env.drafts.getState().drafts[0]!.error).toBe('Limited to 200 characters.');
  });

  it('hands a lost response to the core unconfirmed queue instead of keeping a duplicate draft', async () => {
    const env = await setup();
    env.drafts.add({ title: 'Patch the hammock' });
    env.faults.next('lose-response');
    const summary = await env.drafts.sendAll(env.store);
    expect(summary).toEqual({ sent: 0, unconfirmed: 1, kept: 0, stopped: false });
    expect(env.drafts.getState().drafts).toEqual([]);
    expect(env.store.getState().unconfirmed.map((u) => u.write.op)).toEqual(['create']);
  });
});
