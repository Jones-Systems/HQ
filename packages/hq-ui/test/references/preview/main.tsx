import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, LinkList, LinkPicker, ReferenceChip, referenceKey, type ReferenceEntry } from '../../../src';
import { entries, envelope, NOW } from '../fixtures';
import './preview.css';

const results = [envelope('new-design', 'Launch identity · Design notes'), { ...envelope('draft', 'Launch announcement · Social draft'), domain: 'social' as const }];
const port = {
  find: async (query: string) => {
    if (query === 'error') throw new Error('Synthetic unavailable service');
    return results.filter((result) => result.title.toLowerCase().includes(query.toLowerCase()));
  },
};
function Fixture() {
  const [theme, setTheme] = useState('light');
  const [links, setLinks] = useState<readonly ReferenceEntry[]>(entries);
  const [picker, setPicker] = useState(false);
  const [opened, setOpened] = useState('');
  const [created, setCreated] = useState<string>();
  const [mutations, setMutations] = useState(0);
  const record = () => setMutations((count) => count + 1);
  return <main className="hq-reference-demo">
    <header className="hq-reference-demo-header">
      <div><p className="hq-reference-demo-eyebrow">HQ / REFERENCE UI / SYNTHETIC FIXTURE</p><h1>Keep the context.</h1>
        <p>Readable snapshots across Design, Social and Work. Source-owned actions; no work started.</p></div>
      <Button onClick={() => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); document.documentElement.dataset.theme = next; }}>{theme === 'light' ? 'Dark theme' : 'Light theme'}</Button>
    </header>
    <section className="hq-reference-demo-toolbar"><Button variant="primary" onClick={() => setPicker(true)}>Link to…</Button>
      <span>Project demo-project · Source mutations: <output>{mutations}</output> · Execution calls: 0</span></section>
    {created && <div className="hq-reference-notice" role="status">Linked reference
      <Button onClick={() => { setLinks((current) => current.filter((entry) => referenceKey(entry.envelope) !== created)); setCreated(undefined); record(); }}>Undo link</Button></div>}
    {opened && <p role="status">Navigation callback: {opened} <Button onClick={() => setOpened('')}>Back to source</Button></p>}
    <LinkList entries={links} projectId="demo-project" now={NOW} onOpen={(reference) => setOpened(reference.title)}
      onUnlink={(reference) => {
        const before = links;
        setLinks(links.filter((entry) => referenceKey(entry.envelope) !== referenceKey(reference))); record();
        return { undo: () => { setLinks(before); record(); } };
      }} onUpdateSnapshot={(reference, update) => {
        const before = links;
        setLinks(links.map((entry) => referenceKey(entry.envelope) === referenceKey(reference) ? { ...entry, envelope: { ...entry.envelope, ...update } } : entry)); record();
        return { undo: () => { setLinks(before); record(); } };
      }} />
    <section className="hq-reference-demo-stale"><h2>Unresolved and expired</h2>
      <ReferenceChip envelope={envelope('unresolved', 'Snapshot awaiting resolution')} projectId="demo-project" now={NOW} />
      <ReferenceChip {...entries[0]!} envelope={envelope('stale', 'Previously available · expired observation')} stale projectId="demo-project" now={NOW} />
    </section>
    <LinkPicker open={picker} projectId="demo-project" port={port} existing={links.map((entry) => entry.envelope)}
      onClose={() => setPicker(false)} onSelect={(reference) => {
        setLinks([...links, { envelope: reference }]); setCreated(referenceKey(reference)); setPicker(false); record();
      }} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
