'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { SYNTHETIC, buildReceipt } = require('./identity.cjs');
const { manifestFor } = require('./package.cjs');
const { candidateId, validateInstallation } = require('../contract.cjs');

function scenarioPlan(root, production, archive) {
  const scenario = (name, journeys) => {
    const directory = path.join(root, name);
    const stateRoot = path.join(directory, 'state');
    const steps = journeys.map(([journey, sequenceOffset], index) => {
      const receipt = buildReceipt({ ...production, buildSequence: production.buildSequence + sequenceOffset, synthetic: true });
      const manifest = manifestFor(receipt, archive, { releaseTag: `hq-desktop-synthetic-${receipt.buildSequence}`, runId: String(receipt.buildSequence), runAttempt: 1, event: 'push', publishedAt: '2026-10-22T00:00:00.000Z' });
      const candidate = { schemaVersion: 1, candidateId: candidateId(manifest, { synthetic: true }), manifest, bundlePath: path.join(stateRoot, `candidate-${index}`, 'HQ.app') };
      return { journey, receipt, candidate };
    });
    const record = validateInstallation({ schemaVersion: 1, product: 'hq', installationId: randomUUID(), targetPath: path.join(directory, 'Applications/HQ.app'), stateRoot, userData: path.join(directory, 'profile/userData'), sessionData: path.join(directory, 'profile/sessionData'), appName: SYNTHETIC.productName, bundleId: SYNTHETIC.bundleId, channel: 'preview', compatibilityEpoch: production.compatibilityEpoch, profileCreation: 'allowed-until-first-health', synthetic: true, installed: steps[0].receipt });
    return { name, record, steps };
  };
  return [
    scenario('lifecycle', [['fresh', 0], ['next-launch', 1], ['interrupted-recovery', 2]]),
    scenario('failed-health', [['fresh', 2], ['failed-health', 3]]),
  ];
}

module.exports = { scenarioPlan };
