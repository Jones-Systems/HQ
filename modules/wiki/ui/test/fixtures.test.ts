// The synthetic service must itself be contract-valid, or the other tests prove nothing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateAliasResolution,
  validateBacklinkResult,
  validateIndexStatus,
  validatePage,
  validateSearchResult,
  validateSourceDescriptor,
  validateTopicList,
  NAMESPACES,
} from '../../contract/src/index.ts';
import { PAGES, SOURCES, createSyntheticService } from '../fixtures/synthetic.ts';

test('every fixture page and source validates against the accepted contract', async () => {
  const service = createSyntheticService();
  for (const page of PAGES) {
    const outcome = validatePage(page);
    assert.ok(outcome.ok, `${page.key.path}: ${outcome.ok ? '' : outcome.error.message}`);
  }
  for (const source of Object.values(SOURCES)) assert.ok(validateSourceDescriptor(source).ok);
  const listed = await service.listSources();
  assert.ok(listed.ok && listed.value.every((source) => validateSourceDescriptor(source).ok));
  const status = await service.indexStatus();
  assert.ok(status.ok && validateIndexStatus(status.value).ok);
  for (const namespace of NAMESPACES) {
    const topics = await service.listTopics({ namespace });
    assert.ok(topics.ok && validateTopicList(topics.value).ok, `topics ${namespace}`);
  }
  for (const page of PAGES) {
    const backlinks = await service.getBacklinks({ key: page.key });
    assert.ok(backlinks.ok && validateBacklinkResult(backlinks.value).ok, `backlinks ${page.key.path}`);
  }
  for (const query of ['pricing', 'archive', 'zzzz', 'onboarding']) {
    const result = await service.search({ query });
    assert.ok(result.ok && validateSearchResult(result.value).ok, `search ${query}`);
  }
  for (const namespace of NAMESPACES) {
    for (const alias of ['pricing', 'onboarding', 'nothing']) {
      const resolved = await service.resolveAlias({ namespace, alias });
      assert.ok(resolved.ok && validateAliasResolution(resolved.value).ok);
    }
  }
});

test('fixtures cover the shapes the views must handle', () => {
  const titles = PAGES.filter((page) => page.title === 'Pricing').map((page) => page.key.namespace);
  assert.deepEqual(titles.sort(), ['appdev', 'bl'], 'same title in both namespaces');
  const reasons = PAGES.flatMap((page) => (page.content.state === 'raw' ? [page.content.reason] : [])).sort();
  assert.deepEqual(reasons, ['frontmatter-unsupported', 'markdown-unsupported', 'not-text']);
  const kinds = new Set(PAGES.flatMap((page) => page.outLinks.map((link) => link.target.kind)));
  assert.deepEqual([...kinds].sort(), ['ambiguous', 'external', 'missing', 'page']);
  assert.ok(PAGES.filter((page) => page.key.path.startsWith('archive/')).length > 50, 'enough records to truncate a search');
});
