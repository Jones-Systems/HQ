'use strict';

const PRODUCT = Object.freeze({ name: 'hq', productName: 'HQ', bundleId: 'org.jones-systems.hq.local' });
const SYNTHETIC = Object.freeze({ name: 'hq-updater-test', productName: 'HQ Updater Test', bundleId: 'org.jones-systems.hq.updater-test' });
const WORKFLOW = '.github/workflows/hq-desktop-package.yml';
const REPOSITORY = Object.freeze({ name: 'Jones-Systems/HQ', id: 1426280211, ownerId: 320115260 });
const LIMITS = Object.freeze({ archive: 1024 ** 3, expanded: 3 * 1024 ** 3, entries: 100000 });
const ELECTRON_VERSION = '44.9.0';

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label}`);
  return value;
}

function buildReceipt({ sourceSha, sourceTree, version, buildSequence, channel, compatibilityEpoch, architecture, synthetic = false }) {
  if (![sourceSha, sourceTree].every(value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value))) throw new Error('Invalid source identity');
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid package version');
  if (!['preview', 'stable'].includes(channel) || !['arm64', 'x64'].includes(architecture)) throw new Error('Invalid package target');
  if (typeof compatibilityEpoch !== 'string' || !/^hq1-[a-f0-9]{64}$/.test(compatibilityEpoch)) throw new Error('Invalid compatibility epoch');
  const identity = synthetic ? SYNTHETIC : PRODUCT;
  return { schemaVersion: 1, product: 'hq', version, buildSequence: positiveInteger(buildSequence, 'build sequence'), sourceSha, sourceTree, channel, compatibilityEpoch, electronVersion: ELECTRON_VERSION, appName: identity.productName, bundleId: identity.bundleId, architecture };
}

module.exports = { PRODUCT, SYNTHETIC, WORKFLOW, REPOSITORY, LIMITS, ELECTRON_VERSION, positiveInteger, buildReceipt };
