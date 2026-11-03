import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, FieldError, InlineNotice, Skeleton, StatusChip, Tabs, useToast } from '@hq/ui';
import { checkRunSubmission, isJsonObject, portErrorOf, workspaceSnapshot, type PortError, type ToolId } from '../core';
import { EmptyState, PageHeader, SocialIcon } from '../ui';
import { TOOL_GUIDES } from './catalog';
import { useWorkbench } from './env';
import { fieldId } from './fields';
import { parseJsonText } from './imports';
import { buildInput, formFromInput, nativeWarnings, type Problem, type ToolForm } from './inputs';
import { RunReceipt } from './RunReceipt';
import { WAITS_HERE } from './setup';
import { newDraft, runTool, setAttempt, setDraft, toolDraft, workbenchView, type Attempt, type ToolDraft } from './state';
import { ToolFormView } from './ToolForms';
import { ToolRail } from './ToolRail';
import { UnknownOutcome } from './UnknownOutcome';

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** What an explicit Run would submit now, or the problems that block it. Pure; no service call. */
export function pendingSubmission(tool: ToolId, draft: ToolDraft): { input: Record<string, unknown>; isExample: boolean } | { problems: readonly Problem[] } {
  const isExample = draft.example === 'loaded' && draft.exampleInput !== undefined;
  let input: Record<string, unknown>;
  if (isExample) {
    input = draft.exampleInput!;
  } else if (draft.mode === 'form') {
    const built = buildInput(draft.form);
    if (built.problems.length) return { problems: built.problems };
    input = built.input;
  } else {
    const parsed = parseJsonText(draft.json);
    if (!parsed.ok) return { problems: [{ field: 'json', message: parsed.message }] };
    if (!isJsonObject(parsed.value)) return { problems: [{ field: 'json', message: 'The input must be a JSON object.' }] };
    input = parsed.value;
  }
  const checked = checkRunSubmission(tool, input, isExample);
  if (!checked.ok) return { problems: [{ field: draft.mode === 'json' ? 'json' : 'form', message: checked.error.message }] };
  return { input, isExample };
}

function rejectionText(error: Exclude<PortError, { kind: 'unknown' }>): { title: string; detail: string } {
  switch (error.kind) {
    case 'invalid': return { title: 'Not run: the input was refused', detail: error.message };
    case 'conflict': return { title: 'Not run', detail: error.message };
    case 'unavailable': return { title: 'Not sent: the Social service is unreachable', detail: 'Nothing was submitted. Run again when the service answers.' };
    case 'forbidden': return { title: 'Not run: the Social service refused the request', detail: 'Reload the workspace before running.' };
    case 'not_found': return { title: 'Not run: the run route was not found', detail: 'The Social service did not recognize the request.' };
  }
}

/** The platform's run chord: ⌘ Enter on a Mac, Ctrl Enter elsewhere (spelled out: the Return arrow is missing from many fonts). Either chord runs the tool on any platform. */
function chordKeys(): readonly string[] {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad/u.test(platform) ? ['⌘', 'Enter'] : ['Ctrl', 'Enter'];
}

export function ToolWorkbench({ tool }: { readonly tool: ToolId }) {
  const { port, session, state, clock, navigate, example } = useWorkbench();
  const toast = useToast();
  const snapshot = workspaceSnapshot(state.workspace);
  const view = workbenchView(state);
  const draft = toolDraft(view, tool, clock());
  const attempt = view.attempts[tool];
  const serviceTool = snapshot?.tools.find((item) => item.id === tool);
  const guide = TOOL_GUIDES[tool];
  const name = serviceTool?.name ?? tool;
  const serviceDown = state.workspace.status === 'error';
  const summaryRef = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState<readonly Problem[]>([]);
  const [exampleState, setExampleState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [confirming, setConfirming] = useState<{ input: Record<string, unknown>; isExample: boolean } | null>(null);

  useEffect(() => {
    // Keep a stable form (and its as-of default) once the page has opened.
    if (!workbenchView(session.getState()).drafts[tool]) setDraft(session, tool, newDraft(tool, clock()));
  }, [session, tool, clock]);

  useEffect(() => {
    if (blocked.length) summaryRef.current?.focus();
  }, [blocked]);

  const latest = () => toolDraft(workbenchView(session.getState()), tool, clock());
  const save = (next: ToolDraft) => setDraft(session, tool, next);
  const edited = (current: ToolDraft): ToolDraft['example'] => (current.example === 'loaded' ? 'edited' : current.example);

  const onForm = (form: ToolForm) => {
    const current = latest();
    save({ ...current, form, example: edited(current) });
    if (blocked.length) setBlocked([]);
  };
  const onJson = (json: string) => {
    const current = latest();
    const { jsonNote: _note, ...rest } = current;
    save({ ...rest, json, example: edited(current) });
    if (blocked.length) setBlocked([]);
  };
  const onMode = (mode: string) => {
    const current = latest();
    if (mode === current.mode) return;
    if (mode === 'json') {
      const input = current.example === 'loaded' && current.exampleInput ? current.exampleInput : buildInput(current.form).input;
      const { jsonNote: _note, ...rest } = current;
      save({ ...rest, mode: 'json', json: stringify(input) });
      return;
    }
    const parsed = parseJsonText(current.json);
    if (!parsed.ok) return save({ ...current, jsonNote: `Fix the JSON before switching to the form. ${parsed.message}` });
    if (!isJsonObject(parsed.value)) return save({ ...current, jsonNote: 'The input must be a JSON object before it can be shown as a form.' });
    const filled = formFromInput(tool, parsed.value, { kind: 'json' }, clock());
    if (!filled.ok) return save({ ...current, jsonNote: filled.message });
    const { jsonNote: _note, ...rest } = current;
    save({ ...rest, mode: 'form', form: filled.form });
  };

  const loadExample = async () => {
    setExampleState({ loading: true, error: null });
    try {
      // A read-class call: loading an example never submits a run.
      const input = await port.example(tool);
      const filled = formFromInput(tool, input, { kind: 'example' }, clock());
      const current = latest();
      const { jsonNote: _note, ...rest } = current;
      save({
        ...rest, json: stringify(input), example: 'loaded', exampleInput: input, showProblems: false,
        ...(filled.ok ? { form: filled.form } : { mode: 'json', jsonNote: filled.message }),
      });
      setBlocked([]);
      setExampleState({ loading: false, error: null });
    } catch (reason) {
      const error = portErrorOf(reason);
      setExampleState({ loading: false, error: error && 'message' in error ? error.message : 'The example could not be loaded. Nothing was run.' });
    }
  };

  /** The only caller of `submitRun`. A lost response or a refusal is also raised as a toast that stays until dismissed. */
  const submit = async (input: Record<string, unknown>, isExample: boolean) => {
    const outcome = await runTool(port, session, tool, input, isExample);
    if (outcome?.status === 'unknown') {
      toast.unknown(`${name} run: outcome unknown`, {
        id: `run-outcome:${tool}`, description: 'The response was lost, so the Social service may or may not have created it. HQ will not send it again.',
        action: { label: 'Check', onAction: () => void session.load(port) },
      });
    } else if (outcome?.status === 'rejected') {
      const text = rejectionText(outcome.error);
      toast.error(text.title, { id: `run-outcome:${tool}`, description: text.detail });
    }
  };

  /** The explicit Run action, from the button or ⌘/Ctrl+Enter: one submit. */
  const run = () => {
    if (serviceDown) return;
    const current = latest();
    const pending = pendingSubmission(tool, current);
    if ('problems' in pending) {
      save({ ...current, showProblems: true });
      setBlocked(pending.problems);
      return;
    }
    setBlocked([]);
    if (attempt?.status === 'unknown') {
      setConfirming(pending);
      return;
    }
    void submit(pending.input, pending.isExample);
  };

  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.repeat || event.defaultPrevented) return;
      // A dialog owns its own keys, including the confirmation for running again.
      if ((event.target as Element | null)?.closest?.('dialog, [role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      runRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const formProblems = draft.mode === 'form' && draft.showProblems ? buildInput(draft.form).problems : [];
  const jsonParse = draft.mode === 'json' ? parseJsonText(draft.json) : null;
  const jsonWarnings = jsonParse?.ok && isJsonObject(jsonParse.value) ? nativeWarnings(tool, jsonParse.value, clock()) : [];
  const jsonError = jsonParse && !jsonParse.ok ? jsonParse.message : jsonParse?.ok && !isJsonObject(jsonParse.value) ? 'The input must be a JSON object.' : undefined;
  const submitting = attempt?.status === 'submitting';

  const focusField = (field: string) => {
    const target = field === 'json' ? `sw-${tool}-json` : fieldId(tool, field);
    document.getElementById(target)?.focus();
  };

  return (
    <section className="sw-page sx-page" aria-labelledby="sw-tool-title">
      <PageHeader
        headingId="sw-tool-title" title={name}
        eyebrow={<><button type="button" className="sw-crumb" onClick={() => navigate('workbenches')}><SocialIcon name="chevron-left" />All workbenches</button> · {serviceTool?.category ?? 'Workbench'}</>}
        {...(serviceTool ? { description: serviceTool.description } : {})}
      >
        <p className="sw-limit"><b>Limit</b> {guide.limit}</p>
        <p className="sw-note"><b>Covers</b> {guide.recipe}</p>
      </PageHeader>
      <div className="sw-layout">
        <ToolRail selected={tool} />
        <div className="sw-main">
          <section className="sx-panel sw-panel" aria-labelledby="sw-inputs-title">
            <div className="sx-panel-head">
              <h2 id="sw-inputs-title">Your inputs</h2>
              <Button size="sm" variant="secondary" busy={exampleState.loading} busyLabel="Loading example" onClick={() => void loadExample()}>Load example</Button>
            </div>
            <ExampleStatus draft={draft} />
            {exampleState.error && <p className="sw-error" role="alert">{exampleState.error}</p>}
            {blocked.length > 0 && (
              <div className="sw-problems" role="alert" tabIndex={-1} ref={summaryRef}>
                <h3>Fix {blocked.length === 1 ? 'this problem' : `these ${blocked.length} problems`} before running</h3>
                <ul>
                  {blocked.map((problem, index) => (
                    <li key={index}><button type="button" className="sw-link" onClick={() => focusField(problem.field)}>{problem.message}</button></li>
                  ))}
                </ul>
              </div>
            )}
            <Tabs
              label="Input mode" selectedId={draft.mode} onSelectedChange={onMode}
              tabs={[
                { id: 'form', label: guide.input === 'fields' ? 'Form' : 'Form and file import', panel: <ToolFormView form={draft.form} onChange={onForm} problems={formProblems} /> },
                {
                  id: 'json', label: 'Advanced JSON',
                  panel: (
                    <div className="sw-form">
                      <div className={jsonError ? 'sw-field sw-field--invalid' : 'sw-field'}>
                        <label className="sw-label" htmlFor={`sw-${tool}-json`}>Native input object</label>
                        <textarea
                          id={`sw-${tool}-json`} className="sw-input sw-input--mono sw-json" rows={16} spellCheck={false} value={draft.json}
                          aria-invalid={jsonError ? true : undefined} aria-describedby={`sw-${tool}-json-hint${jsonError ? ` sw-${tool}-json-error` : ''}`}
                          onChange={(event) => onJson(event.target.value)}
                        />
                        <p className="sw-hint" id={`sw-${tool}-json-hint`}>The exact object sent with Run. The service accepts at most 2,000,000 bytes.</p>
                        <FieldError id={`sw-${tool}-json-error`}>{jsonError}</FieldError>
                      </div>
                      {draft.jsonNote && <p className="sw-note" role="status">{draft.jsonNote}</p>}
                      {jsonWarnings.length > 0 && (
                        <div className="sw-warnings">
                          <p><b>The tool may fail.</b> These checks don't block Run in Advanced JSON:</p>
                          <ul>{jsonWarnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            {guide.notices.map((notice) => <p key={notice} className="sw-note">{notice}</p>)}
            <div className="sw-run">
              <div className="sw-run-row">
                <Button
                  variant="primary" busy={submitting} busyLabel="Sending run" disabled={serviceDown}
                  aria-describedby={serviceDown ? 'sw-run-paused' : undefined} aria-keyshortcuts="Control+Enter Meta+Enter" onClick={run}
                >
                  {/* After an unknown outcome the same Run asks first (the ellipsis); it never suggests running again. */}
                  {attempt?.status === 'unknown' ? `Run ${name}…` : `Run ${name}`}
                </Button>
                {!serviceDown && (
                  <span className="sw-kbd-hint" title="Runs this tool once, the same as the Run button">
                    <span className="hq-sr-only">Shortcut: </span>{chordKeys().map((key) => <kbd key={key}>{key}</kbd>)}
                  </span>
                )}
              </div>
              {serviceDown && <p className="sw-hint" id="sw-run-paused">Runs pause while the Social service is unreachable.</p>}
              {!serviceDown && <p className="sw-hint">Nothing runs until you choose Run. Each Run creates one run; nothing is retried.</p>}
              {!serviceDown && example && draft.example !== 'loaded' && (
                <p className="sw-hint">{WAITS_HERE} Load an example to see a full run.</p>
              )}
            </div>
          </section>
          <section className="sx-panel sw-panel sw-results" aria-labelledby="sw-results-title">
            <div className="sx-panel-head"><h2 id="sw-results-title">Results</h2></div>
            <AttemptView tool={tool} toolName={name} attempt={attempt} onClear={() => setAttempt(session, tool, undefined)} />
          </section>
        </div>
      </div>
      <Dialog
        open={confirming !== null} role="alertdialog" onClose={() => setConfirming(null)}
        title="The last run's outcome is unknown"
        description="The Social service may already have created it. Check the possible matches first. Running again creates another run."
        actions={<>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => {
            const pending = confirming;
            setConfirming(null);
            if (pending) void submit(pending.input, pending.isExample);
          }}>Create another run</Button>
        </>}
      />
    </section>
  );
}

function ExampleStatus({ draft }: { readonly draft: ToolDraft }) {
  if (draft.example === 'loaded') {
    return <p className="sw-source"><StatusChip className="sw-status-wrap" tone="neutral" label="Example data" detail="synthetic · runs labeled as an example" /></p>;
  }
  if (draft.example === 'edited') {
    return <p className="sw-source"><StatusChip className="sw-status-wrap" tone="neutral" label="Edited example" detail="runs as your supplied input, not labeled example" /></p>;
  }
  return <p className="sw-source sw-hint">Input source: material you supply. Nothing is fetched from the web.</p>;
}

function AttemptView({ tool, toolName, attempt, onClear }: { readonly tool: ToolId; readonly toolName: string; readonly attempt: Attempt | undefined; readonly onClear: () => void }) {
  if (!attempt) {
    return (
      <EmptyState icon="play" title="No run yet">
        Run this workbench to see results here. Nothing runs until you choose Run.
      </EmptyState>
    );
  }
  switch (attempt.status) {
    case 'submitting':
      return (
        <div className="sw-sending" aria-busy="true">
          <p className="sw-note" role="status">Sending the run…</p>
          <Skeleton shape="text" lines={3} />
        </div>
      );
    case 'accepted': return <RunReceipt key={attempt.run.id} runId={attempt.run.id} initial={attempt.run} />;
    case 'unknown': return <UnknownOutcome tool={tool} toolName={toolName} attempt={attempt} />;
    case 'rejected': {
      const text = rejectionText(attempt.error);
      return (
        <InlineNotice
          tone={attempt.error.kind === 'unavailable' ? 'warning' : 'danger'} title={text.title} live="off"
          actions={[{ label: 'Dismiss', onAction: onClear }]}
        >
          {text.detail}
        </InlineNotice>
      );
    }
  }
}
