'use strict';

const fs = require('node:fs');
const path = require('node:path');

const INPUT_LIMIT = 64 * 1024, AGGREGATE_LIMIT = 32 * 1024;
const STATES = ['prepared', 'staged', 'prior-retained', 'replacement-installed', 'awaiting-health', 'committed', 'restored', 'held'];
const REASONS = ['live-process', 'unknown-process', 'unknown-effect', 'health-timeout', 'incompatible-recovery', 'unexpected-identity'];
const STAGES = Object.freeze({
  helper: ['entered', 'completed', 'error'],
  bootstrap: ['entered', 'import-main', 'completed', 'error'],
  main: ['entered', 'main-ready', 'renderer-ready', 'renderer-error', 'healthy', 'failed-health', 'watchdog', 'error'],
});
const CATEGORIES = ['wait-timeout', 'subprocess-exit', 'assertion', 'invalid', 'unavailable', 'incompatible', 'recovery-required', 'busy', 'stale-candidate', 'other-error'];
const unavailable = reason => ({ status: 'unavailable', reason });
function category(error) {
  if (CATEGORIES.includes(error?.diagnosticCategory)) return error.diagnosticCategory;
  if (error?.code === 'ERR_ASSERTION') return 'assertion';
  return CATEGORIES.includes(error?.code) ? error.code : 'other-error';
}
function inside(root, file) { return file !== root && !path.relative(root, file).startsWith('..' + path.sep) && path.relative(root, file) !== '..' && !path.isAbsolute(path.relative(root, file)); }
function directories(root, file) {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || !inside(root, file)) throw new Error('Unsafe diagnostic containment');
  const owned = fs.lstatSync(root);
  if (!owned.isDirectory() || owned.isSymbolicLink() || owned.uid !== process.getuid()) throw new Error('Unsafe diagnostic root');
  const identities = [];
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe diagnostic ancestor');
    identities.push([directory, stat.dev, stat.ino]);
    if (directory === path.dirname(directory)) break;
  }
  return () => {
    for (const [directory, dev, ino] of identities) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== dev || stat.ino !== ino) throw new Error('Diagnostic ancestor changed');
    }
  };
}
function readKnown(root, file, project, budget = { remaining: AGGREGATE_LIMIT }) {
  let fd;
  try {
    const recheck = directories(root, file);
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.uid !== process.getuid() || before.nlink !== 1) return unavailable('unsafe-file');
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > INPUT_LIMIT) return unavailable('input-limit');
    if (before.size > budget.remaining) return unavailable('aggregate-limit');
    budget.remaining -= before.size;
    const bytes = Buffer.alloc(before.size);
    let at = 0;
    while (at < bytes.length) {
      const count = fs.readSync(fd, bytes, at, bytes.length - at, at);
      if (!count) return unavailable('changed');
      at += count;
    }
    const after = fs.fstatSync(fd), named = fs.lstatSync(file);
    recheck();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || named.dev !== before.dev || named.ino !== before.ino || named.isSymbolicLink()) return unavailable('changed');
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable('malformed');
    return { status: 'available', ...project(value) };
  } catch (error) { return unavailable(error.code === 'ENOENT' ? 'missing' : 'unsafe-or-malformed'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function selected(value, values) { if (!values.includes(value)) throw new Error('Invalid diagnostic enum'); return value; }
function boolean(value) { if (typeof value !== 'boolean') throw new Error('Invalid diagnostic flag'); return value; }
function sequence(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid diagnostic sequence'); return value; }
function presence(value) { if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid diagnostic presence'); return value !== null; }
function projectJournal(value) {
  return {
    state: selected(value.state, STATES), sequence: sequence(value.sequence),
    resumeState: value.resumeState === null ? null : selected(value.resumeState, STATES),
    reason: value.reason === null ? null : selected(value.reason, REASONS),
    launchPresent: presence(value.launch), helperPresent: presence(value.helper),
    launchAttempted: boolean(value.launchAttempted), profileOpened: boolean(value.profileOpened),
    healthPresent: presence(value.health),
  };
}
function exclusiveJson(root, file, value) {
  const recheck = directories(root, file), bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > AGGREGATE_LIMIT) throw new Error('Diagnostic output limit');
  const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    const stat = fs.fstatSync(fd), check = Buffer.alloc(bytes.length);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || stat.size !== bytes.length || fs.readSync(fd, check, 0, check.length, 0) !== check.length || !check.equals(bytes)) throw new Error('Diagnostic persistence unknown');
    recheck();
    const named = fs.lstatSync(file);
    if (named.isSymbolicLink() || named.ino !== stat.ino || named.dev !== stat.dev) throw new Error('Diagnostic output changed');
  } finally { fs.closeSync(fd); }
  const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
function fixtureName(role, buildSequence, stage) {
  selected(role, Object.keys(STAGES)); sequence(buildSequence); selected(stage, STAGES[role]);
  return 'diagnostic-' + role + '-' + buildSequence + '-' + stage + '.json';
}
function fixtureReporter(directory, role) {
  const binding = readKnown(directory, path.join(directory, 'diagnostic-binding.json'), value => {
    sequence(value.buildSequence);
    if (!['lifecycle', 'failed-health'].some(name => value.stateRoot === path.join(value.runRoot, name, 'state'))) throw new Error('Invalid fixture diagnostic binding');
    directories(value.runRoot, path.join(value.stateRoot, 'probe'));
    return { runRoot: value.runRoot, stateRoot: value.stateRoot, buildSequence: value.buildSequence };
  });
  return (stage, error) => {
    try {
      if (binding.status !== 'available') return false;
      exclusiveJson(binding.runRoot, path.join(binding.stateRoot, fixtureName(role, binding.buildSequence, stage)), { stage, category: error ? category(error) : null });
      return true;
    } catch { return false; }
  };
}
function captureFailure({ output, root, production, archive, active, handoff, error }) {
  if (!/^[a-f0-9]{40}$/.test(production.sourceSha) || !/^[a-f0-9]{40}$/.test(production.sourceTree) || !['arm64', 'x64'].includes(production.architecture) || !/^[a-f0-9]{64}$/.test(archive.sha256)) throw new Error('Missing diagnostic source binding');
  const metrics = { sha256: archive.sha256 };
  for (const key of ['size', 'expandedSize', 'fileCount']) {
    if (!Number.isSafeInteger(archive[key]) || archive[key] < 0) throw new Error('Invalid diagnostic archive binding');
    metrics[key] = archive[key];
  }
  const budget = { remaining: AGGREGATE_LIMIT };
  const snapshot = {
    schemaVersion: 1, phase: 'primary-before-drain', sourceSha: production.sourceSha,
    sourceTree: production.sourceTree, architecture: production.architecture, archive: metrics,
    failureCategory: category(error), scenario: 'unavailable', journey: 'unavailable', buildSequence: null,
    handoff: handoff ? { status: selected(handoff.status, ['started', 'exited', 'spawn-error']), code: Number.isSafeInteger(handoff.code) ? handoff.code : null, stderrObserved: handoff.stderrObserved === true } : unavailable('not-started'),
    journal: unavailable('not-started'), health: unavailable('not-started'), fixtureHealth: unavailable('not-started'), milestones: {},
  };
  if (active) {
    snapshot.scenario = selected(active.scenario, ['lifecycle', 'failed-health']);
    snapshot.journey = selected(active.journey, ['fresh', 'next-launch', 'interrupted-recovery', 'failed-health']);
    snapshot.buildSequence = sequence(active.buildSequence);
    const stateRoot = path.join(root, snapshot.scenario, 'state');
    if (stateRoot !== active.stateRoot) throw new Error('Invalid active diagnostic binding');
    snapshot.journal = readKnown(root, path.join(stateRoot, 'transaction.json'), projectJournal, budget);
    snapshot.health = readKnown(root, path.join(stateRoot, 'health.json'), value => ({ main: boolean(value.main), renderer: boolean(value.renderer) }), budget);
    snapshot.fixtureHealth = readKnown(root, path.join(stateRoot, 'smoke-' + snapshot.buildSequence + '.json'), value => ({ healthy: boolean(value.healthy) }), budget);
    for (const [role, stages] of Object.entries(STAGES)) for (const stage of stages) {
      const name = fixtureName(role, snapshot.buildSequence, stage);
      snapshot.milestones[role + ':' + stage] = readKnown(root, path.join(stateRoot, name), value => ({
        stage: selected(value.stage, [stage]), category: value.category === null ? null : selected(value.category, CATEGORIES),
      }), budget);
    }
  }
  exclusiveJson(output, path.join(output, 'native-smoke-primary-failure.json'), snapshot);
  return snapshot;
}
module.exports = { captureFailure, fixtureReporter, readKnown, projectJournal, category, STAGES };
