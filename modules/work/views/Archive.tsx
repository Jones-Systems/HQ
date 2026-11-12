import { Button, StateView } from '@hq/ui';
import { matchesFilters, STATUS_LABEL } from '../core';
import { useEnv } from './env';
import { ago, ItemRow, ViewHint } from './parts';
import { PageHeader } from '../theme';
import { RetainedRows } from './RetainedRows';
import { isPending } from './env';
import './review.css';

// Archive (RV-4): archived items keep their status, dates and notes, and
// Restore puts them back where they were. Archiving is not Done, and nothing
// is deleted.

export function ArchiveView() {
  const env = useEnv();
  const items = env.state.items.filter((it) => it.archived_at && matchesFilters(it, env.filters))
    .sort((a, b) => (a.archived_at! < b.archived_at! ? 1 : -1));
  return (
    <div className="wv-archive">
      <PageHeader title="Archive" meta={`${items.length} archived items`} />
      <ViewHint>Archived items are hidden everywhere else. Restoring keeps their status and position.</ViewHint>
      <div className="wv-archive-list"><RetainedRows>
            {items.map((item) => (
              <div key={item.id} className="wv-review-row">
                <ItemRow item={item} sub={`${STATUS_LABEL[item.status]} · archived ${ago(item.archived_at!, env.now(), env.settings)}`} />
                <div className="wv-review-actions">
                  <Button size="sm" disabled={isPending(env.state, item.id) || !!env.state.held} onClick={() => void env.run(env.store.setArchived(item.id, false), `Restored “${item.title}”.`)}>Restore</Button>
                </div>
              </div>
            ))}
          </RetainedRows></div>
      {!items.length && <StateView state="empty" title="Archive is empty" description="Archive things you no longer want to see. Nothing is deleted." />}
    </div>
  );
}
