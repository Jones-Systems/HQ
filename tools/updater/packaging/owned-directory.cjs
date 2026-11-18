'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function withOwnedDirectory(parent, prefix, action, { remove = fs.rmSync, signals = process } = {}) {
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  let failure;
  const cleanup = async () => { await remove(root, { recursive: true, force: true }); if (fs.existsSync(root)) throw new Error('Owned scratch cleanup did not complete'); };
  const onSignal = async signal => {
    try { await cleanup(); } catch (error) { process.stderr.write(`Scratch cleanup failed: ${error.message}\n`); }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const interrupt = () => onSignal('SIGINT'), terminate = () => onSignal('SIGTERM');
  signals.once('SIGINT', interrupt); signals.once('SIGTERM', terminate);
  try { return await action(root); }
  catch (error) { failure = error; throw error; }
  finally {
    signals.removeListener('SIGINT', interrupt); signals.removeListener('SIGTERM', terminate);
    try { await cleanup(); } catch (error) { if (!failure) throw error; process.stderr.write(`Scratch cleanup failed after original failure: ${error.message}\n`); }
  }
}

module.exports = { withOwnedDirectory };
