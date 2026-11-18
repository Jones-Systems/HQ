import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startReadFixture } from './http.mjs';
import { createWikiCorpus } from './wiki.mjs';
import { startPlanner } from './planner.mjs';
import { startGallery } from './remote-gallery.mjs';
import { createLocalFolder, PREVIEW_PNG } from './local-folder.mjs';
export async function setupFixtures(runtime, repo, profile, { scenarios = false, localFolders = scenarios, observe = () => {} } = {}) {
  const exchange = async name => JSON.parse(await readFile(join(repo, 'modules/work/live/test/contract/exchanges', name), 'utf8'));
  const state = (await exchange('02-state-empty.json')).response;
  const version = (await exchange('01-version.json')).response;
  const fixtures = {};
  observe(fixtures);
  const work = scenarios ? await startPlanner(runtime, repo, partial => { fixtures.work = partial; }) : await startReadFixture(runtime, { '/api/state': state, '/api/version': version });
  fixtures.work = work;
  const social = await startReadFixture(runtime, { '/api/workspace': { status: 200,
    body: { brands: [], content: [], runs: [], tools: [], csrf: 'synthetic-acceptance-token', features: [] } } });
  fixtures.social = social;
  const wiki = await createWikiCorpus(runtime, repo, profile);
  fixtures.wiki = wiki;
  if (localFolders) {
    fixtures.local = await createLocalFolder(runtime, profile);
    fixtures.previewBytes = PREVIEW_PNG.length;
  }
  if (scenarios) fixtures.gallery = await startGallery(runtime);
  await writeFile(join(profile, 'service-config.json'), JSON.stringify({ work: work.origin, social: social.origin }));
  return fixtures;
}
