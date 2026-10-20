/**
 * Social workbench (task.social-workbench.001): the eight tool workbenches, run history and receipts.
 * The Social domain mounts `WorkbenchSection` for the `workbenches[/<toolId>]` and `runs[/<runId>]`
 * destinations. Only an explicit Run calls the execution-class `submitRun`.
 */
export { WorkbenchSection, isWorkbenchDestination, parseWorkbenchDestination, type WorkbenchPage, type WorkbenchSectionProps } from './WorkbenchSection';
export { DELIVERED_LIMITS, TOOL_GUIDES, groupTools, type ToolGuide } from './catalog';
export { buildInput, emptyForm, formFromInput, nativeWarnings, REQUIRED_KEYS, type ToolForm, type ToolFields, type Problem } from './inputs';
export { summarizeRun, type ResultSummary } from './results';
export { draftFromResult, runAsOf, runCitation } from './citation';
export { POLL_INTERVAL_MS, documentVisibility, watchRun, type Visibility } from './polling';
export { runTool, workbenchView, type Attempt, type ToolDraft, type WorkbenchView } from './state';
