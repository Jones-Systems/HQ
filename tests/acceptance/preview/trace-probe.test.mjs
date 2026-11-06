import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTestContext, LOCK_NAME } from '../../../tools/storage/admission.mjs';
import { POLICY } from '../../../tools/storage/policy.mjs';
import { LIMITS,SLOTS,boundedCounter,openProbeStorage,snapshotFile,sameSnapshot,readBounded,sha256 } from './trace-probe-storage.mjs';
import { REFERENCE,validateReference,thinArm64,collectPipe,parseQuery,terminalPredicate,compareSubset,classifyTiny,runReference } from './trace-probe-reference.mjs';
import { WORKTREE,PORT_KEYS,FROZEN,blobHash,verifyFrozen,encodeTraceConfig,parseElapsed,budgetAnchor,setupBudget,driverBudget,admitCase,
  createTraceLifecycle,executeCase,serialCases,descendants,identitiesAbsent,outcomeFor } from './trace-probe.mjs';

// Only synthetic ports and tiny, exactly owned disk fixtures. No app, converter,
// network, process, macOS command or dependency install is used by this suite.
const ownedRoots=new Set();
for(const [signal,code]of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{
  void Promise.allSettled([...ownedRoots].map(root=>fs.rm(root,{recursive:true,force:true}))).finally(()=>process.exit(code));
});
async function fixture(t, available=100*1024**3) {
  const root=await fs.mkdtemp(path.join(tmpdir(),'hq-trace-probe-'));await fs.chmod(root,0o700);ownedRoots.add(root);
  t.after(async()=>{await fs.rm(root,{recursive:true,force:true});ownedRoots.delete(root);});
  const worktree=path.join(root,'repo'),parent=path.join(root,'evidence'),scratchParent=path.join(worktree,'.t3','scratch');
  await fs.mkdir(worktree,{mode:0o700});await fs.mkdir(parent,{mode:0o700});
  const testContext=createTestContext({measureFilesystem:async r=>({id:r.dev,type:'fixture',blockBytes:4096,availableBytes:available})});
  return {root,worktree,parent,scratchParent,testContext,open:()=>openProbeStorage({worktree,parent,scratchParent},{testContext})};
}
const fakeSnapshot={dev:'1',ino:'2',size:20,mode:0o644,sha256:'a'.repeat(64)};
function fakeTrace(extra={}) {
  let clock=1000;const calls=[],sends=[];let event;
  const p={caseName:'normal',outputPath:'/q/normal.pftrace',spawnedPid:4242,now:()=>clock,
    mainPid:async()=>4242,identities:async()=>{calls.push('identities');return [{pid:4242,pgid:4242,birth:'fixed'}];},
    precharge:async()=>calls.push('precharge'),rawAbsentSameDevice:async()=>calls.push('absence-device'),
    connection:async cb=>{event=cb;return {send:async(...args)=>{calls.push('start');sends.push(args);},close:async()=>calls.push('disconnect')};},
    waitUntil:async at=>{calls.push(['wait',at]);clock=at;},snapshot:async()=>{calls.push('snapshot');return {...fakeSnapshot};},
    query:async name=>{calls.push(name);return [];},stop:async()=>calls.push('stop'),proveCessation:async()=>{calls.push('cessation');return true;},
    privateMode:async()=>calls.push('chmod'),secondaryFiles:async()=>[],rename:async()=>{calls.push('rename');return '/e/normal.pftrace';},
    convert:async()=>{calls.push('convert');return {traceEvents:[]};},...extra};
  return {p,calls,sends,event:method=>event(method),clock:value=>clock=value};
}
test('closed manifest pins provenance, schemas, queries, budgets and nonpassing residuals',()=>{
  validateReference();assert.equal(REFERENCE.tools.length,2);assert.equal(REFERENCE.schemas.length,4);
  for(const change of [r=>r.tools[0].size++,r=>r.tools.push(r.tools[0]),r=>r.config.durationMs=30000,r=>r.queries.Q1+=' ',r=>r.budget.ordinaryBytes++,r=>r.extra=true]){
    const r=structuredClone(REFERENCE);change(r);assert.throws(()=>validateReference(r));
  }
  assert.equal(Object.values(SLOTS).reduce((a,b)=>a+b,0),LIMITS.ordinary);
  assert.ok(LIMITS.ordinary+LIMITS.closure<=POLICY.evidenceRunBytes);
});
test('literal protobuf configs use pinned fields, ascending order and no extra buffer',()=>{
  const prefix='0a05088020200212470a320a0b747261636b5f6576656e748a07220a012a121d64697361626c65642d62792d64656661756c742d76697a2e717561647312116f72672e6368726f6d69756d2d3432343218c0b802400148e80750';
  const tail='708827b8018827ea01';
  for(const [caseName,cap,encodedPath]of [['normal','80808008','112f712f6e6f726d616c2e70667472616365'],['tiny','8020','0f2f712f74696e792e70667472616365']]){
    assert.equal(encodeTraceConfig({caseName,browserPid:4242,outputPath:`/q/${caseName}.pftrace`}).toString('hex'),prefix+cap+tail+encodedPath);
  }
  assert.throws(()=>encodeTraceConfig({caseName:'third',browserPid:4242,outputPath:'/q'}));
});
test('category and PID guards refuse before any CDP send',async()=>{
  for(const [extra,categories]of [[{},['other']],[{mainPid:async()=>7},['disabled-by-default-viz.quads']]]){
    const f=fakeTrace(extra),l=createTraceLifecycle(f.p);await assert.rejects(l.traceStart(categories));assert.equal(f.sends.length,0);
  }
});
test('actual trace lifecycle only starts protobuf and closes after S1/Q1',async()=>{
  const f=fakeTrace(),l=createTraceLifecycle(f.p);await l.traceStart(['disabled-by-default-viz.quads']);
  f.event('Tracing.tracingComplete');assert.equal(l.facts.primary,'unexpected-cdp-event');
  await l.traceStop();await l.traceStop();
  assert.equal(f.sends.length,1);assert.equal(f.sends[0][0],'Tracing.start');
  assert.deepEqual(Object.keys(f.sends[0][1]),['tracingBackend','transferMode','perfettoConfig']);
  assert.ok(f.calls.indexOf('precharge')<f.calls.indexOf('start'));
  assert.ok(f.calls.findIndex(v=>Array.isArray(v)&&v[0]==='wait'&&v[1]===53000)>=0);
  assert.ok(f.calls.indexOf('snapshot')<f.calls.indexOf('Q1'));assert.ok(f.calls.indexOf('Q1')<f.calls.indexOf('disconnect'));
  assert.ok(f.calls.indexOf('cessation')<f.calls.indexOf('rename'));assert.equal(await l.browserPid(),4242);
  assert.equal(f.calls.filter(v=>v==='stop').length,1);
});
test('uncertain cessation never renames/closes or admits tiny',async()=>{
  const f=fakeTrace({proveCessation:async()=>false});let closes=0;
  const result=await executeCase({caseName:'normal',trace:f.p,drawable:async()=>{},oracle:async l=>{await l.traceStart(['disabled-by-default-viz.quads']);return l.traceStop();},query:async()=>[],close:async()=>{closes++;}});
  assert.equal(closes,0);assert.equal(result.facts.cessation,false);assert.equal(f.calls.includes('rename'),false);
  const cases=await serialCases({deadline:1000,now:()=>0,run:async()=>result});assert.equal(cases.length,1);
});
test('snapshot mutation, secondary files and conversion failure are nonthrowing and preserve first reason',async()=>{
  for(const extra of [{snapshot:async()=>{throw Error('first');}},{secondaryFiles:async()=>[{name:'unexpected'}]},{convert:async()=>{throw Error('conversion');}}]){
    const f=fakeTrace(extra),l=createTraceLifecycle(f.p);await l.traceStart(['disabled-by-default-viz.quads']);assert.deepEqual(await l.traceStop(),{traceEvents:[]});assert.ok(l.facts.primary);
  }
  const f=fakeTrace(),l=createTraceLifecycle(f.p);await l.traceStart(['disabled-by-default-viz.quads']);l.fail(Error('original-signal'));f.clock(40001);await l.traceStop();assert.equal(l.facts.primary,'original-signal');
});
test('process proof refuses survivors, PID reuse and unknown leader',()=>{
  const captured=[{pid:1,ppid:0,pgid:1,birth:'old'},{pid:2,ppid:1,pgid:1,birth:'old'}];
  assert.equal(identitiesAbsent([],captured,true),true);
  for(const [table,group]of [[[captured[1]],false],[[{...captured[0],birth:'new'}],true],[[],false],[[],true]]){
    if(table.length||!group)assert.equal(identitiesAbsent(table,captured,group),false);
  }
  assert.equal(identitiesAbsent([],[],true),false);
  assert.deepEqual(descendants(captured,1),captured);assert.throws(()=>descendants([],9));
});
test('budget arithmetic and gate refusals preserve the hard tail',()=>{
  assert.equal(parseElapsed('1-02:03:04'),93784);assert.equal(parseElapsed('03:04'),184);
  assert.equal(budgetAnchor({now:1000,workerCommand:'/a/Runner.Worker',elapsed:'00:10'}),1860);
  assert.throws(()=>budgetAnchor({now:1000,workerCommand:'shell',elapsed:'00:10'}));
  assert.throws(()=>parseElapsed('bad'));
  for(const step of ['g0','g1','npm','electron','build']){setupBudget(2000,0,step);assert.throws(()=>setupBudget(2000,1900,step));}
  assert.equal(driverBudget(1000,0).minutes,13);assert.throws(()=>driverBudget(1000,600));
  admitCase(1000,740);assert.throws(()=>admitCase(1000,741));
});
test('thin arm64 header only, refusing fat/x64/truncation',()=>{
  const b=Buffer.alloc(32);b.writeUInt32LE(0xfeedfacf);b.writeUInt32LE(0x0100000c,4);thinArm64(b);
  for(const input of [b.subarray(0,31),Buffer.alloc(32),Buffer.from(b)]){if(input.length===32&&input.readUInt32LE(0)===0xfeedfacf)input.writeUInt32LE(0x01000007,4);assert.throws(()=>thinArm64(input));}
});
test('pipe bounds are exact before accepting one-over and chunk overflow',async()=>{
  async function* bytes(...a){for(const n of a)yield Buffer.alloc(n);}
  assert.equal((await collectPipe(bytes(2,3),5)).length,5);
  await assert.rejects(collectPipe(bytes(3,3),5),/byte-limit/);await assert.rejects(collectPipe(bytes(65537),100000),/chunk-limit/);
  const c=boundedCounter(3);c.add(3);assert.throws(()=>c.add(1));assert.equal(c.bytes,3);
});
const H=s=>Buffer.from(s).toString('hex');
const meta=(name,value,text=null)=>({kind:'m',name,value,text});
function terminalRows(cap=16777216){return [meta('tracing_started_ns',100n),meta('all_data_source_started_ns',200n),meta('all_data_source_flushed_ns',40000000000n),meta('tracing_disabled_ns',40000000100n),
  {kind:'s',name:'traced_final_flush_succeeded',value:1n,text:'info|trace|0'},meta('trace_config_pbtxt',null,['duration_ms: 40000','write_into_file: true','file_write_period_ms: 1000',`max_file_size_bytes: ${cap}`,'flush_timeout_ms: 5000','data_source_stop_timeout_ms: 5000','size_kb: 4096','fill_policy: DISCARD','name: "track_event"','producer_name_filter: "org.chromium-4242"'].join('\n'))];}
test('classic query output preserves hex, null flags and 17-digit real strings',()=>{
  const rows=parseQuery(`"k","n","i","s","z"\n"m","${H('tracing_started_ns')}",123,"",1\n"s","${H('loss')}",1,"${H('error|trace|0')}",0\n`,'Q1');assert.equal(rows[0].value,123n);assert.equal(rows[0].text,null);assert.equal(rows[1].text,'error|trace|0');
  const args=parseQuery(`"k","sid","ts","pid","ak","vt","i","r","sv","z"\n"a",1,"[NULL]","[NULL]","${H('debug.x')}","${H('real')}","[NULL]","1.2345678901234567","",1\n`,'Q2');assert.equal(args[0].real,1.2345678901234567);
  for(const malformed of ['oops','"k","n","i","s","z"\n"m","ZZ",1,"",0\n','"k","n","i","s","z"\n"m","61",no,"",0\n'])assert.throws(()=>parseQuery(malformed,'Q1'));
});
test('normal terminal truth table never infers completeness from parseable prefix',()=>{
  const options={size:100,cap:16777216,pid:4242};assert.equal(terminalPredicate(terminalRows(),options).complete,true);
  for(const name of ['tracing_started_ns','all_data_source_started_ns','all_data_source_flushed_ns','tracing_disabled_ns','traced_final_flush_succeeded','trace_config_pbtxt'])assert.equal(terminalPredicate(terminalRows().filter(x=>x.name!==name),options).complete,false);
  for(const stat of ['traced_final_flush_failed','traced_flushes_failed','traced_buf_chunks_discarded','traced_buf_chunks_overwritten','traced_buf_abi_violations','traced_buf_trace_writer_packet_loss','traced_buf_sequence_packet_loss','unknown']){
    assert.equal(terminalPredicate([...terminalRows(),{kind:'s',name:stat,value:1n,text:'error|trace|0'}],options).complete,false);
  }
  assert.equal(terminalPredicate(terminalRows(),{...options,size:16777216}).complete,false);
});
test('subset uses exact bucket/multiset counts and reports lossy residuals',()=>{
  const e={kind:'e',sid:'1',ts:1001n,pid:4242n},a={kind:'a',sid:'1',key:'debug.snapshot.active_tree.layers[0].x',type:'real',real:1.2345678901234567};
  const make=x=>({traceEvents:[{name:'LayerTreeHostImpl:snapshot',pid:4242,ts:1,args:{snapshot:{active_tree:{layers:[{x}]}}}}]});
  const r=compareSubset([e,a],make(Number(a.real.toPrecision(16))),4242,true);assert.equal(r.SUBSET_EXPORT_CONSISTENT,true);assert.equal(r.REAL_EXACTNESS,'ROUNDED_16G:1');assert.equal(r.TS_PRECISION,'US_TRUNCATED:1');assert.equal(r.FULL_FIDELITY,'UNPROVED');
  for(const [rows,trace]of [[[e,a],make(2)],[[e,a,e],make(a.real)],[[{...e,pid:null},a],make(a.real)],[[e,a],{traceEvents:[]}]])assert.equal(compareSubset(rows,trace,4242,true).FULL_FIDELITY,'FAILED');
  const jsonArg={...a,key:'debug.snapshot.active_tree.layers',type:'json',text:'[{"x":1}]'};assert.equal(compareSubset([e,jsonArg],make(1),4242,true).SUBSET_EXPORT_CONSISTENT,true);
  assert.ok(r.residuals.includes('empty-containers-and-nulls-unobservable'));
});
test('tiny never passes and residuals cannot produce diagnostic success',()=>{
  assert.equal(classifyTiny({admitted:false}).TRUNCATION,'NOT_ADMITTED');assert.equal(classifyTiny({admitted:true,terminalComplete:true}).TRUNCATION,'UNEXPECTED_COMPLETE');
  assert.equal(classifyTiny({admitted:true,normalComplete:true,size:100,clean:true}).TRUNCATION,'INCONCLUSIVE_TRUNCATION_UNPROVEN');
  assert.notEqual(outcomeFor({facts:{reasons:[],ledger:[]}},{}),'DIAGNOSTIC_SUCCESS');
});
test('actual storage preflight refuses low/unknown capacity before lock or scratch',async t=>{
  for(const available of [1,NaN]){
    const f=await fixture(t,available);await assert.rejects(f.open());assert.deepEqual(await fs.readdir(f.parent),[]);await assert.rejects(fs.access(f.scratchParent));
  }
});
test('actual storage lock refusal preserves existing bytes',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.parent,LOCK_NAME),'foreign',{mode:0o600});await assert.rejects(f.open());assert.equal(await fs.readFile(path.join(f.parent,LOCK_NAME),'utf8'),'foreign');
});
test('actual writer preallocates closure, refuses overwrite/limits, retains failure and unlocks',async t=>{
  const f=await fixture(t),w=await f.open();assert.equal((await fs.stat(path.join(w.directory,'.closure.json'))).size,LIMITS.closure);
  await w.write('fact.json','{}');await assert.rejects(w.write('fact.json','bad'),/duplicate/);
  async function* chunks(){yield Buffer.from('abc');yield Buffer.from('d');}
  await assert.rejects(w.stream('partial',chunks(),'facts',3),/byte-limit/);assert.equal(await fs.readFile(path.join(w.directory,'partial'),'utf8'),'abc');
  const closure=await w.close();assert.equal(closure.size,LIMITS.closure);assert.equal((await readBounded(closure.filename,LIMITS.closure)).length,LIMITS.closure);
  assert.equal(closure.sha256,sha256(await fs.readFile(closure.filename)));assert.ok(JSON.parse(await fs.readFile(closure.filename,'utf8')).failures.length);
  await assert.rejects(fs.access(path.join(f.parent,LOCK_NAME)));assert.equal(await fs.readFile(path.join(w.directory,'fact.json'),'utf8'),'{}');
});
test('producer raw retains same inode only inside owned root and counts cap',async t=>{
  const f=await fixture(t),w=await f.open(),root=path.join(f.scratchParent,'owned');await fs.mkdir(root,{mode:0o700});
  const raw=path.join(root,'normal.pftrace');await fs.writeFile(raw,'synthetic',{mode:0o644});const initial=await snapshotFile(raw,{limit:16777216,dev:w.dev,producer:true});
  await assert.rejects(snapshotFile(raw,{limit:16777216,dev:w.dev}));
  w.rawCharge('normal');const moved=await w.retainRaw(raw,'normal',initial,root),after=await snapshotFile(moved,{limit:16777216,dev:w.dev});assert.equal(sameSnapshot(initial,after),true);assert.equal(after.mode,0o600);await assert.rejects(fs.access(raw));await w.close();
});
test('frozen source, port order and original refusal are unchanged',async()=>{
  await verifyFrozen();const source=await fs.readFile(new URL('./run.mjs',import.meta.url),'utf8');
  const portBody=source.slice(source.indexOf('{',source.indexOf('heldCaptureContainment({'))+1,source.indexOf('}));',source.indexOf('heldCaptureContainment({')));
  const names=[...portBody.matchAll(/^        (\w+):/gm)].map(m=>m[1]);names.push('delay','until');assert.deepEqual(names,PORT_KEYS);
  assert.match(source,/traceStart: \(\) => evidenceRun.refuseRawTrace\(\)/);assert.equal(blobHash(Buffer.from(source)),FROZEN['tests/acceptance/preview/run.mjs']);
});

test('writer refuses simultaneous submission without an adapter queue',async t=>{
  const f=await fixture(t),w=await f.open();let release;const gate=new Promise(r=>{release=r;});
  async function* input(){await gate;yield Buffer.from('x');}
  const first=w.stream('first',input(),'facts',1);
  await assert.rejects(w.write('second','x'),/pending-write-limit/);release();await first;await w.close();
});
test('stream tool identity mismatch retains labelled partial evidence',async t=>{
  const f=await fixture(t),w=await f.open();async function* input(){yield Buffer.from('abc');}
  await assert.rejects(w.stream('tool',input(),'tools',3,{expectedSize:3,expectedHash:'0'.repeat(64)}),/tool-size-or-hash/);
  await w.close();const closure=JSON.parse(await fs.readFile(path.join(w.directory,'.closure.json'),'utf8'));assert.equal(closure.files.tool.complete,false);
});
test('actual state machine records cleanup failure without hiding original producer failure',async()=>{
  const f=fakeTrace(),result=await executeCase({caseName:'normal',trace:f.p,drawable:async()=>{},
    oracle:async l=>{await l.traceStart(['disabled-by-default-viz.quads']);l.fail(Error('SIGTERM'));await l.traceStop();throw Error('oracle-after-stop');},
    query:async()=>[],close:async()=>{throw Error('cleanup-failure');}});
  assert.equal(result.facts.primary,'SIGTERM');assert.ok(result.facts.reasons.includes('cleanup-failure'));
});
test('serial driver uses normal then tiny once and refuses a late second case',async()=>{
  const calls=[],good={facts:{cessation:true},cleanup:{rootAbsent:true}};
  await serialCases({deadline:1000,now:()=>0,run:async name=>{calls.push(name);return good;}});assert.deepEqual(calls,['normal','tiny']);
  let n=0;const cases=await serialCases({deadline:1000,now:()=>n++?900:0,run:async()=>good});assert.equal(cases[1].TRUNCATION,'NOT_ADMITTED');
});
test('sanitized projection is closed, all-or-none, and excludes unknown private content',async()=>{
  const {sanitizedBundle}=await import('./trace-probe.mjs');
  const input={head:'a'.repeat(40),outcome:'MEASURED_PARTIAL',FULL_FIDELITY:'UNPROVED',TRUNCATION:'INCONCLUSIVE_TRUNCATION_UNPROVEN',
    closure:{filename:'/private/secret',size:LIMITS.closure,sha256:'b'.repeat(64)},private:'do-not-publish',primary:'/private/env'};
  const event={head:input.head,base:'c'.repeat(40),actor:'example-owner'};
  const bundle=sanitizedBundle(input,event);assert.equal(Object.keys(bundle).length,4);
  assert.equal(JSON.stringify(bundle).includes('/private'),false);assert.equal(JSON.stringify(bundle).includes('do-not-publish'),false);
  assert.throws(()=>sanitizedBundle({...input,closure:null},event));assert.throws(()=>sanitizedBundle(input,{...event,head:'d'.repeat(40)}));
});


test('actual reference runner uses exact argv/env and fake owned lifecycle without native execution',async t=>{
  const f=await fixture(t),w=await f.open(),root=path.join(f.scratchParent,'tool-fixture');await fs.mkdir(root,{mode:0o700});
  const raw=path.join(root,'input');await fs.writeFile(raw,'raw',{mode:0o600});let call,stopped=0;
  const runtime={root,spawn:(command,argv,options)=>{call={command,argv,options};const child=new EventEmitter();Object.assign(child,{pid:77,exitCode:0,signalCode:null,stdout:Readable.from([Buffer.from('query-output')]),stderr:Readable.from([]),done:Promise.resolve()});return child;},stop:async()=>{stopped++;}};
  const lifecycle={capture:async()=>[{pid:77,birth:'fixture'}],absent:async()=>true};
  const output=await runReference({runtime,storage:w,tools:{trace_processor_shell:'/fake/processor'},kind:'query',raw,sql:'fixed SQL',name:'normal-Q1',milliseconds:1000,lifecycle});
  assert.equal(output,'query-output');assert.deepEqual(call.argv,['--full-sort','-Q','fixed SQL',raw]);assert.equal(call.options.shell,false);
  assert.deepEqual(Object.keys(call.options.env).sort(),['HOME','PATH','TMPDIR']);assert.equal(call.options.env.PATH,'/usr/bin:/bin');assert.equal(stopped,1);await w.close();
});
