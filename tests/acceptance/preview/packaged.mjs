import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
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
const report = { schema: 'hq-preview-packaged-switch/v1', binary, profile: runtime.root, outcome: 'failed' };
let log = '', child;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{report.cancelled=signal;void runtime.close().catch(error=>{report.cleanupError=error.stack;});});
try {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HQ_') && !['ELECTRON_RUN_AS_NODE','NODE_OPTIONS'].includes(key)));
  Object.assign(env, { HQ_QUALIFY_PREVIEW: '1', HQ_USER_DATA_DIR: runtime.root });
  child = runtime.spawn(binary, [`--user-data-dir=${runtime.root}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], { env, stdio: ['ignore','ignore','pipe'] });
  let endpoint; child.stderr.on('data', bytes => { log = (log + bytes).slice(-64000); endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(log)?.[1]; });
  await until(() => { if (child.exitCode !== null || child.launchError) throw Error('Packaged start failed: '+log); return endpoint; }, 'packaged debugger');
  const target = await until(async () => (await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()).find(t=>t.type==='page' && t.url.startsWith('file:')), 'packaged HQ renderer');
  const cdp = await connect(target.webSocketDebuggerUrl, runtime);
  await until(()=>cdp.evaluate('!!window.hqServices?.preview'), 'packaged preload');
  report.result = await cdp.evaluate(`window.hqServices.preview.call('open',{versionId:'qualification-switch',url:'http://127.0.0.1:1/',viewport:{w:390,h:844,dpr:1},label:'switch refusal'})`);
  assert.deepEqual(report.result, { ok: false, kind: 'unavailable', reason: 'disabled' });
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
