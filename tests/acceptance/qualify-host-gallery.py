"""Explicit, synthetic two-host qualification with a laptop SSH relay; no local app/tests."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import selectors
import shlex
import signal
import socket
import subprocess as sp
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
for name in ['app-host', 'fixture-host', 'app-repo', 'node', 'owned-root', 'telemetry']:
    parser.add_argument('--' + name, required=True)
parser.add_argument('--runs', type=int, default=4, choices=range(1, 5))
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
base = args.owned_root
children = []
created = []
record = {'schema': 'hq-host-relay/v1', 'route': 'laptop local forwards to fixture; app-host loopback reverse forwards to laptop',
          'native': [], 'processes': [], 'cleanup': []}


def remote(host, code, *argv, payload=None, timeout=30):
    result = sp.run(['ssh', '-T', '-o', 'BatchMode=yes', host,
                     'python3 -c ' + shlex.quote(code) + ' ' + shlex.join(argv)],
                    input=payload, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout


def start(host, code, options=()):
    child = sp.Popen(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
                      *options, host, 'python3 -c ' + shlex.quote(code)],
                     stdin=sp.PIPE, stdout=sp.PIPE, stderr=sp.PIPE, text=True, start_new_session=True)
    children.append((host, child))
    record['processes'].append({'host': host, 'localPid': child.pid, 'localPgid': child.pid})
    return child


def ready_line(child):
    with selectors.DefaultSelector() as selector:
        selector.register(child.stdout, selectors.EVENT_READ)
        if not selector.select(15):
            raise RuntimeError('Owned SSH readiness missing; no retry')
        line = child.stdout.readline()
    if not line:
        raise RuntimeError('SSH exited: ' + child.stderr.read())
    return json.loads(line)


def free_ports():
    sockets = [socket.socket(), socket.socket()]
    try:
        for sock in sockets:
            sock.bind(('127.0.0.1', 0))
        return [sock.getsockname()[1] for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


def cancelled(signum, _frame):
    raise RuntimeError('Qualification cancelled: ' + str(signum))


for sig in [signal.SIGINT, signal.SIGTERM]:
    signal.signal(sig, cancelled)

# SSH can already make its command a session leader; retain that owned session.
session = 'import os;\nif os.getsid(0) != os.getpid(): os.setsid()\n'
helper = session + "import sys,json; print(json.dumps({'pid':os.getpid(),'pgid':os.getpgrp()}),flush=True); sys.stdin.read()"
try:
    sources = []
    for name in ['runtime.mjs', 'fixtures/remote-gallery.mjs', 'fixtures/host-gallery.mjs']:
        data = (repo / 'tests/acceptance' / name).read_bytes()
        sources.append({'path': name, 'data': base64.b64encode(data).decode(), 'sha256': hashlib.sha256(data).hexdigest()})
    for host in [args.fixture_host, args.app_host]:
        # Existence is an error, never reuse or overwrite a previous attempt.
        remote(host, "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.mkdir(mode=0o700); (p/'work').mkdir(); (p/'evidence').mkdir()", base)
        created.append(host)
    remote(args.fixture_host, """import sys,json,pathlib,hashlib,base64
for i in json.load(sys.stdin):
 p=pathlib.Path(sys.argv[1])/'work'/i['path']; p.parent.mkdir(parents=True,exist_ok=True)
 data=base64.b64decode(i['data']); assert hashlib.sha256(data).hexdigest()==i['sha256']; p.write_bytes(data)
""", base, payload=json.dumps(sources))
    record['fixtureSources'] = {item['path']: item['sha256'] for item in sources}
    server = start(args.fixture_host, session + 'os.execv(' + repr('/usr/bin/node') + ',' + repr([
        '/usr/bin/node', base + '/work/fixtures/host-gallery.mjs', '--serve', base + '/work/scratch',
        base + '/evidence/host-process.json']) + ')')
    ready = ready_line(server)
    assert ready['event'] == 'ready'
    record['server'] = ready
    local_ports = free_ports()
    remote_ports = [urlparse(ready[key]).port for key in ['origin', 'controlOrigin']]
    options = sum((['-L', f'127.0.0.1:{local}:127.0.0.1:{target}'] for local, target in zip(local_ports, remote_ports)), [])
    tunnel = start(args.fixture_host, helper, options)
    record['processes'][-1]['remote'] = ready_line(tunnel)
    app_ports = json.loads(remote(args.app_host, "import socket,json; ss=[socket.socket(),socket.socket()]; [s.bind(('127.0.0.1',0)) for s in ss]; print(json.dumps([s.getsockname()[1] for s in ss])); [s.close() for s in ss]"))
    options = sum((['-R', f'127.0.0.1:{app}:127.0.0.1:{local}'] for app, local in zip(app_ports, local_ports)), [])
    relay = start(args.app_host, helper, options)
    record['processes'][-1]['remote'] = ready_line(relay)
    binding = {key: ready[key] for key in ['runId', 'host', 'pid', 'pgid']}
    binding.update(schema='hq-gallery-forward/v1', origin=f'http://127.0.0.1:{app_ports[0]}/',
                   controlOrigin=f'http://127.0.0.1:{app_ports[1]}', topology=record['route'])
    remote(args.app_host, "import pathlib,sys; pathlib.Path(sys.argv[1]+'/work/binding.json').write_text(sys.stdin.read())", base, payload=json.dumps(binding))
    expected = {str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in (repo / 'tests/acceptance').rglob('*.mjs')}
    expected_head = sp.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    print(json.dumps({'event': 'fixture-and-relay-ready', 'pid': ready['pid'], 'pgid': ready['pgid'],
                      'origin': binding['origin'], 'localChildren': [p.pid for _, p in children]}), flush=True)
    for iteration in range(args.runs):
        result = json.loads(remote(args.app_host, """import sys,subprocess as s,json,pathlib,os,hashlib,signal
repo,base,node,iteration,telemetry,head=sys.argv[1:]
expected=json.load(sys.stdin)
assert s.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()==head
assert s.check_output(['git','branch','--show-current'],cwd=repo,text=True).strip() not in ['main','master','']
for path,digest in expected.items(): assert hashlib.sha256((pathlib.Path(repo)/path).read_bytes()).hexdigest()==digest,path
sample=json.loads(s.check_output(['python3',telemetry,'--format','admission'],text=True))
pathlib.Path(base+'/evidence/admission-'+iteration+'.json').write_text(json.dumps(sample))
assert sample['admission']['serial_test_process_ceiling']==1
home=pathlib.Path(base)/'work'/'home';home.mkdir(exist_ok=True)
env=dict(os.environ,HOME=str(home),PATH=str(pathlib.Path(node).parent)+':/usr/bin:/bin')
log=pathlib.Path(base+'/evidence/native-'+iteration+'.log')
with log.open('x') as output:
 p=s.Popen([node,'tests/acceptance/run.mjs','--gallery-only','--gallery-host',base+'/work/binding.json'],cwd=repo,env=env,stdout=output,stderr=s.STDOUT,start_new_session=True)
 stat=pathlib.Path('/proc/'+str(p.pid)+'/stat').read_text().split(') ')[1].split()
 pathlib.Path(base+'/work/native-process.json').write_text(json.dumps({'pid':p.pid,'pgid':p.pid,'start':stat[19]}))
 try: code=p.wait(timeout=45)
 except BaseException:
  os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=25);raise
lines=log.read_text().splitlines(); evidence=next(line[len('Evidence: '):] for line in lines if line.startswith('Evidence: '))
report=json.loads(pathlib.Path(evidence+'/report.json').read_text())
result={'iteration':int(iteration),'exitCode':code,'evidence':evidence,'outcome':report['outcome'],'rows':[{k:r[k] for k in ['id','status']} for r in report['rows']],'timings':report['timings'],'cleanup':report.get('cleanupReadback'),'admission':sample['admission']['measurements'],'build':report['build']}
print(json.dumps(result))
""", args.app_repo, base, args.node, str(iteration), args.telemetry, expected_head,
            payload=json.dumps(expected), timeout=80))
        record['native'].append(result)
        print(json.dumps(result), flush=True)
        if result['exitCode'] != 0 or result['outcome'] != 'gallery-host-passed':
            raise RuntimeError('First native failure preserved; no repeat')
        if iteration and result['build'] != record['native'][0]['build']:
            raise RuntimeError('Built app changed')
except BaseException as error:
    record['error'] = repr(error)
    print(json.dumps({'error': repr(error)}), flush=True)
finally:
    # Cancellation must finish the exact live harness before its fixture disappears.
    if args.app_host in created:
        try:
            readback = remote(args.app_host, """import sys,pathlib,json,os,signal,time
p=pathlib.Path(sys.argv[1]+'/work/native-process.json')
if p.exists():
 d=json.loads(p.read_text());stat=pathlib.Path('/proc/'+str(d['pid'])+'/stat')
 if stat.exists() and stat.read_text().split(') ')[1].split()[19]==d['start']:
  os.killpg(d['pgid'],signal.SIGTERM)
  for _ in range(250):
   if not stat.exists(): break
   time.sleep(.1)
  assert not stat.exists(),'native cleanup unresolved'
 print(json.dumps({'nativePid':d['pid'],'closed':not stat.exists()}))
""", base)
            record['cleanup'].append(json.loads(readback) if readback else {'native': 'not-started'})
        except Exception as error:
            record['cleanup'].append({'error': repr(error)})
    for host, child in reversed(children):
        try:
            child.stdin.close()
            child.wait(timeout=12)
            output = child.stdout.read()
            record['cleanup'].append({'host': host, 'localPid': child.pid, 'exitCode': child.returncode,
                                      'stdout': output, 'stderr': child.stderr.read()})
            if child is children[0][1] and output:
                record['serverClosed'] = json.loads(output.splitlines()[-1])
        except Exception as error:
            record['cleanup'].append({'host': host, 'localPid': child.pid, 'error': repr(error)})
    for host in created:
        try:
            readback = remote(host, """import sys,pathlib,json,shutil,os
base=pathlib.Path(sys.argv[1]);record=json.load(sys.stdin)
(base/'evidence'/'relay-report.json').write_text(json.dumps(record,indent=2))
identities=([record['server']] if sys.argv[2]==sys.argv[3] and 'server' in record else [])+[p['remote'] for p in record['processes'] if p['host']==sys.argv[2] and 'remote' in p]
for p in identities:
 try:os.kill(p['pid'],0)
 except ProcessLookupError:continue
 raise RuntimeError('Owned remote PID still present: '+str(p['pid']))
shutil.rmtree(base/'work')
print(json.dumps({'host':sys.argv[2],'workAbsent':not (base/'work').exists(),'remotePidsClosed':[p['pid'] for p in identities]}))
""", base, host, args.fixture_host, payload=json.dumps(record))
            record['cleanup'].append(json.loads(readback))
        except Exception as error:
            record['cleanup'].append({'host': host, 'error': repr(error)})
    for host in created:
        try:
            remote(host, "import sys,pathlib; pathlib.Path(sys.argv[1]+'/evidence/relay-report.json').write_text(sys.stdin.read())", base, payload=json.dumps(record, indent=2))
        except Exception as error:
            record['cleanup'].append({'host': host, 'error': repr(error)})
    print(json.dumps({'event': 'complete', 'nativeRuns': len(record['native']), 'error': record.get('error'),
                      'cleanup': [{k: v for k, v in item.items() if k not in ['stdout', 'stderr']} for item in record['cleanup']]}), flush=True)
    if record.get('error') or any('error' in item or item.get('exitCode', 0) != 0 for item in record['cleanup']):
        raise SystemExit(1)
