import * as fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { LIMITS, boundedCounter, readBounded, snapshotFile, sameSnapshot, sha256 } from './trace-probe-storage.mjs';

export const REFERENCE = JSON.parse(await fs.readFile(new URL('./trace-probe-reference.json', import.meta.url), 'utf8'));
const toolPins = [
  ['traceconv', 11175288, '2a4692f355fb48ad481d523a9f0b13d61f3693f233cba0b9fed25d639f74f892'],
  ['trace_processor_shell', 12704456, '98a41b80e9f60da0373d64aff6455681f8c26b7c391ae5736324a5b11e3dacc2'],
];
const exactKeys = (v, keys) => assert.deepEqual(Object.keys(v).sort(), [...keys].sort());
export function validateReference(r = REFERENCE) {
  assert.equal(sha256(Buffer.from(JSON.stringify(r))), 'd4af47f85ff88c8f3d0dd9a29ce50d882f468803ba23db5655f19aacdf5a33fc', 'closed-reference-manifest');
  exactKeys(r, ['schema','upstream','tools','schemas','config','queries','budget','deadlines','outcomes']);
  assert.equal(r.schema, 'hq-qpv4-trace-reference/v1');
  exactKeys(r.upstream, ['repository','commit','provenance']);
  assert.equal(r.upstream.repository, 'google/perfetto');
  assert.equal(r.upstream.commit, '9c7ce42050379be8c24a270f395e00c7347965cb');
  assert.equal(r.upstream.provenance, 'pinned by the 9c7 prebuilt manifest; not proved built from 9c7, reproducible or independently build-attested');
  assert.equal(r.tools.length, 2);
  r.tools.forEach((t, i) => {
    exactKeys(t, ['name','url','size','sha256','manifest']);
    const [name,size,hash] = toolPins[i];
    assert.deepEqual([t.name,t.size,t.sha256], [name,size,hash]);
    assert.equal(t.url, `https://commondatastorage.googleapis.com/perfetto-luci-artifacts/v57.2/mac-arm64/${name}`);
    exactKeys(t.manifest, ['path','blob','sha256']);
    assert.match(t.manifest.blob, /^[a-f0-9]{40}$/); assert.match(t.manifest.sha256, /^[a-f0-9]{64}$/);
  });
  assert.equal(r.schemas.length, 4);
  for (const s of r.schemas) { exactKeys(s, ['path','blob','sha256']); assert.match(s.blob, /^[a-f0-9]{40}$/); assert.match(s.sha256, /^[a-f0-9]{64}$/); }
  assert.equal(r.budget.ordinaryBytes, 114 * 1024 ** 2 + 4096);
  assert.equal(r.budget.closureBytes, LIMITS.closure);
  assert.deepEqual(r.outcomes, { best: 'MEASURED_PARTIAL', fullFidelity: ['FAILED','UNPROVED'], truncation: ['INCONCLUSIVE_TRUNCATION_UNPROVEN','NOT_ADMITTED','UNEXPECTED_COMPLETE','NONPASSING'], openResiduals: ['R-T','R-F'] });
  return r;
}
export function thinArm64(bytes) {
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x0100000c) throw Error('not-thin-arm64');
  return true;
}
export async function acquireReference(storage, { fetchPort = fetch, signal } = {}) {
  validateReference(); const tools = {};
  for (const entry of REFERENCE.tools) {
    const response = await fetchPort(entry.url, { redirect: 'error', signal });
    if (!response.ok || response.redirected || response.url !== entry.url || !response.body) throw Error('tool-fetch');
    if (response.headers.get('content-length') !== null && Number(response.headers.get('content-length')) !== entry.size) throw Error('tool-size-or-hash');
    const filename = await storage.stream(entry.name, response.body, 'tools', entry.size, { expectedSize: entry.size, expectedHash: entry.sha256 });
    const fd = await fs.open(filename, 'r');
    try { const head = Buffer.alloc(32); const { bytesRead } = await fd.read(head, 0, 32, 0); thinArm64(head.subarray(0, bytesRead)); await fd.chmod(0o700); }
    finally { await fd.close(); }
    tools[entry.name] = filename;
  }
  return tools;
}
export async function collectPipe(pipe, limit, signal) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > LIMITS.query) throw Error('pipe-limit');
  const count=boundedCounter(limit), output=Buffer.allocUnsafe(limit);
  for await (const input of pipe) {
    signal?.throwIfAborted(); const b=Buffer.from(input);
    if (b.length>LIMITS.chunk) throw Error('chunk-limit');
    const offset=count.bytes;count.add(b.length);b.copy(output,offset);
  }
  return output.subarray(0,count.bytes);
}

// runtime supplies the captured child/group lifecycle; this module never signals
// an unbound PID or searches PATH. stderr is bounded before any log write.
export async function runReference({ runtime, storage, tools, kind, raw, sql, name, milliseconds, signal, lifecycle, producer = false }) {
  if (!path.isAbsolute(raw) || !lifecycle) throw Error('reference-local-input');
  signal?.throwIfAborted();
  const initial = await snapshotFile(raw, {limit:LIMITS.rawNormal, dev:storage.dev, producer});
  const home=path.join(runtime.root,`${name}-${kind}-home`), tmp=path.join(runtime.root,`${name}-${kind}-tmp`);
  await fs.mkdir(home,{mode:0o700}); await fs.mkdir(tmp,{mode:0o700});
  const command=kind==='query'?tools.trace_processor_shell:tools.traceconv;
  const argv=kind==='query'?['--full-sort','-Q',sql,raw]:kind==='json'?['json','--full-sort',raw,'-']:['text',raw,'-'];
  signal?.throwIfAborted();
  const child=runtime.spawn(command,argv,{shell:false,env:{HOME:home,TMPDIR:tmp,PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
  let primary, failure, expectedStop=false, captured, result, timer;
  const stop=async()=>{expectedStop=true;await runtime.stop(child);};
  child.once('exit',(code,sig)=>{if(!expectedStop&&(sig||code!==0))primary??=Error(`reference-exit:${sig??code}`);});
  child.once('error',e=>{primary??=e;});
  const cancel=()=>{primary??=signal.reason??Error('cancelled');void stop().catch(e=>{failure??=e;});};
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    captured=await lifecycle.capture(child);
    timer=setTimeout(()=>{failure??=Error('reference-timeout');void stop().catch(e=>{failure??=e;});},milliseconds);
    const guard=async p=>{try{return await p;}catch(e){failure??=e;await stop();throw e;}};
    const values=await Promise.allSettled([
      guard(kind==='json'?storage.stream(`${name}.json`,child.stdout,`${name}.json`,LIMITS.json):collectPipe(child.stdout,kind==='query'?LIMITS.query:LIMITS.text,signal)),
      guard(collectPipe(child.stderr,LIMITS.stderr,signal)),
    ]);
    await child.done;
    const rejected=values.find(v=>v.status==='rejected');
    if(primary||failure||rejected)throw primary??failure??rejected.reason;
    const [output,stderr]=values.map(v=>v.value);
    await storage.write(`${name}-${kind}.stderr`,stderr,'logs');
    if(child.launchError||child.signalCode||child.exitCode!==0)throw Error(`reference-exit:${child.signalCode??child.exitCode}`);
    if((await fs.readdir(home)).length||(await fs.readdir(tmp)).length)throw Error('tool-spill');
    if(!sameSnapshot(initial,await snapshotFile(raw,{limit:LIMITS.rawNormal,dev:storage.dev,producer})))throw Error('reference-input-changed');
    result=kind==='json'?JSON.parse((await readBounded(output,LIMITS.json)).toString('utf8')):output.toString('utf8');
  } catch(e) { failure??=e; }
  finally {
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    try{await stop();if(!captured||!await lifecycle.absent(child,captured))throw Error('reference-cessation-uncertain');}
    catch(e){if(!primary&&!failure)failure=e;else (primary??failure).additional=[e.message];}
  }
  if(primary||failure)throw primary??failure;
  return result;
}

function csvCell(cell) {
  if (/^"[^"\r\n]*"$/.test(cell)) return cell.slice(1,-1) === '[NULL]' ? null : cell.slice(1,-1);
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(cell)) return cell;
  throw Error('reference-unparseable');
}
const headers = { Q1: ['k','n','i','s','z'], Q2: ['k','sid','ts','pid','ak','vt','i','r','sv','z'] };
const integer = value => { if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw Error('reference-unparseable'); return BigInt(value); };
const hex = value => { if (typeof value !== 'string' || !/^(?:[a-fA-F0-9]{2})*$/.test(value)) throw Error('reference-unparseable'); const b=Buffer.from(value,'hex'); const s=b.toString('utf8'); if (!Buffer.from(s).equals(b)) throw Error('reference-unparseable'); return s; };
export function parseQuery(text, which) {
  if (Buffer.byteLength(text) > LIMITS.query || !headers[which]) throw Error('reference-unparseable');
  const lines = text.trimEnd().split('\n');
  assert.deepEqual(lines.shift()?.split(',').map(csvCell), headers[which], 'reference-unparseable');
  return lines.map(line => {
    const cells = line.split(',').map(csvCell); if (cells.length !== headers[which].length) throw Error('reference-unparseable');
    const r = Object.fromEntries(headers[which].map((k,i)=>[k,cells[i]]));
    if (which === 'Q1') {
      if (!['m','s'].includes(r.k) || !['0','1'].includes(r.z)) throw Error('reference-unparseable');
      return { kind:r.k, name:hex(r.n), value:r.i===null?null:integer(r.i), text:r.z==='1'?null:hex(r.s) };
    }
    if (!['e','a'].includes(r.k) || !['0','1'].includes(r.z)) throw Error('reference-unparseable');
    return { kind:r.k, sid:integer(r.sid).toString(), ts:r.ts===null?null:integer(r.ts), pid:r.pid===null?null:integer(r.pid),
      key:hex(r.ak), type:hex(r.vt), int:r.i===null?null:integer(r.i), real:r.r===null?null:Number(r.r), text:r.z==='1'?null:hex(r.sv) };
  });
}
const lossStats = ['traced_final_flush_failed','traced_flushes_failed','traced_buf_chunks_discarded','traced_buf_chunks_overwritten',
  'traced_buf_abi_violations','traced_buf_trace_writer_packet_loss','traced_buf_sequence_packet_loss'];
export function terminalPredicate(rows, { cap, size, pid }) {
  const reasons = [], meta = name => rows.filter(x=>x.kind==='m' && x.name===name);
  const unique = name => { const a=meta(name); if(a.length!==1||a[0].value===null){reasons.push(`metadata:${name}`);return null;}return a[0].value; };
  const start=unique('tracing_started_ns'), all=unique('all_data_source_started_ns'), end=unique('tracing_disabled_ns');
  if (start!==null&&all!==null&&end!==null && !(start<=all&&all<=end&&end-start>=39500000000n)) reasons.push('terminal-order-or-duration');
  if (!meta('all_data_source_flushed_ns').some(x=>x.value!==null&&all!==null&&end!==null&&x.value>=all&&x.value<=end)) reasons.push('terminal-flush-marker');
  if (meta('slow_start_data_source').length) reasons.push('slow-start');
  const stats=rows.filter(x=>x.kind==='s');
  if (stats.filter(x=>x.name==='traced_final_flush_succeeded'&&x.value===1n).length!==1) reasons.push('final-flush');
  if (stats.some(x=>x.value!==0n&&(lossStats.includes(x.name)||/^(data_loss|error)\|/.test(x.text??'')))) reasons.push('loss-or-error');
  if (!(size>0&&size<cap)) reasons.push('raw-size');
  const configs=meta('trace_config_pbtxt');
  const lines=new Set((configs.length===1?configs[0].text??'':'').split('\n').map(x=>x.trim()));
  for (const l of ['duration_ms: 40000','write_into_file: true','file_write_period_ms: 1000',`max_file_size_bytes: ${cap}`,
    'flush_timeout_ms: 5000','data_source_stop_timeout_ms: 5000','size_kb: 4096','name: "track_event"',`producer_name_filter: "org.chromium-${pid}"`]) if(!lines.has(l))reasons.push('config:'+l);
  if(!lines.has('fill_policy: DISCARD')&&!lines.has('fill_policy: 2')) reasons.push('config:fill-policy');
  return { complete:reasons.length===0,reasons };
}
function leaves(value, prefix='', out=[]) {
  if (Array.isArray(value)) value.forEach((v,i)=>leaves(v,`${prefix}[${i}]`,out));
  else if (value!==null&&typeof value==='object') for(const [k,v] of Object.entries(value)) leaves(v,prefix?`${prefix}.${k}`:k,out);
  else out.push({path:prefix,type:value===null?'null':typeof value==='number'?(Number.isInteger(value)?'int':'real'):typeof value==='boolean'?'bool':typeof value,value});
  return out;
}
function tpLeaves(args) {
  const result=[];
  for(const a of args) {
    const key=a.key.replace(/^debug\./,'args.');
    if(a.type==='json') { for(const l of leaves(JSON.parse(a.text),key)) result.push(l); continue; }
    const type = ['int','uint','bool','pointer','real','string','null'].includes(a.type)?a.type:null;
    if(!type)throw Error('reference-unparseable');
    const value=type==='int'||type==='uint'?a.int?.toString():type==='bool'?a.int===1n:type==='pointer'?`0x${a.int?.toString(16)}`:type==='real'?a.real:type==='null'?null:a.text;
    result.push({path:key,type,value});
  }
  return result.filter(x=>x.path==='args.snapshot.active_tree.layers'||x.path.startsWith('args.snapshot.active_tree.layers['));
}
export function compareSubset(rows, trace, browserPid, terminalComplete) {
  const events=rows.filter(x=>x.kind==='e'), reasons=[]; let rounded=0,truncated=0;
  if(!events.length||events.some(x=>x.pid===null||x.pid!==BigInt(browserPid)||x.ts===null)) reasons.push('foreign-or-unattributed-snapshot');
  if(!Array.isArray(trace?.traceEvents)) reasons.push('reference-json-shape');
  const exported=(trace?.traceEvents??[]).filter(e=>e.pid===browserPid&&e.name==='LayerTreeHostImpl:snapshot');
  const buckets=new Map();
  for(const e of events) {
    if(e.ts===null)continue;
    if(e.ts%1000n)truncated++;
    const k=(e.ts/1000n).toString(); if(!buckets.has(k))buckets.set(k,[]);
    buckets.get(k).push(tpLeaves(rows.filter(a=>a.kind==='a'&&a.sid===e.sid)));
  }
  const exportedBuckets=new Map();
  for(const e of exported) {
    if(!Number.isSafeInteger(e.ts)){reasons.push('json-timestamp');continue;}
    const k=String(e.ts);if(!exportedBuckets.has(k))exportedBuckets.set(k,[]);
    exportedBuckets.get(k).push(leaves(e.args?.snapshot?.active_tree?.layers,'args.snapshot.active_tree.layers'));
  }
  const sort=v=>v.sort((a,b)=>a.path.localeCompare(b.path));
  function match(a,b) {
    a=sort(a);b=sort(b);if(a.length!==b.length)return null;let n=0;
    for(let i=0;i<a.length;i++) {
      const x=a[i],y=b[i];if(x.path!==y.path)return null;
      if(x.type==='int'||x.type==='uint') {if(y.type!=='int'||!Number.isSafeInteger(y.value)||BigInt(y.value).toString()!==String(x.value))return null;}
      else if(x.type==='real') {if(!Number.isFinite(y.value))return null;if(y.value!==x.value){if(y.value!==Number(x.value.toPrecision(16)))return null;n++;}}
      else if(x.type==='pointer') {if(y.value!==x.value)return null;}
      else if(x.type!==y.type||x.value!==y.value)return null;
    }
    return n;
  }
  if(events.length!==exported.length||buckets.size!==exportedBuckets.size)reasons.push('snapshot-count');
  for(const [k,signatures] of buckets) {
    const candidates=[...(exportedBuckets.get(k)??[])];
    for(const s of signatures) {const at=candidates.findIndex(c=>match(s,c)!==null);if(at<0){reasons.push('snapshot-leaves');continue;}rounded+=match(s,candidates[at]);candidates.splice(at,1);}
    if(candidates.length)reasons.push('snapshot-duplicates');
  }
  const consistent=reasons.length===0;
  return { SUBSET_EXPORT_CONSISTENT:consistent,REAL_EXACTNESS:rounded?`ROUNDED_16G:${rounded}`:'EXACT',TS_PRECISION:truncated?`US_TRUNCATED:${truncated}`:'NS_PRESERVED',
    FULL_FIDELITY:consistent&&terminalComplete?'UNPROVED':'FAILED',residuals:['empty-containers-and-nulls-unobservable',...(truncated?['ts-us-truncated']:[]),...(rounded?['reals-rounded-16g']:[])],reasons };
}
export function classifyTiny({ admitted, normalComplete, terminalComplete, size, rows=[], text='', clean=true }) {
  if(!admitted)return {TRUNCATION:'NOT_ADMITTED'};
  if(terminalComplete)return {TRUNCATION:'UNEXPECTED_COMPLETE'};
  return { TRUNCATION:clean&&normalComplete?'INCONCLUSIVE_TRUNCATION_UNPROVEN':'NONPASSING:incomplete',
    consistency:{size,capVisible:rows.some(x=>x.name==='trace_config_pbtxt'&&x.text?.includes('max_file_size_bytes: 4096')),
      disabledAbsent:!rows.some(x=>x.name==='tracing_disabled_ns'),finalFlushAbsent:!rows.some(x=>x.name==='traced_final_flush_succeeded'&&x.value===1n),
      textMarkersAbsent:!/trace_stats|tracing_disabled/.test(text),normalComplete},residual:'R-T' };
}
