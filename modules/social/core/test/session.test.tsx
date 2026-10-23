import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixtureWorkspace } from '../fixture';
import { FIXTURE_IDS } from '../fixtures/workspace';
import { recordCalls } from '../recorder';
import { MESSAGES } from '../validate';
import { isDirty, resetSocialSessions, socialSession, useSocialSession, workspaceSnapshot } from '../session';

afterEach(() => {
  cleanup();
  resetSocialSessions();
});

function Editor({ projectId }: { projectId: string }) {
  const { state } = useSocialSession(projectId);
  return createElement('output', null, state.editors.note?.fields.body ?? 'no editor');
}

const NEW_DRAFT = { title: 'Unsaved', body: '', brand_id: 'default', channel: 'General' as const, planned_date: '', archived: 0 as const };

describe('Social session state', () => {
  it('keeps unsaved text across a module remount, per project', () => {
    const first = render(createElement(Editor, { projectId: 'project-a' }));
    act(() => {
      socialSession('project-a').openEditor('note', null, NEW_DRAFT);
      socialSession('project-a').editDraft('note', { body: 'Half-written thought' });
    });
    expect(screen.getByText('Half-written thought')).toBeTruthy();
    first.unmount();

    render(createElement(Editor, { projectId: 'project-a' }));
    expect(screen.getByText('Half-written thought')).toBeTruthy();
    cleanup();
    render(createElement(Editor, { projectId: 'project-b' }));
    expect(screen.getByText('no editor')).toBeTruthy();
  });

  it('never replaces an open editor when it is opened again', () => {
    const session = socialSession('p');
    session.openEditor('note', null, NEW_DRAFT);
    session.editDraft('note', { body: 'Mine' });
    session.openEditor('note', null, { ...NEW_DRAFT, body: 'Other' });
    expect(session.getState().editors.note?.fields.body).toBe('Mine');
  });

  it('keeps text on conflict, then saves it as a copy without overwriting the other version', async () => {
    const { port, controls } = createFixtureWorkspace();
    const session = socialSession('p');
    await session.load(port);
    session.openEditor('d', workspaceSnapshot(session.getState().workspace)!.content.find((item) => item.id === FIXTURE_IDS.autumnBlend)!);
    session.editDraft('d', { body: 'My version' });
    const theirs = controls.editElsewhere(FIXTURE_IDS.autumnBlend, { body: 'Their version' });

    expect(await session.saveEditor(port, 'd')).toBeNull();
    const editor = session.getState().editors.d!;
    expect(editor).toMatchObject({ status: 'conflict', error: { kind: 'conflict', message: MESSAGES.conflict }, fields: { body: 'My version' } });

    const copy = await session.saveAsCopy(port, 'd');
    expect(copy).toMatchObject({ body: 'My version', version: 1 });
    expect(copy!.id).not.toBe(FIXTURE_IDS.autumnBlend);
    expect(controls.inspect().content.find((item) => item.id === FIXTURE_IDS.autumnBlend)).toEqual(theirs);
  });

  it('reopens the latest copy on request', async () => {
    const { port, controls } = createFixtureWorkspace();
    const session = socialSession('p');
    await session.load(port);
    session.openEditor('d', workspaceSnapshot(session.getState().workspace)!.content.find((item) => item.id === FIXTURE_IDS.openDay)!);
    session.editDraft('d', { body: 'Mine' });
    controls.editElsewhere(FIXTURE_IDS.openDay, { body: 'Theirs' });
    await session.saveEditor(port, 'd');
    const latest = await session.reopenLatest(port, 'd');
    expect(latest?.body).toBe('Theirs');
    expect(session.getState().editors.d).toMatchObject({ status: 'editing', fields: { body: 'Theirs' } });
    expect(isDirty(session.getState().editors.d!)).toBe(false);
  });

  it('keeps the last snapshot visible as stale when a reload fails', async () => {
    const { port, controls } = createFixtureWorkspace();
    const session = socialSession('p');
    await session.load(port);
    controls.setUnavailable(true);
    await session.load(port);
    const load = session.getState().workspace;
    expect(load.status).toBe('error');
    expect(load).toMatchObject({ error: { kind: 'unavailable' }, last: { observedAt: expect.any(String) } });
  });

  it('makes no execution call from loading, editing or saving', async () => {
    const recorded = recordCalls(createFixtureWorkspace().port);
    const session = socialSession('p');
    await session.load(recorded.port);
    session.openEditor('n', null, NEW_DRAFT);
    await session.saveEditor(recorded.port, 'n');
    session.setView('library', { channel: 'X' });
    expect(recorded.callsOf('execution')).toEqual([]);
    expect(session.getState().view.library).toEqual({ channel: 'X' });
  });
});
