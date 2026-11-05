"""Explicit synthetic two-host qualifier. Source support is not native qualification."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import shlex
import signal
import socket
import subprocess as sp
import sys
import time
from urllib.parse import urlparse
sys.dont_write_bytecode = True
from host_gallery_evidence import (CHUNK, DOCUMENT, RESERVE, Frames, NativeSink, Owner,
                                   Witness, directory, disjoint, encoded, frames, read_file,
                                   validate_admission, validate_bundle, verify_sources, padded_json_fact)

SESSION = 'import os;\nif os.getsid(0) != os.getpid(): os.setsid()\n'
ROUTE = 'laptop local forwards to fixture; app-host loopback reverse forwards to laptop'


def bounded_line(stream, timeout=15):
    deadline = time.monotonic() + timeout
    with selectors.DefaultSelector() as selector:
        selector.register(stream, selectors.EVENT_READ)
        if not selector.select(timeout):
            raise RuntimeError('Owned transport deadline; no retry')
        data = bytearray()
        while True:
            chunk = os.read(stream.fileno(), 1)
            if not chunk:
                raise EOFError('Premature transport EOF')
            data.extend(chunk)
            if len(data) > CHUNK:
                raise ValueError('control line limit')
            if chunk == b'\n':
                return json.loads(data)
            left = deadline - time.monotonic()
            if left <= 0 or not selector.select(left):
                raise RuntimeError('Truncated transport deadline')


def send_bytes(stream, data, timeout=15):
    if len(data) > DOCUMENT:
        raise ValueError('transport document limit')
    fd = stream.fileno()
    blocking = os.get_blocking(fd)
    deadline = time.monotonic() + timeout
    os.set_blocking(fd, False)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(stream, selectors.EVENT_WRITE)
            offset = 0
            while offset < len(data):
                left = deadline - time.monotonic()
                if left <= 0 or not selector.select(left):
                    raise RuntimeError('bounded transport write deadline')
                try:
                    size = os.write(fd, data[offset:offset + CHUNK])
                except BlockingIOError:
                    continue
                if size <= 0:
                    raise OSError('transport write made no progress')
                offset += size
    finally:
        os.set_blocking(fd, blocking)


def emit(value):
    data = encoded(value)
    if len(data) > CHUNK:
        raise ValueError('control response limit')
    send_bytes(sys.stdout.buffer, data)


def collect(child, *, timeout=30, maximum=DOCUMENT):
    """Bound both transport pipes in memory before any file sink; no communicate queue."""
    buffers = {child.stdout: bytearray(), child.stderr: bytearray()}
    deadline = time.monotonic() + timeout
    with selectors.DefaultSelector() as selector:
        for stream in buffers:
            selector.register(stream, selectors.EVENT_READ)
        while selector.get_map():
            left = deadline - time.monotonic()
            if left <= 0:
                raise RuntimeError('Owned SSH deadline; cessation unproved')
            for key, _ in selector.select(left):
                data = os.read(key.fileobj.fileno(), CHUNK)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                if sum(map(len, buffers.values())) + len(data) > maximum:
                    raise ValueError('bounded SSH output limit; cessation unproved')
                buffers[key.fileobj].extend(data)
    child.wait(timeout=max(.01, deadline - time.monotonic()))
    if child.returncode:
        raise RuntimeError('SSH nonzero ' + str(child.returncode) + ': ' + bytes(buffers[child.stderr])[:512].decode(errors='replace'))
    return bytes(buffers[child.stdout])


def remote(host, code, *argv, payload=None, timeout=30):
    child = sp.Popen(['ssh', '-T', '-o', 'BatchMode=yes', host,
                      'python3 -c ' + shlex.quote(code) + ' ' + shlex.join(argv)],
                     stdin=sp.PIPE, stdout=sp.PIPE, stderr=sp.PIPE, start_new_session=True)
    try:
        if payload is not None:
            data = encoded(payload)
            # Predetermined source manifests may span bounded chunks, with no disk staging.
            send_bytes(child.stdin, data)
        child.stdin.close()
        return json.loads(collect(child, timeout=timeout))
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=12)


def identity(pid):
    path = Path('/proc') / str(pid) / 'stat'
    try:
        raw = path.read_text()
    except FileNotFoundError:
        return None
    values = raw[raw.rfind(') ') + 2:].split()
    return {'pid': pid, 'pgid': int(values[2]), 'session': int(values[3]), 'birth': values[19]}


def local_identity(pid):
    if sys.platform.startswith('linux'):
        return identity(pid)
    try:
        pgid, session = os.getpgid(pid), os.getsid(pid)
    except ProcessLookupError:
        return None
    birth = sp.check_output(['/bin/ps', '-o', 'lstart=', '-p', str(pid)], text=True, timeout=5).strip()
    if not birth or len(birth) > 128:
        raise RuntimeError('local transport birth identity unavailable')
    return {'pid': pid, 'pgid': pgid, 'session': session, 'birth': birth}


def local_absent(item):
    current = local_identity(item['pid'])
    if current is not None:
        raise RuntimeError('local transport PID alive/reused; absence unknown')
    try:
        os.killpg(item['pgid'], 0)
    except ProcessLookupError:
        return True
    raise RuntimeError('local transport group survives')


def absent(item):
    current = identity(item['pid'])
    if current is not None:
        if current != item:
            raise RuntimeError('PID identity reused; cessation unknown')
        raise RuntimeError('captured PID still alive')
    try:
        os.killpg(item['pgid'], 0)
    except ProcessLookupError:
        return True
    raise RuntimeError('captured process group still alive or unknown')


def source_check(repo, manifest):
    digest = verify_sources(repo, manifest)
    head = sp.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    branch = sp.check_output(['git', 'branch', '--show-current'], cwd=repo, text=True).strip()
    if head != manifest['head'] or branch in ('', 'main', 'master'):
        raise ValueError('pinned non-main checkout required')
    return digest


def admission(repo, node, parent, scratch, manifest):
    source_check(repo, manifest)
    plan = {'worktree': repo, 'parent': parent, 'scratchParent': scratch}
    child = sp.Popen([node, str(Path(repo) / 'tests/acceptance/fixtures/host-gallery-evidence.mjs'), '--inspect'],
                     stdin=sp.PIPE, stdout=sp.PIPE, stderr=sp.PIPE)
    send_bytes(child.stdin, encoded(plan))
    child.stdin.close()
    facts = json.loads(collect(child))
    validate_admission(plan, facts)
    return plan, facts


def native_attempt(config, iteration, owner, *, popen=sp.Popen, sample=None):
    """Existing native command/lifecycle with a bounded first sink. Fake ports test this seam."""
    source_check(config['repo'], config['manifest'])
    plan, facts = admission(config['repo'], config['node'], config['parent'], config['scratch'], config['manifest'])
    owner.document(f'admission-{iteration}.json', facts)
    if sample is None:
        value = sp.Popen(['python3', config['telemetry'], '--format', 'admission'], stdout=sp.PIPE, stderr=sp.PIPE)
        sample = json.loads(collect(value))
    if sample['admission']['serial_test_process_ceiling'] != 1:
        raise RuntimeError('fresh same-host test admission refused')
    owner.document(f'telemetry-{iteration}.json', sample)
    home = Path(config['scratch']) / 'home'
    home.mkdir(mode=0o700, exist_ok=True)
    env = dict(os.environ, HOME=str(home), PATH=str(Path(config['node']).parent) + ':/usr/bin:/bin')
    child = popen([config['node'], 'tests/acceptance/run.mjs', '--gallery-only', '--gallery-host',
                   str(Path(config['scratch']) / 'binding.json')], cwd=config['repo'], env=env,
                  stdin=sp.DEVNULL, stdout=sp.PIPE, stderr=sp.STDOUT, start_new_session=True)
    captured = identity(child.pid)
    if captured is None or captured['pgid'] != child.pid:
        config['unknownCessation'] = 'native birth/group identity unavailable'
        raise RuntimeError(config['unknownCessation'])
    config['nativeRegistry'].append(captured)
    sink = NativeSink(lambda data: owner.write(f'native-{iteration}.log', data, append=True, stream=True))
    original = None
    stopped = False
    deadline = time.monotonic() + 45
    try:
        emit({'event': 'native-start', 'identity': captured, 'iteration': iteration})
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ, 'native')
            selector.register(sys.stdin.buffer, selectors.EVENT_READ, 'control')
            while True:
                left = deadline - time.monotonic()
                if left <= 0:
                    raise RuntimeError('native attempt deadline')
                for key, _ in selector.select(left):
                    if key.data == 'control':
                        # No frame is a launch/stop command. EOF while producing
                        # enters the existing captured-producer termination path.
                        if not os.read(key.fileobj.fileno(), 1):
                            raise EOFError('owner input closed during native production')
                        raise ValueError('premature finalization data')
                    chunk = os.read(child.stdout.fileno(), CHUNK)
                    if not chunk:
                        child.wait(timeout=max(.01, deadline - time.monotonic()))
                        break
                    sink.feed(chunk)
                else:
                    continue
                break
    except BaseException as error:
        original = error
        observed = child.poll()
        if observed is None:
            if identity(child.pid) != captured:
                raise RuntimeError('native identity changed; cleanup held') from error
            os.killpg(captured['pgid'], signal.SIGTERM)
            stopped = True
        # Drain accepted producer output under the same ceilings. Refused chunks
        # are never spilled, and an exhausted sink does not bypass termination.
        try:
            drain_deadline = time.monotonic() + 25
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    left = drain_deadline - time.monotonic()
                    if left <= 0 or not selector.select(left):
                        raise RuntimeError('native drain deadline; cessation unknown')
                    chunk = os.read(child.stdout.fileno(), CHUNK)
                    if not chunk:
                        break
                    if owner.failure is None:
                        try:
                            sink.feed(chunk)
                        except BaseException:
                            owner.failure = owner.failure or 'native evidence refused during drain'
            child.wait(timeout=max(.01, drain_deadline-time.monotonic()))
        except BaseException as cleanup_error:
            config['unknownCessation'] = repr(cleanup_error)[:160]
            raise RuntimeError('native stop/drain unresolved; scratch removal held') from original
    finally:
        config.setdefault('producerExits', []).append({'iteration':iteration,'identity':captured,
            'code':child.returncode,'expectedTeardown':stopped,
            'unexpectedExit':child.returncode not in (0,None) and not stopped})
        child.stdout.close()
    code = child.returncode
    config['primary'] = config.get('primary') or ((observed or 1) if original else code)
    absent(captured)
    if original:
        raise original
    destination = Path(sink.finish())
    expected_parent = Path(config['repo']) / '.t3' / 'acceptance-evidence'
    # Consume the runner's actual announced unique path, never the old supplied report.
    if destination.parent != expected_parent or not destination.name.startswith('run-'):
        raise ValueError('native report path mismatch')
    report_bytes, fact = read_file(destination / 'report.json', DOCUMENT)
    report = json.loads(report_bytes)
    if report['head'] != config['manifest']['head']:
        raise ValueError('native report source mismatch')
    closure, closure_fact = padded_json_fact(destination / '.closure.json', facts['policy']['evidenceClosureBytes'])
    if closure['status'] != 'complete' or closure['code'] != 0 or closure['signal'] is not None:
        config['primary'] = config.get('primary') or code or 1
    result = {'iteration': iteration, 'exitCode': code, 'evidence': str(destination),
              'report': fact, 'closure': closure_fact, 'outcome': report['outcome'], 'rows': [{k: r[k] for k in ['id', 'status']} for r in report['rows']],
              'timings': report['timings'], 'cleanup': report.get('cleanupReadback'),
              'admission': sample['admission']['measurements'], 'build': report['build']}
    return result


def run_attempts(config, owner, attempt=native_attempt):
    results = []
    for iteration in range(config['runs']):
        result = attempt(config, iteration, owner)
        results.append(result)
        if result['exitCode'] != 0 or result['outcome'] != 'gallery-host-passed':
            config['primary'] = config.get('primary') or result['exitCode'] or 1
            break
        if iteration and result['build'] != results[0]['build']:
            raise RuntimeError('Built app changed')
    return results


def receive_documents(stream, qualification, slots, acknowledge):
    protocol = Frames(qualification, slots)
    values = {}
    while protocol.index < len(slots):
        frame = bounded_line(stream)
        result = protocol.accept(frame)
        acknowledge({'event': 'ack', 'sequence': frame['sequence']})
        if result:
            values[result[0]] = result[1]
    protocol.finish()
    return values


def receiver(config):
    """The original app receiver, extended once through Phase B; no forwarding options."""
    if type(config['runs']) is not int or not 1 <= config['runs'] <= 4:
        raise ValueError('bounded run count')
    plan, facts = admission(config['repo'], config['node'], config['parent'], config['scratch'], config['manifest'])
    if Path(config['scratch']).exists():
        raise ValueError('scratch already exists; unknown prior effect')
    owner = Owner(plan, config['qualification'], facts)
    config['nativeRegistry'] = []
    config['producerExits'] = []
    config['primary'] = 0
    owner_identity = identity(os.getpid())
    report = {'schema': 'hq-host-relay/v1', 'qualification': config['qualification'],
              'source': source_check(config['repo'], config['manifest']), 'owner': owner_identity,
              'ownerExit': 'unobserved', 'terminalQualification': 'unobserved', 'native': [], 'failures': [],
              'producerExits':config['producerExits'],
              'witness': config['witness'], 'route': ROUTE}
    closed = None
    try:
        Path(config['scratch']).mkdir(mode=0o700)
        (Path(config['scratch']) / 'binding.json').write_bytes(encoded(config['binding']))
        scratch_stat = Path(config['scratch']).stat()
        emit({'event': 'owner-ready', 'identity': owner_identity, 'run': str(owner.run),
              'scratch': {'dev': scratch_stat.st_dev, 'ino': scratch_stat.st_ino}})
        try:
            report['native'] = run_attempts(config, owner)
        except BaseException as error:
            report['failures'].append(repr(error)[:512])
            config['primary'] = config['primary'] or 1
        owner.document('relay-report-before-cleanup.json', report)
        report['unknownCessation'] = config.get('unknownCessation')
        emit({'event': 'attempts-done', 'primary': config['primary'], 'attempts': len(report['native']), 'unknownCessation':config.get('unknownCessation')})
        values = receive_documents(sys.stdin.buffer, config['qualification'], ['phaseA', 'finalization'], emit)
        phase_a = values['phaseA']
        if (phase_a.get('owner') != owner_identity or phase_a.get('ownerAlive') is not True or
                phase_a.get('qualification') != config['qualification']):
            raise ValueError('Phase A owner identity')
        if values['finalization'] != {'qualification': config['qualification'], 'phaseA': hashlib.sha256(encoded(phase_a)).hexdigest()}:
            raise ValueError('finalization manifest mismatch')
        report['phaseA'] = phase_a
        report['failures'].extend(phase_a.get('failures', []))
        for item in config['nativeRegistry']:
            absent(item)
        if phase_a.get('failures'):
            config['primary'] = config['primary'] or 1
        source_check(config['repo'], config['manifest'])
        owner.document('relay-report.json', report)
    except BaseException as error:
        report['failures'].append(repr(error)[:512])
        config['primary'] = config['primary'] or 1
        # No report overwrite or replacement run. Closure remains available even
        # after ordinary capacity is exhausted or the transport disappears.
    finally:
        closed = owner.close(config['primary'])
    if report['failures'] or closed['incomplete']:
        config['primary'] = config['primary'] or 1
    _, report_fact = read_file(owner.run / 'relay-report.json', DOCUMENT)
    _, closure_fact = read_file(owner.run / '.closure.json', RESERVE)
    emit({'event': 'owner-closed', 'qualification': config['qualification'], 'source': report['source'],
          'run': str(owner.run), 'report': report_fact, 'closure': closure_fact, 'primary': config['primary']})
    return config['primary']


def free_ports():
    sockets = [socket.socket(), socket.socket()]
    try:
        for sock in sockets:
            sock.bind(('127.0.0.1', 0))
        return [sock.getsockname()[1] for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


def boot(repo, body, manifest):
    # Read-only verification precedes importing receiver source. No checkout,
    # parent, cache, module staging or other bootstrap allocation is performed.
    prefix = SESSION + "import sys,pathlib,hashlib,json,subprocess,stat;sys.dont_write_bytecode=True;\n"
    prefix += "r=pathlib.Path(" + repr(repo) + ");m=json.loads(" + repr(json.dumps(manifest)) + ");\n"
    prefix += "assert r.is_absolute() and r.resolve()==r;assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True,timeout=5).strip()==m['head'];\n"
    prefix += "for n,d in m['files'].items():\n p=r/n;assert not pathlib.Path(n).is_absolute() and '..' not in pathlib.Path(n).parts;assert p.resolve()==p;assert stat.S_ISREG(p.lstat().st_mode) and p.stat().st_size<=1048576;b=p.open('rb').read(1048577);assert len(b)<=1048576 and hashlib.sha256(b).hexdigest()==d,n\n"
    prefix += 'sys.path.insert(0,' + repr(str(Path(repo) / 'tests/acceptance')) + ');' + body
    if len(prefix.encode()) > CHUNK:
        raise ValueError('receiver verification command bound')
    return prefix


def outer(args, config):
    children = []
    registry = []
    record = {'qualification': config['qualification'], 'failures': [], 'primary': 0, 'cleanup': [], 'transports': []}
    witness = None
    owner_child = None
    bundle = None
    owner_item = None
    scratch_registry = {}
    local_registry = {}
    def start(host, code, options=()):
        child = sp.Popen(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
                          *options, host, 'python3 -c ' + shlex.quote(code)],
                         stdin=sp.PIPE, stdout=sp.PIPE, stderr=sp.PIPE, start_new_session=True)
        children.append((host, child))
        captured = local_identity(child.pid)
        if captured is None or captured['pgid'] != child.pid:
            raise RuntimeError('local transport identity unavailable')
        local_registry[child.pid] = captured
        record['transports'].append({'host':host,'identity':captured,'exitCode':'unobserved'})
        return child
    def check_host(host, root, node, parent):
        # Import the hyphenated existing qualifier without executing its CLI.
        code = boot(root, "import runpy,json; m=runpy.run_path(" + repr(str(Path(root) / 'tests/acceptance/qualify-host-gallery.py')) + "); c=json.load(sys.stdin); p,f=m['admission'](c['repo'],c['node'],c['parent'],c['scratch'],c['manifest']); print(json.dumps({'admitted':True,'source':m['source_check'](c['repo'],c['manifest'])}))", config['manifest'])
        return remote(host, code, payload={'repo': root, 'node': node, 'parent': parent, 'scratch': args.owned_root, 'manifest': config['manifest']})
    def capture(host, item, kind):
        if not isinstance(item, dict) or any(type(item.get(k)) is not int or item[k] <= 1 for k in ['pid', 'pgid', 'session']) or not isinstance(item.get('birth'), str):
            raise ValueError('captured receiver identity missing')
        registry.append({'host': host, 'identity': item, 'kind': kind})
    def remote_absence(host, identities, ports=(), alive=None):
        root = args.app_repo if host == args.app_host else config['fixtureRepo']
        code = boot(root, "import runpy,json,socket; m=runpy.run_path(" + repr(str(Path(root) / 'tests/acceptance/qualify-host-gallery.py')) + "); c=json.load(sys.stdin); [m['absent'](i) for i in c['identities']]; assert c['alive'] is None or m['identity'](c['alive']['pid'])==c['alive']; ss=[socket.socket() for _ in c['ports']]; [s.bind(('127.0.0.1',p)) for s,p in zip(ss,c['ports'])]; [s.close() for s in ss]; print(json.dumps({'absent':c['identities'],'portsClosed':c['ports'],'ownerAlive':c['alive'] is not None}))", config['manifest'])
        return remote(host, code, payload={'identities': identities, 'ports': list(ports), 'alive': alive})
    app_ports = []
    fixture_ports = []
    try:
        source = source_check(config['localRepo'], config['manifest'])
        disjoint(config['relayEvidenceParent'], config['fixtureEvidenceParent'], args.witness_parent, args.owned_root)
        # Both receiver prerequisites precede ANY remote allocation, source
        # staging (which is forbidden), fixture runtime, or native producer.
        check_host(args.fixture_host, config['fixtureRepo'], '/usr/bin/node', config['fixtureEvidenceParent'])
        check_host(args.app_host, args.app_repo, args.node, config['relayEvidenceParent'])
        witness = Witness(args.witness_parent, config['qualification'], lambda: admission(
            config['localRepo'], config['localNode'], args.witness_parent, config['localScratchParent'], config['manifest']))
        record['source'] = source
        reserve_code = boot(config['fixtureRepo'], "import runpy,json,pathlib; m=runpy.run_path(" + repr(str(Path(config['fixtureRepo']) / 'tests/acceptance/qualify-host-gallery.py')) + "); c=json.load(sys.stdin); m['admission'](c['repo'],c['node'],c['parent'],c['scratch'],c['manifest']); p=pathlib.Path(c['scratch']); p.mkdir(mode=0o700); i=p.stat(); print(json.dumps({'dev':i.st_dev,'ino':i.st_ino}))", config['manifest'])
        scratch_registry[args.fixture_host] = remote(args.fixture_host, reserve_code, payload={'repo':config['fixtureRepo'],'node':'/usr/bin/node','parent':config['fixtureEvidenceParent'],'scratch':args.owned_root,'manifest':config['manifest']})
        fixture = start(args.fixture_host, boot(config['fixtureRepo'], 'os.execv(' + repr('/usr/bin/node') + ',' + repr([
            '/usr/bin/node', str(Path(config['fixtureRepo']) / 'tests/acceptance/fixtures/host-gallery.mjs'),
            '--serve', args.owned_root, config['fixtureEvidenceParent']]) + ')', config['manifest']))
        ready = bounded_line(fixture.stdout)
        if ready.get('event') != 'ready':
            raise ValueError('fixture readiness')
        # Capture actual remote session/birth, not just the SSH client PID.
        observed = remote(args.fixture_host, boot(config['fixtureRepo'], "import runpy,json; m=runpy.run_path(" + repr(str(Path(config['fixtureRepo']) / 'tests/acceptance/qualify-host-gallery.py')) + "); print(json.dumps(m['identity'](" + str(ready['pid']) + ")))", config['manifest']))
        if observed['pgid'] != ready['pgid']:
            raise ValueError('fixture identity changed')
        capture(args.fixture_host, observed, 'fixture')
        local_ports = free_ports()
        fixture_ports = [urlparse(ready[key]).port for key in ['origin', 'controlOrigin']]
        helper = SESSION + "import sys,json; from pathlib import Path; s=Path('/proc/self/stat').read_text().split(') ')[1].split(); print(json.dumps({'pid':os.getpid(),'pgid':os.getpgrp(),'session':os.getsid(0),'birth':s[19]}),flush=True); sys.stdin.buffer.read(1)"
        options = sum((['-L', f'127.0.0.1:{local}:127.0.0.1:{target}'] for local, target in zip(local_ports, fixture_ports)), [])
        tunnel = start(args.fixture_host, helper, options)
        capture(args.fixture_host, bounded_line(tunnel.stdout), 'forward')
        app_ports = remote(args.app_host, 'import socket,json; ss=[socket.socket(),socket.socket()]; [s.bind(("127.0.0.1",0)) for s in ss]; print(json.dumps([s.getsockname()[1] for s in ss])); [s.close() for s in ss]')
        options = sum((['-R', f'127.0.0.1:{app}:127.0.0.1:{local}'] for app, local in zip(app_ports, local_ports)), [])
        relay = start(args.app_host, helper, options)
        capture(args.app_host, bounded_line(relay.stdout), 'forward')
        binding = {key: ready[key] for key in ['runId', 'host', 'pid', 'pgid']}
        binding.update(schema='hq-gallery-forward/v1', origin=f'http://127.0.0.1:{app_ports[0]}/', controlOrigin=f'http://127.0.0.1:{app_ports[1]}', topology=ROUTE)
        receiver_config = {'qualification': config['qualification'], 'repo': args.app_repo, 'manifest': config['manifest'],
                           'node': args.node, 'parent': config['relayEvidenceParent'], 'scratch': args.owned_root,
                           'telemetry': args.telemetry, 'runs': args.runs, 'binding': binding, 'witness': str(witness.path)}
        receiver_code = boot(args.app_repo, "import runpy,json; m=runpy.run_path(" + repr(str(Path(args.app_repo) / 'tests/acceptance/qualify-host-gallery.py')) + "); c=m['receive_documents'](sys.stdin.buffer," + repr(config['qualification']) + ",['startup'],m['emit'])['startup']; sys.exit(m['receiver'](c))", config['manifest'])
        owner_child = start(args.app_host, receiver_code)  # Deliberately NO forwarding options.
        for frame in frames(config['qualification'], 'startup', receiver_config, 0):
            send_bytes(owner_child.stdin, encoded(frame))
            if bounded_line(owner_child.stdout) != {'event':'ack','sequence':frame['sequence']}:
                raise ValueError('startup ack mismatch')
        owner_ready = bounded_line(owner_child.stdout, 30)
        if owner_ready.get('event') != 'owner-ready':
            raise ValueError('owner readiness')
        owner_item = owner_ready['identity']
        scratch_registry[args.app_host] = owner_ready['scratch']
        record['owner'] = owner_item
        record['run'] = owner_ready['run']
        while True:
            event = bounded_line(owner_child.stdout, 80)
            if event.get('event') == 'native-start':
                capture(args.app_host, event['identity'], 'native')
            elif event.get('event') == 'attempts-done':
                record['primary'] = event['primary']
                if event.get('unknownCessation'):
                    record['unknownCessation'] = event['unknownCessation']
                break
            else:
                raise ValueError('unexpected receiver event')
    except BaseException as error:
        record['failures'].append(repr(error)[:512])
        record['primary'] = record['primary'] or 1
    finally:
        # The receiver owns producer termination on EOF. It is not exempted
        # from the cleanup oracle; it stays ALIVE only through Phase A/B.
        if record['failures'] and owner_child is not None and owner_child.poll() is None:
            owner_child.stdin.close()
            try:
                collect(owner_child, timeout=80)
            except BaseException as error:
                record['failures'].append(repr(error)[:512])
        for host, child in reversed(children):
            if child is owner_child:
                continue
            try:
                expected_teardown = child.poll() is None
                child.stdin.close()
                data = collect(child, timeout=12, maximum=DOCUMENT)
                if not expected_teardown:
                    raise RuntimeError('unexpected fixture/forward child exit')
                local_absent(local_registry[child.pid])
                record['transports'][next(i for i,p in enumerate(record['transports']) if p['identity']['pid']==child.pid)]['exitCode'] = child.returncode
                if child is children[0][1] and data:
                    closed = json.loads(data.splitlines()[-1])
                    record['fixtureBundle'] = closed
            except BaseException as error:
                record['failures'].append(repr(error)[:512])
        phase_a = {'qualification': config['qualification'], 'owner': owner_item, 'ownerAlive': False,
                   'failures': list(record['failures']), 'observations': []}
        try:
            for host in [args.fixture_host, args.app_host]:
                entries = [p['identity'] for p in registry if p['host'] == host]
                phase_a['observations'].append(remote_absence(host, entries, fixture_ports if host == args.fixture_host else app_ports,
                                                             owner_item if host == args.app_host else None))
            phase_a['ownerAlive'] = owner_item is not None
            # Validate actual fixture bundle/hash/source before copying closed facts.
            if 'fixtureBundle' in record:
                check = boot(config['fixtureRepo'], "import json;from host_gallery_evidence import validate_node_bundle; c=json.load(sys.stdin); print(json.dumps(validate_node_bundle(c['bundle'],c['parent'],c['head'])))", config['manifest'])
                phase_a['fixture'] = remote(args.fixture_host, check, payload={'bundle': record['fixtureBundle'], 'parent': config['fixtureEvidenceParent'], 'head': config['manifest']['head']})
                if phase_a['fixture']['identity'] != {key: ready[key] for key in ['runId','host','pid','pgid']}:
                    raise ValueError('fixture closed identity mismatch')
            if 'fixture' not in phase_a:
                raise ValueError('fixture closed bundle missing')
        except BaseException as error:
            phase_a['failures'].append(repr(error)[:512])
        if owner_child is not None and not owner_child.stdin.closed:
            try:
                sequence = 0
                for slot, value in [('phaseA', phase_a), ('finalization', {'qualification': config['qualification'], 'phaseA': hashlib.sha256(encoded(phase_a)).hexdigest()})]:
                    for frame in frames(config['qualification'], slot, value, sequence):
                        send_bytes(owner_child.stdin, encoded(frame))
                        ack = bounded_line(owner_child.stdout)
                        if ack != {'event': 'ack', 'sequence': sequence}:
                            raise ValueError('ack mismatch')
                        sequence += 1
                bundle = bounded_line(owner_child.stdout, 30)
                if bundle.get('event') != 'owner-closed':
                    raise ValueError('missing owner closure')
                owner_child.stdin.close()
                collect(owner_child, timeout=12)
            except BaseException as error:
                record['failures'].append(repr(error)[:512])
            finally:
                if not owner_child.stdin.closed:
                    try:
                        owner_child.stdin.close()
                        collect(owner_child, timeout=80)
                    except BaseException as error:
                        record['failures'].append(repr(error)[:512])
        try:
            if owner_child is None or owner_child.poll() is None or owner_item is None or bundle is None:
                raise RuntimeError('owner cessation/bundle unknown; scratch retained')
            local_absent(local_registry[owner_child.pid])
            record['transports'][next(i for i,p in enumerate(record['transports']) if p['identity']['pid']==owner_child.pid)]['exitCode'] = owner_child.returncode
            remote_absence(args.app_host, [owner_item])
            if record.get('unknownCessation'):
                raise RuntimeError('unresolved native identity/lifetime; scratch retained')
            check = boot(args.app_repo, "import json;from host_gallery_evidence import validate_bundle; c=json.load(sys.stdin); v=validate_bundle(c['bundle'],parent=c['parent'],qualification=c['qualification'],source=c['source'],run=c['run'],owner=c['owner']); print(json.dumps({'validated':True,'primary':v['closure']['primary'],'status':v['closure']['status']}))", config['manifest'])
            validated = remote(args.app_host, check, payload={'bundle': bundle, 'parent': config['relayEvidenceParent'], 'qualification': config['qualification'], 'source': record['source'],'run':record['run'],'owner':owner_item})
            if validated['status'] != 'closed' or validated['primary'] or bundle['primary'] or phase_a['failures']:
                record['failures'].append('closed bundle records incomplete/failed qualification')
            for host in [args.fixture_host, args.app_host]:
                try:
                    entries = [p['identity'] for p in registry if p['host'] == host]
                    remote_absence(host, entries, fixture_ports if host == args.fixture_host else app_ports)
                    root = config['fixtureRepo'] if host == args.fixture_host else args.app_repo
                    code = boot(root, "import json,shutil,pathlib; c=json.load(sys.stdin); p=pathlib.Path(c['scratch']); assert p.is_dir() and not p.is_symlink(); i=p.stat(); assert {'dev':i.st_dev,'ino':i.st_ino}==c['identity']; shutil.rmtree(p); assert not p.exists(); print(json.dumps({'scratchAbsent':str(p)}))", config['manifest'])
                    record['cleanup'].append(remote(host, code, payload={'scratch': args.owned_root,'identity':scratch_registry[host]}))
                    check_host(host, root, '/usr/bin/node' if host == args.fixture_host else args.node,
                               config['fixtureEvidenceParent'] if host == args.fixture_host else config['relayEvidenceParent'])
                except BaseException as error:
                    record['failures'].append(repr(error)[:512])
            record['bundle'] = bundle
            record['ownerAbsent'] = True
        except BaseException as error:
            record['failures'].append(repr(error)[:512])
        try:
            source_check(config['localRepo'], config['manifest'])
        except BaseException as error:
            record['failures'].append(repr(error)[:512])
        record['primary'] = record['primary'] or (1 if record['failures'] else 0)
        if witness:
            try:
                record['witness'] = witness.finish({**record, 'terminal': 'passed' if record['primary'] == 0 else 'incomplete'})
            except BaseException as error:
                record['failures'].append(repr(error)[:512]); record['primary'] = record['primary'] or 1
        emit({'event': 'complete', 'qualification': config['qualification'], 'primary': record['primary'],
              'failures': record['failures'], 'witness': record.get('witness')})
    return record['primary']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['app-host', 'fixture-host', 'app-repo', 'node', 'owned-root', 'telemetry', 'witness-parent']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--runs', type=int, default=4, choices=range(1, 5))
    args = parser.parse_args()
    # Startup data fixes candidate/layout/parents. It is not a command or lock token.
    data = sys.stdin.buffer.read(DOCUMENT + 1)
    if len(data) > DOCUMENT:
        raise ValueError('startup document limit')
    config = json.loads(data)
    required = {'qualification', 'manifest', 'fixtureRepo', 'fixtureEvidenceParent', 'relayEvidenceParent', 'localRepo', 'localNode', 'localScratchParent'}
    if set(config) != required:
        raise ValueError('startup schema')
    def cancelled(signum, _frame):
        raise RuntimeError('Qualification cancelled: ' + str(signum))
    for sig in [signal.SIGINT, signal.SIGTERM]:
        signal.signal(sig, cancelled)
    return outer(args, config)


if __name__ == '__main__':
    raise SystemExit(main())
