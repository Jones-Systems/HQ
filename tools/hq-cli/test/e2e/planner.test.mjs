import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conforms } from '../../src/schema.ts';
import { schemas } from '../../src/commands.ts';
import { withService, plannerRoot } from './service.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
const optIn = process.env.HQ_CLI_E2E === '1' ? false : 'Set HQ_CLI_E2E=1 to run the in-tree synthetic Planner E2E';
const instant = '2030-01-02T12:00:00Z';
// One CLI invocation as a subprocess; `expectOk` false returns failures for inspection.
const cliFor = origin => async (args, frozen = true, expectOk = true) => {
  const launch = frozen ? [resolve(here, 'driver.mjs'), instant] : [resolve(here, '../../bin/hq')];
  const { stdout } = await exec(process.execPath, [...launch, '--planner-url', origin, ...args], { env: { ...process.env, HQ_PLANNER_URL: origin }, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }).catch(error => { if (expectOk || typeof error.stdout !== 'string') throw error; return error; });
  const lines = stdout.trim().split('\n'); assert.equal(lines.length, 1, stdout);
  const result = JSON.parse(lines[0]); assert.equal(result.schema, 'hq.cli.result/v1'); if (expectOk) assert.equal(result.ok, true, stdout);
  assert.equal(conforms(schemas().find(c => c.id === result.command).output, result), true, result.command);
  return result;
};
// Store a row the current validator would refuse, as a legacy or pre-upgrade record.
const seedRow = (column, value) => async data => {
  const script = 'import sys\nfrom planning.store import Store\nstore = Store(sys.argv[1])\n_, created, _ = store.create_item({"title": "Seeded legacy row"})\nstore._conn.execute(f"UPDATE items SET {sys.argv[2]} = ? WHERE id = ?", (sys.argv[3], created["item"]["id"]))\nstore.close()';
  await exec('python3', ['-c', script, data, column, JSON.stringify(value)], { cwd: plannerRoot, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 15000 });
};
const target = { version: 1, domain: 'work', projectId: 'synthetic-project', kind: 'item', entityId: 'target01', title: 'Synthetic target', returnDestination: { domain: 'work', destination: 'item/target01' }, sourceRevision: '4', workspaceId: 'synthetic-workspace' };

test('in-tree Planner: five-item owner example, discovery, separate dates, replay and HQ references', { skip: optIn }, async () => {
  let ownedRoot, servicePid;
  await withService(async ({ origin, root, pid }) => {
    ownedRoot = root; servicePid = pid;
    const save = async (name, value) => { const path = resolve(root, name); await writeFile(path, JSON.stringify(value)); return path; };
    const cli = cliFor(origin);
    const status = await cli(['planner', 'status']);
    assert.ok(status.data.features.includes('items.batch_create')); assert.ok(status.data.features.includes('requests.replay'));
    assert.ok(status.data.features.includes('hq-references-v1'), 'The accepted HQ references backend must be integrated before qualifying this E2E');
    const board = await cli(['planner', 'boards']);
    assert.equal(board.data.multiple_boards, false); assert.equal(board.data.boards[0].id, 'planner:main'); assert.equal(board.data.boards[0].columns.length, 7);
    const now = await cli(['planner', 'now']);
    assert.equal(now.data.today, '2030-01-02'); assert.equal(now.data.tomorrow, '2030-01-03'); assert.equal(now.data.weekdays.Friday[0], '2030-01-04');
    const items = Array.from({ length: 5 }, (_, index) => ({ title: `Synthetic owner task ${index + 1}`, area: 'Owner example', dates: [{ kind: 'target', value: index < 3 ? '2030-01-02' : '2030-01-03' }, { kind: 'deadline', value: index < 3 ? '2030-01-04' : '2030-01-08' }] }));
    const spec = await save('batch.json', { schema: 'hq.planner.batch-create/v1', board: 'planner:main', items });
    const created = await cli(['planner', 'items', 'create-batch', '--spec-file', spec, '--request-id', 'owner-example-atomic']);
    assert.equal(created.effect, 'applied'); assert.equal(created.data.mode, 'atomic'); assert.equal(created.data.results.length, 5);
    const ids = created.data.results.map(r => r.item.id); assert.equal(new Set(ids).size, 5);
    const filtered = async (kind, day) => (await cli(['planner', 'items', 'list', '--area', 'Owner example', '--date-kind', kind, '--from', day, '--to', day])).data.items;
    for (const [kind, day, expected] of [['target', '2030-01-02', ids.slice(0, 3)], ['target', '2030-01-03', ids.slice(3)], ['deadline', '2030-01-04', ids.slice(0, 3)], ['deadline', '2030-01-08', ids.slice(3)], ['deadline', '2030-01-02', []]]) {
      const found = await filtered(kind, day); assert.deepEqual(found.map(i => i.id).sort(), [...expected].sort());
      for (const value of found) assert.deepEqual(value.dates.map(d => [d.kind, d.value]), items[ids.indexOf(value.id)].dates.map(d => [d.kind, d.value]));
    }
    const known = await save('known.json', created);
    for (const suffix of [['--check'], []]) {
      const replayed = await cli(['planner', 'replay', '--request-file', known, ...suffix]);
      assert.equal(replayed.effect, 'replayed'); assert.equal(replayed.data.outcome, 'replayed'); assert.deepEqual(replayed.data.response.items.map(i => i.id), ids);
      assert.equal(replayed.replay.body_b64, created.replay.body_b64); assert.equal(replayed.replay.sent_after_version, created.replay.sent_after_version);
    }
    const fresh = await save('unsent.json', { ...created.replay, request_id: 'fresh-unsent-request', method: 'POST', path: '/api/items', body_b64: Buffer.from(JSON.stringify({ fields: { title: 'Never sent' } })).toString('base64'), sent_after_version: (await cli(['planner', 'status'])).data.state_version });
    const checked = await cli(['planner', 'replay', '--request-file', fresh, '--check']);
    assert.equal(checked.data.outcome, 'not_applied'); assert.equal(checked.effect, 'none');
    assert.equal((await cli(['planner', 'items', 'list', '--area', 'Owner example'])).data.items.length, 5);
    const sequentialSpec = await save('sequential.json', { schema: 'hq.planner.batch-create/v1', board: 'planner:main', items: [{ title: 'Sequential one' }, { title: 'Sequential two' }] });
    const sequential = await cli(['planner', 'items', 'create-batch', '--mode', 'sequential', '--spec-file', sequentialSpec]);
    assert.equal(sequential.data.mode, 'sequential'); assert.deepEqual(sequential.data.results.map(r => r.status), ['created', 'created']);
    const progress = await save('progress.json', sequential);
    const resumed = await cli(['planner', 'items', 'create-batch', '--resume-from', progress]);
    assert.equal(resumed.effect, 'none'); assert.deepEqual(resumed.data.results.map(r => r.item.id), sequential.data.results.map(r => r.item.id));
    const liveNow = await cli(['planner', 'now'], false);
    const state = await (await fetch(`${origin}/api/state`)).json();
    const serviceDay = new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.default_tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(state.server_time));
    assert.equal(liveNow.data.today, serviceDay);
    const relative = await cli(['planner', 'items', 'create', '--title', 'Relative echo', '--planned', 'today', '--due', 'tomorrow'], false);
    assert.deepEqual(relative.data.dates, [{ input: 'today', resolved: serviceDay, tz: state.settings.default_tz, today: serviceDay }, { input: 'tomorrow', resolved: liveNow.data.tomorrow, tz: state.settings.default_tz, today: serviceDay }]);
    const fields = await save('references.json', { title: 'HQ linked', references: [{ kind: 'hq', label: 'Link', target }] });
    const linked = await cli(['planner', 'items', 'create', '--fields-file', fields]);
    assert.deepEqual(linked.data.item.references[0].target, target);
    const patch = await save('patch.json', { references: [{ ...linked.data.item.references[0], target: { ...target, sourceRevision: '5' } }] });
    const updated = await cli(['planner', 'items', 'update', linked.data.item.id, '--revision', String(linked.data.item.revision), '--fields-file', patch]);
    const read = await cli(['planner', 'items', 'get', linked.data.item.id]);
    assert.deepEqual(read.data.item.references, updated.data.item.references); assert.equal(read.data.item.references[0].target.sourceRevision, '5');
    const listed = await cli(['planner', 'items', 'list']);
    assert.deepEqual(listed.data.items.find(i => i.id === linked.data.item.id).references, read.data.item.references);
    assert.equal(listed.data.items.some(i => i.title === 'Never sent'), false);
  });
  await assert.rejects(access(ownedRoot), { code: 'ENOENT' });
  assert.throws(() => process.kill(servicePid, 0), { code: 'ESRCH' });
});

test('in-tree service cleanup preserves deliberate failure and removes its child and scratch', { skip: optIn }, async () => {
  let ownedRoot, servicePid;
  await assert.rejects(withService(async ({ root, pid }) => { ownedRoot = root; servicePid = pid; throw Error('deliberate synthetic failure'); }), /deliberate synthetic failure/);
  await assert.rejects(access(ownedRoot), { code: 'ENOENT' });
  assert.throws(() => process.kill(servicePid, 0), { code: 'ESRCH' });
});

test('in-tree service crash mid-test surfaces the child exit, not only a refused request', { skip: optIn }, async () => {
  let ownedRoot, servicePid;
  const failure = await withService(async ({ origin, root, pid }) => {
    ownedRoot = root; servicePid = pid;
    process.kill(pid, 'SIGKILL');
    for (let attempt = 0; attempt < 100; attempt++) await fetch(`${origin}/api/version`, { signal: AbortSignal.timeout(1000) });
    throw Error('Killed service kept answering');
  }).then(() => assert.fail('withService resolved after its service was killed'), error => error);
  assert.ok(failure instanceof AggregateError, String(failure));
  assert.match(failure.message, /exited unexpectedly \(SIGKILL\)/);
  await assert.rejects(access(ownedRoot), { code: 'ENOENT' });
  assert.throws(() => process.kill(servicePid, 0), { code: 'ESRCH' });
});

// Cross-component regressions for HQR-A3 server fixes. Enable (drop `todo`) after A3 merges.
const afterA3 = 'Enable after HQR-A3 merges (WHATWG URL ports, read-time date derivation) and the lone-surrogate rejection (A3 validation with an A4 vector)';
const legacyRef = { id: 'legacyp1', kind: 'url', label: 'Typo port', url: 'http://example.com:abc/' };
test('stored legacy URL with a non-numeric port stays readable through the CLI', { skip: optIn, todo: afterA3 }, async () => {
  await withService(async ({ origin }) => {
    const cli = cliFor(origin);
    const [listed] = (await cli(['planner', 'items', 'list'])).data.items;
    assert.deepEqual(listed.references, [legacyRef]);
    assert.deepEqual((await cli(['planner', 'items', 'get', listed.id])).data.item.references, [legacyRef]);
  }, { seed: seedRow('refs', [legacyRef]) });
});

const gapDate = { id: 'gapdate1', kind: 'event', precision: 'day', value: '2030-03-10', time: '02:30', end_time: null, tz: 'America/New_York', note: '' };
test('snapshot stays readable with a stored DST-gap time', { skip: optIn, todo: afterA3 }, async () => {
  await withService(async ({ origin }) => {
    const [listed] = (await cliFor(origin)(['planner', 'items', 'list'])).data.items;
    assert.deepEqual(listed.dates.map(({ id, value, time, tz }) => ({ id, value, time, tz })), [{ id: gapDate.id, value: gapDate.value, time: gapDate.time, tz: gapDate.tz }]);
  }, { seed: seedRow('dates', [gapDate]) });
});

test('snapshot stays readable after a lone-surrogate HQ target write attempt', { skip: optIn, todo: afterA3 }, async () => {
  await withService(async ({ origin, root }) => {
    const cli = cliFor(origin), fields = resolve(root, 'surrogate.json');
    await writeFile(fields, JSON.stringify({ title: 'Surrogate', references: [{ kind: 'hq', target: { ...target, title: 'Broken \ud800 title' } }] }));
    const attempt = await cli(['planner', 'items', 'create', '--fields-file', fields], true, false);
    assert.ok(attempt.ok || attempt.error.code === 'validation_error', JSON.stringify(attempt.error));
    assert.equal((await fetch(`${origin}/api/state`)).status, 200);
    await cli(['planner', 'items', 'list']);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`in-tree service ${signal} cancellation cleans its exact scratch and child`, { skip: optIn }, async () => {
  const runner = spawn(process.execPath, [resolve(here, 'cancel.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let owned;
  try {
    owned = await new Promise((done, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('Cancellation fixture timed out')), 15000);
      runner.once('error', error => { clearTimeout(timer); reject(error); });
      runner.once('exit', code => { clearTimeout(timer); reject(Error(`Cancellation fixture exited early: ${code}`)); });
      runner.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) { clearTimeout(timer); done(JSON.parse(output.trim())); } });
    });
    const exited = new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error('Cancellation cleanup timed out')), 10000);
      runner.once('exit', (code, exitSignal) => { clearTimeout(timer); done({ code, signal: exitSignal }); });
    });
    runner.kill(signal);
    assert.deepEqual(await exited, { code: signal === 'SIGINT' ? 130 : 143, signal: null });
    await assert.rejects(access(owned.root), { code: 'ENOENT' });
    assert.throws(() => process.kill(owned.pid, 0), { code: 'ESRCH' });
  } finally {
    if (runner.exitCode === null && runner.signalCode === null) {
      await new Promise(done => { runner.once('close', done); runner.kill('SIGTERM'); });
    }
  }
});
