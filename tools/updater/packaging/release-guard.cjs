'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { REPOSITORY, WORKFLOW, positiveInteger } = require('./identity.cjs');
const { PRODUCTION_REF, productionReleaseTag } = require('../signing.cjs');

function assertReleaseContext(context) {
  if (context.repository !== REPOSITORY.name || String(context.repositoryId) !== String(REPOSITORY.id) || String(context.ownerId) !== String(REPOSITORY.ownerId)) throw new Error('Release repository identity mismatch');
  if (context.event !== 'push') throw new Error('Only a bound push can release');
  if (context.workflowRef !== `${REPOSITORY.name}/${WORKFLOW}@${context.ref}` || context.workflowSha !== context.sourceSha) throw new Error('Release workflow identity mismatch');
  positiveInteger(Number(context.runId), 'run ID');
  positiveInteger(Number(context.runAttempt), 'run attempt');
  if (context.ref === PRODUCTION_REF) {
    if (context.enabled !== 'true' || context.defaultBranch !== 'main' || !/^[a-f0-9]{40}$/.test(context.sourceSha) || context.mainSha !== context.sourceSha) throw new Error('Production release requires enabled exact canonical main');
    return productionReleaseTag(context.runId);
  }
  if (!/^refs\/tags\/hq-desktop-[A-Za-z0-9._-]+$/.test(context.ref) || context.ref.startsWith('refs/tags/hq-desktop-signed-')) throw new Error('Reserved or unexpected development release tag');
  if (!/^[a-f0-9]{40}$/.test(context.sourceSha) || context.tagSha !== context.sourceSha || context.foundationSha !== context.sourceSha) throw new Error('Release tag must identify the exact current integrated foundation commit');
  return context.ref.slice('refs/tags/'.length);
}

function contextFromEnvironment(environment, git) {
  const production = environment.GITHUB_REF === PRODUCTION_REF;
  return { repository: environment.GITHUB_REPOSITORY, repositoryId: environment.GITHUB_REPOSITORY_ID, ownerId: environment.GITHUB_REPOSITORY_OWNER_ID, event: environment.GITHUB_EVENT_NAME, ref: environment.GITHUB_REF, sourceSha: environment.GITHUB_SHA,
    ...(production ? { enabled: environment.HQ_SIGNED_RELEASES_ENABLED, defaultBranch: JSON.parse(fs.readFileSync(environment.GITHUB_EVENT_PATH, 'utf8')).repository?.default_branch, mainSha: git(['rev-parse', '--verify', 'refs/remotes/origin/main']) }
      : { tagSha: git(['rev-parse', '--verify', `${environment.GITHUB_REF}^{commit}`]), foundationSha: git(['rev-parse', '--verify', 'refs/remotes/origin/work/hq-foundation']) }),
    workflowRef: environment.GITHUB_WORKFLOW_REF, workflowSha: environment.GITHUB_WORKFLOW_SHA, runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT };
}
function releaseContext(environment = process.env) {
  return contextFromEnvironment(environment, args => execFileSync('git', args, { encoding: 'utf8' }).trim());
}
if (require.main === module) process.stdout.write(`${JSON.stringify({ releaseTag: assertReleaseContext(releaseContext()), sourceSha: process.env.GITHUB_SHA })}\n`);
module.exports = { assertReleaseContext, contextFromEnvironment, releaseContext };
