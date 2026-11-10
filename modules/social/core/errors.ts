import type { PortError } from './port';

/**
 * Typed error presentation (spec.backend-social#iface.adapter.001). One mapping from a `PortError` and
 * the action that raised it to where a page shows the problem, how it reads and what the person may do
 * next, so every page presents the same failure the same way. Pure: no clock, no locale, no side effect.
 *
 * Wording follows the design's copy and honesty rules: an outcome that cannot be confirmed is *unknown*,
 * never success or failure, and nothing is retried automatically. Service text (`invalid`, `conflict`) is
 * passed through verbatim, so pages show exactly what the service said.
 */

/** The user-visible action that failed. `read` is a single-record read: a run receipt or an example input. */
export type PortAction = 'load' | 'save' | 'brand' | 'run' | 'read';

/**
 * What the person may do about it. `fix-input` and `reload-latest` change what they send or see;
 * `check-again` only re-reads or reconnects; `none` offers nothing. No recovery ever runs a tool again.
 */
export type PortRecovery = 'fix-input' | 'reload-latest' | 'check-again' | 'none';

export interface PortNotice {
  readonly surface: 'inline' | 'toast' | 'banner';
  readonly tone: 'danger' | 'warning' | 'info';
  readonly title: string;
  readonly message: string;
  readonly recovery: PortRecovery;
}

/** Delivered wording, reused so pages read consistently. */
const KEPT = 'Your text is kept in this session.';
const DO_NOT_START_AGAIN = "Don't start it again until the status is known.";

/** What a failed action did not do, for outcomes where the service definitely did not act. */
const NOT_DONE: Record<PortAction, string> = {
  load: "The workspace couldn't be loaded.",
  save: 'The draft was not saved.',
  brand: 'The brand was not added.',
  run: 'The run did not start.',
  read: "This couldn't be read.",
};

const NOUN: Record<PortAction, string> = {
  load: 'the workspace',
  save: 'this draft',
  brand: 'this brand',
  run: 'this run',
  read: 'this record',
};

const TITLE_REFUSED: Record<PortAction, string> = {
  load: "Couldn't load",
  save: 'Not saved',
  brand: 'Brand not added',
  run: 'Run not started',
  read: "Couldn't read",
};

function invalid(error: Extract<PortError, { kind: 'invalid' }>, action: PortAction): PortNotice {
  return { surface: 'inline', tone: 'danger', title: TITLE_REFUSED[action], message: error.message, recovery: 'fix-input' };
}

function conflict(error: Extract<PortError, { kind: 'conflict' }>, action: PortAction): PortNotice {
  switch (action) {
    case 'save':
      return { surface: 'inline', tone: 'warning', title: 'Changed elsewhere', message: error.message, recovery: 'reload-latest' };
    case 'run':
      // A full queue: a definite refusal, nothing started, and nothing for the person to fix.
      return { surface: 'toast', tone: 'warning', title: TITLE_REFUSED.run, message: error.message, recovery: 'none' };
    case 'brand':
      return { surface: 'inline', tone: 'warning', title: TITLE_REFUSED.brand, message: error.message, recovery: 'reload-latest' };
    case 'load':
    case 'read':
      return { surface: 'toast', tone: 'warning', title: TITLE_REFUSED[action], message: error.message, recovery: 'check-again' };
  }
}

function notFound(action: PortAction): PortNotice {
  const message: Record<PortAction, string> = {
    load: 'The Social service could not find the workspace. Check again.',
    save: `This draft is no longer in the workspace. ${KEPT} Check again to see what is stored now.`,
    brand: 'The Social service could not find this. The brand was not added. Check again.',
    run: 'The Social service could not find what this run needs. The run did not start. Check again.',
    read: 'The Social service has no record of this. Check again to see what is there now.',
  };
  return { surface: 'toast', tone: 'warning', title: 'Not found', message: message[action], recovery: 'check-again' };
}

function forbidden(action: PortAction): PortNotice {
  // Check again re-reads the workspace, which is what refreshes the connection's token. It never resends a mutation.
  const refused = `The Social service refused this request. ${NOT_DONE[action]}`;
  const suffix = action === 'save' ? ` ${KEPT}` : action === 'run' ? ' Nothing is resent automatically.' : '';
  return {
    surface: 'banner',
    tone: 'danger',
    title: 'Service refused the request',
    message: `${refused} Check again reconnects before retrying.${suffix}`,
    recovery: 'check-again',
  };
}

function unavailable(action: PortAction): PortNotice {
  const message: Record<PortAction, string> = {
    load: 'The Social service is unreachable. Nothing was changed. Check again when it is running.',
    save: `The Social service is unreachable. Nothing was changed. ${KEPT}`,
    brand: 'The Social service is unreachable. Nothing was changed.',
    run: 'The Social service is unreachable. Nothing was changed, and no run was started. Runs are paused until the service is reachable. Checking again never resends a run.',
    read: 'The Social service is unreachable. Nothing was changed.',
  };
  return { surface: 'banner', tone: 'warning', title: 'Social service unreachable', message: message[action], recovery: 'check-again' };
}

function unknown(action: PortAction): PortNotice {
  switch (action) {
    case 'run':
      // Never offer Run again here: the service may have started the run.
      return {
        surface: 'toast',
        tone: 'warning',
        title: 'Run status unknown',
        message: `HQ could not confirm whether the Social service started this run. ${DO_NOT_START_AGAIN} Check again to look for it in the run history.`,
        recovery: 'check-again',
      };
    case 'save':
    case 'brand':
      return {
        surface: 'inline',
        tone: 'warning',
        title: action === 'save' ? 'Save not confirmed' : 'Brand not confirmed',
        message: `HQ could not confirm the result: the Social service may or may not have ${action === 'save' ? 'saved this draft' : 'added this brand'}, so check again before saving again.${action === 'save' ? ` ${KEPT}` : ''}`,
        recovery: 'check-again',
      };
    case 'load':
    case 'read':
      // Reads normally fail as `unavailable`; an unconfirmed answer is shown the same way, never as data.
      return {
        surface: 'banner',
        tone: 'warning',
        title: 'Result not confirmed',
        message: `HQ could not confirm the Social service's answer for ${NOUN[action]}. Nothing was changed. Check again.`,
        recovery: 'check-again',
      };
  }
}

/** The notice for a failed port call. Exhaustive over `PortError` and `PortAction`; add a case when either grows. */
export function portErrorNotice(error: PortError, action: PortAction): PortNotice {
  switch (error.kind) {
    case 'invalid': return invalid(error, action);
    case 'conflict': return conflict(error, action);
    case 'not_found': return notFound(action);
    case 'forbidden': return forbidden(action);
    case 'unavailable': return unavailable(action);
    case 'unknown': return unknown(action);
  }
}
