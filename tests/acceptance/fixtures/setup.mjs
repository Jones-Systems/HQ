import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startFixture } from './http.mjs';
import { createWikiCorpus } from './wiki.mjs';
export async function setupFixtures(runtime, repo, profile) {
  const exchange = async name => JSON.parse(await readFile(join(repo, 'modules/work/live/test/contract/exchanges', name), 'utf8'));
  const state = (await exchange('02-state-empty.json')).response;
  const version = (await exchange('01-version.json')).response;
  const work = await startFixture(runtime, 'work', { reads: { '/api/state': state, '/api/version': version } });
  const social = await startFixture(runtime, 'social', { reads: { '/api/workspace': { status: 200,
    body: { brands: [], content: [], runs: [], tools: [], csrf: 'synthetic-acceptance-token', features: [] } } } });
  const wiki = await createWikiCorpus(runtime, repo, profile);
  await writeFile(join(profile, 'service-config.json'), JSON.stringify({ work: work.origin, social: social.origin }));
  return { work, social, wiki };
}
