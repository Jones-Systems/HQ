import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
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
if (!evidenceParent || !isAbsolute(evidenceParent) || !relative(repo, resolve(evidenceParent)).startsWith('..')) throw Error('--evidence must be an absolute private path outside the repository');
if (process.platform !== 'darwin') throw Error('This runner qualifies the native macOS route only');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
await mkdir(evidenceParent, { recursive: true });
const evidence = await mkdtemp(join(evidenceParent, 'evidence-'));
const runtime = await createRuntime(join(evidenceParent, 'scratch'));
const report = { schema: 'hq-preview-native/v1', head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), dirty: git('status', '--short'), platform: process.platform, architecture: process.arch, node: process.version, invocation: process.argv, evidence, rows: [], outcome: 'unmeasured', networkClaim: 'Normal browser network reach; literal URL filtering is hygiene only.' };
let log = '', main, shell, child, endpoint;
class Unmeasured extends Error {}
const check = async (id, scenario, fn) => {
  try { const observed = await fn(); report.rows.push({ id, scenario, outcome: 'passed', observed }); }
  catch (error) { report.rows.push({ id, scenario, outcome: error instanceof Unmeasured ? 'unmeasured' : 'failed', error: error.stack }); }
};
const unmeasured = (id, scenario, reason) => report.rows.push({ id, scenario, outcome: 'unmeasured', reason });
const api = (route, params) => shell.evaluate(`window.hqServices.preview.call(${JSON.stringify(route)},${JSON.stringify(params)})`);
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const hook = expression => main.evaluate(`globalThis.__hqPreviewQualification.${expression}`);
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:#eee;color:#111;font:16px monospace}#spacer{height:40px}#target{margin:20px;width:240px;height:60px;background:#aaccee}#tail{height:1600px}</style></head><body><div id="spacer"></div><button id="target">Qualification target</button><p id="quote">Select this exact synthetic quote.</p><input id="file" type="file"><div id="tail"></div></body></html>`;
let origin, crossOrigin, canaries;
async function open(viewport = { w: 1280, h: 800, dpr: 1 }, url = origin) {
  const session = value(await api('open', { versionId: 'preview-qualification', url, viewport, label: 'Synthetic native qualification' }));
  value(await api('place', { sessionId: session.sessionId, rect: { x: 0, y: 0, width: viewport.w, height: viewport.h }, visible: true }));
  const target = await until(async () => (await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith(url)), 'preview CDP target');
  const cdp = await connect(target.webSocketDebuggerUrl, runtime);
  return { session: value(await api('status', { sessionId: session.sessionId })), cdp, target };
}
async function withPreview(fn, viewport) {
  const p = await open(viewport);
  try { return await fn(p); } finally { await api('close', { sessionId: p.session.sessionId }); p.cdp.close(); }
}
const capture = session => api('capture', { sessionId: session.sessionId, expectedGeneration: session.generation });
async function click(cdp, x = 80, y = 80) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
let cancelled;
const cancel = signal => { cancelled = signal; void runtime.close().catch(error => { report.cleanupError = error.stack; }); };
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
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-256000); endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(log)?.[1]; inspector = /Debugger listening on (ws:\/\/\S+)/.exec(log)?.[1]; });
  await until(() => { if (child.exitCode !== null || child.launchError) throw Error('Native launch failed: ' + (child.launchError?.message ?? `exit=${child.exitCode}`) + '\n' + log); return endpoint && inspector; }, 'Electron debug endpoints');
  if(args.includes('--fail-after-launch')) throw Error('Deliberate qualification lifecycle failure after native launch');
  main = await connect(inspector, runtime);
  const target = await until(async () => (await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('file:')), 'HQ renderer');
  shell = await connect(target.webSocketDebuggerUrl, runtime);
  await until(() => shell.evaluate('!!window.hqServices?.preview'), 'preview preload');
  report.desktop = await shell.evaluate('window.hqDesktop');
  assert.equal(report.desktop.versions.electron, '44.9.0');
  report.hooksAvailable = await main.evaluate('!!globalThis.__hqPreviewQualification');
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
    await cdp.evaluate(`(async()=>{document.body.replaceChildren();document.documentElement.style.cssText='margin:0;padding:0;scroll-behavior:auto';document.body.style.cssText='margin:0;padding:0';for(let i=0;i<24;i++){const row=document.createElement('div');row.style.cssText='height:100px;background:'+(i%2?'rgb(0,255,0)':'rgb(255,0,0)');document.body.append(row)}scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
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
    assert.deepEqual(initialPixels.top, [255,0,0,255]);
    assert.deepEqual(initialPixels.next, [0,255,0,255]);
    await cdp.evaluate('new Promise(resolve=>{scrollTo(0,100);requestAnimationFrame(()=>requestAnimationFrame(resolve))})');
    assert.equal(await cdp.evaluate('scrollY'), 100);
    const scrolled = value(await capture(session));
    const scrolledPixels = await inspectCapture(scrolled, 'stable-scroll-after');
    assert.deepEqual(scrolled.scroll, { x: 0, y: 100 });
    assert.equal(scrolledPixels.width, session.viewport.w);
    assert.equal(scrolledPixels.height, session.viewport.h);
    assert.deepEqual(scrolledPixels.top, [0,255,0,255], 'PNG top is the visible green row after stable scroll');
    assert.deepEqual(scrolledPixels.next, [255,0,0,255]);
    assert.notEqual(scrolled.captureDigest, initial.captureDigest);
    return { initial, initialPixels, scrolled, scrolledPixels };
  }));
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
    ['hid', "navigator.hid.requestDevice({filters:[]}).then(()=> 'allowed',e=>'denied:'+e.name)"],
    ['serial', "navigator.serial.requestPort().then(()=> 'allowed',e=>'denied:'+e.name)"],
    ['bluetooth', "navigator.bluetooth.requestDevice({acceptAllDevices:true}).then(()=> 'allowed',e=>'denied:'+e.name)"],
  ]) await check('Q-PV2', `Permission/device API ${name}`, () => withPreview(async ({ cdp }) => {
    const before = report.hooksAvailable ? await hook('stats()') : null;
    const response = await cdp.send('Runtime.evaluate',{expression:`(async()=>{try{return await (${expression})}catch(e){return 'unsupported:'+e.name}})()`,returnByValue:true,awaitPromise:true,userGesture:true});
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
    try { const after=await hook('stats()');if(after.denials.certificates<=before.denials.certificates) throw new Unmeasured('No native select-client-certificate callback observed');return {result,before:before.denials.certificates,after:after.denials.certificates}; }
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
    const rect = await cdp.evaluate("(()=>{const r=document.querySelector('#quote').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x + 2, y: rect.y + 8, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + 300, y: rect.y + 8, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 300, y: rect.y + 8, button: 'left', clickCount: 1 });
    assert.ok(await cdp.evaluate('getSelection().toString().length>0'));
    const events = await until(async () => { const result = value(await api('events', { sessionId: session.sessionId, after: 0 })); return result.events.length ? result.events : null; }, 'trusted citation', 5000);
    assert.ok(events.every(event => event.event.type === 'text-cited')); return events;
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
      await cdp.evaluate("window.motion=document.querySelector('#target').animate([{transform:'translateX(0px)'},{transform:'translateX(300px)'}],{duration:1200,iterations:Infinity})");
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
      const setup = await cdp.evaluate(`(async()=>{const c=document.createElement('canvas');c.width=200;c.height=100;const ctx=c.getContext('2d');let frame=0;window.videoClock=setInterval(()=>{ctx.fillStyle='rgb('+((frame++*13)%256)+',0,128)';ctx.fillRect(0,0,200,100)},100);const v=document.createElement('video');v.id='moving-video';v.muted=true;v.style.cssText='position:fixed;left:20px;top:200px;width:200px;height:100px';v.srcObject=c.captureStream(20);document.body.append(v);await v.play();await new Promise(r=>v.requestVideoFrameCallback(r));return {width:v.videoWidth,height:v.videoHeight,paused:v.paused}})()`);
      assert.equal(setup.paused, false); assert.equal(setup.width, 200);
      const before = await hook('stats()'); await hook("pauseAt('first-capture')");
      const pending = capture(session); pending.catch(() => {});
      try { await hook('waitForPause()'); await cdp.evaluate(`new Promise(r=>document.querySelector('#moving-video').requestVideoFrameCallback(r))`); await delay(110); }
      finally { await hook('resume()'); await hook('pauseAt(null)'); }
      const result = await pending; assert.equal(result.kind, 'stale'); assert.equal(result.reason, 'pixels-unstable');
      assert.equal((await hook('stats()')).blobWrites, before.blobWrites);
      await cdp.evaluate("clearInterval(window.videoClock);document.querySelector('#moving-video').pause()"); await delay(100); value(await capture(session)); return { setup, result };
    }));
    await check('Q-PV6a', 'Native blinking caret changes captured pixels', () => withPreview(async ({ session, cdp }) => {
      await cdp.evaluate(`(()=>{const input=document.createElement('input');input.id='caret';input.value='Caret';input.style.cssText='position:fixed;left:20px;top:200px;width:300px;font:48px monospace;caret-color:black';document.body.append(input);input.focus();input.setSelectionRange(5,5)})()`);
      const shot = async () => digest(Buffer.from((await cdp.send('Page.captureScreenshot')).data, 'base64'));
      const first = await shot(); let changed = false;
      for (let i=0;i<6&&!changed;i++) { await delay(180); changed = await shot() !== first; }
      if (!changed) throw new Unmeasured('Positive control: no native caret pixels observed');
      const before = await hook('stats()'); await hook("pauseAt('first-capture')");
      const pending = capture(session); pending.catch(() => {});
      try { await hook('waitForPause()'); const baseline=await shot(); let different=false; for(let i=0;i<6&&!different;i++){await delay(180);different=await shot()!==baseline;} if(!different) throw new Unmeasured('Caret ceased blinking during pause'); }
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
    await check('Q-PV9', 'Domain switch closes views and clears session', async () => {
      const p = await open(); const before = await hook('stats()');
      assert.equal(await shell.evaluate(`(()=>{const b=[...document.querySelectorAll('nav[aria-label="Domains"] button')].find(b=>b.textContent.trim()==='Work');b?.click();return !!b})()`), true);
      await until(async () => (await hook('stats()')).sessions === 0, 'domain switch teardown');
      const after = await hook('stats()'); assert.equal(after.clearedSessions, before.clearedSessions + 1); p.cdp.close();
      await shell.evaluate(`(()=>{const b=[...document.querySelectorAll('nav[aria-label="Domains"] button')].find(b=>b.textContent.trim()==='Design');b?.click()})()`); return after;
    });
    await check('Q-PV9', 'Main renderer reload closes views and clears session', async () => {
      const p = await open(); const before = await hook('stats()');
      await shell.send('Page.reload');
      await until(async () => (await hook('stats()')).sessions === 0, 'reload view teardown');
      await until(() => shell.evaluate('!!window.hqServices?.preview'), 'reloaded preload');
      const after = await hook('stats()'); assert.equal(after.clearedSessions, before.clearedSessions + 1); p.cdp.close(); return after;
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
} catch (error) { report.error = error.stack; }
finally {
  if (cancelled) report.cancelled = cancelled;
  await writeFile(join(evidence, 'native.log'), log).catch(error => { report.evidenceError = error.stack; });
  await runtime.close().then(() => { report.cleanup = 'passed'; }, error => { report.cleanup = 'failed'; report.cleanupError = error.stack; });
  try {await access(runtime.root);report.cleanup='failed';report.cleanupError='Owned scratch root survived cleanup';}catch(error){if(error.code!=='ENOENT'){report.cleanup='failed';report.cleanupError=error.stack;}}
  if(child?.pid){try{process.kill(-child.pid,0);report.cleanup='failed';report.cleanupError='Owned process group survived cleanup';}catch(error){if(error.code!=='ESRCH'){report.cleanup='failed';report.cleanupError=error.stack;}}}
  report.pickQualified = false;
  report.runnerDigest = digest(await readFile(fileURLToPath(import.meta.url)));
  report.harness={};for(const path of ['tests/acceptance/preview/run.mjs','tests/acceptance/preview/network.mjs','tests/acceptance/preview/chooser.mjs','tests/acceptance/preview/tls.mjs','tests/acceptance/preview/packaged.mjs','tests/check-groups.toml'])report.harness[path]=digest(await readFile(join(repo,path)));
  for (const id of ['Q-PV0','Q-PV1','Q-PV2','Q-PV3','Q-PV3h','Q-PV4','Q-PV5','Q-PV6','Q-PV6d','Q-PV6a','Q-PV6h','Q-PV7','Q-PV8','Q-PV9','Q-PV10','PUBLIC-HTTPS','PACKAGED-SWITCH']) {
    if (!report.rows.some(row => row.id === id)) unmeasured(id, 'Required matrix row', 'Run stopped before this row');
  }
  report.outcome = report.error || report.cancelled || report.evidenceError || report.cleanup !== 'passed' || report.rows.some(r => r.outcome === 'failed') ? 'failed' : report.rows.some(r => r.outcome === 'unmeasured') ? 'partial' : 'passed';
  report.endHead = git('rev-parse', 'HEAD');
  if (report.endHead !== report.head) { report.outcome = 'failed'; report.identityError = 'HEAD changed during run'; }
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ evidence, outcome: report.outcome, rows: report.rows.map(({ id, scenario, outcome }) => ({ id, scenario, outcome })), error: report.error, cleanup: report.cleanup }));
  process.exitCode = report.outcome === 'passed' ? 0 : report.outcome === 'partial' ? 2 : 1;
}
