'use strict';

const { createTransaction } = require('./transaction.cjs');
const { ensure, validateInstallation, recordPath, sameProcess } = require('./contract.cjs');

async function runHelper({ record, operationId, adapters = {} }) {
  record = validateInstallation(record);
  const engine = createTransaction(adapters);
  const { state, native } = engine;
  const sleep = adapters.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const now = adapters.clock ?? Date.now;
  const self = await native.identity();
  let journal = await engine.read(record);
  ensure(journal && journal.operationId === operationId, 'Helper operation differs.', 'stale-candidate');
  ensure(self.executable === native.runtimePath(journal.candidate.bundlePath, journal.candidate.manifest), 'Helper must use the retained candidate runtime.', 'recovery-required');
  await native.verifyBundle(journal.candidate.bundlePath, require('./contract.cjs').receiptOf(journal.candidate.manifest));
  const exitDeadline = now() + 30000;
  while (journal.initiating && !['dead', 'stale'].includes(await native.observe(journal.initiating))) {
    if (now() >= exitDeadline) return state.withGate(record, self, async () => engine.hold(record, await engine.read(record), 'live-process'));
    await sleep(100);
  }
  journal = await state.withGate(record, self, async () => {
    let current = await engine.read(record);
    ensure(current.operationId === operationId, 'Helper operation changed.', 'stale-candidate');
    const phase = current.resumeState ?? current.state;
    if (['committed', 'restored'].includes(phase)) return current;
    if (phase === 'awaiting-health' && current.launchAttempted) return engine.recover(record, self, { operationId, expectedSequence: current.sequence });
    current = await engine.activate(record, self);
    if (current.state === 'awaiting-health' && !current.launchAttempted) return engine.requestLaunch(record, current, self);
    return current;
  });
  while (journal.state === 'awaiting-health') {
    await sleep(200);
    journal = await state.withGate(record, self, async () => {
      const current = await engine.read(record);
      ensure(current.operationId === operationId && sameProcess(current.helper, self), 'Helper ownership changed.', 'recovery-required');
      const healthy = await engine.reconcileHealth(record, current);
      if (healthy) return healthy.journal;
      if (current.launch) {
        const evidence = await native.observe(current.launch);
        if (evidence === 'dead' || evidence === 'stale') return engine.recover(record, self, { operationId, expectedSequence: current.sequence });
      }
      if (now() >= current.deadline) return engine.recover(record, self, { operationId, expectedSequence: current.sequence, timeout: true });
      return current;
    });
  }
  return journal;
}
async function cli(argv = process.argv.slice(2)) {
  ensure(argv.length === 4 && argv[0] === '--record' && argv[2] === '--operation', 'Expected an exact helper record and operation.');
  const { readJson } = require('./contract.cjs');
  const record = validateInstallation(await readJson(argv[1]));
  ensure(recordPath(record.targetPath) === argv[1], 'Unexpected installation record location.');
  return runHelper({ record, operationId: argv[3] });
}
if (require.main === module) cli().catch(error => { process.stderr.write(`HQ updater held (${error.code ?? 'recovery-required'}). Inspect the installation record before retry.\n`); process.exitCode = 1; });
module.exports = { runHelper, cli };
