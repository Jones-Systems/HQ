"""Everything the service owns survives a restart; the per-process token and unfinished runs do not."""

from support import ServiceTestCase

SLOT = {'start': '09:15', 'duration_minutes': 30, 'timezone': 'America/New_York'}


def link(entity):
    return {'version': 1, 'domain': 'work', 'projectId': 'p', 'kind': 'item', 'entityId': entity, 'title': f'Item {entity}',
            'returnDestination': {'domain': 'social', 'destination': 'library'}, 'sourceRevision': 'r1'}


class Persistence(ServiceTestCase):
    def snapshot(self):
        return {key: value for key, value in self.get('/api/workspace').json.items() if key != 'csrf'}

    def test_brands_drafts_links_slots_and_runs_survive_a_restart(self):
        brand = self.post('/api/brands', {'name': 'Larkspur Tea Co.'}).json
        planned = self.harness.save(title='Planned', brand_id=brand['id'], channel='X', planned_date='2026-10-22',
                                    planning_slot=SLOT, links=[link('a'), link('b')], body='  Body  ', archived=True)
        plain = self.harness.save(title='Plain')
        updated = self.harness.save(title='Plain, edited', id=plain['id'], version=1)
        failed = self.harness.wait_run(self.harness.submit('x-studio', {'mode': 'fail', 'message': 'No notes'}).json['id'])
        succeeded = self.harness.wait_run(self.harness.submit('seo-studio', {'mode': 'ok'}, is_example=True).json['id'])
        before = self.snapshot()
        self.restart()
        self.assertEqual(self.snapshot(), before)
        after = {item['id']: item for item in self.get('/api/workspace').json['content']}
        self.assertEqual(after[planned['id']], planned)
        self.assertEqual((after[plain['id']]['version'], after[plain['id']]['title']), (2, 'Plain, edited'))
        self.assertEqual(after[plain['id']], updated)
        self.assertEqual(self.get(f'/api/runs/{failed["id"]}').json, failed)
        self.assertEqual(self.get(f'/api/runs/{succeeded["id"]}').json, succeeded)

    def test_versions_continue_from_where_they_were(self):
        draft = self.harness.save(title='One')
        self.harness.save(title='Two', id=draft['id'], version=1)
        self.restart()
        stale = self.post('/api/content', {'title': 'Old window', 'id': draft['id'], 'version': 1})
        self.assertEqual((stale.status, stale.json['error']),
                         (409, 'This draft changed in another window. Close and reopen it before saving.'))
        fresh = self.post('/api/content', {'title': 'Three', 'id': draft['id'], 'version': 2})
        self.assertEqual((fresh.status, fresh.json['version']), (200, 3))

    def test_the_token_is_new_after_a_restart_and_the_old_one_is_refused(self):
        old = self.service.token
        self.restart()
        self.assertNotEqual(old, self.service.token)
        refused = self.post('/api/brands', {'name': 'x'}, token=old)
        self.assertEqual((refused.status, refused.json), (403, {'error': 'Reload the workspace before saving'}))
        refreshed = self.get('/api/workspace').json['csrf']
        self.assertEqual(self.post('/api/brands', {'name': 'x'}, token=refreshed).status, 201)

    def test_the_default_brand_is_never_duplicated_by_restarts(self):
        for _ in range(3):
            self.restart()
        self.assertEqual(self.get('/api/workspace').json['brands'], [{'id': 'default', 'name': 'My workspace', 'project_id': None}])

    def test_repeated_restarts_do_not_change_stored_data(self):
        self.harness.save(title='Stable', planned_date='2026-10-22', planning_slot=SLOT, links=[link('x')])
        first = self.snapshot()
        for _ in range(3):
            self.restart()
            self.assertEqual(self.snapshot(), first)

    def test_unfinished_runs_become_interrupted_and_stay_that_way(self):
        gate = self.scratch / 'gate'
        running = self.harness.submit('x-studio', {'mode': 'block', 'gate': str(gate)}).json
        queued = self.harness.submit('x-studio', {'mode': 'ok'}).json
        self.restart()
        for record in (running, queued):
            seen = self.get(f'/api/runs/{record["id"]}').json
            self.assertEqual(seen['status'], 'interrupted')
            self.assertEqual(seen['error'], 'Service restarted before completion; run again explicitly.')
        before = self.snapshot()
        self.restart()
        self.assertEqual(self.snapshot(), before)
