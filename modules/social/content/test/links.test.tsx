import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceEnvelope } from '@hq/contracts';
import type { ReferencePort } from '@hq/ui';
import { createFixtureWorkspace, FIXTURE_IDS, recordCalls, resetSocialSessions, socialSession, FEATURE_HQ_BRAND_PROJECT } from '../../core';
import { createSocialReferenceProvider } from '../../references';
import { SocialContent } from '../SocialContent';
import { addDraftLink, referenceSavePort, saveDraftLinks, UNSAVED_LINKS } from '../links';
import { sameStoredFields, reconcileUnknownSave } from '../actions';
import { SocialDomain } from '../../nav';

afterEach(() => { cleanup(); resetSocialSessions(); });
const projectId = 'fixture-project';
const source = FIXTURE_IDS.autumnBlend;
const envelope: ReferenceEnvelope = { version: 1, domain: 'social', projectId, kind: 'draft',
  entityId: FIXTURE_IDS.slowerRhythm, title: 'Notes on a slower posting rhythm',
  returnDestination: { domain: 'social', destination: 'library' }, sourceRevision: '1' };

function setup(features?: string[], draftId = source) {
  const fixture = createFixtureWorkspace({ ...(features ? { features } : {}) });
  const recorded = recordCalls(fixture.port);
  const provider = createSocialReferenceProvider(recorded.port, projectId);
  const references: ReferencePort = { find: provider.find, resolve: provider.resolve, open: vi.fn() };
  const navigate = vi.fn();
  const props = { projectId, port: recorded.port, references, destination: `library/${draftId}`, navigate };
  return { ...fixture, recorded, references, navigate, props, session: socialSession(projectId) };
}

function paste() {
  fireEvent.change(screen.getByLabelText('Serialized HQ reference'), { target: { value: JSON.stringify(envelope) } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reference' }));
}

describe('Social draft references', () => {
  it('searches, links with a versioned save, opens, remounts with source state, unlinks and undoes without execution', async () => {
    const s = setup();
    const view = render(<SocialContent {...s.props} />);
    await screen.findByRole('heading', { name: 'Edit draft' });
    s.recorded.clear();
    fireEvent.click(screen.getByRole('button', { name: 'Link to…' }));
    await screen.findByRole('option', { name: /Notes on a slower posting rhythm/ });
    fireEvent.click(screen.getByRole('option', { name: /Notes on a slower posting rhythm/ }));
    await screen.findByRole('button', { name: 'Undo link' });
    expect(s.controls.inspect().content.find((draft) => draft.id === source)).toMatchObject({ version: 4, links: [expect.objectContaining({ entityId: envelope.entityId })] });
    await waitFor(() => expect((screen.getByRole('button', { name: `Open ${envelope.title}` }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: `Open ${envelope.title}` }));
    expect(s.references.open).toHaveBeenCalledWith(expect.objectContaining({ entityId: envelope.entityId }), {
      label: 'Autumn blend tasting notes', to: { domain: 'social', destination: `library/${source}` },
    });
    expect(s.navigate).not.toHaveBeenCalled();
    view.unmount();
    render(<SocialContent {...s.props} />);
    await screen.findByRole('button', { name: `Unlink ${envelope.title}` });
    fireEvent.click(screen.getByRole('button', { name: `Unlink ${envelope.title}` }));
    await screen.findByRole('button', { name: 'Undo' });
    expect(s.controls.inspect().content.find((draft) => draft.id === source)?.links).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(s.controls.inspect().content.find((draft) => draft.id === source)?.links).toHaveLength(1));
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft').map((call) => (call.args[0] as { version: number }).version)).toEqual([3, 4, 5]);
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('keeps unsupported proposed links across save attempts and remount, sending none to the port', async () => {
    const s = setup([]);
    const stored = s.controls.inspect().content.find((draft) => draft.id === source)!;
    s.session.openEditor(source, stored, { ...stored, links: [envelope] });
    const view = render(<SocialContent {...s.props} />);
    await screen.findByText(UNSAVED_LINKS);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('cannot save links yet'));
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toEqual([]);
    expect(s.session.getState().editors[source]?.fields.links).toEqual([envelope]);
    expect((screen.getByRole('button', { name: 'Link to…' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    render(<SocialContent {...s.props} />);
    expect(await screen.findByText(UNSAVED_LINKS)).toBeTruthy();
    expect(screen.getByText(envelope.title, { selector: '.hq-reference-title' })).toBeTruthy();
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('rejects duplicates, the 31st link, invalid drops and foreign projects without a save', async () => {
    expect(() => addDraftLink([envelope], { ...envelope, title: 'Renamed' }, projectId)).toThrow('Already linked');
    const full = Array.from({ length: 30 }, (_, i) => ({ ...envelope, entityId: `fictional-${i}` }));
    expect(() => addDraftLink(full, envelope, projectId)).toThrow('30-link');
    expect(() => addDraftLink([], { ...envelope, projectId: 'other' }, projectId)).toThrow('read-only');
    const s = setup();
    render(<SocialContent {...s.props} />);
    const section = await screen.findByRole('region', { name: 'Draft links' });
    fireEvent.drop(section, { dataTransfer: { getData: () => 'invalid' } });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Paste or drop a valid serialized HQ reference.');
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toEqual([]);
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('adds a dropped envelope once, allows Undo, and retains a conflicting proposed link', async () => {
    const s = setup();
    render(<SocialContent {...s.props} />);
    const section = await screen.findByRole('region', { name: 'Draft links' });
    fireEvent.drop(section, { dataTransfer: { getData: () => JSON.stringify(envelope) } });
    fireEvent.drop(section, { dataTransfer: { getData: () => JSON.stringify(envelope) } });
    await screen.findByRole('button', { name: 'Undo link' });
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo link' }));
    await waitFor(() => expect(s.controls.inspect().content.find((draft) => draft.id === source)?.links).toEqual([]));
    s.controls.editElsewhere(source, { title: 'Someone else' });
    paste();
    expect(await screen.findByText('Changed elsewhere.')).toBeTruthy();
    expect(s.session.getState().editors[source]?.fields.links).toEqual([envelope]);
    expect(s.controls.inspect().content.find((draft) => draft.id === source)?.links).toEqual([]);
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('updates snapshots only explicitly and saves the inverse with Undo', async () => {
    const s = setup();
    render(<SocialContent {...s.props} />);
    await screen.findByRole('region', { name: 'Draft links' });
    paste();
    await screen.findByRole('button', { name: 'Undo link' });
    s.controls.editElsewhere(envelope.entityId, { title: 'New target title' });
    s.recorded.clear();
    fireEvent.click(screen.getByRole('button', { name: 'Check references' }));
    await screen.findByText(/Latest title: New target title/);
    expect(s.controls.inspect().content.find((draft) => draft.id === source)?.links?.[0]?.title).toBe(envelope.title);
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toEqual([]);
    await waitFor(() => expect((screen.getByRole('button', { name: `Update snapshot ${envelope.title}` }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: `Update snapshot ${envelope.title}` }));
    await screen.findByRole('button', { name: 'Undo' });
    expect(s.controls.inspect().content.find((draft) => draft.id === source)?.links?.[0]).toMatchObject({ title: 'New target title', sourceRevision: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(s.controls.inspect().content.find((draft) => draft.id === source)?.links).toEqual([envelope]));
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('does not navigate or mutate a foreign project reference or draft', async () => {
    const s = setup(['hq-references-v1', FEATURE_HQ_BRAND_PROJECT], FIXTURE_IDS.openDay);
    render(<SocialContent {...s.props} />);
    await screen.findByText('Another project: this draft is read-only. The project has not changed.');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Link to…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.drop(screen.getByRole('region', { name: 'Draft links' }), { dataTransfer: { getData: () => JSON.stringify(envelope) } });
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toEqual([]);
    expect(s.navigate).not.toHaveBeenCalled();
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('reconciles unknown link saves by exact links as well as text, without retrying', async () => {
    const s = setup();
    await s.session.load(s.recorded.port);
    const draft = s.controls.inspect().content.find((item) => item.id === source)!;
    s.session.openEditor(source, draft);
    s.controls.failNext('saveDraft', { kind: 'unknown', attemptedAt: new Date().toISOString() });
    await expect(saveDraftLinks(s.session, s.recorded.port, source, [envelope])).rejects.toThrow('not confirmed');
    expect(s.session.getState().editors[source]?.fields.links).toEqual([envelope]);
    const fields = s.session.getState().editors[source]!.fields;
    expect(sameStoredFields({ ...draft, version: 4, links: [] }, fields, ['hq-references-v1'])).toBe(false);
    s.controls.editElsewhere(source);
    expect(await reconcileUnknownSave(s.session, s.recorded.port, source)).toEqual({ kind: 'changed' });
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toHaveLength(1);
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('renders return context informationally with no return seam or execution', async () => {
    const s = setup();
    render(<SocialDomain context={{ id: projectId, name: 'Fictional project' }} destination="library" navigate={s.navigate}
      port={s.recorded.port} references={s.references} returnContext={{ label: 'Fictional source', to: { domain: 'work', destination: 'list' } }}
      desktop={{ platform: 'browser', versions: { electron: null } }} appearance="light" />);
    await screen.findByText('Reference opened from Fictional source.');
    await act(async () => {});
    expect(s.recorded.callsOf('execution')).toEqual([]);
    expect(s.navigate).not.toHaveBeenCalled();
  });

  it('keeps a proposed link when a claimed successful save omits it, then reconciles the unknown result', async () => {
    const s = setup();
    const port = { ...s.recorded.port, saveDraft: async (request: Parameters<typeof s.recorded.port.saveDraft>[0]) => {
      const saved = await s.recorded.port.saveDraft(request);
      return { ...saved, links: [] };
    } };
    await s.session.load(port);
    s.session.openEditor(source, s.controls.inspect().content.find((draft) => draft.id === source)!);
    await expect(saveDraftLinks(s.session, port, source, [envelope])).rejects.toThrow('not confirmed');
    expect(s.session.getState().editors[source]).toMatchObject({ status: 'error', error: { kind: 'unknown' }, fields: { links: [envelope] } });
    expect(await reconcileUnknownSave(s.session, port, source)).toMatchObject({ kind: 'applied' });
    expect(s.recorded.calls().filter((call) => call.method === 'saveDraft')).toHaveLength(1);
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('strips even an empty links field when the flag is absent', async () => {
    const s = setup([]);
    const draft = s.controls.inspect().content.find((item) => item.id === source)!;
    await referenceSavePort(s.recorded.port, []).saveDraft({ ...draft, links: [] });
    expect(s.recorded.calls()[0]?.args[0]).not.toHaveProperty('links');
    expect(s.recorded.callsOf('execution')).toEqual([]);
  });

  it('shows a foreign reference read-only, and dragging its readable snapshot makes no calls', async () => {
    const s = setup();
    const draft = s.controls.inspect().content.find((item) => item.id === source)!;
    s.session.openEditor(source, draft, { ...draft, links: [{ ...envelope, projectId: 'elsewhere' }] });
    render(<SocialContent {...s.props} />);
    await screen.findByText('Another project: links are read-only. The project has not changed.');
    expect(screen.queryByRole('button', { name: `Unlink ${envelope.title}` })).toBeNull();
    const open = await screen.findByRole('button', { name: `Open ${envelope.title}` });
    expect((open as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(s.recorded.calls().every((call) => call.outcome !== 'pending')).toBe(true));
    s.recorded.clear();
    fireEvent.dragStart(screen.getByText(envelope.title, { selector: '.hq-reference-title' }));
    fireEvent.dragEnd(screen.getByText(envelope.title, { selector: '.hq-reference-title' }));
    fireEvent.click(open);
    expect(s.recorded.calls()).toEqual([]);
    expect(s.references.open).not.toHaveBeenCalled();
    expect(s.navigate).not.toHaveBeenCalled();
  });
});
