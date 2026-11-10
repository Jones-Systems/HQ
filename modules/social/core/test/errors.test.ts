import { describe, expect, it } from 'vitest';
import * as core from '../index';
import { MESSAGES } from '../validate';
import { portErrorNotice, type PortAction, type PortNotice, type PortRecovery } from '../errors';
import type { PortError } from '../port';

type Kind = PortError['kind'];
type Shape = readonly [surface: PortNotice['surface'], tone: PortNotice['tone'], recovery: PortRecovery];

/** One sample per kind. Typed as a record so a new `PortError` kind fails typecheck until it is covered. */
const ERRORS: Record<Kind, PortError> = {
  invalid: { kind: 'invalid', message: 'Title must be text, 1–200 characters' },
  conflict: { kind: 'conflict', message: MESSAGES.conflict },
  not_found: { kind: 'not_found' },
  forbidden: { kind: 'forbidden' },
  unavailable: { kind: 'unavailable' },
  unknown: { kind: 'unknown', attemptedAt: '2026-11-03T12:00:00.000Z' },
};
const KINDS = Object.keys(ERRORS) as Kind[];
/** Likewise for actions. */
const ACTIONS = Object.keys({ load: 0, save: 0, brand: 0, run: 0, read: 0 } satisfies Record<PortAction, 0>) as PortAction[];

const everywhere = (shape: Shape): Record<PortAction, Shape> => ({ load: shape, save: shape, brand: shape, run: shape, read: shape });

/** The complete surface, tone and recovery for every kind and action. */
const EXPECTED: Record<Kind, Record<PortAction, Shape>> = {
  invalid: everywhere(['inline', 'danger', 'fix-input']),
  conflict: {
    save: ['inline', 'warning', 'reload-latest'],
    run: ['toast', 'warning', 'none'],
    brand: ['inline', 'warning', 'reload-latest'],
    load: ['toast', 'warning', 'check-again'],
    read: ['toast', 'warning', 'check-again'],
  },
  not_found: everywhere(['toast', 'warning', 'check-again']),
  forbidden: everywhere(['banner', 'danger', 'check-again']),
  unavailable: everywhere(['banner', 'warning', 'check-again']),
  unknown: {
    run: ['toast', 'warning', 'check-again'],
    save: ['inline', 'warning', 'check-again'],
    brand: ['inline', 'warning', 'check-again'],
    load: ['banner', 'warning', 'check-again'],
    read: ['banner', 'warning', 'check-again'],
  },
};

const ALL = KINDS.flatMap((kind) => ACTIONS.map((action) => ({ kind, action, error: ERRORS[kind], notice: portErrorNotice(ERRORS[kind], action) })));
const DO_NOT_START = "Don't start it again until the status is known.";

describe('portErrorNotice', () => {
  it('is exported from the core entry point', () => {
    expect(core.portErrorNotice).toBe(portErrorNotice);
  });

  it('covers every PortError kind and every action', () => {
    expect(KINDS).toEqual(['invalid', 'conflict', 'not_found', 'forbidden', 'unavailable', 'unknown']);
    expect(ACTIONS).toEqual(['load', 'save', 'brand', 'run', 'read']);
    expect(ALL).toHaveLength(30);
  });

  describe.each(ALL)('$kind × $action', ({ kind, action, notice }) => {
    it('has the specified surface, tone and recovery', () => {
      expect([notice.surface, notice.tone, notice.recovery]).toEqual(EXPECTED[kind][action]);
    });

    it('carries plain, non-empty text and only the typed fields', () => {
      expect(Object.keys(notice).sort()).toEqual(['message', 'recovery', 'surface', 'title', 'tone']);
      for (const text of [notice.title, notice.message]) {
        expect(text.trim()).toBe(text);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/[<>]/);
      }
    });

    it('never says something happened that did not (copy and honesty rules)', () => {
      expect(`${notice.title} ${notice.message}`).not.toMatch(/\b(?:scheduled|published|posted|live|connected|succeeded|success)\b/i);
    });
  });

  it('is pure: the same error gives equal notices and the error is not touched', () => {
    for (const kind of KINDS) {
      const error = Object.freeze({ ...ERRORS[kind] }) as PortError;
      for (const action of ACTIONS) expect(portErrorNotice(error, action)).toEqual(portErrorNotice({ ...error }, action));
    }
  });

  describe('invalid', () => {
    it.each(ACTIONS)('shows the service message verbatim for %s', (action) => {
      const notice = portErrorNotice(ERRORS.invalid, action);
      expect(notice.message).toBe('Title must be text, 1–200 characters');
      expect(notice.surface).toBe('inline');
    });
  });

  describe('conflict', () => {
    it('on save is "Changed elsewhere", with the service message and a reload', () => {
      expect(portErrorNotice({ kind: 'conflict', message: MESSAGES.conflict }, 'save')).toEqual({
        surface: 'inline', tone: 'warning', title: 'Changed elsewhere', message: MESSAGES.conflict, recovery: 'reload-latest',
      });
    });

    it('on run is a full queue: a toast with the service message and nothing to do', () => {
      const notice = portErrorNotice({ kind: 'conflict', message: MESSAGES.queueFull }, 'run');
      expect(notice).toMatchObject({ surface: 'toast', tone: 'warning', message: 'Run queue is full. Wait for a run to finish.', recovery: 'none' });
    });

    it.each(ACTIONS)('shows the service message verbatim for %s', (action) => {
      expect(portErrorNotice({ kind: 'conflict', message: 'Some other conflict.' }, action).message).toBe('Some other conflict.');
    });
  });

  describe('forbidden', () => {
    it.each(ACTIONS)('for %s says the service refused it and that Check again reconnects before retrying', (action) => {
      const { message, surface, recovery } = portErrorNotice(ERRORS.forbidden, action);
      expect(surface).toBe('banner');
      expect(message).toContain('The Social service refused this request.');
      expect(message).toContain('Check again reconnects before retrying.');
      expect(recovery).toBe('check-again');
    });

    it('says a refused run did not start and is never resent', () => {
      expect(portErrorNotice(ERRORS.forbidden, 'run').message).toContain('The run did not start.');
      expect(portErrorNotice(ERRORS.forbidden, 'run').message).toContain('Nothing is resent automatically.');
    });
  });

  describe('unavailable', () => {
    it.each(ACTIONS)('for %s says nothing changed', (action) => {
      expect(portErrorNotice(ERRORS.unavailable, action).message).toMatch(/Nothing was changed\b/);
    });

    it('for save says the text is kept in this session', () => {
      expect(portErrorNotice(ERRORS.unavailable, 'save').message).toContain('Your text is kept in this session.');
    });

    it('for run says runs are paused until the service is reachable, and that checking never resends a run', () => {
      const { message } = portErrorNotice(ERRORS.unavailable, 'run');
      expect(message).toContain('Runs are paused until the service is reachable.');
      expect(message).toContain('Checking again never resends a run.');
    });

    it('is a banner for load and read', () => {
      for (const action of ['load', 'read'] as const) expect(portErrorNotice(ERRORS.unavailable, action).surface).toBe('banner');
    });
  });

  describe('not_found', () => {
    it.each(ACTIONS)('for %s is a toast that can only check again', (action) => {
      expect(portErrorNotice(ERRORS.not_found, action)).toMatchObject({ surface: 'toast', tone: 'warning', recovery: 'check-again' });
    });

    it('for save says the draft is gone and keeps the text', () => {
      const { message } = portErrorNotice(ERRORS.not_found, 'save');
      expect(message).toContain('This draft is no longer in the workspace.');
      expect(message).toContain('Your text is kept in this session.');
    });
  });

  describe('unknown', () => {
    it('on run is "Run status unknown" and forbids starting it again', () => {
      const notice = portErrorNotice(ERRORS.unknown, 'run');
      expect(notice.surface).toBe('toast');
      expect(notice.tone).toBe('warning');
      expect(notice.title).toBe('Run status unknown');
      expect(notice.message).toContain(DO_NOT_START);
      expect(notice.recovery).toBe('check-again');
    });

    it.each(['save', 'brand'] as const)('on %s says HQ could not confirm the result and to check again before saving again', (action) => {
      const notice = portErrorNotice(ERRORS.unknown, action);
      expect(notice.surface).toBe('inline');
      expect(notice.tone).toBe('warning');
      expect(notice.message).toContain('HQ could not confirm the result');
      expect(notice.message).toContain('check again before saving again');
      expect(notice.recovery).toBe('check-again');
    });

    it('on save keeps the text', () => {
      expect(portErrorNotice(ERRORS.unknown, 'save').message).toContain('Your text is kept in this session.');
    });

    it.each(['load', 'read'] as const)('on %s is a banner that does not present the result as data', (action) => {
      const notice = portErrorNotice(ERRORS.unknown, action);
      expect(notice).toMatchObject({ surface: 'banner', tone: 'warning', recovery: 'check-again' });
      expect(notice.message).toContain('HQ could not confirm');
    });

    it('never claims the outcome either way', () => {
      for (const action of ACTIONS) {
        const { title, message } = portErrorNotice(ERRORS.unknown, action);
        expect(`${title} ${message}`).not.toMatch(/\b(?:was|were|has been|have been) (?:saved|added|started|created)\b|\bfailed\b|\bsucceeded\b/i);
      }
    });
  });

  describe('a run is never offered again', () => {
    const textOf = (notice: PortNotice) => `${notice.title} ${notice.message}`;
    // "Check again" re-reads; every other "again", and any retry wording, would offer another run.
    const withoutCheckAgain = (text: string) => text.replaceAll(DO_NOT_START, '').replaceAll(/check(?:ing)? again/gi, '');

    it('unknown after a run submission has no run-again, retry or resend wording at all', () => {
      const notice = portErrorNotice(ERRORS.unknown, 'run');
      expect(textOf(notice)).toContain(DO_NOT_START);
      expect(withoutCheckAgain(textOf(notice))).not.toMatch(/again|retry|retrying|resend|resubmit|re-?run|try (?:it |once )?more/i);
    });

    it('unknown after a run submission only ever offers Check again, never fix-input, reload-latest or an action that runs', () => {
      expect(portErrorNotice(ERRORS.unknown, 'run').recovery).toBe('check-again');
    });

    it.each(KINDS)('%s on run never tells the person to run or start it again', (kind) => {
      const notice = portErrorNotice(ERRORS[kind], 'run');
      expect(withoutCheckAgain(textOf(notice))).not.toMatch(/\b(?:run|start|submit|send)\b[^.]*\bagain\b|\brun it\b|\bre-?run\b|\bresubmit\b/i);
      expect(notice.recovery).not.toBe('reload-latest');
    });

    it('carries the do-not-start sentence on unknown after a run submission and nowhere else', () => {
      for (const { kind, action, notice } of ALL) {
        expect(notice.message.includes(DO_NOT_START)).toBe(kind === 'unknown' && action === 'run');
      }
    });
  });

  describe('delivered wording', () => {
    it('reuses the phrases the pages already show', () => {
      const text = ALL.map(({ notice }) => `${notice.title}\n${notice.message}`).join('\n');
      for (const phrase of ['Changed elsewhere', 'Check again', DO_NOT_START, 'Your text is kept in this session']) expect(text).toContain(phrase);
    });
  });
});
