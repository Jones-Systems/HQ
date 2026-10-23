'use strict';

const { execFileSync } = require('node:child_process');
const { REPOSITORY, WORKFLOW, positiveInteger } = require('./identity.cjs');

function assertReleaseContext(context) {
  if (context.repository !== REPOSITORY.name || String(context.repositoryId) !== String(REPOSITORY.id) || String(context.ownerId) !== String(REPOSITORY.ownerId)) throw new Error('Release repository identity mismatch');
  if (context.event !== 'push' || !/^refs\/tags\/hq-desktop-[A-Za-z0-9._-]+$/.test(context.ref)) throw new Error('Only an explicit product tag push can release');
  if (!/^[a-f0-9]{40}$/.test(context.sourceSha) || context.tagSha !== context.sourceSha || context.foundationSha !== context.sourceSha) throw new Error('Release tag must identify the exact current integrated foundation commit');
  if (context.workflowRef !== `${REPOSITORY.name}/${WORKFLOW}@${context.ref}` || context.workflowSha !== context.sourceSha) throw new Error('Release workflow identity mismatch');
  positiveInteger(Number(context.runId), 'run ID');
  positiveInteger(Number(context.runAttempt), 'run attempt');
  return context.ref.slice('refs/tags/'.length);
}

function contextFromEnvironment(environment, git) {
  return { repository: environment.GITHUB_REPOSITORY, repositoryId: environment.GITHUB_REPOSITORY_ID, ownerId: environment.GITHUB_REPOSITORY_OWNER_ID, event: environment.GITHUB_EVENT_NAME, ref: environment.GITHUB_REF, sourceSha: environment.GITHUB_SHA, tagSha: git(['rev-parse', '--verify', `${environment.GITHUB_REF}^{commit}`]), foundationSha: git(['rev-parse', '--verify', 'refs/remotes/origin/work/hq-foundation']), workflowRef: environment.GITHUB_WORKFLOW_REF, workflowSha: environment.GITHUB_WORKFLOW_SHA, runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT };
}

if (require.main === module) {
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const tag = assertReleaseContext(contextFromEnvironment(process.env, git));
  process.stdout.write(`${JSON.stringify({ releaseTag: tag, sourceSha: process.env.GITHUB_SHA })}\n`);
}

module.exports = { assertReleaseContext, contextFromEnvironment };
