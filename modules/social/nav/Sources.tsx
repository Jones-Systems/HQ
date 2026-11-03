import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, InlineNotice, StatusChip, useListMotion, useToast } from '@hq/ui';
import { hasFeature, useSocialSession, workspaceSnapshot, type ToolId } from '../core';
import { PageHeader, SocialIcon, longTime, useSocialFrame } from '../ui';
import { fitsOf, handOff, previewHandoff, type HandoffFit } from '../workbench/handoff';
import { checkFile } from './sources/check';
import { DropZone } from './sources/DropZone';
import { exampleFile } from './sources/examples';
import { ImportDetail, NOT_SAVED } from './sources/ImportDetail';
import { addImport, removeImport, selectImport, sourcesView } from './sources/store';
import './pages.css';

export const SOURCES_PROPOSED = 'Proposed — needs the Social service source registry (SOC-6)';

/** Advertised by a service that has a source registry; HQ has no port method to read it, so nothing is called. */
const FEATURE_HQ_SOURCES = 'hq-sources-v1';

const systemNow = () => new Date();

export interface SourcesProps {
  readonly sourceId?: string;
  readonly navigate: (destination: string) => void;
  /** The HQ project: the key of the Social session that keeps this page's files. */
  readonly projectId: string;
  readonly now?: () => Date;
}

interface Problem { readonly name: string; readonly message: string }

/**
 * Sources is an import desk (RC-6, SOC-7): drop or choose a JSON or JSON Lines file and HQ checks it on this device,
 * recognizes which workbenches accept it and offers *Open in <workbench>*, which loads the file into that tool's form.
 * Files are kept for the session and are not saved: the source registry (SOC-6) does not exist yet, so the saved
 * sources area says so and calls nothing. Nothing is uploaded, collected or run from this page.
 */
export function Sources({ sourceId, navigate, projectId, now = systemNow }: SourcesProps) {
  const { state, session } = useSocialSession(projectId);
  const frame = useSocialFrame();
  const toast = useToast();
  const snapshot = workspaceSnapshot(state.workspace);
  const view = sourcesView(state);
  const selected = view.imports.find((item) => item.id === view.selected) ?? view.imports[0] ?? null;

  const [checking, setChecking] = useState(false);
  const [problems, setProblems] = useState<readonly Problem[]>([]);
  const [blocked, setBlocked] = useState<{ readonly fit: HandoffFit; readonly reason: string } | null>(null);
  // Bumped when a check finishes, so focus moves to the problem or to the new result.
  const [problemFocus, setProblemFocus] = useState(0);
  const [detailFocus, setDetailFocus] = useState(0);
  const problemRef = useRef<HTMLDivElement>(null);
  const listRef = useListMotion<HTMLUListElement>(view.imports.map((item) => item.id));
  const ids = useId();

  useEffect(() => {
    if (problemFocus > 0) problemRef.current?.focus();
  }, [problemFocus]);

  const toolName = (tool: ToolId) => snapshot?.tools.find((item) => item.id === tool)?.name ?? tool;
  const known = useMemo(() => new Set(snapshot?.tools.map((tool) => tool.id)), [snapshot]);
  const fits = useMemo(
    () => (selected ? fitsOf(selected.imported.value, selected.kind, now()).filter((fit) => known.has(fit.tool)) : []),
    [selected, known, now],
  );

  const check = async (files: readonly File[], example = false) => {
    setChecking(true);
    setProblems([]);
    setBlocked(null);
    const failed: Problem[] = [];
    let added = false;
    try {
      for (const file of files) {
        const result = await checkFile(file);
        if (result.ok) {
          addImport(session, result.file, now().toISOString(), example);
          added = true;
        } else {
          failed.push({ name: result.name, message: result.message });
        }
      }
    } finally {
      setChecking(false);
    }
    setProblems(failed);
    if (failed.length) setProblemFocus((value) => value + 1);
    else if (added) setDetailFocus((value) => value + 1);
  };

  const open = (fit: HandoffFit) => {
    if (!selected) return;
    const result = handOff(session, fit, selected.imported, now());
    if (!result.ok) {
      setBlocked({ fit, reason: result.reason });
      return;
    }
    setBlocked(null);
    const name = toolName(fit.tool);
    toast.show({
      id: `social-handoff:${fit.tool}`, tone: 'success', title: `Loaded ${selected.name} into ${name}`, duration: 8000,
      description: result.remaining.length
        ? `Nothing has run. Still needed there: ${result.remaining.slice(0, 3).map((problem) => problem.message.replace(/\.$/u, '')).join('; ')}${result.remaining.length > 3 ? '…' : ''}.`
        : 'Nothing has run. Check the form, then choose Run.',
    });
    navigate(`workbenches/${fit.tool}`);
  };

  const examples = frame?.example ? {
    onValid: () => void check([exampleFile('valid')], true),
    onBroken: () => void check([exampleFile('broken')], true),
  } : undefined;
  const registry = snapshot && hasFeature(snapshot, FEATURE_HQ_SOURCES)
    ? "Proposed — the service advertises hq-sources-v1, but HQ can't read a source registry yet"
    : SOURCES_PROPOSED;

  return (
    <div className="sx-page sd-sources">
      <PageHeader
        title="Sources"
        description="Data you supply for analysis. Drop a file to check it here, then open it in the workbench that reads it."
        actions={<Button variant="secondary" onClick={() => navigate('workbenches')}>Open workbenches</Button>}
      >
        {sourceId && <p className="sd-header-note" role="note">The source “{sourceId}” can't be shown: there is no source registry yet.</p>}
      </PageHeader>

      <DropZone busy={checking} onFiles={(files) => void check(files)} {...(examples ? { examples } : {})} />

      {problems.length > 0 && (
        <div className="sd-problem hq-enter-rise" tabIndex={-1} ref={problemRef}>
          <InlineNotice
            tone="danger" title={problems.length === 1 ? "Can't import this file" : `Can't import ${problems.length} files`}
            onDismiss={() => setProblems([])}
          >
            {problems.map((problem) => <span key={problem.name} className="sd-problem-line"><b>{problem.name}</b>{' '}<span>{problem.message}</span></span>)}
            <span className="sd-problem-line">Nothing was saved or sent.</span>
          </InlineNotice>
        </div>
      )}

      {view.imports.length > 0 && selected ? (
        <div className="sx-split sd-imports">
          <section className="sx-panel sx-panel--flush" aria-labelledby={`${ids}-files`}>
            <header className="sx-panel-head">
              <h2 id={`${ids}-files`}>This session</h2>
              <span className="hq-meta">{view.imports.length} {view.imports.length === 1 ? 'file' : 'files'}</span>
              <span className="sx-tag">{NOT_SAVED}</span>
            </header>
            <ul className="sx-list" ref={listRef}>
              {view.imports.map((item) => (
                <li key={item.id} data-hq-motion-key={item.id}>
                  <button
                    type="button" className="sx-row sd-import-row" aria-current={item.id === selected.id ? 'true' : undefined}
                    onClick={() => { selectImport(session, item.id); setBlocked(null); }}
                  >
                    <span className="sx-mark" aria-hidden="true"><SocialIcon name="file" /></span>
                    <span className="sx-row-main">
                      <span className="sx-row-title">{item.name}</span>
                      <span className="sx-row-meta">
                        {item.example ? 'Example data · ' : ''}{item.kind === 'jsonl' ? 'JSON Lines' : 'JSON'}
                        {item.records !== null ? ` · ${item.records.toLocaleString('en-US')} ${item.records === 1 ? 'record' : 'records'}` : ''} · {longTime(item.importedAt)}
                      </span>
                    </span>
                    <span className="sx-row-side"><StatusChip tone="success" label="Valid" /></span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <ImportDetail
            key={selected.id} item={selected} fits={fits} toolsLoaded={known.size > 0} toolName={toolName}
            replaces={(fit) => previewHandoff(session, fit, now()).replaces} blocked={blocked}
            focusSignal={detailFocus} onOpen={open} onOpenTool={(tool) => navigate(`workbenches/${tool}`)}
            onRemove={() => { removeImport(session, selected.id); setBlocked(null); }}
          />
        </div>
      ) : (
        <section className="sx-panel sd-steps" aria-labelledby={`${ids}-how`}>
          <h2 id={`${ids}-how`} className="sd-subhead">How it works</h2>
          <ol className="sd-steps-list hq-stagger">
            <li><span className="sd-step-num" aria-hidden="true">1</span><p><b>Check.</b> HQ reads the file here and names the line and column of any syntax error. Nothing is uploaded.</p></li>
            <li><span className="sd-step-num" aria-hidden="true">2</span><p><b>Match.</b> HQ recognizes which workbenches accept a file of that shape.</p></li>
            <li><span className="sd-step-num" aria-hidden="true">3</span><p><b>Open.</b> The file loads into that workbench's form. Nothing runs until you choose Run there.</p></li>
          </ol>
        </section>
      )}

      <div className="sx-grid sx-grid--2 hq-stagger">
        <section className="sx-panel sx-panel--dashed" aria-labelledby={`${ids}-saved`}>
          <header className="sx-panel-head"><h2 id={`${ids}-saved`}>Saved sources</h2></header>
          <p>{registry}</p>
        </section>
        <section className="sx-panel sx-panel--dashed" aria-labelledby={`${ids}-collection`}>
          <header className="sx-panel-head">
            <h2 id={`${ids}-collection`}>Collection</h2>
            <StatusChip tone="unavailable" label="Not available" />
          </header>
          <p>HQ never collects data from social platforms. The separate social-listening tool isn't connected to HQ.</p>
        </section>
      </div>
    </div>
  );
}
