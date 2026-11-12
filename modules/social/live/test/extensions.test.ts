import { describe, it, expect } from 'vitest';
import { createFixtureWorkspace, FEATURE_HQ_BRAND_PROJECT, FEATURE_HQ_SOURCES, FEATURE_HQ_PUBLISHING,
  type ExtendedSocialWorkspacePort } from '../../core';
import { createLiveSocialPort } from '../port';
import { createWireStub } from './wire-stub';
const features = [FEATURE_HQ_BRAND_PROJECT, FEATURE_HQ_SOURCES, FEATURE_HQ_PUBLISHING];
for (const mode of ['fixture', 'live'] as const) describe(`extensions ${mode}`, () => {
  const create = (flags: string[]) => mode === 'fixture' ? createFixtureWorkspace({ features: flags }).port
    : createLiveSocialPort(createWireStub({ features: flags }).transport);
  it('rejects every unadvertised capability locally', async () => {
    const p = create([]);
    await p.snapshot();
    for (const call of [() => p.setBrandProject('default', null), () => p.source('x'),
      () => p.connectChannel('X', 'Example'), () => p.approvePublish('x', 'x')]) {
      await expect(call()).rejects.toMatchObject({ error: { kind: 'invalid' } });
    }
  });
  it('preserves supplied source provenance and rejects duplicate and archived run sources', async () => {
    const p = create(features); await p.snapshot();
    expect((await p.setBrandProject('default', 'project-example')).project_id).toBe('project-example');
    const input = { name: 'Example', kind: 'feed-items' as const, file_name: 'feed.json', text: '[{"title":"Example"}]', as_of: '' };
    const source = await p.saveSource(input);
    expect(source.bytes).toBe(new TextEncoder().encode(input.text).length);
    expect((await p.source(source.id)).content).toEqual([{ title: 'Example' }]);
    await expect(p.saveSource(input)).rejects.toMatchObject({ error: { kind: 'conflict' } });
    expect((await p.submitRun('x-studio', {}, false, { sourceIds: [source.id] })).source_ids).toEqual([source.id]);
    await p.setSourceArchived(source.id, 1);
    await expect(p.submitRun('x-studio', {}, false, { sourceIds: [source.id] })).rejects.toMatchObject({ error: { kind: 'invalid' } });
  });
  async function request(p: ExtendedSocialWorkspacePort) {
    await p.snapshot();
    const d = await p.saveDraft({ title: 'Synthetic', body: 'Example', channel: 'X', brand_id: 'default', archived: 0, planned_date: '' });
    const c = await p.connectChannel('X', 'Simulated example');
    return { d, r: await p.requestPublish(d.id, d.version, c.id) };
  }
  it('requires exact approval and refuses a repeated delivery', async () => {
    const p = create(features), { r } = await request(p);
    await expect(p.approvePublish(r.id, 'wrong')).rejects.toMatchObject({ error: { kind: 'conflict' } });
    expect((await p.approvePublish(r.id, r.content_sha256)).receipt).toMatchObject({ simulated: true, readback: 'simulated' });
    await expect(p.approvePublish(r.id, r.content_sha256)).rejects.toMatchObject({ error: { kind: 'conflict' } });
  });
  it('invalidates pending snapshots when draft versions change', async () => {
    const p = create(features), { d, r } = await request(p);
    await p.saveDraft({ ...d, title: 'Changed' });
    expect((await p.snapshot()).publishing?.requests.find(x => x.id === r.id)?.status).toBe('invalidated');
  });
});
it('does not transport missing capabilities or retry an unknown approval', async () => {
  const stub = createWireStub({ features });
  let approvals = 0;
  const p = createLiveSocialPort({ async call(route, params) {
    if (route === 'publishingApprove') { approvals++; await stub.transport.call(route, params); throw new Error('synthetic lost response'); }
    return stub.transport.call(route, params);
  } });
  await expect(p.source('x')).rejects.toMatchObject({ error: { kind: 'invalid' } });
  expect(stub.calls).toHaveLength(0);
  await p.snapshot();
  const draft = await p.saveDraft({ title: 'Example', body: 'Synthetic', channel: 'X', brand_id: 'default', archived: 0, planned_date: '' });
  const connection = await p.connectChannel('X', 'Simulated example');
  const request = await p.requestPublish(draft.id, draft.version, connection.id);
  await expect(p.approvePublish(request.id, request.content_sha256)).rejects.toMatchObject({ error: { kind: 'unknown' } });
  expect((await stub.service.port.snapshot()).publishing?.requests[0]?.status).toBe('delivered_simulated');
  expect(approvals).toBe(1);
});
