import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,access,readdir,readlink,lstat,realpath,rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { dirname,isAbsolute,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON,safeBundlePath,validateManifest } from '../../src/preview/bundle.ts';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'node:net';
import { execFileSync } from 'node:child_process';
import { createRuntime,connect,until } from '../../../../tests/acceptance/runtime.mjs';
const repo=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const pythonPath=process.env.HQ_BROWSER_PYTHON;
const nativePath=fileURLToPath(new URL('./native.py',import.meta.url));
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
const sha=x=>createHash('sha256').update(x).digest('hex');
const args=process.argv.slice(2);
assert.equal(args.length,6,'Expected --revision <candidate> --bundle <sealed-bundle> --out <new-evidence-directory>');
assert.equal(args[0],'--revision');assert.equal(args[2],'--bundle');assert.equal(args[4],'--out');
const revision=args[1],bundle=args[3],evidence=args[5];
assert.match(revision,/^[0-9a-f]{40}$/);
for(const p of [bundle,evidence])assert.ok(isAbsolute(p)&&resolve(p)===p,'Use absolute normalized paths');
const within=(parent,child)=>{const rel=relative(parent,child);return rel===''||(!rel.startsWith('../')&&rel!=='..'&&!isAbsolute(rel));};
assert.ok(!within(repo,evidence)&&!within(bundle,evidence)&&!within(evidence,bundle));
assert.equal(await realpath(bundle),bundle,'Bundle path must not traverse symlinks');
assert.equal(await realpath(dirname(evidence)),dirname(evidence),'Evidence parent must not traverse symlinks');
await mkdir(evidence,{mode:0o700}); // Exclusive allocation; this invocation owns only this evidence directory.
const scratch=evidence+'/.scratch';
await mkdir(scratch,{mode:0o700});
const out=scratch;
let scratchRemoved=false;
const journeyIds=['identity','linux-runtime',...['default','empty'].flatMap(entry=>[1280,760].flatMap(width=>['light','dark'].map(theme=>entry+'-'+width+'-'+theme))),
 'rail-pointer-keyboard','work-create-edit','domain-retention','peer-edit','reset-isolation','native-only-unavailable','storage-untouched','forbidden-egress','browser-zoom-200'];
const report={schema:'hq-browser-qualification/v1',startedAt:new Date().toISOString(),revision,steps:[],requests:[],limits:[
 'Synthetic browser preview only; no native Electron, Mac, iOS, gallery or activation qualification.',
 'The error entry is conditional on existing FixtureControl support and is currently absent.',
 'Hosted placement proves this GitHub job only; no named owner device or fleet qualification.'
]};
let manifest,runtime;
async function fullBindings(){
 assert.equal(git('rev-parse','HEAD'),revision,'Candidate HEAD changed');
 assert.equal(git('status','--porcelain','--untracked-files=all'),'','Candidate source is dirty');
 const bytes=await readFile(bundle+'/preview-bundle.json');
 const value=JSON.parse(bytes);
 validateManifest(value);
 assert.equal(bytes.toString(),canonicalJSON(value)+'\n','Manifest must be canonical');
 assert.equal(value.source.revision,revision);
 assert.deepEqual(value.entries.map(e=>e.id).sort(),['default','empty'],'Conditional error-entry gap requires the existing two-entry manifest');
 assert.equal(value.build.lockfileSha256,sha(await readFile(repo+'/package-lock.json')));
 assert.equal(value.build.configSha256,sha(await readFile(repo+'/apps/desktop/vite.browser-preview.config.ts')));
 const files=[];
 async function walk(directory,prefix=''){
  const stat=await lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(stat.mode&0o222,0,'Sealed directory is writable');
  for(const e of await readdir(directory,{withFileTypes:true})){
   const path=prefix+e.name;assert.ok(safeBundlePath(path));
   if(e.isDirectory())await walk(directory+'/'+e.name,path+'/');
   else{assert.ok(e.isFile()&&!e.isSymbolicLink());assert.equal((await lstat(directory+'/'+e.name)).mode&0o222,0,'Sealed file is writable');files.push(path);}
  }
 }
 await walk(bundle);
 assert.deepEqual(files.sort(),['preview-bundle.json',...value.files.map(f=>f.path)].sort(),'Complete bundle inventory');
 for(const f of value.files){const b=await readFile(bundle+'/'+f.path);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);}
 const closures=value.files.filter(f=>/^source-closure-[0-9a-f]{64}\.json$/.test(f.path));assert.equal(closures.length,1);
 const closureFile=closures[0],closure=JSON.parse(await readFile(bundle+'/'+closureFile.path,'utf8'));
 assert.equal(closureFile.path,'source-closure-'+closureFile.sha256+'.json');
 assert.equal(closure.schema,'hq-preview-source-closure/v1');assert.equal(closure.revision,revision);
 const roots=['apps/desktop/src','apps/desktop/preview','apps/desktop/scripts','modules/work','modules/social','modules/wiki/contract','packages/contracts','packages/hq-ui'];
 assert.deepEqual(closure.coverage.supplementalSourceRoots,roots);
 const required=[...git('ls-files','-z','--',...roots).split('\0').filter(Boolean),
  'package.json','package-lock.json','tsconfig.json','apps/desktop/package.json','apps/desktop/vite.browser-preview.config.ts'];
 const paths=new Set();let previous='';
 for(const f of closure.files){
  assert.ok(typeof f.path==='string'&&safeBundlePath(f.path)&&f.path>previous);previous=f.path;paths.add(f.path);
  assert.ok(git('ls-files','--error-unmatch','--',f.path));
  assert.equal(await realpath(repo+'/'+f.path),repo+'/'+f.path,'Source symlink is not accepted');
  const b=await readFile(repo+'/'+f.path);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);
 }
 for(const path of required)assert.ok(paths.has(path),'Required closure input absent: '+path);
 assert.ok(closure.graph.length>0);
 for(const edge of closure.graph){assert.ok(paths.has(edge.path));for(const path of edge.imports)assert.ok(paths.has(path));}
 for(const edge of closure.typeOnlyImports)assert.ok(paths.has(edge.importer));
 assert.ok(Array.isArray(closure.lockedDependencyModules)&&Array.isArray(closure.virtualModules));
 manifest=value;
 return {bundleSha256:sha(canonicalJSON(value)),inventorySha256:sha(canonicalJSON(value.files)),
  sourceClosure:{sha256:closureFile.sha256,files:closure.files.length},completeBundleFiles:files.length,
  inputs:{runner:sha(await readFile(fileURLToPath(import.meta.url))),native:sha(await readFile(nativePath)),
   runtime:sha(await readFile(repo+'/tests/acceptance/runtime.mjs')),builder:sha(await readFile(repo+'/apps/desktop/scripts/build-browser-preview.mjs')),
   workflow:sha(await readFile(repo+'/.github/workflows/hq-browser-qualification.yml'))}};
}
let browser,origin,first,peer,storageId,storageBefore;
let wrapper,browserClient,client,readyEvent,displayNumber,cdp,phase;let nativeStderr='',requestId=0,expired=false;const pending=new Map(),owned=new Map(),namespaces=new Set();const outerNamespace=await readlink('/proc/self/ns/pid');const expected={hq:report.revision};report.nativeEvents=[];report.ownedHostProcesses=[];report.phases=[];
let current='setup';
async function processRecord(pid){
 try{
  const raw=await readFile('/proc/'+pid+'/stat','utf8');const fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');
  let namespace;try{namespace=await readlink('/proc/'+pid+'/ns/pid');}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')namespace=null;else throw e;}
  return{pid:Number(pid),state:fields[0],ppid:Number(fields[1]),pgrp:Number(fields[2]),startTicks:fields[19],namespace};
 }catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw e;}
}
async function captureOwned(){
 if(!wrapper?.pid)return[];
 const queue=[wrapper.pid],seen=new Set(),rows=[];
 while(queue.length){
  const pid=queue.shift();if(seen.has(pid))continue;seen.add(pid);
  const r=await processRecord(pid);if(!r)continue;
  const key=r.pid+':'+r.startTicks;owned.set(key,{...r,namespace:r.namespace??owned.get(key)?.namespace??null});
  if(r.namespace&&r.namespace!==outerNamespace)namespaces.add(r.namespace);
  rows.push(r);
  let kids='';try{kids=await readFile('/proc/'+pid+'/task/'+pid+'/children','utf8');}catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')throw e;}
  queue.push(...kids.trim().split(/\s+/).filter(Boolean).map(Number));
 }
 report.ownedHostProcesses=[...owned.values()];report.ownedPidNamespaces=[...namespaces];return rows;
}
async function native(action,extra={}){
 assert.ok(!expired,'Experiment deadline reached');
 const id=++requestId;
 const response=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Native action timeout: '+action));},20000);
  pending.set(id,{resolve,reject,timer});
 });
 wrapper.stdin.write(JSON.stringify({id,action,...extra})+'\n');
 return response;
}
const pageMetrics='(()=>({innerWidth,innerHeight,outerWidth,outerHeight,screenX,screenY,dpr:devicePixelRatio,visualViewport:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop},screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight},cssZoom:{html:getComputedStyle(document.documentElement).zoom,body:getComputedStyle(document.body).zoom},state:document.documentElement.dataset.previewState,revision:document.documentElement.dataset.previewRevision,session:document.documentElement.dataset.previewSession,readyState:document.readyState,platform:navigator.platform,location:location.href}))()';
async function snapshot(label){
 const result=await client.send('Runtime.evaluate',{expression:pageMetrics,returnByValue:true});
 assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
 const value={label,native:await native('snapshot'),browser:await browserClient.send('Browser.getWindowForTarget',{targetId:report.target.id}),page:result.result.value};
 report.phases.push(value);return value;
}
function sameGeometry(a,b){
 assert.deepEqual(b.native.geometry,a.native.geometry,'X11 geometry unchanged');
 assert.equal(b.native.window,a.native.window,'Same owned X window');
 assert.deepEqual(b.browser,a.browser,'Browser window bounds unchanged');
 for(const k of ['outerWidth','outerHeight','screenX','screenY'])assert.equal(b.page[k],a.page[k],k+' unchanged');
 assert.deepEqual(b.page.screen,a.page.screen);
 assert.equal(b.page.visualViewport.scale,a.page.visualViewport.scale);
 assert.deepEqual(b.page.cssZoom,a.page.cssZoom);
}
async function screenshot(label){
 const bytes=Buffer.from((await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64');
 const path=out+'/'+label+'.png';await writeFile(path,bytes,{flag:'wx'});
 return{path,sha256:sha(bytes),bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}

const record=async(id,action,fn)=>{current=id;try{const data=await fn();report.steps.push({id,action,assert:JSON.stringify(data),outcome:'pass',captures:data?.capture?[data.capture]:[]});await writeFile(out+'/observations.json',JSON.stringify(report,null,2));return data;}catch(e){report.steps.push({id,action,assert:e.stack,outcome:'fail',captures:[]});throw e;}};
const snap=async(c,label)=>{const d=await c.evaluate(`({dataset:{...document.documentElement.dataset},text:document.body.innerText,controls:[...document.querySelectorAll('button,input,[role=separator],a')].map(e=>({tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),title:e.getAttribute('title'),text:e.innerText,value:e.value,placeholder:e.getAttribute('placeholder')})),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},theme:document.documentElement.dataset.theme})`);await writeFile(out+'/'+label+'.dom.json',JSON.stringify(d,null,2));const bytes=Buffer.from((await c.send('Page.captureScreenshot',{format:'png'})).data,'base64');await writeFile(out+'/'+label+'.png',bytes);return{sha256:sha(bytes),bytes:bytes.length};};
const point=async(c,expr)=>{const p=await c.evaluate(`(()=>{const e=${expr};if(!e) return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);assert.ok(p,'DOM locator found '+expr);assert.ok(p.width&&p.height,'DOM locator visible '+expr);return p;};
const click=async(c,expr)=>{await c.send('Page.bringToFront');await native('snapshot');await until(()=>c.evaluate('document.visibilityState==="visible" && document.hasFocus()'),'owned target visible and focused',3000);const p=await point(c,expr);for(const type of ['mousePressed','mouseReleased'])await c.send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});};
const key=async(c,key,code,windowsVirtualKeyCode,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await c.send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode,modifiers,...(key==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});};
const type=async(c,expr,text)=>{await click(c,expr);await key(c,'a','KeyA',65,2);await c.send('Input.insertText',{text});};
const btn=(text,scope='document')=>`[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const domain=name=>btn(name,`document.querySelector('nav[aria-label="Domains"]')`);
const text=async c=>c.evaluate('document.body.innerText');
const pause=()=>new Promise(r=>setTimeout(r,180));
const ready=async c=>until(()=>c.evaluate('document.documentElement?.dataset.previewState==="ready"'),'preview ready');
const newTab=async(path)=>{const target=await fetch(originCDP+'/json/new?'+encodeURIComponent(origin+'/'+path),{method:'PUT'}).then(r=>r.json());const c=await connect(target.webSocketDebuggerUrl,runtime);await c.send('Page.enable');await c.send('Network.enable');await c.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await ready(c);c.targetId=target.id;return c;};
let originCDP;
const timeout=setTimeout(()=>process.emit('SIGTERM'),265000);
const cancelled=signal=>{report.cancelled=signal;expired=true;void runtime?.close().catch(()=>{});};
const onTerm=()=>cancelled('SIGTERM'),onInt=()=>cancelled('SIGINT');
process.once('SIGTERM',onTerm);process.once('SIGINT',onInt);
try{
 assert.equal(process.env.GITHUB_ACTIONS,'true','GitHub-only qualification');
 assert.equal(process.env.GITHUB_SHA,revision,'GitHub candidate must be the tested checkout');
 assert.equal(process.env.GITHUB_REPOSITORY,'Jones-Systems/HQ');
 assert.ok(pythonPath&&isAbsolute(pythonPath),'Pinned Python executable required');
 runtime=await createRuntime(scratch+'/runtime');
 await record('identity','Verify exact worktree and sealed file bytes',async()=>{report.bindingsBefore=await fullBindings();assert.equal(execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),report.revision);assert.equal(execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8'}).trim(),'');for(const f of manifest.files){const b=await readFile(bundle+'/'+f.path);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256);}report.bundleSha256=report.bindingsBefore.bundleSha256;return{revision:report.revision,bundleSha256:report.bundleSha256,files:manifest.files.length};});
 const allowed=new Map(manifest.files.map(f=>['/'+f.path,f]));
 const server=createServer(async(req,res)=>{const pathname=new URL(req.url,'http://owned').pathname;const f=allowed.get(pathname);report.requests.push({method:req.method,path:pathname,allowed:!!f,status:f?200:404});if(!f){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':f.path.endsWith('.html')?'text/html':f.path.endsWith('.css')?'text/css':f.path.endsWith('.js')?'text/javascript':'application/json','Cache-Control':'no-store'});res.end(await readFile(bundle+'/'+f.path));});
 origin=await runtime.listen(server);report.origin=origin;
 for(const p of ['home','config','cache','tmp','xdg-runtime'])await mkdir(runtime.root+'/'+p,{mode:0o700});
 await writeFile(runtime.root+'/Xauthority','',{mode:0o600,flag:'wx'});
 displayNumber=20000+(process.pid%10000);
 report.display=':'+displayNumber;
 const socketName='/tmp/.X11-unix/X'+displayNumber;
 assert.ok(!(await readFile('/proc/net/unix','utf8')).split('\n').some(line=>line.trim().endsWith(socketName)||line.trim().endsWith('@'+socketName)),'Selected owned display already exists');
 const chromiumArgs=['--ozone-platform=x11','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+runtime.root+'/profile','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--disable-features=MediaRouter','--window-size=1280,900','about:blank'];
 await writeFile(out+'/chromium-args.json',JSON.stringify(chromiumArgs,null,2)+'\n',{flag:'wx'});
 const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:runtime.root+'/home',XDG_CONFIG_HOME:runtime.root+'/config',XDG_CACHE_HOME:runtime.root+'/cache',XDG_RUNTIME_DIR:runtime.root+'/xdg-runtime',TMPDIR:'/tmp',LD_LIBRARY_PATH:resolve(dirname(pythonPath),'../lib')};
 const namespaceArgs=['--die-with-parent','--unshare-user','--unshare-pid','--bind','/','/','--bind',runtime.root+'/tmp','/tmp','--proc','/proc','--dev','/dev','/usr/bin/xvfb-run','--server-num='+displayNumber,'--auth-file='+runtime.root+'/Xauthority','--error-file='+runtime.root+'/xvfb.stderr','--server-args=-screen 0 1600x1100x24 -nolisten tcp',pythonPath,nativePath,runtime.root,out,':'+displayNumber];
 report.launch={command:'/usr/bin/bwrap',args:namespaceArgs,env,chromiumArgs,headless:false,emulationCommands:[],cssMutations:[],windowResizeCommands:[]};
 phase='owned-display-and-browser-launch';
 wrapper=runtime.spawn('/usr/bin/bwrap',namespaceArgs,{env,stdio:['pipe','pipe','pipe']});
 report.wrapperPid=wrapper.pid;
 wrapper.stderr.on('data',b=>{nativeStderr=(nativeStderr+b).slice(-14000);});
 const lines=createInterface({input:wrapper.stdout});
 lines.on('line',line=>{
  let m;try{m=JSON.parse(line);}catch{report.nativeEvents.push({invalidLine:line.slice(0,2000)});return;}
  if(m.event){report.nativeEvents.push(m);if(m.event==='ready')readyEvent=m;}
  const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.ok?p.resolve(m.value):p.reject(Error(m.error));}
 });
 await until(async()=>{
  if(wrapper.launchError||wrapper.exitCode!==null||wrapper.signalCode!==null)throw Error('Owned wrapper stopped: '+nativeStderr);
  return readyEvent;
 },'authenticated XTest helper ready',25000);
 assert.equal(readyEvent.authentication.withoutCookie,'rejected');assert.equal(readyEvent.authentication.withCookie,'opened');
 assert.equal(readyEvent.authorityMode,'0o600');
 report.nativeIdentity=readyEvent;
 const port=await until(async()=>{
  if(wrapper.exitCode!==null||wrapper.signalCode!==null)throw Error('Owned wrapper stopped');
  try{return(await readFile(runtime.root+'/profile/DevToolsActivePort','utf8')).split('\n')[0];}catch{}
 },'owned Chromium debugger',20000);
 cdp='http://127.0.0.1:'+port;report.cdp=cdp;
 report.browser=await fetch(cdp+'/json/version',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
 browserClient=await connect(report.browser.webSocketDebuggerUrl,runtime);
 originCDP=cdp;browser=wrapper;report.chromiumArgs=['windowed X11','sandbox enabled (no disabling switch)','isolated authenticated task profile'];report.launch.emulationCommands=['Earlier responsive journeys use existing CDP viewport metrics; actual zoom clears them.'];
 first=await newTab('index.html');client=first;report.target={id:first.targetId};report.window=await native('identify');await captureOwned();report.namespaceProcesses=await native('processes');assert.ok(namespaces.size>0,'Owned PID namespace identified');
 await record('linux-runtime','Observe actual Linux renderer and session identity',async()=>{const v=await first.evaluate('({platform:navigator.platform,userAgent:navigator.userAgent,dataset:{...document.documentElement.dataset},bridge:[typeof window.hqDesktop,typeof window.hqServices],secureContext:isSecureContext})');assert.match(v.platform,/Linux/);assert.equal(v.dataset.previewRevision,report.revision);assert.deepEqual(v.bridge,['undefined','undefined']);report.firstSession=v.dataset.previewSession;report.secureContext=v.secureContext;return v;});
 storageId={securityOrigin:origin,isLocalStorage:true};
 await first.send('DOMStorage.enable');
 const sentinel='linux-browser-r2-owned-sentinel';
 await first.send('DOMStorage.setDOMStorageItem',{storageId,key:sentinel,value:'unchanged'});
 const sessionStorageId={securityOrigin:origin,isLocalStorage:false};
 await first.send('DOMStorage.setDOMStorageItem',{storageId:sessionStorageId,key:sentinel,value:'session-unchanged'});
 storageBefore={local:await first.send('DOMStorage.getDOMStorageItems',{storageId}),session:await first.send('DOMStorage.getDOMStorageItems',{storageId:sessionStorageId})};
 for(const width of [1280,760])for(const theme of ['light','dark'])await record('default-'+width+'-'+theme,'Default entry appearance and viewport',async()=>{await first.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});for(let i=0;i<3&&await first.evaluate('document.documentElement.dataset.theme')!==theme;i++)await click(first,`document.querySelector('button[aria-label^="Appearance:"]')`);await pause();assert.equal(await first.evaluate('document.documentElement.dataset.theme'),theme);const shot=await snap(first,'default-'+width+'-'+theme);report.steps.at(-1);return{width,height:800,theme,capture:shot,metrics:await first.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth})')};});
 await first.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await record('rail-pointer-keyboard','Resize primary rail by real pointer and arrow key',async()=>{const expr=`document.querySelector('[role="separator"][aria-label="Primary navigation width"]')`;const before=await first.evaluate(`${expr}.getAttribute('aria-valuenow')`);const p=await point(first,expr);await first.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await first.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+32,y:p.y,button:'left',buttons:1});await first.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+32,y:p.y,button:'left',clickCount:1});await pause();const pointer=await first.evaluate(`${expr}.getAttribute('aria-valuenow')`);await key(first,'ArrowRight','ArrowRight',39);await pause();const keyboard=await first.evaluate(`${expr}.getAttribute('aria-valuenow')`);assert.ok(+pointer>+before);assert.equal(+keyboard,+pointer+8);return{before,pointer,keyboard};});
 async function create(c,title){await type(c,`document.querySelector('input[placeholder="Capture to Inbox…"]')`,title);await key(c,'Enter','Enter',13);await until(async()=>(await text(c)).includes(title),'created title');}
 await record('work-create-edit','Create and edit fictional Work item with real input',async()=>{await create(first,'Linux owned create');const expr=`[...document.querySelectorAll('article.work-card')].find(e=>(e.getAttribute('aria-label')||'').startsWith('Linux owned create,')||e.querySelector('.work-card-title')?.textContent==='Linux owned create')`;await click(first,expr);await type(first,`document.querySelector('input.work-detail-title')`,'Linux owned edited');await key(first,'Tab','Tab',9);await until(async()=>(await text(first)).includes('Linux owned edited'),'edited title');await snap(first,'work-edited');return{created:'Linux owned create',edited:'Linux owned edited',input:await first.evaluate('document.querySelector("input.work-detail-title").value')};});
 await record('domain-retention','Navigate Social and return to retained Work edit',async()=>{await click(first,domain('Social'));await pause();assert.equal(await first.evaluate(`document.querySelector('nav[aria-label="Domains"] button[aria-current="page"]').title`),'Social');await snap(first,'social-navigation');await click(first,domain('Work'));await pause();assert.ok((await text(first)).includes('Linux owned edited')||await first.evaluate('document.querySelector("input.work-detail-title")?.value==="Linux owned edited"'));return{active:'Work',retained:true};});
 peer=await newTab('index.html');await record('peer-edit','Create independent peer-tab memory change',async()=>{await create(peer,'Linux peer retained');report.peerSession=await peer.evaluate('document.documentElement.dataset.previewSession');assert.notEqual(report.peerSession,report.firstSession);return{session:report.peerSession,title:'Linux peer retained'};});
 await record('reset-isolation','Reset first tab restores fixture, appearance and new session; peer retained',async()=>{await click(first,`document.querySelector('button[data-preview-reset]')`);await until(async()=>{try{return await first.evaluate('document.documentElement?.dataset.previewState==="ready" && document.documentElement?.dataset.previewSession!=='+JSON.stringify(report.firstSession));}catch{}},'reset new session');const a=await first.evaluate(`({session:document.documentElement.dataset.previewSession,theme:document.documentElement.dataset.theme,text:document.body.innerText,appearance:document.querySelector('button[aria-label^="Appearance:"]').getAttribute('aria-label')})`);assert.ok(!a.text.includes('Linux owned edited'));assert.equal(a.appearance,'Appearance: System');assert.equal(await peer.evaluate('document.documentElement.dataset.previewSession'),report.peerSession);assert.ok((await text(peer)).includes('Linux peer retained'));return{first:a,peerSession:report.peerSession,peerEditRetained:true};});
 await record('native-only-unavailable','Design and Wiki show explicit unavailable status',async()=>{const observations=[];for(const name of ['Design','Wiki']){await click(first,domain(name));await pause();const t=await text(first);assert.ok(t.includes(name+' is unavailable in this browser preview.'));observations.push(name);}await click(first,domain('Work'));return{unavailable:observations};});
 const empty=await newTab('empty.html');
 for(const width of [1280,760])for(const theme of ['light','dark'])await record('empty-'+width+'-'+theme,'Empty entry appearance and viewport',async()=>{await empty.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});for(let i=0;i<3&&await empty.evaluate('document.documentElement.dataset.theme')!==theme;i++)await click(empty,`document.querySelector('button[aria-label^="Appearance:"]')`);await pause();const d=await empty.evaluate('({entry:document.documentElement.dataset.previewEntry,theme:document.documentElement.dataset.theme,text:document.body.innerText})');assert.equal(d.entry,'empty');assert.equal(d.theme,theme);assert.match(d.text,/No items|Nothing|empty|Inbox/i);return{...d,capture:await snap(empty,'empty-'+width+'-'+theme)};});
 await record('storage-untouched','Compare underlying origin local/session storage after all journeys',async()=>{const after={local:await first.send('DOMStorage.getDOMStorageItems',{storageId}),session:await first.send('DOMStorage.getDOMStorageItems',{storageId:sessionStorageId})};assert.deepEqual(after,storageBefore);return{before:storageBefore,after};});
 await record('forbidden-egress','Exercise forbidden fetch, XHR, WebSocket, service worker APIs under sealed CSP',async()=>{const r=await first.evaluate(`(async()=>{const out={csp:[]};const listener=e=>out.csp.push({directive:e.effectiveDirective,blocked:e.blockedURI});document.addEventListener('securitypolicyviolation',listener);try{await fetch('https://example.invalid/owned-forbidden');out.fetch='unexpected success'}catch(e){out.fetch=e.name}out.xhr=await new Promise(r=>{const x=new XMLHttpRequest();x.onerror=()=>r('blocked');x.onload=()=>r('unexpected success');x.open('GET','https://example.invalid/owned-forbidden');x.send()});out.ws=await new Promise(r=>{try{const s=new WebSocket('wss://example.invalid/owned-forbidden');s.onerror=()=>{r('blocked');s.close()};s.onopen=()=>{r('unexpected success');s.close()}}catch(e){r(e.name)}});out.beacon=navigator.sendBeacon('https://example.invalid/owned-forbidden','owned');out.eventSource=await new Promise(r=>{const x=new EventSource('https://example.invalid/owned-forbidden');x.onerror=()=>{x.close();r('blocked')};x.onopen=()=>{x.close();r('unexpected success')}});try{await navigator.serviceWorker.register('/owned-forbidden-sw.js');out.worker='unexpected success'}catch(e){out.worker=e.name}out.registrations=(await navigator.serviceWorker.getRegistrations()).length;out.resources=performance.getEntriesByType('resource').map(x=>({name:x.name,initiatorType:x.initiatorType,transferSize:x.transferSize}));out.bridge=[typeof hqServices,typeof hqDesktop];await new Promise(r=>setTimeout(r,50));document.removeEventListener('securitypolicyviolation',listener);return out})()`);assert.notEqual(r.fetch,'unexpected success');assert.equal(r.xhr,'blocked');assert.equal(r.ws,'blocked');assert.notEqual(r.worker,'unexpected success');assert.equal(r.eventSource,'blocked');assert.ok(r.csp.some(x=>x.directive==='connect-src'));assert.equal(r.beacon,false);assert.equal(r.registrations,0);assert.deepEqual(r.bridge,['undefined','undefined']);assert.ok(report.requests.every(r=>r.allowed||r.path==='/favicon.ico'));return r;});
 await first.send('Emulation.clearDeviceMetricsOverride');await first.send('Page.bringToFront');
 await record('browser-zoom-200','Actual native Ctrl plus to 200 percent with fixed geometry and reset',async()=>{
 phase='baseline-control-zero';
 report.baselineReset=await native('chord',{key:'0'});
 await delay(400);
 const baseline=await snapshot('baseline-100');
 assert.equal(baseline.page.revision,expected.hq);assert.equal(baseline.page.state,'ready');
 assert.equal(baseline.page.outerWidth,1280);assert.equal(baseline.page.outerHeight,900);assert.equal(baseline.page.innerWidth,1280);
 assert.equal(baseline.page.dpr,1);assert.equal(baseline.page.visualViewport.scale,1);
 assert.equal(baseline.page.cssZoom.html,'1');assert.equal(baseline.page.cssZoom.body,'1');
 report.baselineCapture=await screenshot('baseline-100');
 phase='native-browser-zoom';
 report.keyProgress=[];
 for(let i=0;i<5;i++){
  const input=await native('chord',{key:'plus'});
  await delay(400);
  const current=await snapshot('native-plus-'+(i+1));
  sameGeometry(baseline,current);
  assert.ok(current.page.dpr> (i?report.keyProgress.at(-1).page.dpr:baseline.page.dpr),'Native Ctrl+plus must increase DPR');
  report.keyProgress.push({input,page:current.page});
 }
 const zoomed=report.phases.at(-1);
 assert.equal(zoomed.page.innerWidth,640);
 assert.equal(zoomed.page.dpr,baseline.page.dpr*2,'Actual page zoom 200%');
 assert.ok(Math.abs(zoomed.page.innerWidth*2-baseline.page.innerWidth)<=2,'CSS viewport width halves');
 assert.ok(Math.abs(zoomed.page.innerHeight*2-baseline.page.innerHeight)<=2,'CSS viewport height halves');
 report.zoomCapture=await screenshot('actual-200');
 phase='reset-readback';
 report.finalReset=await native('chord',{key:'0'});await delay(400);
 const reset=await snapshot('reset-100');sameGeometry(baseline,reset);
 for(const k of ['innerWidth','innerHeight','dpr'])assert.equal(reset.page[k],baseline.page[k],k+' reset');
 assert.equal(reset.page.session,baseline.page.session,'Zoom and reset preserve page session');
 report.resetCapture=await screenshot('reset-100');
 return {baseline:baseline.page,zoomed:zoomed.page,reset:reset.page,nativeKeyboard:true,noEmulationForZoom:true,capture:{sha256:report.zoomCapture.sha256,bytes:report.zoomCapture.bytes}};});
 assert.equal(report.steps.filter(s=>s.outcome==='pass').length,19,'All nineteen supported journeys must pass');
 report.steps.push({id:'error-entry',action:'Qualify rejected-write error entry when existing fixture supports it',assert:'Accepted conditional gap: existing FixtureControl has no reject-next-write operation; sealed manifest omits error entry.',outcome:'conditional-gap',captures:[]});
}catch(e){report.firstFailure=current;report.error=e.stack;report.failureType=e.name;report.assertionFailure={code:e.code,operator:e.operator,expected:e.expected,actual:e.actual};try{if(first)report.failureCapture=await snap(first,'first-failure');}catch{}}
finally{
 clearTimeout(timeout);
 if(first&&storageId){try{const sentinel='linux-browser-r2-owned-sentinel';await first.send('DOMStorage.removeDOMStorageItem',{storageId,key:sentinel});await first.send('DOMStorage.removeDOMStorageItem',{storageId:{securityOrigin:origin,isLocalStorage:false},key:sentinel});report.sentinelCleanup={local:await first.send('DOMStorage.getDOMStorageItems',{storageId}),session:await first.send('DOMStorage.getDOMStorageItems',{storageId:{securityOrigin:origin,isLocalStorage:false}})};for(const store of Object.values(report.sentinelCleanup))assert.ok(store.entries.every(([key])=>key!==sentinel),'Owned sentinel must be removed');}catch(e){report.sentinelCleanupError=e.stack;}}
 if(runtime){
  try{await captureOwned();}catch(e){report.processCaptureError=e.stack;}
  for(const name of ['chromium.stderr','xvfb.stderr']){
   try{const bytes=await readFile(runtime.root+'/'+name);await writeFile(out+'/'+name,bytes.subarray(Math.max(0,bytes.length-24000)),{flag:'wx'});}catch(e){if(e.code!=='ENOENT')report.logError=e.stack;}
  }
  if(wrapper?.stdin?.writable&&!expired){
   try{report.stop=await native('stop');await Promise.race([wrapper.done,delay(2000)]);}catch(e){report.stopError=e.stack;}
  }
  try{
   const cleanupDeadline=Date.now()+18000;
   await Promise.race([runtime.close(),delay(18000).then(()=>{throw Error('Cleanup deadline exceeded');})]);
   report.cleanup={};
   const closed=url=>new Promise(resolve=>{
    if(!url)return resolve(null);const sock=createConnection({host:'127.0.0.1',port:Number(new URL(url).port)});sock.setTimeout(500);
    sock.once('connect',()=>{sock.destroy();resolve(false);});sock.once('error',e=>{sock.destroy();resolve(e.code==='ECONNREFUSED');});sock.once('timeout',()=>{sock.destroy();resolve(false);});
   });
   const inspect=async()=>{
    const state={at:new Date().toISOString(),remainingKnownProcesses:[],reusedPids:[],remainingNamespaceProcesses:[],unresolvedNamespaceVisibility:[],processGroupAbsent:false};
    for(const old of owned.values()){
     const now=await processRecord(old.pid);if(!now)continue;
     if(now.startTicks!==old.startTicks){state.reusedPids.push({old,current:now});continue;}
     assert.equal(now.pgrp,old.pgrp,'Captured process group identity changed');
     if(now.namespace!==null)assert.equal(now.namespace,old.namespace,'Captured namespace identity changed');
     state.remainingKnownProcesses.push(now);
    }
    for(const pid of await readdir('/proc')){
     if(!/^\d+$/.test(pid))continue;
     try{
      const ns=await readlink('/proc/'+pid+'/ns/pid');
      if(namespaces.has(ns))state.remainingNamespaceProcesses.push({pid:Number(pid),namespace:ns});
     }catch(e){
      if(e.code==='EACCES'){
       try{
        const status=await readFile('/proc/'+pid+'/status','utf8');
        const uid=Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
        const nspid=status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/);
        if(uid===process.getuid()&&(!nspid||nspid.length>1))state.unresolvedNamespaceVisibility.push(Number(pid));
       }catch(x){if(!['ENOENT','ESRCH'].includes(x.code))throw x;}
      }else if(!['ENOENT','ESRCH'].includes(e.code))throw e;
     }
    }
    try{if(wrapper?.pid)process.kill(-wrapper.pid,0);else state.processGroupAbsent=true;}catch(e){if(e.code==='ESRCH')state.processGroupAbsent=true;else throw e;}
    const suffix='/tmp/.X11-unix/X'+displayNumber;
    state.x11SocketAbsent=!(await readFile('/proc/net/unix','utf8')).split('\n').some(line=>line.trim().endsWith(suffix)||line.trim().endsWith('@'+suffix));
    state.listenersClosed={http:await closed(origin),cdp:await closed(cdp)};
    state.remainingPaths=[];
    for(const suffix of ['','/profile','/Xauthority','/empty-authority','/tmp','/tmp/.X11-unix/X'+displayNumber,'/tmp/.X'+displayNumber+'-lock']){
     try{await access(runtime.root+suffix);state.remainingPaths.push(runtime.root+suffix);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    state.allAbsent=!state.remainingKnownProcesses.length&&!state.remainingNamespaceProcesses.length&&!state.unresolvedNamespaceVisibility.length&&state.processGroupAbsent&&state.x11SocketAbsent&&Object.values(state.listenersClosed).every(x=>x!==false)&&!state.remainingPaths.length;
    return state;
   };
   report.cleanup.settlementObservations=[];
   const settleDeadline=Math.min(cleanupDeadline,Date.now()+2000);
   do{
    const state=await inspect();report.cleanup.settlementObservations.push(state);
    if(state.allAbsent){report.cleanup.finalReadback=state;break;}
    if(Date.now()>=settleDeadline)break;
    await delay(100);
   }while(Date.now()<settleDeadline);
   const last=report.cleanup.settlementObservations.at(-1);
   assert.equal(last.remainingKnownProcesses.length,0);
   assert.equal(last.remainingNamespaceProcesses.length,0);
   assert.equal(last.unresolvedNamespaceVisibility.length,0);
   assert.equal(last.processGroupAbsent,true);assert.equal(last.x11SocketAbsent,true);
   assert.ok(last.listenersClosed.http!==false);assert.ok(last.listenersClosed.cdp!==false);
   assert.equal(last.remainingPaths.length,0);assert.equal(last.allAbsent,true);
  }catch(e){report.cleanupError=e.stack;}
 }
 report.nativeStderr=nativeStderr;
 try{assert.ok(report.requests.every(r=>r.allowed||r.path==='/favicon.ico'),'Unexpected original request');report.bindingsAfter=await fullBindings();assert.deepEqual(report.bindingsAfter,report.bindingsBefore);}catch(e){report.error??=e.stack;report.firstFailure??='identity-after';}
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Qualification finished'));}pending.clear();
 try{await rm(scratch,{recursive:true});await access(scratch);throw Error('Owned scratch remains');}catch(e){if(e.code==='ENOENT')scratchRemoved=true;else report.cleanupError??=e.stack;}
 report.finishedAt=new Date().toISOString();
 const held=!!report.error&&['setup','identity','linux-runtime'].includes(report.firstFailure)&&!report.steps.some(s=>s.id==='linux-runtime'&&s.outcome==='pass');
 report.outcome=report.cancelled||report.error||report.cleanupError||report.sentinelCleanupError?(held?'held':'fail'):'pass';
 const scalar=value=>typeof value==='number'||typeof value==='boolean'||value===null?value:{sha256:sha(JSON.stringify(value)??'undefined')};
 const metric=p=>p?Object.fromEntries(['innerWidth','innerHeight','outerWidth','outerHeight','dpr'].map(k=>[k,p[k]]).concat([['visualViewportScale',p.visualViewport.scale]])):null;
 // This is an allowlist, not a redaction pass over raw captures, paths, text or process records.
 const receipt={schema:report.schema,revision,startedAt:report.startedAt,finishedAt:report.finishedAt,
  placement:{served:origin?'github-hosted':'unavailable',rendered:report.window?'github-hosted':'unavailable',os:'linux',architecture:process.arch,
   browser:typeof report.browser?.Browser==='string'&&/^Chrome\/[0-9.]+$/.test(report.browser.Browser)?report.browser.Browser:'unavailable'},
  github:{repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
   job:process.env.GITHUB_JOB,event:process.env.GITHUB_EVENT_NAME,mergeCandidate:process.env.GITHUB_SHA},
  bindingsBefore:report.bindingsBefore??null,bindingsAfter:report.bindingsAfter??null,
  outcome:report.outcome,firstFailure:report.firstFailure??null,
  heldConditions:held?['Required isolated authenticated browser runtime or candidate binding unavailable; no qualification pass']:[],
  failure:report.error?{type:report.failureType??'Error',diagnosticSha256:sha(report.error),
   assertion:report.assertionFailure?{expected:scalar(report.assertionFailure.expected),actual:scalar(report.assertionFailure.actual)}:null}:null,
  failureCapture:report.failureCapture??null,
  cancelled:report.cancelled??null,
  steps:report.steps.map(s=>({id:s.id,action:s.action,outcome:s.outcome,assertionSha256:sha(s.assert??'unavailable'),
   captures:s.captures.map(c=>({sha256:c.sha256,bytes:c.bytes}))})),
  journeys:journeyIds.map(id=>({id,outcome:report.steps.find(s=>s.id===id)?.outcome??'not-run'})),
  conditionalErrorEntry:manifest?.entries.every(e=>e.id!=='error')?'conditional-gap':'unverified',
  requests:report.requests.map(r=>({method:['GET','HEAD'].includes(r.method)?r.method:'other',
   path:r.allowed||['/favicon.ico','/owned-forbidden-sw.js'].includes(r.path)?r.path:'unexpected',allowed:r.allowed,status:r.status})),
  native:{authenticated:report.nativeIdentity?.authentication.withCookie==='opened'&&report.nativeIdentity?.authentication.withoutCookie==='rejected',
   authorityMode:report.nativeIdentity?.authorityMode??null,ownedWindow:!!report.window,ownedPidNamespace:namespaces.size>0,
   zoom:{baseline:metric(report.phases.find(p=>p.label==='baseline-100')?.page),
    actual200:metric(report.phases.find(p=>p.label==='native-plus-5')?.page),reset:metric(report.phases.find(p=>p.label==='reset-100')?.page),
    allKeysReleased:report.keyProgress?.every(k=>k.input.allReleased)===true}},
  cleanup:{runtimeAbsent:report.cleanup?.finalReadback?.allAbsent===true,
   scratchRemoved,sentinelsRemoved:!!report.sentinelCleanup&&!report.sentinelCleanupError,
   failed:!!report.cleanupError||!!report.sentinelCleanupError,
   diagnosticSha256:report.cleanupError||report.sentinelCleanupError?sha(report.cleanupError??report.sentinelCleanupError):null},limits:report.limits};
 await writeFile(evidence+'/report.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 await writeFile(evidence+'/hashes.json',JSON.stringify({schema:'hq-browser-qualification-hashes/v1',revision,
  reportSha256:sha(await readFile(evidence+'/report.json')),inputs:report.bindingsBefore?.inputs??null},null,2)+'\n',{flag:'wx'});
 process.off('SIGTERM',onTerm);process.off('SIGINT',onInt);
 console.log(JSON.stringify({outcome:receipt.outcome,firstFailure:receipt.firstFailure,steps:receipt.steps.map(s=>[s.id,s.outcome]),cleanup:receipt.cleanup}));
 process.exitCode=receipt.outcome==='pass'?0:1;
}
