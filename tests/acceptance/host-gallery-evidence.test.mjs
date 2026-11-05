import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Python's actual owner/sink/protocol and qualifier functions, fake ports only.
// TemporaryDirectory owns all tiny synthetic bytes on success, error and cancel.
const suite = String.raw`
import base64, hashlib, importlib.util, io, json, os, pathlib, signal, stat, sys, tempfile, types, unittest
from unittest.mock import patch
root = pathlib.Path(sys.argv[1])
sys.dont_write_bytecode = True
sys.path.insert(0, str(root))
import host_gallery_evidence as h
spec = importlib.util.spec_from_file_location('qualifier', root / 'qualify-host-gallery.py')
q = importlib.util.module_from_spec(spec); spec.loader.exec_module(q)

class Relay(unittest.TestCase):
 def setUp(self):
  fs = os.statvfs(tempfile.gettempdir())
  self.assertGreater(fs.f_bavail * fs.f_frsize, 2 * h.MIB)
  self.temp = tempfile.TemporaryDirectory(prefix='hq-relay-synthetic-')
  self.root = pathlib.Path(self.temp.name); self.root.chmod(0o700)
  self.parent = self.root / 'evidence'; self.parent.mkdir(mode=0o700)
  self.plan = dict(worktree=str(self.root), parent=str(self.parent), scratchParent=str(self.root / 'scratch'))
  self.policy = dict(reserveBytes=0, peakBytes=1, evidenceOrdinaryBytes=h.ORDINARY, artifactBytes=32*h.MIB)
  self.owners = []
 def tearDown(self):
  for owner in self.owners:
   if not owner.closed:
    try: owner.close(7)
    except BaseException: pass
  name = self.temp.name; self.temp.cleanup(); self.assertFalse(pathlib.Path(name).exists())
 def owner(self, name='relay', policy=None):
  value = h.Owner(self.plan, name, {}, validate=lambda p,f: policy or self.policy)
  self.owners.append(value); return value
 def test_preallocation_and_immutable_report(self):
  o=self.owner(); self.assertEqual((o.run/'.closure.json').stat().st_size,h.RESERVE)
  self.assertEqual(json.loads((o.run/'.closure.json').read_text())['status'],'incomplete')
  o.document('relay-report.json',{'source':'pinned'}); o.close()
  self.assertEqual(json.loads((o.run/'.closure.json').read_text())['status'],'closed')
  self.assertFalse((self.parent/'.hq-storage.lock').exists())
  with self.assertRaises(ValueError): o.document('late.json',{})
  with self.assertRaises(ValueError): o.close()
 def test_capacity_refusal_precedes_lock_or_run(self):
  def refuse(p,f): raise ValueError('unknown capacity')
  with self.assertRaises(ValueError): h.Owner(self.plan,'refused',{},validate=refuse)
  self.assertEqual(list(self.parent.iterdir()),[])
 def test_actual_admission_rejects_unknown_or_stale_facts(self):
  for facts in [{}, {'schema':'hq-gallery-admission/v1','snapshot':{'worktree':{'path':'wrong'}},'policy':{}}]:
   with self.assertRaises((ValueError,KeyError)): h.validate_admission(self.plan,facts)
  self.assertFalse(pathlib.Path(self.plan['scratchParent']).exists())
 def test_lock_refusal_preserves_existing_bytes(self):
  lock=self.parent/'.hq-storage.lock'; lock.write_text('foreign'); lock.chmod(0o600)
  with self.assertRaises(FileExistsError): self.owner()
  self.assertEqual(lock.read_text(),'foreign'); self.assertFalse((self.parent/'relay').exists())
 def test_exact_and_one_over_prepaid_file_bound(self):
  o=self.owner()
  for i in range(63): o.write('file-'+str(i),b'')
  with self.assertRaises(ValueError): o.write('sixty-fourth',b'')
  o.close(9); c=json.loads((o.run/'.closure.json').read_text())
  self.assertEqual(c['primary'],9); self.assertEqual(c['ordinaryFiles'],63); self.assertEqual(c['status'],'incomplete')
 def test_exact_one_over_stricter_policy_bytes(self):
  o=self.owner(policy={**self.policy,'evidenceOrdinaryBytes':8,'artifactBytes':8})
  o.write('one',b'12345678')
  with self.assertRaises(ValueError): o.write('two',b'x')
  self.assertFalse((o.run/'two').exists()); self.assertEqual((o.run/'one').read_bytes(),b'12345678')
 def test_prepaid_witness_bytes_not_refunded(self):
  o=self.owner(); self.assertEqual(o.ceiling,h.ORDINARY-h.RESERVE)
  o.ceiling=8; o.write('one',b'12345678')
  with self.assertRaises(ValueError): o.write('two',b'x')
 def test_overwrite_and_stream_chunk_refuse_before_write(self):
  o=self.owner(); o.write('one',b'old')
  with self.assertRaises(ValueError): o.write('one',b'new')
  self.assertEqual((o.run/'one').read_bytes(),b'old')
  o.close(3); o=self.owner('other')
  with self.assertRaises(ValueError): o.write('log',b'x'*(h.CHUNK+1),stream=True)
  self.assertFalse((o.run/'log').exists())
 def test_changed_lock_late_close_never_replaces_original_failure(self):
  o=self.owner(); (self.parent/'.hq-storage.lock').write_text('replacement')
  with self.assertRaises(RuntimeError): o.close(-signal.SIGTERM)
  self.assertEqual(json.loads((o.run/'.closure.json').read_text())['primary'],-signal.SIGTERM)
  self.assertTrue((self.parent/'.hq-storage.lock').exists())
 def test_parent_and_hardlink_substitution(self):
  o=self.owner(); o.write('one',b'first'); os.link(o.run/'one',self.root/'link')
  with self.assertRaises(ValueError): o.write('one',b'x',append=True)
 def test_sink_exact_and_one_over_output_bound(self):
  writes=[]; sink=h.NativeSink(writes.append)
  line=b'x'*(h.CHUNK-1)+b'\n'
  for _ in range(h.NATIVE//h.CHUNK): sink.feed(line)
  self.assertEqual(sum(map(len,writes)),h.NATIVE)
  with self.assertRaises(ValueError): sink.feed(b'\n')
  self.assertEqual(sum(map(len,writes)),h.NATIVE)
 def test_sink_incremental_control_no_unbounded_line(self):
  writes=[]; s=h.NativeSink(writes.append)
  s.feed(b'Evidence: /unique/'); s.feed(b'report\n')
  self.assertEqual(s.finish(),'/unique/report')
  with self.assertRaises(ValueError): s.feed(b'Evidence: /second\n')
  s=h.NativeSink(writes.append); s.feed(b'x'*h.CHUNK)
  with self.assertRaises(ValueError): s.feed(b'x')
 def test_truncated_missing_and_write_error(self):
  for data in [b'partial',b'ordinary\n']:
   s=h.NativeSink(lambda b:None); s.feed(data)
   with self.assertRaises(ValueError): s.finish()
  def fail(b): raise OSError('disk refused')
  with self.assertRaises(OSError): h.NativeSink(fail).feed(b'line\n')
 def test_segmented_protocol_and_exact_ack_order(self):
  value={'text':'x'*100000}; p=h.Frames('q',['phaseA','finalization']); seq=0
  for slot,v in [('phaseA',value),('finalization',{'ok':True})]:
   result=None
   for frame in h.frames('q',slot,v,seq):
    self.assertLessEqual(len(h.encoded(frame)),h.CHUNK); result=p.accept(frame); seq+=1
   self.assertEqual(result,(slot,v))
  p.finish()
 def test_protocol_rejects_malformed_duplicate_reordered_and_truncated(self):
  frame=next(h.frames('q','phaseA',{'ok':True},0))
  for update in [{'qualification':'other'},{'slot':'launch'},{'sequence':1},{'part':1},{'length':h.DOCUMENT+1},{'sha256':'wrong'},{'extra':True},{'data':'!'}]:
   with self.assertRaises((ValueError,KeyError)): h.Frames('q',['phaseA']).accept({**frame,**update})
  p=h.Frames('q',['phaseA']); p.accept(frame)
  with self.assertRaises(ValueError): p.accept(frame)
  with self.assertRaises(ValueError): h.Frames('q',['phaseA']).finish()
 def test_witness_before_native_and_write_once(self):
  parent=self.root/'witness'; parent.mkdir(mode=0o700); order=[]
  w=h.Witness(str(parent),'q',lambda:order.append('admit'))
  order.append('reserve'); self.assertEqual(w.path.stat().st_size,h.RESERVE)
  for event in ['A','B','owner-exit','independent-absence']: order.append(event)
  w.finish({'terminal':'passed','bundle':{'report':'immutable'}}); order.append('witness')
  self.assertEqual(order,['admit','reserve','A','B','owner-exit','independent-absence','witness'])
  with self.assertRaises(ValueError): w.finish({})
 def test_witness_unknown_capacity_and_collision_never_allocate_replacement(self):
  parent=self.root/'witness'; parent.mkdir(mode=0o700)
  def refuse(): raise ValueError('unknown capacity')
  with self.assertRaises(ValueError): h.Witness(str(parent),'q',refuse)
  self.assertEqual(list(parent.iterdir()),[])
  w=h.Witness(str(parent),'q',lambda:None)
  with self.assertRaises(FileExistsError): h.Witness(str(parent),'q',lambda:None)
  w.finish({'terminal':'incomplete'})
 def test_witness_failure_still_closes_descriptor(self):
  parent=self.root/'witness'; parent.mkdir(mode=0o700); w=h.Witness(str(parent),'q',lambda:None)
  with self.assertRaises(ValueError): w.finish({'oversized':'x'*h.RESERVE})
  with self.assertRaises(OSError): os.fstat(w.fd)
 def test_bundle_one_way_hash_identity_and_no_future_exit_claim(self):
  o=self.owner(); r={'qualification':'q','source':'source','ownerExit':'unobserved'}
  o.document('relay-report.json',r); o.close()
  # Bind the exact closed facts, never a path as live writer authority.
  _,report=h.read_file(o.run/'relay-report.json',h.DOCUMENT)
  _,closure=h.read_file(o.run/'.closure.json',h.RESERVE)
  b={'qualification':'q','source':'source','run':str(o.run),'report':report,'closure':closure}
  self.assertEqual(h.validate_bundle(b,parent=str(self.parent),qualification='q',source='source')['report'],r)
  for changed in [{**b,'qualification':'wrong'},{**b,'run':str(self.root)},{**b,'report':{**report,'sha256':'wrong'}}]:
   with self.assertRaises(ValueError): h.validate_bundle(changed,parent=str(self.parent),qualification='q',source='source')
 def test_group_survivor_pid_reuse_and_unknown_absence_never_pass(self):
  item={'pid':123,'pgid':123,'session':123,'birth':'original'}
  with patch.object(q,'identity',return_value={**item,'birth':'reused'}):
   with self.assertRaises(RuntimeError): q.absent(item)
  with patch.object(q,'identity',return_value=None),patch.object(q.os,'killpg',return_value=None):
   with self.assertRaises(RuntimeError): q.absent(item)
  with patch.object(q,'identity',return_value=None),patch.object(q.os,'killpg',side_effect=PermissionError()):
   with self.assertRaises(PermissionError): q.absent(item)
  with patch.object(q,'identity',return_value=None),patch.object(q.os,'killpg',side_effect=ProcessLookupError()): self.assertTrue(q.absent(item))
 def test_one_max_attempts_and_first_failure_stop(self):
  for runs in [1,4]:
   seen=[]; c={'runs':runs,'primary':0}
   def attempt(c,i,o): seen.append(i); return {'exitCode':0,'outcome':'gallery-host-passed','build':{'fixed':1}}
   self.assertEqual(len(q.run_attempts(c,None,attempt)),runs); self.assertEqual(seen,list(range(runs)))
  seen=[]; c={'runs':4,'primary':0}
  def failure(c,i,o): seen.append(i); return {'exitCode':7,'outcome':'failed','build':{}}
  self.assertEqual(len(q.run_attempts(c,None,failure)),1); self.assertEqual(c['primary'],7); self.assertEqual(seen,[0])
 def test_build_drift_is_not_retried(self):
  seen=[]
  def attempt(c,i,o): seen.append(i); return {'exitCode':0,'outcome':'gallery-host-passed','build':{'version':i}}
  with self.assertRaises(RuntimeError): q.run_attempts({'runs':4},None,attempt)
  self.assertEqual(seen,[0,1])
 def test_source_manifest_requires_complete_graph_before_any_allocation(self):
  repo=self.root/'repo'; repo.mkdir(mode=0o700)
  required=['tests/acceptance/runtime.mjs','tests/acceptance/evidence.mjs','tests/acceptance/fixtures/host-gallery.mjs','tests/acceptance/fixtures/remote-gallery.mjs','tests/acceptance/fixtures/host-gallery-evidence.mjs','tests/acceptance/host_gallery_evidence.py','tests/acceptance/qualify-host-gallery.py','tools/storage/admission.mjs','tools/storage/policy.mjs']
  files={}
  for name in required:
   p=repo/name; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(b'synthetic'); files[name]=hashlib.sha256(b'synthetic').hexdigest()
  manifest={'schema':'hq-gallery-source/v1','head':'candidate','files':files}
  self.assertEqual(h.verify_sources(str(repo),manifest),hashlib.sha256(h.encoded(manifest)).hexdigest())
  for changed in [{**manifest,'files':{k:v for k,v in files.items() if k!=required[0]}},{**manifest,'files':{**files,required[0]:'0'*64}}]:
   with self.assertRaises(ValueError): h.verify_sources(str(repo),changed)
  self.assertFalse((self.root/'scratch').exists())
 def test_closed_files_reject_symlink_hash_path_and_size(self):
  p=self.root/'report'; p.write_bytes(b'{}\n'); p.chmod(0o600)
  _,fact=h.read_file(p,8)
  with self.assertRaises(ValueError): h.read_file(p,2)
  with self.assertRaises(ValueError): h.read_file(p,8,{**fact,'path':'substituted'})
  alias=self.root/'alias'; alias.symlink_to(p)
  with self.assertRaises(OSError): h.read_file(alias,8)
 def test_disjoint_required_parents(self):
  for paths in [(self.root,self.root/'child'),(self.root,self.root)]:
   with self.assertRaises(ValueError): h.disjoint(*paths)
 def test_actual_qualifier_pipe_argument_and_deadline_seam(self):
  owner=types.SimpleNamespace(document=lambda *a:None,write=lambda *a,**k:None,failure=None)
  captured={'pid':12345,'pgid':12345,'session':12345,'birth':'original'}
  class Stream:
   def fileno(self): return 31
   def close(self): pass
  class Child:
   pid=12345; stdout=Stream(); returncode=0
   def wait(self,timeout): self.timeout=timeout; return 0
   def poll(self): return 0
  child=Child(); launches=[]
  def popen(argv,**kwargs): launches.append((argv,kwargs)); return child
  class Select:
   def __enter__(self): return self
   def __exit__(self,*args): pass
   def register(self,*args): pass
   def select(self,left): self.left=left; return [(types.SimpleNamespace(fileobj=child.stdout,data='native'),None)]
  config={'repo':'/repo','node':'/pinned/node','parent':'/evidence','scratch':str(self.root/'scratch'),'manifest':{},'telemetry':'/telemetry','nativeRegistry':[],'primary':0}
  pathlib.Path(config['scratch']).mkdir(mode=0o700)
  sample={'admission':{'serial_test_process_ceiling':1,'measurements':{}}}
  with patch.object(q,'source_check',return_value='source'),patch.object(q,'admission',return_value=({}, {'policy':{'evidenceClosureBytes':h.RESERVE}})),patch.object(q,'identity',side_effect=[captured,None]),patch.object(q,'emit'),patch.object(q.selectors,'DefaultSelector',Select),patch.object(q.os,'read',side_effect=[b'Evidence: /wrong/run\n',b'']),patch.object(q.os,'killpg',side_effect=ProcessLookupError()):
   with self.assertRaises(ValueError): q.native_attempt(config,0,owner,popen=popen,sample=sample)
  argv,kw=launches[0]
  self.assertEqual(argv,['/pinned/node','tests/acceptance/run.mjs','--gallery-only','--gallery-host',str(self.root/'scratch/binding.json')])
  self.assertEqual(kw['stdout'],q.sp.PIPE); self.assertEqual(kw['stderr'],q.sp.STDOUT); self.assertTrue(kw['start_new_session'])
  self.assertLessEqual(child.timeout,45)
 def test_receiver_failure_closes_reserved_owner_on_eof(self):
  o=self.owner(); c={'repo':'/repo','node':'/node','parent':str(self.parent),'scratch':str(self.root/'scratch'),'manifest':{},'qualification':'q','witness':'/witness','runs':1}
  with patch.object(q,'admission',return_value=(self.plan,{})),patch.object(q,'Owner',return_value=o),patch.object(q,'source_check',return_value='source'),patch.object(q,'identity',return_value={'pid':1}),patch.object(q,'emit'),patch.object(q,'run_attempts',return_value=[]),patch.object(q,'receive_documents',side_effect=EOFError('cancel')):
   with self.assertRaises(FileNotFoundError): q.receiver(c)
  self.assertTrue(o.closed); self.assertEqual(json.loads((o.run/'.closure.json').read_text())['status'],'failed')

 def exercise_outer(self, fault=None, failed_bundle=False):
  witness_parent=self.root/('witness-'+str(fault)+'-'+str(failed_bundle)); witness_parent.mkdir(mode=0o700)
  config={'qualification':'qualification','manifest':{'head':'candidate'},'fixtureRepo':'/fixture/repo','fixtureEvidenceParent':'/fixture/evidence','relayEvidenceParent':'/app/evidence','localRepo':'/local/repo','localNode':'/node','localScratchParent':'/local/scratch'}
  args=types.SimpleNamespace(app_host='app',fixture_host='fixture',app_repo='/app/repo',node='/node',owned_root='/owned/new-scratch',telemetry='/telemetry',runs=4,witness_parent=str(witness_parent))
  owner_identity={'pid':304,'pgid':304,'session':304,'birth':'owner'}
  fixture_identity={'pid':301,'pgid':301,'session':301,'birth':'fixture'}
  ready={'event':'ready','runId':'host-run','host':'fixture-host','pid':301,'pgid':301,'origin':'http://127.0.0.1:5001/','controlOrigin':'http://127.0.0.1:5002/'}
  node_bundle={'event':'closed','schema':'hq-gallery-closed/v1'}
  bundle={'event':'owner-closed','qualification':'qualification','source':'source','run':'/app/evidence/qualification','report':{'path':'/app/evidence/qualification/relay-report.json','bytes':4,'sha256':'report'},'closure':{'path':'/app/evidence/qualification/.closure.json','bytes':h.RESERVE,'sha256':'closure'},'primary':7 if failed_bundle else 0}
  events=[ready,{'pid':302,'pgid':302,'session':302,'birth':'tunnel'},{'pid':303,'pgid':303,'session':303,'birth':'relay'},{'event':'ack','sequence':0},{'event':'owner-ready','identity':owner_identity,'run':bundle['run'],'scratch':{'dev':1,'ino':2}}, {'event':'native-start','identity':{'pid':305,'pgid':305,'session':305,'birth':'native'},'iteration':0},{'event':'attempts-done','primary':7 if failed_bundle else 0,'attempts':1},{'event':'ack','sequence':0},{'event':'ack','sequence':1},bundle]
  calls=[]; children=[]; emitted=[]; counter=[0]
  class Pipe:
   closed=False
   def close(self): self.closed=True
  class Child:
   def __init__(self):
    self.pid=201+len(children); self.stdin=Pipe(); self.stdout=Pipe(); self.stderr=Pipe(); self.returncode=None; children.append(self)
   def poll(self): return self.returncode
  def popen(argv,**kwargs):
   calls.append(('start',argv)); return Child()
  def line(*a,**kw):
   index=counter[0]; counter[0]+=1
   if index==fault: raise EOFError('injected cancellation/EOF')
   return events[index]
  def collect(child,**kw):
   calls.append(('reap',child.pid)); child.returncode=0; return h.encoded(node_bundle) if child is children[0] else b''
  def remote(host,code,*argv,payload=None,**kw):
   if 'validate_node_bundle' in code: return {'identity':{k:ready[k] for k in ['runId','host','pid','pgid']}}
   if 'validate_bundle' in code:
    calls.append(('validate-bundle',host)); return {'validated':True,'status':'failed' if failed_bundle else 'closed','primary':7 if failed_bundle else 0}
   if 'shutil.rmtree' in code: calls.append(('scratch-remove',host)); return {'scratchAbsent':args.owned_root}
   if "m['absent']" in code:
    calls.append(('absence',payload)); return {'absent':payload['identities'],'portsClosed':payload['ports'],'ownerAlive':payload['alive'] is not None}
   if "m['identity']" in code: return fixture_identity
   if 'p.mkdir(mode=0o700)' in code: calls.append(('reserve-remote',host)); return {'dev':1,'ino':2}
   if 'socket.socket' in code: return [6001,6002]
   calls.append(('preflight',host)); return {'admitted':True,'source':'source'}
  with patch.object(q,'source_check',return_value='source'),patch.object(q,'admission',return_value=({},{})),patch.object(q,'remote',side_effect=remote),patch.object(q.sp,'Popen',side_effect=popen),patch.object(q,'bounded_line',side_effect=line),patch.object(q,'collect',side_effect=collect),patch.object(q,'send_bytes',side_effect=lambda stream,data: calls.append(('data-only',json.loads(data)))),patch.object(q,'local_identity',side_effect=lambda pid:{'pid':pid,'pgid':pid,'session':pid,'birth':'local'}),patch.object(q,'local_absent',side_effect=lambda item:calls.append(('local-absence',item['pid']))),patch.object(q,'free_ports',return_value=[7001,7002]),patch.object(q,'emit',side_effect=emitted.append):
   result=q.outer(args,config)
  witness=json.loads(next(witness_parent.iterdir()).read_text())
  return result,calls,witness,emitted
 def test_actual_outer_A_B_exit_absence_witness_order(self):
  result,calls,witness,emitted=self.exercise_outer()
  self.assertEqual(result,0,witness.get('failures')); self.assertEqual(witness['terminal'],'passed')
  self.assertEqual(witness['bundle']['report']['sha256'],'report'); self.assertTrue(witness['ownerAbsent'])
  owner_reap=next(i for i,c in enumerate(calls) if c==('reap',204))
  owner_absence=next(i for i,c in enumerate(calls) if c[0]=='absence' and any(p['pid']==304 for p in c[1]['identities']))
  self.assertLess(owner_reap,owner_absence)
  self.assertLess(owner_absence,next(i for i,c in enumerate(calls) if c[0]=='validate-bundle'))
  self.assertEqual(sum(c[0]=='scratch-remove' for c in calls),2)
  start=[c for c in calls if c[0]=='start'][-1][1]
  self.assertNotIn('-L',start); self.assertNotIn('-R',start)
  self.assertEqual(emitted[-1]['event'],'complete')
 def test_actual_outer_eof_at_each_protocol_phase_never_passes(self):
  for phase in range(10):
   with self.subTest(phase=phase):
    result,calls,witness,_=self.exercise_outer(fault=phase)
    self.assertNotEqual(result,0); self.assertEqual(witness['terminal'],'incomplete')
 def test_original_nonzero_stays_primary_while_cleanup_and_witness_run(self):
  result,calls,witness,_=self.exercise_outer(failed_bundle=True)
  self.assertEqual(result,7,witness.get('failures')); self.assertEqual(witness['primary'],7); self.assertEqual(witness['terminal'],'incomplete')
  self.assertEqual(sum(c[0]=='scratch-remove' for c in calls),2)


unittest.main(argv=['synthetic-relay'],verbosity=2)
`;

test('actual Python relay owner, bounded sink and qualifier synthetic contracts', () => {
  const result = spawnSync('python3', ['-B', '-c', suite, fileURLToPath(new URL('.', import.meta.url))], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024,
  });
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran \d+ tests/);
});
