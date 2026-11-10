import assert from 'node:assert/strict';
import { constants as osConstants } from 'node:os';
import { readFile, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { join, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, connect, until } from '../runtime.mjs';
import { openPreviewEvidence } from './evidence.mjs';

const args = process.argv.slice(2);
const option = name => { const index=args.indexOf(name);return index<0?undefined:args[index+1]; };
const binary = option('--binary'), profiles = option('--profile-parent'), evidenceParent = option('--evidence');
for (const path of [binary, profiles, evidenceParent]) assert.ok(path && isAbsolute(path), 'Explicit absolute binary, profile-parent, evidence paths required');
assert.ok(relative(fileURLToPath(new URL('../../../',import.meta.url)),resolve(evidenceParent)).startsWith('..'), 'Evidence must remain outside repository');
assert.ok(binary.endsWith('.app/Contents/MacOS/HQ'), 'Expected staged HQ bundle executable');
const repo = fileURLToPath(new URL('../../../',import.meta.url));
let evidence, evidenceRun, runtime, expectedTeardown = false;
const report = { schema: 'hq-preview-packaged-switch/v2', binary, profile: undefined, platform: process.platform, outcome: 'failed' };
let log = '', child;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{report.cancelled??=signal;evidenceRun?.observeOutcome({code:null,signal});expectedTeardown=true;void runtime?.close().catch(error=>{report.cleanupError=error.stack;});});
try {
  evidenceRun = await openPreviewEvidence({worktree:repo,parent:evidenceParent,scratchParent:profiles,report,
    stopProducer:async()=>{expectedTeardown=true;if(child)await runtime.stop(child);} });
  evidence = evidenceRun.directory;
  if(report.cancelled){evidenceRun.observeOutcome({code:null,signal:report.cancelled});throw Error('Cancelled: '+report.cancelled);}
  runtime = await createRuntime(profiles);
  if(report.cancelled)throw Error('Cancelled: '+report.cancelled);
  report.profile = runtime.root;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HQ_') && !['ELECTRON_RUN_AS_NODE','NODE_OPTIONS'].includes(key)));
  // Every switch and fault hook points only at the owned profile; a packaged start must ignore all of them.
  Object.assign(env, { HQ_QUALIFY_PREVIEW: '1', HQ_USER_DATA_DIR: runtime.root, HQ_PREVIEW_FAULT: 'mutation' });
  child = runtime.spawn(binary, [`--user-data-dir=${runtime.root}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--inspect=0'], { env, stdio: ['ignore','ignore','pipe'] });
  child.once('error',error=>{evidenceRun.observeChildExit({pid:child.pid,error:error.message},expectedTeardown);});
  child.once('exit',(code,signal)=>{evidenceRun.observeChildExit({pid:child.pid,code,signal},expectedTeardown);});
  let endpoint, inspector; child.stderr.on('data', bytes => { void evidenceRun.append('native.log',bytes); log = (log + bytes).slice(-64000); endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(log)?.[1]; inspector = /Debugger listening on (ws:\/\/\S+)/.exec(log)?.[1]; });
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
} catch(error) { report.error = error.stack;evidenceRun?.observeOutcome({code:1,signal:null}); }
finally {
  const cleanup = async () => {
    expectedTeardown = true;
    await runtime?.close().then(()=>{ report.cleanup='passed'; }, error=>{ report.cleanup='failed';report.cleanupError=error.stack;report.outcome='failed'; });
    if(runtime)try{await access(runtime.root);report.cleanup='failed';report.outcome='failed';report.cleanupError='Owned profile survived';}catch(error){if(error.code!=='ENOENT'){report.cleanup='failed';report.outcome='failed';report.cleanupError=error.stack;}}
    if(child?.pid){try{process.kill(-child.pid,0);report.cleanup='failed';report.outcome='failed';report.cleanupError='Owned process group survived';}catch(error){if(error.code!=='ESRCH'){report.cleanup='failed';report.outcome='failed';report.cleanupError=error.stack;}}}
  };
  const verify = async () => {
    if(report.cancelled || report.cleanup!=='passed' || report.evidenceError) report.outcome='failed';
  };
  let final;
  if(evidenceRun) final=await evidenceRun.finalize({cleanup,verify,outcome:()=>({code:report.outcome==='passed'?0:1,signal:null})});
  else{await cleanup();await verify();report.outcome='failed';}
  console.log(JSON.stringify({ evidence, ...report })); process.exitCode=final?.signal?128+(osConstants.signals[final.signal]??1):final?.code??1;
}
