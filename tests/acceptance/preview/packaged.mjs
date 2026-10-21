import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { join, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, connect, until } from '../runtime.mjs';

const args = process.argv.slice(2);
const option = name => { const index=args.indexOf(name);return index<0?undefined:args[index+1]; };
const binary = option('--binary'), profiles = option('--profile-parent'), evidenceParent = option('--evidence');
for (const path of [binary, profiles, evidenceParent]) assert.ok(path && isAbsolute(path), 'Explicit absolute binary, profile-parent, evidence paths required');
assert.ok(relative(fileURLToPath(new URL('../../../',import.meta.url)),resolve(evidenceParent)).startsWith('..'), 'Evidence must remain outside repository');
assert.ok(binary.endsWith('.app/Contents/MacOS/HQ'), 'Expected staged HQ bundle executable');
await mkdir(evidenceParent, { recursive: true });
const evidence = await mkdtemp(join(evidenceParent, 'packaged-'));
const runtime = await createRuntime(profiles);
const report = { schema: 'hq-preview-packaged-switch/v2', binary, profile: runtime.root, platform: process.platform, outcome: 'failed' };
let log = '', child;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{report.cancelled=signal;void runtime.close().catch(error=>{report.cleanupError=error.stack;});});
try {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HQ_') && !['ELECTRON_RUN_AS_NODE','NODE_OPTIONS'].includes(key)));
  // Every switch and fault hook points only at the owned profile; a packaged start must ignore all of them.
  Object.assign(env, { HQ_QUALIFY_PREVIEW: '1', HQ_USER_DATA_DIR: runtime.root, HQ_PREVIEW_FAULT: 'mutation' });
  child = runtime.spawn(binary, [`--user-data-dir=${runtime.root}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--inspect=0'], { env, stdio: ['ignore','ignore','pipe'] });
  let endpoint, inspector; child.stderr.on('data', bytes => { log = (log + bytes).slice(-64000); endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(log)?.[1]; inspector = /Debugger listening on (ws:\/\/\S+)/.exec(log)?.[1]; });
  await until(() => { if (child.exitCode !== null || child.launchError) throw Error('Packaged start failed: '+log); return endpoint && inspector; }, 'packaged debugger');
  const main = await connect(inspector, runtime);
  report.main = await main.evaluate(`(()=>{const {app}=process.getBuiltinModule('module').createRequire(process.execPath)('electron');return {packaged:app.isPackaged,electron:process.versions.electron,qualificationGlobal:typeof globalThis.__hqPreviewQualification,switchesPresent:process.env.HQ_QUALIFY_PREVIEW==='1'&&process.env.HQ_PREVIEW_FAULT==='mutation'}})()`);
  assert.deepEqual({ packaged: report.main.packaged, qualificationGlobal: report.main.qualificationGlobal, switchesPresent: report.main.switchesPresent }, { packaged: true, qualificationGlobal: 'undefined', switchesPresent: true });
  // Keep the temporary window out of the way: lower-left of the primary work area, fully visible.
  report.window = await until(() => main.evaluate(`(()=>{const {BrowserWindow,screen}=process.getBuiltinModule('module').createRequire(process.execPath)('electron');const [w]=BrowserWindow.getAllWindows();if(!w)return null;const area=screen.getPrimaryDisplay().workArea,b=w.getBounds();w.setPosition(area.x+33,area.y+area.height-b.height);return w.getBounds()})()`), 'packaged window');
  const target = await until(async () => (await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t=>t.type==='page' && t.url.startsWith('file:')), 'packaged HQ renderer');
  const cdp = await connect(target.webSocketDebuggerUrl, runtime);
  await until(()=>cdp.evaluate('!!window.hqServices?.preview'), 'packaged preload');
  if (process.platform === 'darwin') {
    // Mac preview is enabled in production (status.ts); the switch neither enables nor alters it.
    const site = await runtime.listen(createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>packaged switch</title>'); }));
    report.result = await cdp.evaluate(`window.hqServices.preview.call('open',{versionId:'qualification-switch',url:${JSON.stringify(site + '/')},viewport:{w:390,h:844,dpr:1},label:'packaged switch'})`);
    assert.equal(report.result.ok, true, JSON.stringify(report.result));
    report.closed = await cdp.evaluate(`window.hqServices.preview.call('close',{sessionId:${JSON.stringify(report.result.value.sessionId)}})`);
    assert.deepEqual(report.closed, { ok: true, value: null });
    report.result = { ok: true, status: report.result.value.status, pickQualified: report.result.value.pickQualified };
  } else {
    report.result = await cdp.evaluate(`window.hqServices.preview.call('open',{versionId:'qualification-switch',url:'http://127.0.0.1:1/',viewport:{w:390,h:844,dpr:1},label:'switch refusal'})`);
    assert.deepEqual(report.result, { ok: false, kind: 'unavailable', reason: 'disabled' });
  }
  report.binarySha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  report.outcome = 'passed';
} catch(error) { report.error = error.stack; }
finally {
  await runtime.close().then(()=>{ report.cleanup='passed'; }, error=>{ report.cleanup='failed';report.cleanupError=error.stack;report.outcome='failed'; });
  try{await access(runtime.root);report.cleanup='failed';report.outcome='failed';report.cleanupError='Owned profile survived';}catch(error){if(error.code!=='ENOENT'){report.cleanup='failed';report.outcome='failed';report.cleanupError=error.stack;}}
  if(child?.pid){try{process.kill(-child.pid,0);report.cleanup='failed';report.outcome='failed';report.cleanupError='Owned process group survived';}catch(error){if(error.code!=='ESRCH'){report.cleanup='failed';report.outcome='failed';report.cleanupError=error.stack;}}}
  if(report.cancelled) report.outcome='failed';
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(evidence,'native.log'),log);
  console.log(JSON.stringify({ evidence, ...report })); process.exitCode=report.outcome==='passed'?0:1;
}
