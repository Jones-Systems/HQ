import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import type { HqServices } from '@hq/contracts/services';
import type { ModulePort } from '@hq/contracts';
import { createServiceDomains } from './services/domains';
import { createServices, sendHttp, type HttpCall, type Transport } from '../electron/services';
import type { ServiceConfig } from '../electron/service-config';
import { createLiveSocialPort } from '../../../modules/social/live';
import type { Draft, SaveDraft } from '../../../modules/social/core';

// Real-service E2E: the clean-room HQ Social service (services/social) runs as a disposable loopback
// process, and every call goes through the actual main-process bridge (createServices + sendHttp).
interface Running { child: ChildProcessByStdio<null, Readable, Readable>; url: URL; exited: Promise<unknown> }

function start(data: string, port: number): Promise<Running> {
  const child = spawn('python3', ['-m', 'social_service', '--data', data, '--host', '127.0.0.1', '--port', String(port)],
    { cwd: 'services/social', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  const exited = once(child, 'exit');
  let output = ''; let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  return new Promise<Running>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`UNKNOWN: Social service startup timed out: ${stderr}`)), 10_000);
    child.on('error', error => { clearTimeout(timer); reject(new Error(`UNKNOWN: Social service startup: ${error.message}`)); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`UNKNOWN: Social service exited ${code}: ${stderr}`)); });
    child.stdout.on('data', b => {
      output += b;
      const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(output);
      if (match) { clearTimeout(timer); resolve({ child, url: new URL(match[0]), exited }); }
    });
  });
}
async function stop(running: Running | undefined) {
  if (!running) return;
  if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill('SIGTERM');
  await running.exited;
}

const props = (): ModulePort => ({ context: { id: 'social-live', name: 'Synthetic Social' }, destination: 'library', appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: vi.fn() });
const configured = { configured: true, policy: 'ok', transport: 'loopback-http' } as const;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('drives the real disposable Social service through the main bridge: drafts, slot, link, run and token refresh after restart', async () => {
  const data = join(await mkdtemp(join(tmpdir(), 'hq-social-live-')), 'social');
  let running: Running | undefined = await start(data, 0);
  const url = running.url;
  const calls: string[] = [];
  const transport: Transport = async (endpoint: URL, call: HttpCall) => {
    const response = await sendHttp(endpoint, call);
    calls.push(`${call.method} ${call.path} ${response.ok ? response.status : response.kind}`);
    return response;
  };
  const config: ServiceConfig = { get: () => url, status: () => configured, set: async () => configured };
  const main = createServices(config, transport);
  const services: HqServices = { social: { call: main.social }, work: { call: async () => ({ ok: false, kind: 'unavailable' }) }, config: { status: async () => configured, set: async () => configured }, design: { call: async () => ({ ok: false, kind: 'unavailable' }) } };
  try {
    const port = createLiveSocialPort(services.social);
    const snapshot = await port.snapshot();
    expect(snapshot.features).toEqual(expect.arrayContaining(['hq-editorial-timebox-v1', 'hq-references-v1']));
    const brand = await port.addBrand('Synthetic roastery');

    // Draft create with a timed planning slot and a saved HQ reference link.
    const link = { version: 1, domain: 'work', projectId: 'hq-local', kind: 'item', entityId: 'item-1', title: 'Plan the cupping hour', returnDestination: { domain: 'social', destination: 'library' } } as const;
    const slot = { start: '09:15', duration_minutes: 30, timezone: 'America/New_York' };
    const fields: SaveDraft = { title: 'Cupping hour invite', body: 'Free tasting on Saturday.', brand_id: brand.id, channel: 'X', planned_date: '2026-12-05', archived: 0, planning_slot: slot, links: [link] };
    const created = await port.saveDraft(fields);
    expect(created).toMatchObject({ version: 1, planning_slot: slot, links: [link] });

    // Draft update keeps the slot and the link, and bumps the version.
    const updated = await port.saveDraft({ ...fields, body: 'Free tasting on Saturday at nine.', id: created.id, version: created.version });
    expect(updated).toMatchObject({ id: created.id, version: 2, body: 'Free tasting on Saturday at nine.', planning_slot: slot, links: [link] });

    // A save against the old version is a typed conflict, and nothing changes.
    await expect(port.saveDraft({ ...fields, body: 'Stale window', id: created.id, version: created.version }))
      .rejects.toMatchObject({ error: { kind: 'conflict', message: expect.stringMatching(/changed in another window/) } });
    const afterConflict = (await port.snapshot()).content.find(d => d.id === created.id);
    expect(afterConflict).toMatchObject({ version: 2, body: 'Free tasting on Saturday at nine.' });

    // A real example run through the network-denied worker reaches succeeded.
    const sample = await port.example('x-studio');
    const queued = await port.submitRun('x-studio', sample, true);
    expect(['queued', 'running', 'succeeded']).toContain(queued.status);
    let run = queued;
    for (let i = 0; i < 150 && run.status !== 'succeeded' && run.status !== 'failed'; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      run = await port.run(queued.id);
    }
    expect(run).toMatchObject({ id: queued.id, status: 'succeeded', error: null, output: { ok: true } });

    // The mounted Social UI reads the same live workspace.
    const domains = createServiceDomains(() => services);
    render(<domains.Social {...props()} />);
    expect((await screen.findAllByText('Cupping hour invite')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Fictional example/)).toBeNull();
    cleanup();

    // Restart on the same port and data: the old token is refused once, the bridge refreshes it
    // silently and the save goes through; the draft, slot and link survived the restart.
    await stop(running); running = undefined;
    running = await start(data, Number(url.port));
    expect(running.url.href).toBe(url.href);
    const before = calls.length;
    const restarted: Draft = await port.saveDraft({ ...fields, body: 'Saved after a restart.', id: updated.id, version: updated.version });
    expect(calls.slice(before)).toEqual(['POST /api/content 403', 'GET /api/workspace 200', 'POST /api/content 200']);
    expect(restarted).toMatchObject({ id: created.id, version: 3, body: 'Saved after a restart.', planning_slot: slot, links: [link] });
    const persisted = (await port.snapshot()).content.find(d => d.id === created.id);
    expect(persisted).toMatchObject({ version: 3, planning_slot: slot, links: [link] });
  } finally {
    cleanup(); await stop(running);
    await rm(join(data, '..'), { recursive: true, force: true });
  }
}, 30_000);
