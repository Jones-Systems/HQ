import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access, appendFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createRuntime, connect, until } from '../runtime.mjs';
import { createNetworkCanaries } from './network.mjs';
import { observeFileChooser } from './chooser.mjs';
import { createSyntheticTls } from './tls.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const evidenceParent = option('--evidence');
const keepTestWindowVisible = args.includes('--keep-test-window-visible');
if (!evidenceParent || !isAbsolute(evidenceParent) || !relative(repo, resolve(evidenceParent)).startsWith('..')) throw Error('--evidence must be an absolute private path outside the repository');
if (process.platform !== 'darwin') throw Error('This runner qualifies the native macOS route only');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
await mkdir(evidenceParent, { recursive: true });
const evidence = await mkdtemp(join(evidenceParent, 'evidence-'));
const runtime = await createRuntime(join(evidenceParent, 'scratch'));
const report = { schema: 'hq-preview-native/v1', head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), dirty: git('status', '--short'), platform: process.platform, architecture: process.arch, node: process.version, invocation: process.argv, evidence, rows: [], outcome: 'unmeasured', networkClaim: 'Normal browser network reach; literal URL filtering is hygiene only.' };
report.windowArrangement = { requested: keepTestWindowVisible };
let log = '', main, shell, child, endpoint, cancelled, arrangedWindow;
const electronModule = "process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')";
let evidenceWrites = Promise.resolve(), stopNative;
const nativeStopped = new Promise(resolve => { stopNative = resolve; });
class Unmeasured extends Error {}
class EnvironmentOccluded extends Unmeasured {}
class NativeStopped extends Error {}
class PlannedStop extends Error {}
let stopForOcclusion;
const environmentStopped = new Promise(resolve => { stopForOcclusion = resolve; });
const persist = (name, text) => {
  evidenceWrites = evidenceWrites.then(() => appendFile(join(evidence, name), text)).catch(error => { report.evidenceError = error.stack; });
  return evidenceWrites;
};
const emit = event => {
  const entry = { at: new Date().toISOString(), ...event };
  console.log(JSON.stringify(entry));
  return persist('events.jsonl', JSON.stringify(entry) + '\n');
};
function assertNative() {
  if (cancelled) throw new NativeStopped(`Cancelled: ${cancelled}`);
  if (child?.launchError || child?.exitCode != null || child?.signalCode != null) throw new NativeStopped(`Native child stopped: ${JSON.stringify(report.nativeExit ?? { error: child.launchError?.message, code: child.exitCode, signal: child.signalCode })}`);
}
const nativeCall = async fn => {
  assertNative();
  return Promise.race([fn(), nativeStopped.then(error => { throw error; })]);
};
const previewConnections = new Map();
let rowDepth = 0;
const check = async (id, scenario, fn) => {
  assertNative();
  await emit({ type: 'row-start', id, scenario });
  const connectionsBefore = new Set(previewConnections.keys());
  let row, stopped, baseline = [];
  const nested = rowDepth++ > 0;
  try {
    baseline = report.hooksAvailable ? await hook('sessions()') : [];
    assert.ok(nested || baseline.length === 0, 'Unexpected preview session before row');
    const observed = await Promise.race([nativeCall(fn), environmentStopped.then(error => { throw error; })]);
    row = { id, scenario, outcome: 'passed', observed };
  } catch (error) {
    stopped = error instanceof NativeStopped || error instanceof EnvironmentOccluded ? error : null;
    row = { id, scenario, outcome: error instanceof Unmeasured ? 'unmeasured' : 'failed', error: error.stack, observed: error.observed };
  } finally {
    rowDepth--;
    try {
      assertNative();
      if (report.hooksAvailable) {
        const survivors = (await hook('sessions()')).filter(s => !nested || !baseline.some(b => b.sessionId === s.sessionId));
        row.cleanup = { survivingSessionIds: survivors.map(s => s.sessionId) };
        if (survivors.length) {
          row.outcome = 'failed';
          row.cleanup.orphanFailure = 'Row left native preview sessions alive';
          for (const session of survivors) value(await api('close', { sessionId: session.sessionId }));
          const remaining = await hook('sessions()');
          assert.ok(survivors.every(s => !remaining.some(r => r.sessionId === s.sessionId)), 'Row cleanup left orphan sessions');
        }
        if (!nested && (await hook('stats()')).overlayHidden) {
          row.outcome = 'failed'; row.cleanup.overlayLeftOpen = true;
          const closed = await shell.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Back to'));b?.click();return !!b})()`);
          assert.equal(closed, true, 'Cannot restore Settings after failed row');
          await until(async () => !(await hook('stats()')).overlayHidden, 'row overlay cleanup');
        }
        row.cleanup.completed = true;
      }
    } catch (error) {
      row.outcome = 'failed'; row.cleanupError = error.stack;
      if (error instanceof NativeStopped) stopped = error;
    }
    for (const [id, cdp] of previewConnections) if (!connectionsBefore.has(id)) { cdp.close(); previewConnections.delete(id); }
  }
  report.rows.push(row); await persist('rows.jsonl', JSON.stringify(row) + '\n');
  await emit({ type: 'row-end', id, scenario, outcome: row.outcome });
  if (stopped) throw stopped;
  if (row.cleanupError) throw Error('Row cleanup failed; stopping to prevent contamination: ' + row.cleanupError);
  if (report.baselineRestoreError) throw Error('Domain baseline restoration failed; stopping to prevent contamination: ' + report.baselineRestoreError);
  assertNative();
};
const unmeasured = (id, scenario, reason) => report.rows.push({ id, scenario, outcome: 'unmeasured', reason });
const api = async (route, params) => {
  assertNative(); await emit({ type: 'api-start', route });
  const result = await nativeCall(() => shell.evaluate(`window.hqServices.preview.call(${JSON.stringify(route)},${JSON.stringify(params)})`));
  await emit({ type: 'api-end', route, ok: result.ok, kind: result.kind }); return result;
};
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const hook = expression => nativeCall(() => main.evaluate(`globalThis.__hqPreviewQualification.${expression}`));
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;color-scheme:dark;background:#17191d;color:#c2c6cd;font:16px monospace}#spacer{height:40px}#target{margin:20px;width:240px;height:60px;background:#303640;color:#c2c6cd;border:1px solid #454b55}#tail{height:1600px}</style></head><body><div id="spacer"></div><button id="target">Qualification target</button><p id="quote">Select this exact synthetic quote.</p><input id="file" type="file"><div id="tail"></div></body></html>`;
let origin, crossOrigin, canaries;
async function open(viewport = { w: 1280, h: 800, dpr: 1 }, url = origin) {
  const opened = await api('open', { versionId: 'preview-qualification', url, viewport, label: 'Synthetic native qualification' });
  if (!opened.ok) {
    const error = new Error('Native preview open failed: ' + JSON.stringify(opened));
    error.observed = { result: opened };
    try { if (report.hooksAvailable) error.observed.stats = await hook('stats()'); }
    catch (diagnosticError) { error.observed.diagnosticError = diagnosticError.stack; }
    throw error;
  }
  const session = value(opened);
  value(await api('place', { sessionId: session.sessionId, rect: { x: 0, y: 0, width: viewport.w, height: viewport.h }, visible: true }));
  const target = await until(async () => (await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith(url)), 'preview CDP target');
  await emit({type:'fixture-cdp-attach-start',targetId:target.id});
  const cdp = await nativeCall(()=>connect(target.webSocketDebuggerUrl, runtime));
  previewConnections.set(session.sessionId, cdp);
  await emit({type:'fixture-cdp-attach-end',targetId:target.id});
  return { session: value(await api('status', { sessionId: session.sessionId })), cdp, target };
}
async function withPreview(fn, viewport) {
  const p = await open(viewport);
  try {await drawable(p.cdp, 'workload');await emit({type:'fixture-workload-start'});const result=await nativeCall(()=>fn(p));await emit({type:'fixture-workload-end'});return result;}
  finally {if(!cancelled && !child.launchError && child.exitCode===null && child.signalCode===null)await api('close',{sessionId:p.session.sessionId});p.cdp.close();await emit({type:'fixture-cdp-close'});}
}
let occlusionNoticed = false;
async function drawable(cdp, stage) {
  const windows = await main.evaluate("process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),destroyed:w.isDestroyed()}))");
  const document = await cdp.evaluate('({visibility:document.visibilityState,focused:document.hasFocus()})');
  const mainDocument = await shell.evaluate('({visibility:document.visibilityState,focused:document.hasFocus()})');
  const bindings = [...previewConnections].filter(([, connection]) => connection === cdp);
  assert.equal(bindings.length, 1, 'Drawable sentinel requires exactly one owned preview session');
  let previewSession = null;
  if (report.hooksAvailable) {
    const sessions = (await hook('sessions()')).filter(session => session.sessionId === bindings[0][0]);
    assert.equal(sessions.length, 1, 'Drawable sentinel requires the exact live preview session');
    const {sessionId, visible, intendedVisible, overlayHidden, webContentsId} = sessions[0];
    previewSession = {sessionId, visible, intendedVisible, overlayHidden, webContentsId};
  }
  const owningWindowId = arrangedWindow?.id ?? (windows.length === 1 ? windows[0].id : null);
  const observed = {stage,owningWindowId,windows,document,mainDocument,sessionId:bindings[0][0],previewSession};
  await emit({type:'drawable-sentinel',...observed});
  if (!windows.some(w=>w.visible&&!w.minimized&&!w.destroyed) || document.visibility !== 'visible') {
    if (!occlusionNoticed) {occlusionNoticed=true;await emit({type:'environment-occluded',notice:'Native qualification stopped: keep the HQ test window visible and unobscured before a separately scheduled run.',...observed});}
    const error = new EnvironmentOccluded('unmeasured:environment-occluded');error.observed=observed;stopForOcclusion(error);throw error;
  }
}
const capture = async session => {
  const cdp = previewConnections.get(session.sessionId);
  assert.ok(cdp, 'Capture requires the owned preview connection for drawable evidence');
  await drawable(cdp, 'host-capture');
  return api('capture', { sessionId: session.sessionId, expectedGeneration: session.generation });
};
async function click(cdp, x = 80, y = 80) {
  await drawable(cdp, 'trusted-input');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const cancel = signal => { cancelled = signal; stopNative(new NativeStopped(`Cancelled: ${signal}`)); void emit({type:'cancelled',signal}); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => cancel(signal));
try {
  canaries = await createNetworkCanaries(runtime);
  origin = await runtime.listen(createServer((req, res) => {
    if (req.url.startsWith('/redirect')) { res.writeHead(302, { Location: canaries.alias + '/redirected' + new URL(req.url, 'http://fixture').search }); res.end(); }
    else if (req.url === '/download') { res.writeHead(200, { 'Content-Disposition': 'attachment; filename=synthetic.txt' }); res.end('synthetic'); }
    else if (req.url === '/auth') { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="synthetic"' }); res.end(); }
    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fixture); }
  }));
  crossOrigin = await runtime.listen(createServer((_req, res) => res.end('cross origin canary')));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HQ_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  await mkdir(join(runtime.root, 'tmp'));
  Object.assign(env, { HQ_USER_DATA_DIR: join(runtime.root, 'profile'), HQ_QUALIFY_PREVIEW: '1', TMPDIR: join(runtime.root, 'tmp') });
  let inspector;
  const electronBinary=option('--electron-binary') ?? join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  report.electronBinary=electronBinary;
  child = runtime.spawn(electronBinary, ['--host-resolver-rules=MAP hq-qualification.test 127.0.0.1', '--inspect=0', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', join(repo, 'apps/desktop/dist-electron/main.js')], { cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.once('error', error => { report.nativeExit={pid:child.pid,error:error.message};stopNative(new NativeStopped(error.message));void emit({type:'native-error',...report.nativeExit}); });
  child.once('exit', (code, signal) => { report.nativeExit={pid:child.pid,code,signal};stopNative(new NativeStopped(`Electron exited: code=${code}, signal=${signal}`));void emit({type:'native-exit',...report.nativeExit}); });
  child.stderr.on('data', bytes => { void persist('native.log',String(bytes)); log = (log + bytes).slice(-256000); endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(log)?.[1]; inspector = /Debugger listening on (ws:\/\/\S+)/.exec(log)?.[1]; });
  await emit({type:'native-start',pid:child.pid,binary:electronBinary});
  await until(() => { if (child.exitCode !== null || child.launchError) throw Error('Native launch failed: ' + (child.launchError?.message ?? `exit=${child.exitCode}`) + '\n' + log); return endpoint && inspector; }, 'Electron debug endpoints');
  if(args.includes('--fail-after-launch')) throw Error('Deliberate qualification lifecycle failure after native launch');
  main = await connect(inspector, runtime);
  try {report.nativeIdentity=await nativeCall(()=>main.evaluate(`(()=>{const {app}=${electronModule};return {isPackaged:app.isPackaged,architecture:process.arch,electron:process.versions.electron,userData:app.getPath('userData')}})()`));await emit({type:'native-identity',...report.nativeIdentity});}
  catch(error){assertNative();report.nativeIdentityUnavailable=error.message;await emit({type:'native-identity-unavailable',error:error.message});}
  if(report.nativeIdentity){assert.equal(report.nativeIdentity.isPackaged,false);assert.equal(report.nativeIdentity.architecture,'arm64');assert.equal(report.nativeIdentity.electron,'44.9.0');}
  const target = await until(async () => (await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('file:')), 'HQ renderer');
  shell = await connect(target.webSocketDebuggerUrl, runtime);
  await until(() => shell.evaluate('!!window.hqServices?.preview'), 'preview preload');
  report.desktop = await shell.evaluate('window.hqDesktop');
  assert.equal(report.desktop.versions.electron, '44.9.0');
  report.hooksAvailable = await main.evaluate('!!globalThis.__hqPreviewQualification');
  if (keepTestWindowVisible) {
    assert.ok(report.nativeIdentity, 'Window arrangement requires verified native identity');
    assert.equal(report.nativeIdentity.userData, join(runtime.root, 'profile'), 'Window arrangement requires the owned private profile');
    arrangedWindow = await until(async () => {
      const windows = await nativeCall(() => main.evaluate(`${electronModule}.BrowserWindow.getAllWindows().map(w=>({id:w.id,initialAlwaysOnTop:w.isAlwaysOnTop(),webContentsId:w.webContents.id}))`));
      assert.ok(windows.length <= 1, 'Window arrangement refuses multiple native windows');
      return windows.length === 1 ? windows[0] : null;
    }, 'exactly one owned test window');
    report.windowArrangement.initial = arrangedWindow;
    assertNative();
    const state = await main.evaluate(`(()=>{const {BrowserWindow}=${electronModule};const windows=BrowserWindow.getAllWindows();if(windows.length!==1||windows[0].id!==${arrangedWindow.id})throw Error('Owned test window changed before arrangement');const w=windows[0];w.setAlwaysOnTop(true);return {id:w.id,alwaysOnTop:w.isAlwaysOnTop(),visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused()}})()`);
    report.windowArrangement.arranged = state;
    await emit({type:'test-window-arranged',...state});
    assert.equal(state.alwaysOnTop, true, 'Owned test window stacking readback');
    report.windowArrangement.claim = 'foreground-arranged test window only';
  }
  for (const path of ['apps/desktop/dist/index.html', 'apps/desktop/dist-electron/main.js', 'apps/desktop/dist-electron/preload.cjs', 'apps/desktop/dist-electron/preview-agent/agent.js']) {
    report.build ??= {}; report.build[path] = digest(await readFile(join(repo, path)));
  }
  await check('Q-PV10', 'Main renderer CSP equals 73a6532 baseline', async () => {
    const baseline = git('show', '73a6532:apps/desktop/index.html').match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/s)?.[1];
    assert.ok(baseline, 'baseline CSP found');
    const actual = await shell.evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
    assert.equal(actual, baseline); return actual;
  });
  await check('Q-PV1', 'Native renderer exposes no HQ or Node globals', () => withPreview(async ({ cdp }) => {
    const globals = await cdp.evaluate(`Object.fromEntries(['require','process','hqServices','hqDesktop'].map(k=>[k,typeof window[k]]))`);
    assert.ok(Object.values(globals).every(v => v === 'undefined')); return globals;
  }));
  if(args.includes('--stop-after-first-preview'))throw new PlannedStop('Stopped after first native preview lifecycle');
  if (args.includes('--diagnose-capture-control')) {
    const diagnose = async phase => {
      let failed = false;
      await withPreview(async ({session, cdp}) => {
        const windows = await main.evaluate("process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),destroyed:w.isDestroyed()}))");
        const document = await cdp.evaluate('({visibility:document.visibilityState,focus:document.hasFocus(),width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
        await emit({type:'capture-diagnostic-state',phase,windows,document,sessions:await hook('sessions()'),stats:await hook('stats()')});
        for (const [stage, operation] of [
          ['agent-resolve', () => api('resolve',{sessionId:session.sessionId,generation:session.generation,requests:[{kind:'element',path:'#target'}]}).then(value)],
          ['host-capture', () => capture(session).then(value)],
          ['direct-screenshot', async () => {const shot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width:1280,height:800,scale:1}});const bytes=Buffer.from(shot.data,'base64');await writeFile(join(evidence,phase+'.png'),bytes);return {digest:digest(bytes),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};}],
        ]) {
          await emit({type:'capture-diagnostic-stage-start',phase,stage});
          try { const observed=await operation();await emit({type:'capture-diagnostic-stage-end',phase,stage,outcome:'passed',observed}); }
          catch(error){if(error instanceof EnvironmentOccluded)throw error;assertNative();failed=true;await emit({type:'capture-diagnostic-stage-end',phase,stage,outcome:'failed',error:error.stack});}
        }
      });
      if(failed)throw new Error('Capture diagnostic failed at '+phase+'; remaining phases not run');
    };
    await diagnose('before-control');
    await emit({type:'capture-diagnostic-control-start'});
    await hook(`createNetworkControl(${JSON.stringify(origin+'/network-control')})`);
    try {
      await diagnose('during-control');
      if (args.includes('--diagnose-network-workloads')) {
        const target=await until(async()=>(await(await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t=>t.url===origin+'/network-control'),'diagnostic control target');
        const control=await connect(target.webSocketDebuggerUrl,runtime);
        try {
          for(const [name,url] of [['literal',canaries.http],['alias',canaries.alias],['redirect',origin+'/redirect'],...(canaries.privateUrl?[['private',canaries.privateUrl]]:[])]) {
            await emit({type:'capture-diagnostic-workload-start',name});
            await canaries.nodeControl();
            const before=await canaries.httpProbe(control,url,'diagnostic-before-'+name);
            const observed=await withPreview(({cdp})=>canaries.httpProbe(cdp,url,'diagnostic-preview-'+name));
            const after=await canaries.httpProbe(control,url,'diagnostic-after-'+name);
            await canaries.nodeControl();
            await emit({type:'capture-diagnostic-workload-end',name,before,observed,after});
            await diagnose('after-'+name);
          }
          await emit({type:'capture-diagnostic-workload-start',name:'turn'});
          await canaries.nodeControl();const before=await canaries.turnProbe(control);
          const observed=await withPreview(({cdp})=>canaries.turnProbe(cdp));
          const after=await canaries.turnProbe(control);await canaries.nodeControl();
          await emit({type:'capture-diagnostic-workload-end',name:'turn',before,observed,after});
          await diagnose('after-turn');
        } finally {control.close();}
      }
    }
    finally {await hook('closeNetworkControl()');await emit({type:'capture-diagnostic-control-closed'});}
    await diagnose('after-control');
    throw new PlannedStop('Bounded capture-control diagnosis completed; full matrix not executed');
  }

  if (report.hooksAvailable) await check('Q-PV0', 'Unregistered contents with main preload are quarantined', async () => {
    value(await shell.evaluate("window.hqServices.design.call('blob.has',{digest:'sha256:'+'0'.repeat(64)})"));
    const result = await hook("trustProbe('same-preload')");
    assert.equal(result.registered, null); assert.equal(result.destroyed, true); assert.equal(result.allowedSenderAccepted, false); assert.equal(typeof result.synchronousRegistration, 'boolean'); return result;
  });
  if (report.hooksAvailable) await check('Q-PV0', 'Factory refuses preview literal with preload', async () => { const result=await hook("trustProbe('altered-preferences')"); assert.equal(result.constructed,false);assert.equal(result.alteredPreviewRefused,true);return result; });
  if (report.hooksAvailable) await check('Q-PV1', 'Separate renderer PID and no session preloads', () => withPreview(async ({ session }) => {
    const stats = await hook('stats()');
    const native = (await hook('sessions()')).find(s => s.sessionId === session.sessionId);
    assert.ok(native.processId > 0); assert.notEqual(native.processId, stats.rendererPid); assert.notEqual(native.processId, stats.mainPid);
    assert.deepEqual(native.preloads, []); assert.deepEqual(native.preloadScripts, []); assert.equal(native.persistent, false); assert.equal(native.storagePath, null); return { native, stats };
  })); else unmeasured('Q-PV1', 'Separate renderer PIDs and sessions', 'Main hooks unavailable');
  for (const viewport of [{ w: 1280, h: 800, dpr: 1 }, { w: 390, h: 844, dpr: 3 }]) {
    await check('Q-PV4', `Ten native captures ${JSON.stringify(viewport)}`, () => withPreview(async ({ session, cdp }) => {
      assert.deepEqual(await cdp.evaluate('({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})'), viewport);
      const digests = [];
      for (let i = 0; i < 10; i++) {
        const record = value(await capture(session));
        const image = value(await api('image', { captureId: record.captureId }));
        const bytes = Buffer.from(image.split(',')[1], 'base64');
        assert.equal(digest(bytes), record.captureDigest);
        assert.equal(bytes.readUInt32BE(16), viewport.w * viewport.dpr);
        assert.equal(bytes.readUInt32BE(20), viewport.h * viewport.dpr);
        digests.push(record.captureDigest);
        if (i === 0) await writeFile(join(evidence, `static-${viewport.w}-${viewport.dpr}.png`), bytes);
      }
      assert.equal(new Set(digests).size, 1); return digests;
    }, viewport));
  }
  await check('Q-PV5', 'Stable scroll captures visible viewport pixels and records scroll 100', () => withPreview(async ({ session, cdp }) => {
    await cdp.evaluate(`(async()=>{document.body.replaceChildren();document.documentElement.style.cssText='margin:0;padding:0;scroll-behavior:auto';document.body.style.cssText='margin:0;padding:0';for(let i=0;i<24;i++){const row=document.createElement('div');row.style.cssText='height:100px;background:'+(i%2?'rgb(35,39,45)':'rgb(27,30,35)');document.body.append(row)}scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
    const inspectCapture = async (record, name) => {
      const image = value(await api('image', { captureId: record.captureId }));
      const encoded = image.split(',')[1];
      const bytes = Buffer.from(encoded, 'base64');
      assert.equal(digest(bytes), record.captureDigest);
      await writeFile(join(evidence, name + '.png'), bytes);
      return shell.evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));try{const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);return {width:bitmap.width,height:bitmap.height,top:Array.from(context.getImageData(10,10,1,1).data),next:Array.from(context.getImageData(10,110,1,1).data)}}finally{bitmap.close()}})()`);
    };
    const initial = value(await capture(session));
    const initialPixels = await inspectCapture(initial, 'stable-scroll-before');
    assert.deepEqual(initial.scroll, { x: 0, y: 0 });
    assert.deepEqual(initialPixels.top, [27,30,35,255]);
    assert.deepEqual(initialPixels.next, [35,39,45,255]);
    await cdp.evaluate('new Promise(resolve=>{scrollTo(0,100);requestAnimationFrame(()=>requestAnimationFrame(resolve))})');
    assert.equal(await cdp.evaluate('scrollY'), 100);
    const scrolled = value(await capture(session));
    const scrolledPixels = await inspectCapture(scrolled, 'stable-scroll-after');
    assert.deepEqual(scrolled.scroll, { x: 0, y: 100 });
    assert.equal(scrolledPixels.width, session.viewport.w);
    assert.equal(scrolledPixels.height, session.viewport.h);
    assert.deepEqual(scrolledPixels.top, [35,39,45,255], 'PNG top is the visible lighter dark row after stable scroll');
    assert.deepEqual(scrolledPixels.next, [27,30,35,255]);
    assert.notEqual(scrolled.captureDigest, initial.captureDigest);
    return { initial, initialPixels, scrolled, scrolledPixels };
  }));
  for (const dpr of [1, 2]) {
    await check('Q-PV4', `Scaled responsive dark viewport retains full PNG coverage at DPR ${dpr}`, () => withPreview(async ({ session, cdp }) => {
      value(await api('place', { sessionId: session.sessionId, rect: { x: 0, y: 0, width: 519, height: 420 }, visible: true }));
      session = value(await api('status', { sessionId: session.sessionId }));
      await cdp.evaluate(`(async()=>{
        document.documentElement.style.cssText='margin:0;padding:0;color-scheme:dark;scroll-behavior:auto';
        document.body.style.cssText='margin:0;padding:0';
        document.body.innerHTML='<style>#responsive-surface{height:2160px;width:100%;background:repeating-linear-gradient(to bottom,rgb(23,25,29) 0 100px,rgb(35,39,45) 100px 200px)}.landmark{position:fixed;width:32px;height:32px}#nw{left:0;top:0;background:rgb(70,80,90)}#ne{right:0;top:0;background:rgb(90,80,70)}#sw{left:0;bottom:0;background:rgb(60,90,80)}#se{right:0;bottom:0;background:rgb(80,60,90)}#center{left:calc(50% - 16px);top:calc(50% - 16px);background:rgb(100,110,120)}@media(max-width:1023px){#responsive-surface{border-right:1px solid rgb(45,48,54)}}</style><main id="responsive-surface"></main><div class="landmark" id="nw"></div><div class="landmark" id="ne"></div><div class="landmark" id="sw"></div><div class="landmark" id="se"></div><div class="landmark" id="center"></div>';
        const surface=document.querySelector('#responsive-surface');
        const events=window.responsiveEvents={resize:0,observer:0,media:0,mutations:0};
        const write=()=>surface.setAttribute('data-layout',innerWidth>=1024?'wide':'compact');
        addEventListener('resize',()=>{events.resize++;write()});
        const observer=new ResizeObserver(()=>{events.observer++;write()});observer.observe(surface);
        for(const query of ['(max-width:1023px)','(resolution:2dppx)'])matchMedia(query).addEventListener('change',()=>{events.media++;write()});
        new MutationObserver(records=>{events.mutations+=records.length}).observe(surface,{attributes:true});
        write();scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      })()`);
      const geometry = () => cdp.evaluate(`({viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},scroll:{x:scrollX,y:scrollY},client:{w:document.documentElement.clientWidth,h:document.documentElement.clientHeight},surface:document.querySelector('#responsive-surface').getBoundingClientRect().toJSON(),landmarks:[...document.querySelectorAll('.landmark')].map(n=>n.getBoundingClientRect().toJSON()),events:{...window.responsiveEvents}})`);
      const captures = [];
      for (const scroll of [0, 100]) {
        await cdp.evaluate(`new Promise(r=>{scrollTo(0,${scroll});requestAnimationFrame(()=>requestAnimationFrame(r))})`);
        const before = await geometry();
        assert.deepEqual(before.viewport, { w: 1024, h: 720, dpr });
        assert.deepEqual(before.scroll, { x: 0, y: scroll });
        const record = value(await capture(session));
        const image = value(await api('image', { captureId: record.captureId }));
        const encoded = image.split(',')[1], bytes = Buffer.from(encoded, 'base64');
        assert.equal(digest(bytes), record.captureDigest);
        assert.deepEqual(record.viewport, before.viewport);
        assert.deepEqual(record.scroll, before.scroll);
        assert.equal(bytes.readUInt32BE(16), 1024 * dpr);
        assert.equal(bytes.readUInt32BE(20), 720 * dpr);
        const points = [[16,16],[1008,16],[16,704],[1008,704],[512,360],[80,10]];
        const pixels = await shell.evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));try{const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);return ${JSON.stringify(points)}.map(([x,y])=>Array.from(context.getImageData(x*${dpr},y*${dpr},1,1).data))}finally{bitmap.close()}})()`);
        assert.deepEqual(pixels, [[70,80,90,255],[90,80,70,255],[60,90,80,255],[80,60,90,255],[100,110,120,255],scroll === 0 ? [23,25,29,255] : [35,39,45,255]]);
        await cdp.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        const after = await geometry();
        assert.deepEqual(after, before, 'Host capture preserves responsive geometry and emits no resize, media, or attribute mutations');
        await writeFile(join(evidence, `responsive-${dpr}-scroll-${scroll}.png`), bytes);
        captures.push({ record, before, after, pixels });
      }
      assert.notEqual(captures[0].record.captureDigest, captures[1].record.captureDigest);
      const before = await hook('stats()');
      await hook("pauseAt('pre-read')");
      const pending = capture(session); pending.catch(() => {});
      try {
        assert.equal((await hook('waitForPause()')).sessionId, session.sessionId);
        await cdp.evaluate("document.querySelector('#responsive-surface').setAttribute('data-genuine-change','changed')");
      } finally { await hook('resume()'); await hook('pauseAt(null)'); }
      const mutation = await pending;
      assert.equal(mutation.kind, 'stale'); assert.equal(mutation.reason, 'mutation');
      assert.equal((await hook('stats()')).blobWrites, before.blobWrites);
      return { placement: { width: 519, height: 420 }, captures, mutation };
    }, { w: 1024, h: 720, dpr }));
  }
  await check('Q-PV2', 'Cross-origin main-frame navigation blocked', () => withPreview(async ({ session, cdp }) => {
    const before=await hook('stats()');
    await cdp.evaluate(`location.href=${JSON.stringify(crossOrigin)};void 0`);
    await delay(200);
    assert.ok((await cdp.evaluate('location.href')).startsWith(origin));
    const status = await api('status', { sessionId: session.sessionId });
    assert.equal(status.kind, 'blocked');const after=await hook('stats()');assert.ok(after.denials.navigation>before.denials.navigation || after.deniedRequests>before.deniedRequests);return status;
  }));
  await check('Q-PV2', 'Popup blocked', () => withPreview(async ({ cdp }) => {
    const before=await hook('stats()');
    assert.equal(await cdp.evaluate(`window.open(${JSON.stringify(origin)})===null`), true);
    assert.ok((await hook('stats()')).denials.popups>before.denials.popups);
  }));
  await check('Q-PV2', 'Geolocation and notification denied', () => withPreview(async ({ cdp }) => {
    const result = await cdp.evaluate(`Promise.all(['geolocation','notifications'].map(async name=>[name,(await navigator.permissions.query({name})).state]))`);
    assert.ok(result.every(([, state]) => state === 'denied')); return result;
  }));
  await check('Q-PV2', 'File chooser observed with empty-file cancellation', () => withPreview(async ({ cdp, target }) => {
    const rect = await cdp.evaluate("(()=>{const r=document.querySelector('#file').getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()");
    return observeFileChooser(target, runtime, () => click(cdp, rect.x, rect.y));
  }));
  for (const [name, expression] of [
    ['geolocation', "new Promise(resolve=>navigator.geolocation.getCurrentPosition(()=>resolve('allowed'),e=>resolve('denied:'+e.code)))"],
    ['notifications', "Notification.requestPermission()"],
    ['camera-microphone', "navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(stream=>{stream.getTracks().forEach(t=>t.stop());return 'allowed'},e=>'denied:'+e.name)"],
    ['display-media', "navigator.mediaDevices.getDisplayMedia({video:true}).then(stream=>{stream.getTracks().forEach(t=>t.stop());return 'allowed'},e=>'denied:'+e.name)"],
    ['usb', "navigator.usb.requestDevice({filters:[]}).then(()=> 'allowed',e=>'denied:'+e.name)"],
    ['hid', "navigator.hid.requestDevice({filters:[]}).then(devices=>Array.isArray(devices)&&devices.length===0?'denied:empty-selection':'allowed:nonempty-or-invalid-selection',e=>'denied:'+e.name)"],
    ['serial', "navigator.serial.requestPort().then(()=> 'allowed',e=>'denied:'+e.name)"],
    ['bluetooth', "navigator.bluetooth.requestDevice({acceptAllDevices:true}).then(()=> 'allowed',e=>'denied:'+e.name)"],
  ]) await check('Q-PV2', `Permission/device API ${name}`, () => withPreview(async ({ cdp }) => {
    if (name === 'bluetooth') {
      try {
        await cdp.send('BluetoothEmulation.enable', { state: 'powered-on', leSupported: true });
        await cdp.send('BluetoothEmulation.simulatePreconnectedPeripheral', { address: '00:00:00:00:00:01', name: 'HQ synthetic peripheral', manufacturerData: [], knownServiceUuids: [] });
      } catch (error) { await emit({type:'bluetooth-emulation-unavailable',error:error.message,next:'Bounded real request; no device selection or permission changes'}); }
    }
    const before = report.hooksAvailable ? await hook('stats()') : null;
    const boundedExpression = name === 'bluetooth' ? `Promise.race([(${expression}),new Promise(resolve=>setTimeout(()=>resolve('unsupported:request-timeout-no-permission-change'),3000))])` : expression;
    const response = await cdp.send('Runtime.evaluate',{expression:`(async()=>{try{return await (${boundedExpression})}catch(e){return 'unsupported:'+e.name}})()`,returnByValue:true,awaitPromise:true,userGesture:true});
    const result=response.result?.value;
    if(typeof result !== 'string' || result.startsWith('unsupported:')) throw new Unmeasured(`${name}: ${result ?? 'no result'}`);
    assert.ok(result==='denied' || result.startsWith('denied:'),String(result));
    const after=report.hooksAvailable?await hook('stats()'):null;
    if(!before || !after || !['permissions','devices','display'].some(key=>after.denials[key]>before.denials[key])) throw new Unmeasured(`${name} rejected without an observed host denial callback: ${result}`);
    return {result,before:before.denials,after:after.denials};
  }));
  await check('Q-PV2','Untrusted synthetic server certificate stays rejected',async()=>{
    const tls=await createSyntheticTls(runtime);
    const result=await api('open',{versionId:'tls-rejection',url:tls.url,viewport:{w:390,h:844,dpr:1},label:'Synthetic untrusted TLS'});
    assert.equal(result.ok,false);assert.equal(result.kind,'unavailable');
    if(!/ERR_CERT_AUTHORITY_INVALID|net_error -202/.test(log))throw new Unmeasured('TLS load refused but exact native certificate-error diagnostic unavailable');
    return {result,connections:tls.connections,fingerprint:tls.fingerprint,trustOverride:false};
  });
  const clientCertificateUrl=option('--client-certificate-url');
  if(clientCertificateUrl) await check('Q-PV2','Trusted public client-certificate request denied without identity',async()=>{
    const url=new URL(clientCertificateUrl);assert.equal(url.protocol,'https:');assert.equal(url.username+url.password,'');
    const before=await hook('stats()');
    const result=await api('open',{versionId:'client-certificate-denial',url:url.href,viewport:{w:390,h:844,dpr:1},label:'Public client certificate test'});
    try {
      const after=await hook('stats()');
      const observed={result,before:before.denials.certificates,after:after.denials.certificates,emptyIdentityBehavior:'Electron 44.9 skips the app selection delegate when client_certs is empty',source:'https://github.com/electron/electron/blob/v44.9.0/shell/browser/electron_browser_client.cc'};
      const target=(await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t=>t.type==='page'&&t.url.startsWith(url.origin));
      if(target){const cdp=await connect(target.webSocketDebuggerUrl,runtime);try{observed.document=await cdp.evaluate('({url:location.href,title:document.title,text:document.body?.innerText.slice(0,2000),secure:isSecureContext})');}finally{cdp.close();}}
      await emit({type:'client-certificate-observation',...observed});
      if(after.denials.certificates<=before.denials.certificates){const error=new Unmeasured('unmeasured-unreachable: no native select-client-certificate callback; Electron empty-identity branch bypasses app delegate; load/document retained separately');error.observed=observed;throw error;}
      return observed;
    }
    finally {if(result.ok) await api('close',{sessionId:result.value.sessionId});}
  });else unmeasured('Q-PV2','Client-certificate chooser denial','Provide verified trusted --client-certificate-url; untrusted certificate rejection is separate evidence');
  for(const [name,path] of [['downloads','/download'],['auth','/auth']]) await check('Q-PV2', `Native ${name} callback denies request`, () => withPreview(async ({cdp})=>{
    const before=await hook('stats()');
    if(name==='downloads') await cdp.evaluate(`(()=>{const a=document.createElement('a');a.href='/download';a.download='synthetic.txt';document.body.append(a);a.click()})()`);
    else await cdp.evaluate("fetch('/auth').then(r=>r.status,()=>0)");
    await until(async()=> (await hook('stats()')).denials[name]>before.denials[name],`${name} denial callback`,3000);
    return (await hook('stats()')).denials;
  }));
  for (const url of ['file:///hq-qualification-does-not-exist', 'hq-component://qualification/', 'hq-unknown://qualification/']) {
    await check('Q-PV3', `Navigation refuses ${url}`, () => withPreview(async ({ cdp }) => {
      await cdp.evaluate(`location.href=${JSON.stringify(url)};void 0`); await delay(150);
      assert.ok((await cdp.evaluate('location.href')).startsWith(origin));
    }));
  }
  if(report.hooksAvailable) await check('Q-PV3h','Network-control lifecycle and canary observations',async()=>{
    await canaries.nodeControl();
    const controlUrl=origin+'/network-control';await hook(`createNetworkControl(${JSON.stringify(controlUrl)})`);
    let control;
    try {
      const target=await until(async()=> (await(await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t=>t.url===controlUrl),'network control target');
      control=await connect(target.webSocketDebuggerUrl,runtime);
      const probes=[['literal',canaries.http],['alias',canaries.alias],['redirect',origin+'/redirect'],...(canaries.privateUrl?[['private',canaries.privateUrl]]:[])];
      if(!canaries.privateUrl) unmeasured('Q-PV3h','Private literal hygiene','No host-owned RFC1918 address available');
      for(const [name,url] of probes) await check('Q-PV3h',`${name} HTTP reach with before/after controls`,async()=>{
        await canaries.nodeControl();
        const positiveBefore=await canaries.httpProbe(control,url,`control-before-${name}`);
        if(!positiveBefore)throw new Unmeasured(`${name} browser positive control unavailable`);
        const observed=await withPreview(({cdp})=>canaries.httpProbe(cdp,url,`preview-${name}`));
        const positiveAfter=await canaries.httpProbe(control,url,`control-after-${name}`);await canaries.nodeControl();
        if(!positiveAfter)throw new Unmeasured(`${name} post-run browser control unavailable; preview hit=${observed}`);
        if(name==='literal'||name==='private')assert.equal(observed,false,'Literal address hygiene');
        return {positiveBefore,observed,positiveAfter,claim:report.networkClaim};
      });
      await check('Q-PV3h','TURN-TCP reach with native STUN allocation bytes',async()=>{
        await canaries.nodeControl();const positiveBefore=await canaries.turnProbe(control);
        if(!positiveBefore)throw new Unmeasured('TURN-TCP browser positive control unavailable');
        const observed=await withPreview(({cdp})=>canaries.turnProbe(cdp));
        const positiveAfter=await canaries.turnProbe(control);await canaries.nodeControl();
        if(!positiveAfter)throw new Unmeasured(`TURN-TCP post-run control unavailable; preview hit=${observed}`);
        return {positiveBefore,observed,positiveAfter,claim:report.networkClaim};
      });
      return {canaryEvents:canaries.hits};
    } finally {control?.close();await hook('closeNetworkControl()');}
  });else unmeasured('Q-PV3h','Network reach controls','Main hooks unavailable');
  await check('Q-PV6', 'Old generation rejected after navigation', () => withPreview(async ({ session }) => {
    value(await api('navigate', { sessionId: session.sessionId, route: '/next' }));
    const result = await capture(session); assert.equal(result.kind, 'stale'); assert.equal(result.reason, 'navigation'); return result;
  }));
  await check('Q-PV7', 'Synthetic pick is ignored', () => withPreview(async ({ session, cdp }) => {
    value(await api('mode', { sessionId: session.sessionId, generation: session.generation, mode: 'pick' }));
    await cdp.evaluate(`document.querySelector('#target').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:80,clientY:80}))`);
    await delay(250);
    const result = value(await api('events', { sessionId: session.sessionId, after: 0 })); assert.equal(result.events.length, 0); return result;
  }));
  await check('Q-PV7','Synthetic cite selection and mouseup are ignored',()=>withPreview(async({session,cdp})=>{
    value(await api('mode',{sessionId:session.sessionId,generation:session.generation,mode:'cite'}));
    await cdp.evaluate(`(()=>{const n=document.querySelector('#quote');const r=document.createRange();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r);n.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})()`);
    await delay(700);assert.equal(value(await api('events',{sessionId:session.sessionId,after:0})).events.length,0);
  }));
  await check('Q-PV6h', 'Native trusted pick captures matching PNG digest', () => withPreview(async ({ session, cdp }) => {
    const baseline = value(await capture(session));
    value(await api('mode', { sessionId: session.sessionId, generation: session.generation, mode: 'pick' }));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 80, y: 80 });
    await click(cdp);
    const events = await until(async () => { const v = value(await api('events', { sessionId: session.sessionId, after: 0 })); return v.events.length ? v.events : null; }, 'trusted pick', 5000);
    assert.equal(events[0].event.type, 'element-picked');
    const image = value(await api('image', { captureId: events[0].capture.captureId }));
    const expectedDigest = events[0].capture.captureDigest;
    assert.equal(digest(Buffer.from(image.split(',')[1], 'base64')), expectedDigest);
    assert.equal(expectedDigest, baseline.captureDigest, 'Agent highlight is absent from captured pixels');
    const stored = await shell.evaluate(`window.hqServices.design.call('blob.get',{digest:${JSON.stringify(expectedDigest)}}).then(result=>({...result,value:result.value?Array.from(result.value):null}))`);
    assert.equal(digest(Buffer.from(value(stored))), expectedDigest); return events;
  }));
  await check('Q-PV8', 'Isolated agent ignores page geometry override', () => withPreview(async ({ session, cdp }) => {
    const params = { sessionId: session.sessionId, generation: session.generation, requests: [{ kind: 'element', path: '#target' }] };
    const before = value(await api('resolve', params));
    assert.equal(before.results[0].found, true);
    await cdp.evaluate('Element.prototype.getBoundingClientRect=function(){return {x:9999,y:9999,width:1,height:1,top:9999,left:9999,right:10000,bottom:10000}}');
    assert.equal(await cdp.evaluate("document.querySelector('#target').getBoundingClientRect().x"), 9999);
    const after = value(await api('resolve', params)); assert.deepEqual(after, before); return after;
  }));
  await check('Q-PV7', 'Trusted selection produces cite only', () => withPreview(async ({ session, cdp }) => {
    value(await api('mode', { sessionId: session.sessionId, generation: session.generation, mode: 'cite' }));
    await drawable(cdp, 'trusted-selection');
    const selection = () => cdp.evaluate(`(()=>{const s=getSelection(),r=s?.rangeCount?s.getRangeAt(0):null,q=document.querySelector('#quote');return {text:s?.toString()??'',collapsed:s?.isCollapsed,anchorOffset:s?.anchorOffset,focusOffset:s?.focusOffset,withinQuote:!!r&&q.contains(r.startContainer)&&q.contains(r.endContainer),rects:r?[...r.getClientRects()].map(r=>r.toJSON()):[],scroll:{x:scrollX,y:scrollY},visibility:document.visibilityState,focused:document.hasFocus()}})()`);
    const observed = { session, beforeStats: report.hooksAvailable ? await hook('stats()') : null };
    const rect = await cdp.evaluate("(()=>{const r=document.querySelector('#quote').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x + 2, y: rect.y + 8, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + 300, y: rect.y + 8, button: 'left', buttons: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 300, y: rect.y + 8, button: 'left', clickCount: 1 });
      observed.initialSelection = await selection();
      assert.ok(observed.initialSelection.text.length > 0);
      assert.equal(observed.initialSelection.withinQuote, true);
      const events = await until(async () => { const result = value(await api('events', { sessionId: session.sessionId, after: 0 })); observed.lastEvents = result; return result.events.length ? result.events : null; }, 'trusted citation', 5000);
      observed.finalSelection = await selection();
      assert.deepEqual(observed.finalSelection, observed.initialSelection);
      assert.ok(events.every(event => event.event.type === 'text-cited' && event.event.target.quote === observed.initialSelection.text));
      return { ...observed, events };
    } catch (error) {
      try { observed.finalSelection = await selection(); if (report.hooksAvailable) observed.afterStats = await hook('stats()'); }
      catch (diagnosticError) { observed.diagnosticError = diagnosticError.stack; }
      error.observed = observed; throw error;
    }
  }));
  if (report.hooksAvailable) {
    for (const stage of ['pre-read', 'first-capture', 'post-read']) {
      for (const action of ['navigate', 'scroll', 'resize']) {
        await check('Q-PV5', `${action} at ${stage} causes stale without blob write`, () => withPreview(async ({ session, cdp }) => {
          const before = await hook('stats()');
          await hook(`pauseAt(${JSON.stringify(stage)})`);
          const pending = capture(session); pending.catch(() => {});
          try {
            assert.equal((await hook('waitForPause()')).sessionId, session.sessionId);
            if (action === 'scroll') await cdp.evaluate('scrollTo(0,100)');
            if (action === 'navigate') value(await api('navigate', { sessionId: session.sessionId, route: '/changed' }));
            if (action === 'resize') value(await api('place', { sessionId: session.sessionId, rect: { x: 0, y: 0, width: 1100, height: 700 }, visible: true }));
          } finally { await hook('resume()'); await hook('pauseAt(null)'); }
          const result = await pending;
          assert.equal(result.kind, 'stale'); assert.equal(result.reason, action === 'scroll' ? 'scroll' : 'navigation');
          assert.equal((await hook('stats()')).blobWrites, before.blobWrites); return result;
        }));
      }
    }
    for (const [label, script, reason] of [
      ['same-length text', "document.querySelector('#target').textContent='Qualification TARGET'", 'target-changed'],
      ['remove and reinsert same node', "{const n=document.querySelector('#target');const next=n.nextSibling;n.remove();document.body.insertBefore(n,next)}", 'mutation'],
      ['sibling height', "document.querySelector('#spacer').style.height='80px'", 'target-changed'],
    ]) await check('Q-PV6d', label, () => withPreview(async ({ session, cdp }) => {
      const before = await hook('stats()');
      value(await api('mode', { sessionId: session.sessionId, generation: session.generation, mode: 'pick' }));
      await hook("pauseAt('pre-read')");
      try { await click(cdp); await hook('waitForPause()'); await cdp.evaluate(script); }
      finally { await hook('resume()'); await hook('pauseAt(null)'); }
      await delay(200);
      const after = await hook('stats()');
      assert.equal(after.lastPickOutcome?.kind, 'stale'); assert.equal(after.lastPickOutcome?.reason, reason);
      assert.equal(after.blobWrites, before.blobWrites);
      assert.equal(value(await api('events', { sessionId: session.sessionId, after: 0 })).events.length, 0); return after.lastPickOutcome;
    }));
    await check('Q-PV6', 'Trusted pick navigated before queue validation is stale', () => withPreview(async ({ session, cdp }) => {
      const before = await hook('stats()');
      value(await api('mode', { sessionId: session.sessionId, generation: session.generation, mode: 'pick' }));
      await hook("pauseAt('before-drain')");
      try { await click(cdp); await hook('waitForPause()'); value(await api('navigate', { sessionId: session.sessionId, route: '/after-pick' })); }
      finally { await hook('resume()'); await hook('pauseAt(null)'); }
      await delay(200);
      const after = await hook('stats()'); assert.equal(after.lastPickOutcome?.kind, 'stale'); assert.equal(after.lastPickOutcome?.reason, 'navigation');
      assert.equal(after.blobWrites, before.blobWrites); assert.equal(value(await api('events', { sessionId: session.sessionId, after: 0 })).events.length, 0); return after.lastPickOutcome;
    }));
    await check('Q-PV6a', 'Compositor animation changes pixels, paused animation anchors', () => withPreview(async ({ session, cdp }) => {
      await cdp.evaluate("document.querySelector('#target').style.width='120px';document.querySelector('#target').style.height='32px';window.motion=document.querySelector('#target').animate([{transform:'translateX(0px)'},{transform:'translateX(24px)'}],{duration:4000,iterations:3})");
      const before = await hook('stats()');
      await hook("pauseAt('first-capture')");
      const pending = capture(session); pending.catch(() => {});
      try { await hook('waitForPause()'); await delay(200); }
      finally { await hook('resume()'); await hook('pauseAt(null)'); }
      const result = await pending; assert.equal(result.kind, 'stale'); assert.equal(result.reason, 'pixels-unstable');
      assert.equal((await hook('stats()')).blobWrites, before.blobWrites);
      await cdp.evaluate('window.motion.pause()'); await delay(100);
      value(await capture(session)); return result;
    }));
    await check('Q-PV6a', 'Playing synthetic video changes captured pixels', () => withPreview(async ({ session, cdp }) => {
      const setup = await cdp.evaluate(`(async()=>{const c=document.createElement('canvas');c.width=96;c.height=48;const ctx=c.getContext('2d');let frame=0;window.videoClock=setInterval(()=>{ctx.fillStyle='rgb('+(30+(frame++%12))+',35,42)';ctx.fillRect(0,0,96,48);if(frame>=40)clearInterval(window.videoClock)},250);const v=document.createElement('video');v.id='moving-video';v.muted=true;v.style.cssText='position:fixed;left:20px;top:200px;width:96px;height:48px';v.srcObject=c.captureStream(4);document.body.append(v);await v.play();await new Promise(r=>v.requestVideoFrameCallback(r));return {width:v.videoWidth,height:v.videoHeight,paused:v.paused}})()`);
      assert.equal(setup.paused, false); assert.equal(setup.width, 96);
      const before = await hook('stats()'); await hook("pauseAt('first-capture')");
      const pending = capture(session); pending.catch(() => {});
      try { await hook('waitForPause()'); await cdp.evaluate(`new Promise(r=>document.querySelector('#moving-video').requestVideoFrameCallback(r))`); await delay(260); }
      finally { await hook('resume()'); await hook('pauseAt(null)'); }
      const result = await pending; assert.equal(result.kind, 'stale'); assert.equal(result.reason, 'pixels-unstable');
      assert.equal((await hook('stats()')).blobWrites, before.blobWrites);
      await cdp.evaluate("clearInterval(window.videoClock);document.querySelector('#moving-video').pause()"); await delay(100); value(await capture(session)); return { setup, result };
    }));
    await check('Q-PV6a', 'Native blinking caret changes captured pixels', () => withPreview(async ({ session, cdp }) => {
      await cdp.evaluate(`(()=>{const input=document.createElement('input');input.id='caret';input.value='Caret';input.style.cssText='position:fixed;left:20px;top:200px;width:300px;font:32px monospace;background:#20242a;color:#bec3cb;caret-color:#bec3cb';document.body.append(input);input.focus();input.setSelectionRange(5,5)})()`);
      await cdp.send('Page.bringToFront');
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await click(cdp, 200, 225);
      await cdp.evaluate("document.querySelector('#caret').setSelectionRange(5,5)");
      const focus = await cdp.evaluate("({focused:document.hasFocus(),active:document.activeElement?.id,start:document.activeElement?.selectionStart,end:document.activeElement?.selectionEnd})");
      assert.equal(focus.focused, true); assert.equal(focus.active, 'caret'); assert.equal(focus.start, focus.end);
      const samples = [];
      const shot = async () => { await drawable(cdp, 'caret-screenshot');const hash=digest(Buffer.from((await cdp.send('Page.captureScreenshot')).data, 'base64'));samples.push(hash);return hash; };
      const first = await shot(); let changed = false;
      for (let i=0;i<20&&!changed;i++) { await delay(180); changed = await shot() !== first; }
      if (!changed) {const error=new Unmeasured('Positive control: focused native caret did not change pixels in 20 finite samples');error.observed={focus,samples};throw error;}
      const before = await hook('stats()'); await hook("pauseAt('first-capture')");
      const pending = capture(session); pending.catch(() => {});
      try { await hook('waitForPause()'); const baseline=await shot(); let different=false; for(let i=0;i<20&&!different;i++){await delay(180);different=await shot()!==baseline;} if(!different) throw new Unmeasured('Caret ceased blinking during pause'); }
      finally { await hook('resume()'); await hook('pauseAt(null)'); }
      const result = await pending; assert.equal(result.kind, 'stale'); assert.equal(result.reason, 'pixels-unstable'); assert.equal((await hook('stats()')).blobWrites, before.blobWrites);
      await cdp.evaluate("document.querySelector('#caret').blur()"); value(await capture(session)); return result;
    }));
    await check('Q-PV9', 'Renderer crash is observed then session clears', async () => {
      const p = await open(); const before = await hook('stats()');
      void p.cdp.send('Page.crash').catch(() => {});
      await until(async () => { const result = await api('status', { sessionId: p.session.sessionId }); return result.ok && result.value.status === 'crashed'; }, 'preview renderer crash');
      value(await api('close', { sessionId: p.session.sessionId }));
      const after = await hook('stats()'); assert.equal(after.sessions, 0); assert.equal(after.clearedSessions, before.clearedSessions + 1); p.cdp.close(); return after;
    });
    await check('Q-PV9', 'Settings hides native view, suppresses drain and restores intended visibility', () => withPreview(async ({session, cdp}) => {
      const native = async () => (await hook('sessions()')).find(s => s.sessionId === session.sessionId);
      const before = await hook('stats()');
      assert.equal((await native()).visible, true);
      value(await api('mode', {sessionId:session.sessionId,generation:session.generation,mode:'pick'}));
      await hook("pauseAt('before-drain')");
      try {
        await click(cdp); await hook('waitForPause()');
        assert.equal(await shell.evaluate(`(()=>{const b=document.querySelector('button[title="Settings"]');b?.click();return !!b})()`), true);
        await until(async () => (await native())?.overlayHidden === true, 'Settings overlay hide');
        assert.equal((await native()).visible, false);
        value(await api('place', {sessionId:session.sessionId,rect:{x:0,y:0,width:1280,height:800},visible:true}));
        assert.equal((await native()).visible, false);
        assert.equal((await native()).intendedVisible, true);
      } finally { await hook('resume()'); await hook('pauseAt(null)'); }
      await delay(250);
      assert.equal((await hook('stats()')).blobWrites, before.blobWrites);
      assert.equal(value(await api('events', {sessionId:session.sessionId,after:0})).events.length, 0);
      assert.equal(await shell.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Back to'));b?.click();return !!b})()`), true);
      await until(async () => {const n=await native();return n && !n.overlayHidden && n.visible;}, 'Settings overlay restore');
      assert.equal((await hook('stats()')).clearedSessions, before.clearedSessions);
      value(await api('mode', {sessionId:session.sessionId,generation:session.generation,mode:'off'}));
      return {before, after:await hook('stats()'), native:await native()};
    }));
    await check('Q-PV9', 'Domain switch closes views and clears session', async () => {
      const p = await open(); const before = await hook('stats()');
      let failure;
      try {
        assert.equal(await shell.evaluate(`(()=>{const b=[...document.querySelectorAll('nav[aria-label="Domains"] button')].find(b=>b.textContent.trim()==='Work');b?.click();return !!b})()`), true);
        const after = await until(async () => { const stats = await hook('stats()'); return stats.sessions === 0 && stats.clearedSessions === before.clearedSessions + 1 ? stats : null; }, 'completed domain switch teardown');
        assert.equal(after.clearedSessions, before.clearedSessions + 1); return after;
      } catch (error) { failure = error; throw error; }
      finally {
        p.cdp.close();
        try {
          assert.equal(await shell.evaluate(`(()=>{const b=[...document.querySelectorAll('nav[aria-label="Domains"] button')].find(b=>b.textContent.trim()==='Design');b?.click();return !!b})()`), true);
          await until(() => shell.evaluate(`document.querySelector('nav[aria-label="Domains"] button[aria-current="page"]')?.textContent.trim()==='Design'`), 'restored Design domain');
        } catch (error) {
          report.baselineRestoreError = error.stack;
          if (failure) failure.observed = { ...failure.observed, baselineRestoreError: error.stack };
          else throw error;
        }
      }
    });
    await check('Q-PV9', 'Main renderer reload closes views and clears session', async () => {
      const p = await open(); const before = await hook('stats()');
      await shell.send('Page.reload');
      const after = await until(async () => { const stats = await hook('stats()'); return stats.sessions === 0 && stats.clearedSessions === before.clearedSessions + 1 ? stats : null; }, 'completed reload view teardown');
      await until(() => shell.evaluate('!!window.hqServices?.preview'), 'reloaded preload');
      await until(() => shell.evaluate(`document.querySelector('nav[aria-label="Domains"] button[aria-current="page"]')?.textContent.trim()==='Design'`), 'reloaded Design domain');
      assert.equal(after.clearedSessions, before.clearedSessions + 1); p.cdp.close(); return after;
    });
  }
  const publicUrl = option('--public-url');
  if (publicUrl) await check('PUBLIC-HTTPS', 'Ordinary unauthenticated public site', async () => {
    assert.equal(new URL(publicUrl).protocol, 'https:');
    assert.equal(new URL(publicUrl).username + new URL(publicUrl).password, '');
    const p = await open({ w: 1280, h: 800, dpr: 1 }, publicUrl);
    try { const result = { url: await p.cdp.evaluate('location.href'), title: await p.cdp.evaluate('document.title') }; assert.ok(result.title); return result; }
    finally { await api('close', { sessionId: p.session.sessionId }); p.cdp.close(); }
  }); else unmeasured('PUBLIC-HTTPS', 'Public website smoke', 'No --public-url supplied');
  unmeasured('PACKAGED-SWITCH', 'Packaged build ignores qualification switch', 'Parent performs after staging packaged candidate');
} catch (error) {if(error instanceof EnvironmentOccluded){report.environmentStop=error.observed;report.plannedStop=error.message;}else if(error instanceof PlannedStop)report.plannedStop=error.message;else report.error=error.stack;report.remainingScenarios='unmeasured: runner stopped before executing remaining scenarios';}
finally {
  if (cancelled) report.cancelled = cancelled;
  if (arrangedWindow) {
    try {
      if (child.launchError || child.exitCode !== null || child.signalCode !== null) {
        report.windowArrangement.restore = {skipped:'native process already exited',id:arrangedWindow.id};
      } else {
        const state = await main.evaluate(`(()=>{const w=${electronModule}.BrowserWindow.fromId(${arrangedWindow.id});if(!w||w.isDestroyed())return {id:${arrangedWindow.id},skipped:'owned window no longer exists'};w.setAlwaysOnTop(${JSON.stringify(arrangedWindow.initialAlwaysOnTop)});return {id:w.id,alwaysOnTop:w.isAlwaysOnTop()}})()`);
        report.windowArrangement.restore = state;
        if (!state.skipped) assert.equal(state.alwaysOnTop, arrangedWindow.initialAlwaysOnTop, 'Owned test window stacking restored');
      }
      await emit({type:'test-window-restored',...report.windowArrangement.restore});
    } catch (error) {
      report.windowArrangement.restoreError = error.stack;
      await emit({type:'test-window-restore-failed',error:error.stack});
    }
  }
  await evidenceWrites;
  await runtime.close().then(() => { report.cleanup = 'passed'; }, error => { report.cleanup = 'failed'; report.cleanupError = error.stack; });
  try {await access(runtime.root);report.cleanup='failed';report.cleanupError='Owned scratch root survived cleanup';}catch(error){if(error.code!=='ENOENT'){report.cleanup='failed';report.cleanupError=error.stack;}}
  if(child?.pid){try{process.kill(-child.pid,0);report.cleanup='failed';report.cleanupError='Owned process group survived cleanup';}catch(error){if(error.code!=='ESRCH'){report.cleanup='failed';report.cleanupError=error.stack;}}}
  await evidenceWrites;
  report.pickQualified = false;
  report.runnerDigest = digest(await readFile(fileURLToPath(import.meta.url)));
  report.harness={};for(const path of ['tests/acceptance/preview/run.mjs','tests/acceptance/preview/network.mjs','tests/acceptance/preview/chooser.mjs','tests/acceptance/preview/tls.mjs','tests/acceptance/preview/packaged.mjs','tests/check-groups.toml'])report.harness[path]=digest(await readFile(join(repo,path)));
  for (const id of ['Q-PV0','Q-PV1','Q-PV2','Q-PV3','Q-PV3h','Q-PV4','Q-PV5','Q-PV6','Q-PV6d','Q-PV6a','Q-PV6h','Q-PV7','Q-PV8','Q-PV9','Q-PV10','PUBLIC-HTTPS','PACKAGED-SWITCH']) {
    if (!report.rows.some(row => row.id === id)) unmeasured(id, 'Required matrix row', 'Run stopped before this row');
  }
  report.outcome = report.error || report.cancelled || report.evidenceError || report.windowArrangement.restoreError || report.cleanup !== 'passed' || report.rows.some(r => r.outcome === 'failed') ? 'failed' : report.rows.some(r => r.outcome === 'unmeasured') ? 'partial' : 'passed';
  report.endHead = git('rev-parse', 'HEAD');
  if (report.endHead !== report.head) { report.outcome = 'failed'; report.identityError = 'HEAD changed during run'; }
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ evidence, outcome: report.outcome, rows: report.rows.map(({ id, scenario, outcome }) => ({ id, scenario, outcome })), error: report.error, cleanup: report.cleanup }));
  process.exitCode = report.outcome === 'passed' ? 0 : report.outcome === 'partial' ? 2 : 1;
}
