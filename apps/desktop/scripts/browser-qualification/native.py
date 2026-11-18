import ctypes as C
import hashlib, json, os, pathlib, shutil, subprocess, sys, time, traceback
from datetime import datetime, timezone

def emit_json(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def hosted_root(value):
    assert os.environ.get('GITHUB_ACTIONS') == 'true', 'GitHub-only qualification'
    assert os.environ.get('GITHUB_REPOSITORY') == 'Jones-Systems/HQ'
    run_id, attempt = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
    assert run_id.isdecimal() and attempt.isdecimal()
    parent = pathlib.Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    expected = parent / ('hq-browser-' + run_id + '-' + attempt)
    assert pathlib.Path(value) == expected and not expected.is_symlink()
    return expected


def write_json(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def cpu_sample():
    def read():
        values = [int(v) for v in pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
        return sum(values), values[3] + values[4]
    before = read()
    time.sleep(1)
    after = read()
    total = after[0] - before[0]
    assert total > 0
    return 100 * (1 - (after[1] - before[1]) / total)


def disk_backed(path):
    matches = []
    for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():
        left, right = line.split(' - ', 1)
        mount = pathlib.Path(left.split()[4].replace('\\040', ' '))
        if path == mount or mount in path.parents:
            matches.append((len(str(mount)), right.split()[0]))
    assert matches
    return max(matches)[1] not in ('tmpfs', 'ramfs')


def admission(root, phase):
    workspace = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    memory = dict(line.split(':', 1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
    available_ram = int(memory['MemAvailable'].split()[0]) * 1024
    cpu = cpu_sample()
    peak, reserve = 5 * 1024**3, 2 * 1024**3
    filesystems = {}
    for role, path in [('scratch', root), ('checkout', workspace)]:
        device = path.stat().st_dev
        stat = os.statvfs(path)
        free = stat.f_bavail * stat.f_frsize
        if device not in filesystems:
            filesystems[device] = {'roles': [], 'availableBytes': free, 'diskBacked': disk_backed(path)}
        filesystems[device]['roles'].append(role)
    binaries = ['/usr/bin/bwrap', '/usr/bin/chromium', sys.executable, '/usr/bin/xvfb-run', '/usr/bin/Xvfb', '/usr/bin/xauth']
    tools = {pathlib.Path(p).name: os.access(p, os.X_OK) for p in binaries}
    libraries = {name: pathlib.Path('/usr/lib/x86_64-linux-gnu/' + name).is_file() for name in ['libX11.so.6', 'libXtst.so.6']}
    namespace = False
    if tools['bwrap']:
        try:
            probe = subprocess.run(['/usr/bin/bwrap', '--die-with-parent', '--unshare-user', '--unshare-pid',
                                    '--ro-bind', '/', '/', '--proc', '/proc', '/usr/bin/true'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            namespace = probe.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            pass
    holds = []
    if sys.version_info[:3] != (3, 13, 5): holds.append('python-version')
    if cpu >= 85: holds.append('cpu-admission')
    if available_ram < 2 * 1024**3: holds.append('memory-admission')
    if any(f['availableBytes'] < peak + reserve or not f['diskBacked'] for f in filesystems.values()): holds.append('disk-admission')
    if not all(tools.values()) or not all(libraries.values()): holds.append('preinstalled-tools')
    if not namespace: holds.append('user-pid-namespaces')
    result = {'schema': 'hq-browser-admission/v1', 'observedAt': datetime.now(timezone.utc).isoformat(),
              'pythonVersion': '.'.join(map(str, sys.version_info[:3])), 'phase': phase, 'outcome': 'held' if holds else 'admitted', 'heldConditions': holds,
              'cpuWholeHostPercent': round(cpu, 2), 'logicalCores': os.cpu_count(),
              'oneCoreWholeHostPercent': 100 / os.cpu_count(), 'availableRamBytes': available_ram,
              'estimatedAdditionalPeakBytes': peak, 'reserveBytes': reserve,
              'filesystems': list(filesystems.values()), 'preinstalledTools': tools,
              'libraries': libraries, 'userPidNamespaces': namespace, 'serialTestProcesses': 0 if holds else 1}
    write_json(root / ('admission-' + phase + '.json'), result)
    emit_json({'phase': phase, 'outcome': result['outcome'], 'heldConditions': holds})
    return 1 if holds else 0


def remove_owned(path):
    if not path.exists() and not path.is_symlink(): return
    assert not path.is_symlink(), 'Cleanup root became a symlink'
    if path.is_dir():
        # Sealed bundle directories are read-only; only this invocation's exact tree is made removable.
        for current, directories, files in os.walk(path, followlinks=False):
            current_path = pathlib.Path(current)
            current_path.chmod(0o700)
        shutil.rmtree(path)
    else:
        path.unlink()
    assert not path.exists()


if len(sys.argv) > 1 and sys.argv[1] in ('--prepare', '--admit', '--finalize'):
    mode = sys.argv[1]
    root = hosted_root(sys.argv[2])
    workspace = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    owner = {'runId': os.environ['GITHUB_RUN_ID'], 'attempt': os.environ['GITHUB_RUN_ATTEMPT'],
             'revision': os.environ['GITHUB_SHA']}
    if mode == '--prepare':
        for path in [workspace / 'node_modules', workspace / 'apps/desktop/dist', workspace / 'apps/desktop/dist-electron']:
            assert not path.exists() and not path.is_symlink(), 'Fresh hosted checkout required'
        root.mkdir(mode=0o700)
        write_json(root / 'owner.json', owner)
        sys.exit(admission(root, 'prepare'))
    assert json.loads((root / 'owner.json').read_text()) == owner
    if mode == '--admit':
        assert sys.argv[3] in ('install', 'build', 'production', 'bundle', 'browser')
        sys.exit(admission(root, sys.argv[3]))
    phase, original_status = sys.argv[3], int(sys.argv[4])
    assert phase in ('prepare', 'install', 'build', 'production', 'bundle', 'browser', 'complete')
    admissions = [json.loads(p.read_text()) for p in root.glob('admission-*.json')]
    if not (root / 'evidence/report.json').exists():
        (root / 'evidence').mkdir(exist_ok=True)
        inputs = {role: hashlib.sha256((workspace / path).read_bytes()).hexdigest() for role, path in {
            'runner': 'apps/desktop/scripts/browser-qualification/run.mjs',
            'native': 'apps/desktop/scripts/browser-qualification/native.py',
            'runtime': 'tests/acceptance/runtime.mjs',
            'builder': 'apps/desktop/scripts/build-browser-preview.mjs',
            'workflow': '.github/workflows/hq-browser-qualification.yml'}.items()}
        write_json(root / 'evidence/report.json', {'schema': 'hq-browser-qualification/v1', **owner,
            'outcome': 'held' if any(a['outcome'] == 'held' for a in admissions) else 'fail',
            'firstFailure': phase, 'heldConditions': [h for a in admissions for h in a['heldConditions']],
            'placement': {'served': 'unavailable', 'rendered': 'unavailable'}, 'inputs': inputs,
            'steps': [], 'journeys': [{'id': journey, 'outcome': 'not-run'} for journey in [
                'identity', 'linux-runtime', 'default-1280-light', 'default-1280-dark', 'default-760-light', 'default-760-dark',
                'rail-pointer-keyboard', 'work-create-edit', 'domain-retention', 'peer-edit', 'reset-isolation',
                'native-only-unavailable', 'empty-1280-light', 'empty-1280-dark', 'empty-760-light', 'empty-760-dark',
                'storage-untouched', 'forbidden-egress', 'browser-zoom-200']],
            'job': os.environ['GITHUB_JOB'], 'event': os.environ['GITHUB_EVENT_NAME']})
        write_json(root / 'evidence/hashes.json', {'schema': 'hq-browser-qualification-hashes/v1',
            **owner, 'inputs': inputs, 'reportSha256': hashlib.sha256((root / 'evidence/report.json').read_bytes()).hexdigest()})
    removed, failed = [], []
    targets = {'sealed-bundle': root / 'bundle', 'runner-scratch': root / 'evidence/.scratch',
               'npm-cache': root / 'npm-cache', 'temporary-files': root / 'tmp',
               'build-log': root / 'build.log', 'dependencies': workspace / 'node_modules',
               'renderer': workspace / 'apps/desktop/dist', 'electron': workspace / 'apps/desktop/dist-electron'}
    for role, path in targets.items():
        try:
            remove_owned(path)
            removed.append(role)
        except Exception:
            failed.append(role)
    qualification = json.loads((root / 'evidence/report.json').read_text())['outcome']
    if not (root / 'evidence/hashes.json').exists():
        write_json(root / 'evidence/hashes.json', {'schema': 'hq-browser-qualification-hashes/v1', **owner,
            'reportSha256': hashlib.sha256((root / 'evidence/report.json').read_bytes()).hexdigest()})
    status = original_status or (1 if failed or qualification != 'pass' else 0)
    admissions = [json.loads(p.read_text()) for p in root.glob('admission-*.json')]
    receipt = {'schema': 'hq-browser-hosted-cleanup/v1', **owner, 'phase': phase,
               'originalStatus': original_status, 'finalStatus': status,
               'outcome': 'held' if qualification == 'held' or any(a['outcome'] == 'held' for a in admissions) else 'fail' if status else 'pass',
               'qualificationOutcome': qualification,
               'removed': removed, 'failed': failed, 'finishedAt': datetime.now(timezone.utc).isoformat(),
               'placement': 'github-hosted', 'job': os.environ['GITHUB_JOB'],
               'publicArtifacts': 'sanitized synthetic receipts and hashes only'}
    write_json(root / 'cleanup.json', receipt)
    emit_json(receipt)
    sys.exit(status)

# This helper opens only the explicit task display passed by owned xvfb-run.
root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
expected_display = sys.argv[3]
assert os.environ.get('DISPLAY') == expected_display
assert os.environ.get('XAUTHORITY') == str(root / 'Xauthority')
assert root.is_dir() and out.is_dir()
os.umask(0o077)
X = C.CDLL('/usr/lib/x86_64-linux-gnu/libX11.so.6')
T = C.CDLL('/usr/lib/x86_64-linux-gnu/libXtst.so.6')
D = C.c_void_p
U = C.c_ulong
I = C.c_int
P = C.POINTER
def bind(lib, name, args, result):
    f = getattr(lib, name); f.argtypes = args; f.restype = result; return f
bind(X,'XOpenDisplay',[C.c_char_p],D)
bind(X,'XCloseDisplay',[D],I)
bind(X,'XDefaultRootWindow',[D],U)
bind(X,'XInternAtom',[D,C.c_char_p,I],U)
bind(X,'XGetWindowProperty',[D,U,U,C.c_long,C.c_long,I,U,P(U),P(I),P(U),P(U),P(P(C.c_ubyte))],I)
bind(X,'XQueryTree',[D,U,P(U),P(U),P(P(U)),P(C.c_uint)],I)
bind(X,'XFree',[D],I)
bind(X,'XSync',[D,I],I)
bind(X,'XRaiseWindow',[D,U],I)
bind(X,'XSetInputFocus',[D,U,I,U],I)
bind(X,'XGetInputFocus',[D,P(U),P(I)],I)
bind(X,'XStringToKeysym',[C.c_char_p],U)
bind(X,'XKeysymToKeycode',[D,U],C.c_ubyte)
bind(X,'XGetKeyboardMapping',[D,C.c_ubyte,I,P(I)],P(U))
bind(T,'XTestQueryExtension',[D,P(I),P(I),P(I),P(I)],I)
bind(T,'XTestFakeKeyEvent',[D,C.c_uint,I,U],I)
class Attributes(C.Structure):
    _fields_=[('x',I),('y',I),('width',I),('height',I),('border_width',I),('depth',I),('visual',D),('root',U),('class_',I),('bit_gravity',I),('win_gravity',I),('backing_store',I),('backing_planes',U),('backing_pixel',U),('save_under',I),('colormap',U),('map_installed',I),('map_state',I),('all_event_masks',C.c_long),('your_event_mask',C.c_long),('do_not_propagate_mask',C.c_long),('override_redirect',I),('screen',D)]
bind(X,'XGetWindowAttributes',[D,U,P(Attributes)],I)
class Modifiers(C.Structure):
    _fields_=[('max_keypermod',I),('modifiermap',P(C.c_ubyte))]
bind(X,'XGetModifierMapping',[D],P(Modifiers))
bind(X,'XFreeModifiermap',[P(Modifiers)],I)

# Negative authentication control is a child with the same owned display and an empty owned authority file.
empty_auth = root / 'empty-authority'
empty_auth.write_bytes(b'')
empty_auth.chmod(0o600)
auth_code="import ctypes as c,os; x=c.CDLL('/usr/lib/x86_64-linux-gnu/libX11.so.6'); x.XOpenDisplay.argtypes=[c.c_char_p]; x.XOpenDisplay.restype=c.c_void_p; p=x.XOpenDisplay(os.environ['DISPLAY'].encode()); print('opened' if p else 'rejected'); raise SystemExit(1 if p else 0)"
negative = subprocess.run([sys.executable,'-c',auth_code],env={**os.environ,'XAUTHORITY':str(empty_auth)},capture_output=True,text=True,timeout=5)
assert negative.returncode == 0 and negative.stdout.strip() == 'rejected', 'Unauthenticated X connection was not rejected'
display = X.XOpenDisplay(expected_display.encode())
assert display, 'Authenticated owned X connection failed'
browser = None
pressed = []
window = None
root_window = X.XDefaultRootWindow(display)
def prop(w, name):
    actual=U(); fmt=I(); n=U(); remain=U(); data=P(C.c_ubyte)()
    atom=X.XInternAtom(display,name.encode(),0)
    result=X.XGetWindowProperty(display,w,atom,0,4096,0,0,C.byref(actual),C.byref(fmt),C.byref(n),C.byref(remain),C.byref(data))
    assert result == 0, 'XGetWindowProperty failed'
    try:
        if not data: return None
        if fmt.value == 32: return [C.cast(data,P(U))[i] for i in range(n.value)]
        if fmt.value == 8: return bytes(data[:n.value]).decode('utf-8','replace')
        return None
    finally:
        if data: X.XFree(data)
def children(w):
    rr=U(); parent=U(); values=P(U)(); n=C.c_uint()
    assert X.XQueryTree(display,w,C.byref(rr),C.byref(parent),C.byref(values),C.byref(n))
    try: return [values[i] for i in range(n.value)]
    finally:
        if values: X.XFree(values)
def geometry(w):
    a=Attributes()
    assert X.XGetWindowAttributes(display,w,C.byref(a))
    return {k:getattr(a,k) for k in ('x','y','width','height','border_width','depth','map_state')}
def resolve_key(name):
    sym=X.XStringToKeysym(name.encode()); code=X.XKeysymToKeycode(display,sym)
    assert sym and code, 'Unmapped keysym '+name
    count=I(); data=X.XGetKeyboardMapping(display,code,1,C.byref(count))
    try: values=[int(data[i]) for i in range(count.value)]
    finally: X.XFree(data)
    level=values.index(sym)
    assert level in (0,1), 'Unsupported native key level '+name
    return {'name':name,'keysym':int(sym),'keycode':int(code),'level':level,'mapping':values}
keys={n:resolve_key(n) for n in ('Control_L','Shift_L','plus','0')}
assert keys['Control_L']['level'] == keys['Shift_L']['level'] == 0
mods=X.XGetModifierMapping(display)
try:
    modifier_map={str(i):[int(mods.contents.modifiermap[i*mods.contents.max_keypermod+j]) for j in range(mods.contents.max_keypermod)] for i in range(8)}
finally: X.XFreeModifiermap(mods)
assert keys['Control_L']['keycode'] in modifier_map['2']
assert keys['Shift_L']['keycode'] in modifier_map['0']
eb=I(); err=I(); major=I(); minor=I()
assert T.XTestQueryExtension(display,C.byref(eb),C.byref(err),C.byref(major),C.byref(minor)), 'XTest unavailable'
def focus():
    assert window is not None
    assert prop(window,'_NET_WM_PID') == [browser.pid], 'Window ownership changed'
    assert geometry(window)['map_state'] == 2, 'Owned window is not viewable'
    X.XRaiseWindow(display,window)
    X.XSetInputFocus(display,window,2,0)
    X.XSync(display,0)
    got=U(); revert=I()
    X.XGetInputFocus(display,C.byref(got),C.byref(revert))
    assert got.value == window, 'Owned window focus not established'
    return {'window':int(got.value),'revert':revert.value}
def snapshot():
    return {'window':int(window),'ownerPid':prop(window,'_NET_WM_PID'),'wmClass':prop(window,'WM_CLASS'),'name':prop(window,'_NET_WM_NAME'),'geometry':geometry(window),'focus':focus()}
def chord(name):
    item=keys[name]
    codes=[keys['Control_L']['keycode']]
    if item['level'] == 1: codes.append(keys['Shift_L']['keycode'])
    codes.append(item['keycode'])
    readback=focus()
    try:
        for code in codes:
            assert T.XTestFakeKeyEvent(display,code,1,0)
            pressed.append(code); X.XSync(display,0); time.sleep(0.04)
        for code in reversed(codes):
            assert T.XTestFakeKeyEvent(display,code,0,0)
            pressed.remove(code); X.XSync(display,0); time.sleep(0.04)
    finally:
        for code in reversed(pressed): T.XTestFakeKeyEvent(display,code,0,0)
        pressed.clear(); X.XSync(display,0)
    return {'key':name,'codes':codes,'allReleased':not pressed,'focus':readback,'snapshot':snapshot()}
def emit(value):
    print(json.dumps(value,separators=(',',':')),flush=True)
def own_processes():
    rows=[]
    for p in pathlib.Path('/proc').iterdir():
        if not p.name.isdecimal(): continue
        try:
            stat=(p/'stat').read_text(); rest=stat[stat.rfind(')')+2:].split()
            rows.append({'pid':int(p.name),'ppid':int(rest[1]),'pgrp':int(rest[2]),'startTicks':rest[19]})
        except FileNotFoundError: pass
    return rows
try:
    args=json.loads((out/'chromium-args.json').read_text())
    log=open(root/'chromium.stderr','wb')
    browser=subprocess.Popen(['/usr/bin/chromium',*args],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=log,env=os.environ.copy())
    emit({'event':'ready','pid':os.getpid(),'browserPid':browser.pid,'display':expected_display,'authority':str(root/'Xauthority'),'authorityMode':oct((root/'Xauthority').stat().st_mode & 0o777),'authentication':{'withoutCookie':'rejected','stderr':negative.stderr.strip(),'withCookie':'opened'},'xtest':{'major':major.value,'minor':minor.value},'keys':keys,'modifiers':modifier_map})
    for line in sys.stdin:
        request=json.loads(line)
        try:
            action=request['action']
            if action == 'identify':
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    assert browser.poll() is None, 'Owned Chromium stopped'
                    matches=[]
                    for candidate in children(root_window):
                        if prop(candidate,'_NET_WM_PID') != [browser.pid]: continue
                        cls=prop(candidate,'WM_CLASS') or ''
                        geom=geometry(candidate)
                        if 'chromium' in cls.lower() and geom['map_state']==2 and geom['width']>=760 and geom['height']>=500:
                            matches.append(candidate)
                    assert len(matches)<=1, 'Ambiguous owned Chromium windows'
                    if matches: window=matches[0]; break
                    time.sleep(0.1)
                assert window is not None, 'No owned Chromium window'
                value=snapshot()
            elif action == 'snapshot': value=snapshot()
            elif action == 'chord':
                assert request['key'] in ('0','plus')
                value=chord(request['key'])
            elif action == 'processes': value=own_processes()
            elif action == 'stop':
                emit({'id':request['id'],'ok':True,'value':{'stopping':True}}); break
            else: raise AssertionError('Unsupported action')
            emit({'id':request['id'],'ok':True,'value':value})
        except Exception:
            emit({'id':request.get('id'),'ok':False,'error':traceback.format_exc()}); break
finally:
    for code in reversed(pressed): T.XTestFakeKeyEvent(display,code,0,0)
    X.XSync(display,0)
    X.XCloseDisplay(display)
    if browser is not None:
        if browser.poll() is None:
            browser.terminate()
            try: browser.wait(timeout=4)
            except subprocess.TimeoutExpired:
                browser.kill(); browser.wait(timeout=3)
        log.close()
        emit({'event':'stopped','browserReturnCode':browser.returncode})
