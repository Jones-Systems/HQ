import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { createRuntime, connect, until } from '../runtime.mjs';
import { heldCaptureContainment } from './containment.mjs';
import { createImageFixture } from './images.mjs';
import { inspectStorage, requireAdmission } from '../../../tools/storage/admission.mjs';
import { openProbeStorage, LIMITS, snapshotFile, sameSnapshot, absent, sha256, readBounded } from './trace-probe-storage.mjs';
import { REFERENCE, validateReference, acquireReference, runReference, parseQuery, terminalPredicate, compareSubset, classifyTiny, thinArm64 } from './trace-probe-reference.mjs';

export const WORKTREE = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const PORT_KEYS = Object.freeze(['place','settle','view','capture','blobWrites','traces','browserPid','pauseAt','waitForPause','resume','navigate','settings','displayScale','contentSize','widget','traceStart','traceStop','delay','until']);
export const FROZEN = Object.freeze({
  'tests/acceptance/preview/run.mjs':'e2610ae09377c603d11129766f9045a919b1a04a',
  'tests/acceptance/preview/containment.mjs':'c157f93f00f4dfb6067ecb900666f05f53798988',
  'tests/acceptance/preview/images.mjs':'d62a6af6a7206570fc9c3a2df1b1a170ca4fd189',
  'tests/acceptance/runtime.mjs':'8f27d962505762197021e40db7693bfb44eaec11',
  'tests/acceptance/evidence.mjs':'b8e84b0c44d78709d938d5ba16d5d4a9a9be690f',
  'tests/acceptance/preview/evidence.mjs':'a6a92f6cb46288e6c81efb0fec2f77c772d55b3e',
  'tools/storage/admission.mjs':'6d6ea06dc7a3f6001d34f8d34db6c772a804ae0d',
  'tools/storage/policy.mjs':'3419adbdb22bbeae5e19b4dbfa8a1e630700ee00',
});
export function blobHash(b) { return createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex'); }
export async function verifyFrozen(repo = WORKTREE) {
  for (const [name,oid] of Object.entries(FROZEN)) assert.equal(blobHash(await fs.readFile(path.join(repo,name))),oid,`frozen:${name}`);
}
function varint(n) { n=BigInt(n); if(n<0n)throw Error('protobuf-integer');const out=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;out.push(b);}while(n);return Buffer.from(out); }
const scalar=(n,v)=>Buffer.concat([varint(n*8),varint(v)]);
const bytes=(n,v)=>{v=Buffer.from(v);return Buffer.concat([varint(n*8+2),varint(v.length),v]);};
export function encodeTraceConfig({ browserPid, outputPath, caseName }) {
  if(!Number.isSafeInteger(browserPid)||browserPid<=0||!path.isAbsolute(outputPath)||!['normal','tiny'].includes(caseName))throw Error('config-input');
  const track=Buffer.concat([bytes(1,'*'),bytes(2,'disabled-by-default-viz.quads')]);
  const config=Buffer.concat([bytes(1,'track_event'),bytes(113,track)]);
  return Buffer.concat([bytes(1,Buffer.concat([scalar(1,4096),scalar(4,2)])),bytes(2,Buffer.concat([bytes(1,config),bytes(2,`org.chromium-${browserPid}`)])),
    scalar(3,40000),scalar(8,1),scalar(9,1000),scalar(10,caseName==='normal'?16777216:4096),scalar(14,5000),scalar(23,5000),bytes(29,outputPath)]);
}
export function parseElapsed(s) {
  const m=/^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(s);
  if(!m||Number(m[4])>=60||Number(m[3])>=60)throw Error('budget-anchor');
  return Number(m[1]??0)*86400+Number(m[2]??0)*3600+Number(m[3])*60+Number(m[4]);
}
export function budgetAnchor({ now, workerCommand, elapsed }) {
  if(path.basename(workerCommand.trim())!=='Runner.Worker'||!Number.isFinite(now))throw Error('budget-anchor');
  return now-parseElapsed(elapsed)-30+900;
}
export function setupBudget(end, now, step) {
  const maxima={g0:[60,120],g1:[60,0],npm:[240,0],electron:[120,0],build:[240,0]};
  if(!maxima[step]||!Number.isFinite(end)||now+maxima[step][0]+maxima[step][1]+180>end)throw Error(`budget:${step}`);
}
export function driverBudget(end, now) {
  const minutes=Math.floor((end-180-now-15)/60);
  if(!Number.isFinite(end)||minutes<6)throw Error('budget:driver');
  return {minutes,deadline:Math.min(end-180,now+minutes*60-10)};
}
export function admitCase(deadline, now) { if(!Number.isFinite(deadline)||now+260>deadline)throw Error('budget:case'); }
export async function bounded(operation, milliseconds, reason='deadline') {
  let timer;try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(reason)),milliseconds);})]);}finally{clearTimeout(timer);}
}

// The same state machine is used by native ports and finite fake-port tests.
// traceStop never throws, including during final collection after oracle failure.
export function createTraceLifecycle(p) {
  let stopPromise;
  const facts={caseName:p.caseName,reasons:[],ledger:[],cessation:false,renameRecorded:false}, state={};
  function fail(e){const reason=typeof e==='string'?e:e.message;facts.reasons.push(reason,...(e?.additional??[]));facts.primary??=reason;}
  async function traceStart(categories) {
    try {
      assert.deepEqual(categories,['disabled-by-default-viz.quads'],'category-guard');
      state.pid=await p.mainPid();assert.equal(state.pid,p.spawnedPid,'browser-pid');
      facts.browserPid=state.pid;facts.identities=await p.identities();
      await p.precharge();await p.rawAbsentSameDevice();
      const config=encodeTraceConfig({browserPid:state.pid,outputPath:p.outputPath,caseName:p.caseName});facts.configSha256=sha256(config);
      state.connection=await p.connection(method=>{if(method.startsWith('Tracing.')||method.startsWith('IO.')){if(!facts.ledger.length){facts.ledger.push(method.slice(0,128));fail('unexpected-cdp-event');}}});
      state.request=p.now();facts.tRequest=state.request;
      await bounded(()=>state.connection.send('Tracing.start',{tracingBackend:'chrome',transferMode:'ReturnAsStream',perfettoConfig:config.toString('base64')}),5000,'start-timeout');
      state.ack=p.now();facts.tAck=state.ack;facts.started=true;
    }catch(e){fail(e);throw e;}
  }
  async function stopOnce() {
    facts.tEnd=p.now();if(state.request!==undefined&&facts.tEnd-state.request>38000)fail('span-exceeded');
    let trace={traceEvents:[]};
    try {
      if(state.ack!==undefined)await p.waitUntil(state.ack+52000);
      if(state.ack!==undefined){state.initial=await p.snapshot();facts.raw=state.initial;facts.Q1=await p.query('Q1');}
    }catch(e){fail(e);}
    try{if(state.connection)await state.connection.close();}catch(e){fail(e);}
    try{
      facts.identities=await p.identities(facts.identities);
      await p.stop();facts.cessation=await p.proveCessation(facts.identities);
      if(!facts.cessation)throw Error('cessation-uncertain');
    }catch(e){fail(e);facts.cessation=false;}
    if(!facts.cessation)return trace;
    try{
      if(!state.initial)throw Error('raw-snapshot-unavailable');
      const after=await p.snapshot();if(!sameSnapshot(state.initial,after))throw Error('post-snapshot-mutation');
      await p.privateMode(state.initial);facts.secondary=await p.secondaryFiles(state.request);
      if(facts.secondary.length)throw Error('secondary-file');
      facts.retained=await p.rename(state.initial);facts.renameRecorded=true;
      trace=await p.convert();if(!Array.isArray(trace?.traceEvents))throw Error('reference-json-shape');
    }catch(e){fail(e);facts.renameRecorded=true;trace={traceEvents:[]};}
    return trace;
  }
  const traceStop=()=>stopPromise??=stopOnce().catch(e=>{fail(e);return {traceEvents:[]};});
  return {traceStart,traceStop,browserPid:async()=>state.pid,facts,fail};
}
export async function executeCase(p) {
  const trace=createTraceLifecycle(p.trace), result={caseName:p.caseName,facts:trace.facts};
  let stopped=false;
  try{
    await p.drawable();
    try{result.oracle=await p.oracle(trace);}catch(e){result.oracle={outcome:trace.facts.reasons.length?'not-evaluable':'failed',reason:e.message};trace.fail(e);}
    // A pre-trace oracle failure still needs the same stop/readbacks.
    if(!trace.facts.cessation){await trace.traceStop();stopped=true;}
    if(trace.facts.cessation&&trace.facts.retained){result.Q2=await p.query('Q2');if(p.caseName==='tiny')result.text=await p.text();}
  }catch(e){trace.fail(e);}
  finally{
    if(!trace.facts.cessation&&!stopped)await trace.traceStop();
    if(trace.facts.cessation&&trace.facts.renameRecorded){try{result.cleanup=await p.close();}catch(e){trace.fail(e);}}
    else result.cleanup={held:true,reason:'cessation-or-rename-unproved'};
  }
  return result;
}
export function outcomeFor(normal,tiny) {
  const f=normal?.facts;
  const partial=f?.started&&f.raw?.size>0&&normal.terminal?.complete&&normal.subset?.SUBSET_EXPORT_CONSISTENT&&f.cessation&&f.renameRecorded&&f.retained&&
    f.ledger.length===0&&f.reasons.length===0&&normal.cleanup?.rootAbsent&&!(tiny?.facts?.reasons.length)&&tiny?.TRUNCATION!=='UNEXPECTED_COMPLETE';
  return partial?'MEASURED_PARTIAL':f?.primary?.startsWith('budget:')?'INCONCLUSIVE':'NONPASSING';
}
export async function serialCases({deadline,now,run}) {
  const cases=[];
  for(const caseName of ['normal','tiny']){
    try{admitCase(deadline,now());}catch(e){cases.push({caseName,TRUNCATION:'NOT_ADMITTED',facts:{primary:e.message,reasons:[e.message]}});break;}
    const result=await run(caseName);cases.push(result);
    if(!result.facts.cessation||!result.cleanup?.rootAbsent)break;
  }
  return cases;
}
async function psSnapshot() {
  const s=execFileSync('/bin/ps',['-axo','pid=,ppid=,pgid=,lstart='],{encoding:'utf8',maxBuffer:4*1024**2});
  return s.trim().split('\n').filter(Boolean).map(line=>{const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);if(!m)throw Error('process-identity');return {pid:Number(m[1]),ppid:Number(m[2]),pgid:Number(m[3]),birth:m[4]};});
}
export function descendants(table,pid,previous=[]) {
  const selected=new Map(previous.map(v=>[`${v.pid}:${v.birth}`,v]));let frontier=new Set([pid]);
  for(let n=0;n<table.length&&frontier.size;n++){
    const next=new Set();for(const row of table)if(frontier.has(row.pid)||frontier.has(row.ppid)){selected.set(`${row.pid}:${row.birth}`,row);if(!frontier.has(row.pid))next.add(row.pid);}frontier=next;
  }
  if(!previous.length&&!table.some(x=>x.pid===pid))throw Error('missing-producer-identity');
  return [...selected.values()];
}
export function identitiesAbsent(table, captured, groupAbsent) {
  return groupAbsent&&captured.length>0&&captured.every(old=>!table.some(now=>now.pid===old.pid));
}
async function proveCessation(pid, captured) {
  const end=Date.now()+10000;
  do{
    let groupAbsent=false;try{process.kill(-pid,0);}catch(e){if(e.code==='ESRCH')groupAbsent=true;else throw e;}
    if(identitiesAbsent(await psSnapshot(),captured,groupAbsent))return true;
    await delay(100);
  }while(Date.now()<end);
  return false;
}
async function tracingConnection(url,onEvent) {
  const ws=new WebSocket(url);let answer,failed;
  await bounded(()=>new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});}),5000,'cdp-open');
  ws.addEventListener('message',({data})=>{
    if(typeof data!=='string'||Buffer.byteLength(data)>65536){failed=Error('cdp-message-limit');answer?.reject(failed);return;}
    try{const m=JSON.parse(data);if(m.method)onEvent(m.method);else if(m.id===1){if(m.error)answer?.reject(Error('direct-file-unreachable'));else answer?.resolve(m.result);}}
    catch(e){failed=e;answer?.reject(e);}
  });
  return {
    send(method,params){if(failed||method!=='Tracing.start'||answer)throw failed??Error('cdp-method');return new Promise((resolve,reject)=>{answer={resolve,reject};ws.send(JSON.stringify({id:1,method,params}));});},
    close:()=>bounded(()=>new Promise((resolve,reject)=>{if(ws.readyState===WebSocket.CLOSED)return resolve();ws.addEventListener('close',resolve,{once:true});ws.addEventListener('error',reject,{once:true});ws.close();}),2000,'cdp-close'),
  };
}
async function newFiles(root, after) {
  const result=[];let entries=0;
  async function visit(dir){for(const name of await fs.readdir(dir)){if(++entries>4096)throw Error('secondary-scan-limit');const full=path.join(dir,name),s=await fs.lstat(full);if(s.isSymbolicLink())throw Error('secondary-symlink');if(s.isDirectory())await visit(full);else if(s.isFile()&&s.birthtimeMs>=after)result.push({name,size:s.size});}}
  await visit(root);return result;
}
async function machFile(filename) {
  const fd=await fs.open(filename,'r');try{const b=Buffer.alloc(32);const r=await fd.read(b,0,32,0);thinArm64(b.subarray(0,r.bytesRead));}finally{await fd.close();}
}

async function nativeCase({caseName,storage,tools,deadline,signal,repo=WORKTREE}) {
  // Admission is repeated before each new runtime; an existing snapshot never
  // authorizes a later filesystem allocation.
  requireAdmission(await inspectStorage({worktree:repo,roots:[{kind:'evidence',path:path.dirname(storage.directory)},{kind:'scratch',path:storage.scratchParent}]}));
  admitCase(deadline,Date.now()/1000);
  const runtime=await createRuntime(storage.scratchParent);
  const traceDir=path.join(runtime.root,'trace');await fs.mkdir(traceDir,{mode:0o700});
  const outputPath=path.join(traceDir,`${caseName}.pftrace`);
  let child,main,shell,endpoint,expectedTeardown=false,preview,life,retained,original,converted;
  let text='',inspector,unexpectedExit;
  const builtins="process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')";
  const now=()=>Date.now();
  const check=()=>{signal.throwIfAborted();if(unexpectedExit)throw unexpectedExit;};
  const hook=expression=>{check();return main.evaluate(`globalThis.__hqPreviewQualification.${expression}`);};
  const value=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
  const api=(route,params)=>{check();return shell.evaluate(`window.hqServices.preview.call(${JSON.stringify(route)},${JSON.stringify(params)})`);};
  const url=await runtime.listen(createServer(createImageFixture()));
  const binary=path.join(repo,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const identities=async previous=>descendants(await psSnapshot(),child.pid,previous);
  const stop=async()=>{expectedTeardown=true;await bounded(()=>runtime.stop(child),15000,'cessation-uncertain');};
  const toolSubjects=new Map();
  const toolLifecycle={
    capture:async c=>{toolSubjects.set(c.pid,{captured:[],absent:false});const value=descendants(await psSnapshot(),c.pid);toolSubjects.set(c.pid,{captured:value,absent:false});return value;},
    absent:async(c,captured)=>{const value=await proveCessation(c.pid,captured);toolSubjects.set(c.pid,{captured,absent:value});return value;},
  };
  const close=()=>{if([...toolSubjects.values()].some(s=>!s.absent))throw Error('reference-cessation-uncertain');return bounded(()=>runtime.close(),10000,'runtime-close');};
  try{
    await machFile(binary);await fs.mkdir(path.join(runtime.root,'tmp'),{mode:0o700});
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('HQ_')&&!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key)));
    Object.assign(env,{HQ_USER_DATA_DIR:path.join(runtime.root,'profile'),HQ_QUALIFY_PREVIEW:'1',TMPDIR:path.join(runtime.root,'tmp')});
    child=runtime.spawn(binary,['--host-resolver-rules=MAP hq-qualification.test 127.0.0.1','--inspect=0','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
      '--enable-features=TracingServiceInProcess',path.join(repo,'apps/desktop/dist-electron/main.js')],{cwd:repo,env,stdio:['ignore','ignore','pipe']});
    child.once('error',e=>{original??=e;unexpectedExit??=e;});
    child.once('exit',(code,signal)=>{if(!expectedTeardown){unexpectedExit=Error(`unexpected-native-exit:${signal??code}`);original??=unexpectedExit;}});
    const stopForOutput=()=>{original??=Error('electron-output-limit');void stop().catch(()=>{});};
    const electronCount={bytes:0};
    child.stderr.on('data',bytes=>{if(bytes.length>65536||electronCount.bytes+bytes.length>LIMITS.electron){stopForOutput();return;}electronCount.bytes+=bytes.length;text+=bytes;
      endpoint=/DevTools listening on (ws:\/\/\S+)/.exec(text)?.[1];inspector=/Debugger listening on (ws:\/\/\S+)/.exec(text)?.[1];});
    const cancel=()=>{original??=Error(`cancelled:${signal.reason?.message??'signal'}`);void stop().catch(()=>{});};
    signal.addEventListener('abort',cancel,{once:true});runtime.own('cancellation-listener',()=>signal.removeEventListener('abort',cancel));
    await bounded(()=>until(()=>{check();if(original)throw original;return endpoint&&inspector;},'debug-endpoints',30000),30000,'launch-timeout');
    main=await connect(inspector,runtime);
    const renderer=await until(async()=>{check();const targets=await(await fetch(`http://${new URL(endpoint).host}/json/list`)).json();return targets.find(t=>t.type==='page'&&t.url.startsWith('file:'));},'HQ renderer');
    shell=await connect(renderer.webSocketDebuggerUrl,runtime);
    await until(()=>shell.evaluate('!!window.hqServices?.preview'),'preview-preload');
    const opened=value(await api('open',{versionId:'preview-qualification',url:url+'/images?kind=img&decoding=async',viewport:{w:1024,h:720,dpr:1},label:'Synthetic native qualification'}));
    const sessionId=opened.sessionId;
    value(await api('place',{sessionId,rect:{x:0,y:0,width:1024,height:720},visible:true}));
    const target=await until(async()=>(await(await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t=>t.type==='page'&&t.url.startsWith(url)),'preview CDP target');
    const cdp=await connect(target.webSocketDebuggerUrl,runtime);preview={sessionId,cdp};
    const owned=`globalThis.__hqPreviewQualification.sessions().find(s=>s.sessionId===${JSON.stringify(sessionId)})`;
    const settingsButton=show=>shell.evaluate(show?`(()=>{const b=document.querySelector('button[title="Settings"]');b?.click();return !!b})()`:`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Back to'));b?.click();return !!b})()`);
    const drawable=async()=>{
      check();const windows=await main.evaluate(`${builtins}.BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused(),destroyed:w.isDestroyed()}))`);
      const document=await cdp.evaluate('({visibility:document.visibilityState,focused:document.hasFocus()})');
      const sessions=(await hook('sessions()')).filter(s=>s.sessionId===sessionId);assert.equal(sessions.length,1,'exact-live-preview-session');
      assert.ok(windows.some(w=>w.visible&&!w.minimized&&!w.destroyed),'drawable-window');assert.equal(document.visibility,'visible');
      return {windows,document};
    };
    await bounded(async()=>{
      const id=await main.evaluate(`(()=>{const {app}=${builtins};return {packaged:app.isPackaged,arch:process.arch,electron:process.versions.electron,chrome:process.versions.chrome}})()`);
      assert.deepEqual(id,{packaged:false,arch:'arm64',electron:'44.9.0',chrome:'152.0.7977.167'});
      assert.equal((await hook('stats()')).mainPid,child.pid,'hook-pid');
      const observed=await drawable();assert.ok(observed.windows.some(w=>w.focused),'window-focus');
      assert.ok(await main.evaluate(`(()=>{const {BrowserWindow,screen}=${builtins};return screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).scaleFactor})()`)>0);
      for(const row of await identities()){
        const executable=execFileSync('/bin/ps',['-p',String(row.pid),'-o','comm='],{encoding:'utf8',maxBuffer:65536}).trim();await machFile(executable);
      }
    },10000,'G2');
    const tracePorts={caseName,outputPath,spawnedPid:child.pid,now,
      mainPid:async()=>(await hook('stats()')).mainPid,identities,
      precharge:async()=>storage.rawCharge(caseName),
      rawAbsentSameDevice:async()=>{await absent(outputPath);if(String((await fs.stat(traceDir,{bigint:true})).dev)!==storage.dev)throw Error('same-filesystem-required');},
      connection:onEvent=>tracingConnection(endpoint,onEvent),waitUntil:async at=>{check();await delay(Math.max(0,at-now()),undefined,{signal});},
      snapshot:()=>snapshotFile(outputPath,{limit:caseName==='normal'?LIMITS.rawNormal:LIMITS.rawTiny,dev:storage.dev,producer:true}),
      query:async phase=>parseQuery(await runReference({runtime,storage,tools,kind:'query',raw:phase==='Q1'?outputPath:retained,sql:REFERENCE.queries[phase],
        name:`${caseName}-${phase}`,milliseconds:phase==='Q1'?20000:30000,signal,lifecycle:toolLifecycle,producer:phase==='Q1'}),phase),
      stop,proveCessation:async captured=>await proveCessation(child.pid,captured)&&[...toolSubjects.values()].every(s=>s.absent),
      privateMode:async initial=>{const fd=await fs.open(outputPath,(await import('node:fs')).constants.O_RDWR|(await import('node:fs')).constants.O_NOFOLLOW);try{const s=await fd.stat({bigint:true});if(String(s.dev)!==initial.dev||String(s.ino)!==initial.ino||Number(s.size)!==initial.size)throw Error('post-snapshot-mutation');await fd.chmod(0o600);}finally{await fd.close();}},
      secondaryFiles:async at=>[...(await fs.readdir(traceDir)).filter(n=>n!==`${caseName}.pftrace`).map(name=>({name})),...await newFiles(path.join(runtime.root,'tmp'),at)],
      rename:async initial=>{retained=await storage.retainRaw(outputPath,caseName,initial,runtime.root);return retained;},
      convert:async()=>converted=await runReference({runtime,storage,tools,kind:'json',raw:retained,name:caseName,milliseconds:30000,signal,lifecycle:toolLifecycle}),
    };
    const result=await executeCase({caseName,drawable,trace:tracePorts,close,
      query:tracePorts.query,text:()=>runReference({runtime,storage,tools,kind:'text',raw:retained,name:caseName,milliseconds:10000,signal,lifecycle:toolLifecycle}),
      oracle:async trace=>{
        life=trace;
        // Keep the frozen port membership/order and product assertions. The
        // diagnostic changes only trace start/stop and the cached browser PID.
        return heldCaptureContainment({
          place:async rect=>value(await api('place',{sessionId,rect,visible:true})),
          settle:()=>until(()=>cdp.evaluate(`(async()=>{if(document.readyState!=='complete'||![...document.images].every(i=>i.complete&&i.naturalWidth>0))return false;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await new Promise(r=>setTimeout(r,500));return true})()`).catch(()=>false),'image page settled'),
          view:async()=>(await hook('sessions()')).find(s=>s.sessionId===sessionId),
          capture:async()=>{await drawable();return api('capture',{sessionId,expectedGeneration:value(await api('status',{sessionId})).generation});},
          blobWrites:async()=>(await hook('stats()')).blobWrites,
          traces:async()=>(await hook('stats()')).traces.filter(t=>t.sessionId===sessionId),
          browserPid:trace.browserPid,
          pauseAt:stage=>hook(`pauseAt(${JSON.stringify(stage)})`),
          waitForPause:()=>hook('waitForPause()'),
          resume:()=>hook('resume()'),
          navigate:async()=>value(await api('navigate',{sessionId,route:'/images?kind=img&decoding=async&navigated=1'})),
          settings:async show=>{assert.equal(await settingsButton(show),true,`Settings ${show?'open':'close'} control`);await until(async()=>(await hook('sessions()')).find(s=>s.sessionId===sessionId)?.overlayHidden===show,`Settings overlay ${show}`);},
          displayScale:()=>main.evaluate(`(()=>{const {BrowserWindow,screen}=${builtins};const w=BrowserWindow.getAllWindows()[0];return screen.getDisplayMatching(w.getBounds()).scaleFactor})()`),
          contentSize:()=>main.evaluate(`(()=>{const {BrowserWindow}=${builtins};const {width,height}=BrowserWindow.getAllWindows()[0].getContentBounds();return {width,height}})()`),
          widget:async()=>{const bytes=Buffer.from(await main.evaluate(`(async()=>{const {webContents}=${builtins};return (await webContents.fromId(${owned}.webContentsId).capturePage()).toPNG().toString('base64')})()`),'base64');return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};},
          traceStart:trace.traceStart,
          traceStop:trace.traceStop,
          delay,until,
        });
      },
    });
    if(original){result.facts.reasons.unshift(original.message);result.facts.primary=original.message;}
    const f=result.facts;
    result.terminal=terminalPredicate(f.Q1??[],{cap:caseName==='normal'?16777216:4096,size:f.raw?.size??0,pid:child.pid});
    // The converter result used by the unchanged oracle is captured by the
    // same traceStop, not a second conversion or a reconstructed trace.
    if(f.retained&&result.Q2){
      result.subset=compareSubset(result.Q2,converted,child.pid,result.terminal.complete);}
    return result;
  }catch(e){
    original??=e;const captured=child?.pid?await identities().catch(()=>[]):[];
    if(child)try{await stop();}catch{}
    const ceased=child?.pid?await proveCessation(child.pid,captured).catch(()=>false):!child;
    let cleanup={held:true};if(ceased)try{cleanup=await close();}catch{}
    return {caseName,facts:{started:false,primary:original.message,reasons:[original.message],cessation:ceased,ledger:[],renameRecorded:false},cleanup};
  }finally{
    // No independent removal route: unknown cessation retains the runtime.
    if(preview&&child?.exitCode===null&&!child.signalCode&&!unexpectedExit){try{await api('close',{sessionId:preview.sessionId});}catch{}}
  }
}
function json(value){return JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,null,2)+'\n';}
async function buildIdentity(repo) {
  const result={};
  for(const name of ['apps/desktop/dist/index.html','apps/desktop/dist-electron/main.js','apps/desktop/dist-electron/preload.cjs','apps/desktop/dist-electron/preview-agent/agent.js'])
    result[name]=(await snapshotFile(path.join(repo,name),{limit:256*1024**2,producer:true})).sha256;
  return result;
}
export async function runProbe({repo=WORKTREE,parent,jobEnd,expectedHead},{runCase=nativeCase,acquire=acquireReference}={}) {
  if(process.platform!=='darwin'||process.arch!=='arm64'||process.version!=='v24.19.0')throw Error('G1-platform');
  const git=(...a)=>execFileSync('git',a,{cwd:repo,encoding:'utf8',maxBuffer:1024**2}).trim();
  if(!/^[a-f0-9]{40}$/.test(expectedHead??'')||git('rev-parse','HEAD')!==expectedHead||git('status','--short'))throw Error('source-identity');
  await verifyFrozen(repo);validateReference();await machFile(process.execPath);
  const budget=driverBudget(jobEnd,Date.now()/1000),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(Error('budget:driver')),Math.max(0,budget.deadline*1000-Date.now()));
  const handlers=new Map(['SIGINT','SIGTERM'].map(s=>[s,()=>controller.abort(Error(s))]));for(const [s,h]of handlers)process.on(s,h);
  let storage,result={schema:'hq-qpv4-diagnostic/v1',head:expectedHead,outcome:'INCONCLUSIVE',FULL_FIDELITY:'UNPROVED',TRUNCATION:'NOT_ADMITTED',residuals:['R-T','R-F']};
  try{
    storage=await openProbeStorage({worktree:repo,parent,scratchParent:path.join(repo,'.t3/preview-acceptance-scratch')});
    const build=await buildIdentity(repo);result.build=build;
    const tools=await acquire(storage,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
    result.cases=await serialCases({deadline:budget.deadline,now:()=>Date.now()/1000,run:async caseName=>{await verifyFrozen(repo);assert.deepEqual(await buildIdentity(repo),build,'build-drift');return runCase({caseName,storage,tools,deadline:budget.deadline,signal:controller.signal,repo});}});
    const [normal,tiny]=result.cases;
    result.primary=normal?.facts?.primary??tiny?.facts?.primary;
    assert.deepEqual(await buildIdentity(repo),build,'build-drift');
    Object.assign(result,classifyTiny({admitted:!!tiny&&!tiny.TRUNCATION,normalComplete:!!normal?.terminal?.complete,terminalComplete:!!tiny?.terminal?.complete,
      size:tiny?.facts?.raw?.size??0,rows:tiny?.facts?.Q1,text:tiny?.text,clean:tiny?.facts?.reasons.length===0}));
    result.primary??=normal?.terminal?.reasons?.[0]??normal?.subset?.reasons?.[0]??(result.TRUNCATION==='UNEXPECTED_COMPLETE'?'tiny-unexpected-complete':undefined);
    result.FULL_FIDELITY=normal?.subset?.FULL_FIDELITY??'FAILED';result.outcome=outcomeFor(normal,{...tiny,TRUNCATION:result.TRUNCATION});
    if(controller.signal.aborted){result.signal=['SIGINT','SIGTERM'].includes(controller.signal.reason?.message)?controller.signal.reason.message:undefined;throw controller.signal.reason;}
    if(git('rev-parse','HEAD')!==expectedHead||git('status','--short'))throw Error('source-changed');
    await verifyFrozen(repo);
    await storage.write('report.json',json(result));
  }catch(e){result.primary??=e.message;result.outcome='NONPASSING';storage?.observe(e);}
  finally{
    if(storage){try{result.closure=await storage.close(result.outcome);}catch(e){result.closeFailure=e.message;result.outcome='NONPASSING';}}
    clearTimeout(timer);for(const [s,h]of handlers)process.off(s,h);
  }
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const argv=process.argv.slice(2),get=key=>argv[argv.indexOf(key)+1];
  if(argv[0]!=='run'||!argv.includes('--evidence')||!argv.includes('--job-end')||!argv.includes('--head'))throw Error('usage: trace-probe.mjs run --evidence EXISTING_PRIVATE_PARENT --job-end EPOCH_SECONDS --head SHA');
  const result=await runProbe({parent:get('--evidence'),jobEnd:Number(get('--job-end')),expectedHead:get('--head')});
  console.log(json({outcome:result.outcome,primary:result.primary,FULL_FIDELITY:result.FULL_FIDELITY,TRUNCATION:result.TRUNCATION}));
  // An open residual is incomplete, even when measurements are useful.
  process.exitCode=result.signal==='SIGINT'?130:result.signal==='SIGTERM'?143:1;
}

// Pure, closed-schema projection for the later separately allocated closure/
// upload workflow. It cannot expose private paths, traces, argv or diagnostics.
export function sanitizedBundle(report,event) {
  const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
  if(!sha(event.head)||!sha(event.base)||report.head!==event.head||typeof event.actor!=='string'||!/^[A-Za-z0-9-]{1,39}$/.test(event.actor))throw Error('upload-identity');
  const outcomes=new Set(['MEASURED_PARTIAL','NONPASSING','INCONCLUSIVE']);
  if(!outcomes.has(report.outcome)||!['FAILED','UNPROVED'].includes(report.FULL_FIDELITY))throw Error('upload-outcome');
  const result={schema:'hq-qpv4-sanitized/v1',head:event.head,base:event.base,actor:event.actor,outcome:report.outcome,
    FULL_FIDELITY:report.FULL_FIDELITY,TRUNCATION:['NOT_ADMITTED','UNEXPECTED_COMPLETE','INCONCLUSIVE_TRUNCATION_UNPROVEN'].includes(report.TRUNCATION)?report.TRUNCATION:'NONPASSING',
    normalTerminal:report.cases?.[0]?.terminal?.complete===true,subsetConsistent:report.cases?.[0]?.subset?.SUBSET_EXPORT_CONSISTENT===true,
    normalCessation:report.cases?.[0]?.facts?.cessation===true,tinyCessation:report.cases?.[1]?.facts?.cessation===true};
  const closure=report.closure;
  if(!closure||closure.size!==LIMITS.closure||!/^[a-f0-9]{64}$/.test(closure.sha256))throw Error('upload-closure');
  const config=caseName=>({caseName,output_path:`<owned-scratch>/${caseName}.pftrace`,duration_ms:40000,buffer_kib:4096,
    max_file_size_bytes:caseName==='normal'?16777216:4096,diagnosticFeature:'TracingServiceInProcess'});
  return {'report.json':result,'closure.json':{schema:'hq-qpv4-sanitized-closure/v1',size:closure.size,sha256:closure.sha256},
    'config-normal.json':config('normal'),'config-tiny.json':config('tiny')};
}
