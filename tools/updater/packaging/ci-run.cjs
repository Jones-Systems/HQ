'use strict';

const os = require('node:os');
const { spawn } = require('node:child_process');

function snapshot() {
  const cpus = os.cpus();
  return { count: cpus.length, idle: cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0), total: cpus.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0) };
}

async function run(argv) {
  if (!argv.length) throw new Error('A direct command and argument vector are required');
  let compilerJobs;
  // Resample only before spawn: a started command may have effects and is never retried.
  for (let attempt = 1; attempt <= 10; attempt++) {
    const before = snapshot();
    await new Promise(resolve => setTimeout(resolve, 1000));
    const after = snapshot();
    const elapsed = after.total - before.total;
    const cpuUsed = elapsed > 0 ? 100 * (1 - (after.idle - before.idle) / elapsed) : null;
    const availableLowerBound = os.freemem();
    const evidenceAvailable = Number.isFinite(cpuUsed) && cpuUsed >= 0 && cpuUsed <= 100 && before.count === after.count && after.count > 0 && Number.isSafeInteger(availableLowerBound) && availableLowerBound > 0;
    const admitted = evidenceAvailable && cpuUsed < 85;
    compilerJobs = Math.min(6, after.count);
    process.stdout.write(`${JSON.stringify({ cpuUsedPercent: cpuUsed, logicalCores: after.count, oneCoreHostSharePercent: 100 / after.count, memoryAvailableLowerBoundBytes: availableLowerBound, memoryTotalBytes: os.totalmem(), starts: admitted ? 1 : 0, compilerJobs, command: argv, attempt })}\n`);
    if (admitted) break;
    if (!evidenceAvailable || attempt === 10) throw new Error('CI command held: CPU must be below 85% and current memory/core evidence must be available');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  const env = { ...process.env, CMAKE_BUILD_PARALLEL_LEVEL: String(compilerJobs), CARGO_BUILD_JOBS: String(compilerJobs), GOMAXPROCS: String(compilerJobs), UV_THREADPOOL_SIZE: String(compilerJobs), npm_config_jobs: String(compilerJobs), MAKEFLAGS: `-j${compilerJobs}` };
  const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env });
  const forward = signal => { if (child.exitCode === null) child.kill(signal); };
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    return result.code ?? (result.signal === 'SIGINT' ? 130 : 143);
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}

if (require.main === module) run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { run };
