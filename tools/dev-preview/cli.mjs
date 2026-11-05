// Shared bits for the three command-line entry points.
import { UsageError } from './config.mjs';
import { PrerequisiteError } from './prereq.mjs';

export const say = message => console.error(`[dev-preview] ${message}`);

/** 2 for a mistake in how the tool was called or set up, 1 for anything that failed while running. */
export const exitCodeFor = error => (error instanceof UsageError || error instanceof PrerequisiteError ? 2 : 1);

export function fail(error) {
  if (error instanceof UsageError) console.error(`error: ${error.message}\nRun with --help for usage.`);
  else if (error instanceof PrerequisiteError) console.error(error.message);
  else console.error(`error: ${error?.stack ?? error}`);
  process.exit(exitCodeFor(error));
}
