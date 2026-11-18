// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { assessmentId, projectId, projectVersionSubject, type RatingValue, type TasteClientPort, type TasteEvent } from '../../src/contract.ts';
import { TastePanel } from '../../src/ui/TastePanel.tsx';
import { Documents, bind, seedJournal } from '../document-port.ts';
import { GENERAL, PROJECT_A, PROJECT_B, subject } from '../helpers.ts';

const A = projectId('project-a');
const B = projectId('project-b');
// Deterministic capture IDs repeat across projects: the same digest names a version in each.
const SHARED = 'capture-0123456789abcdef';
const LABELS: Readonly<Record<RatingValue, string>> = { 1: 'Strongly dislike', 2: 'Dislike', 3: 'Neutral', 4: 'Like', 5: 'Love' };

afterEach(cleanup);

const overall = (value: RatingValue) => screen.getByRole('radio', { name: `Overall: ${value}, ${LABELS[value]}` }) as HTMLInputElement;
const checked = () => ([1, 2, 3, 4, 5] as const).filter((value) => overall(value).checked);
const rated = (scope: typeof GENERAL | typeof PROJECT_A, id: string, value: RatingValue): TasteEvent => ({
  type: 'assessment.recorded', assessmentId: assessmentId(id), scope, subject: subject(SHARED), judgment: 'liking',
  target: { kind: 'overall' }, value, supersedes: null,
});

function sequence(prefix: string) {
  let count = 0;
  return () => `${prefix}-${++count}`;
}

function panel(client: TasteClientPort, project: typeof A) {
  return <TastePanel client={client} projectId={project} projectName={`Project ${project.slice(-1).toUpperCase()}`}
    subject={projectVersionSubject(project, SHARED, 'Synthetic landing v2')} newId={sequence(`new-${project}`)} />;
}

describe('TastePanel over journals written before version subjects were qualified', () => {
  it('shows a project rating saved earlier for the same version, and not a general one that names no project', async () => {
    const documents = new Documents();
    await seedJournal(documents, [
      { id: 'l1', event: rated(PROJECT_A, 'legacy-a', 4) },
      { id: 'l2', event: rated(PROJECT_B, 'legacy-b', 2) },
      { id: 'l3', event: rated(GENERAL, 'legacy-general', 5) },
    ]);
    const before = structuredClone(documents.value);
    render(panel(bind(documents, A), A));
    await screen.findByText('Project profile');
    expect(checked()).toEqual([4]);

    fireEvent.click(screen.getByLabelText('General taste'));
    expect(checked()).toEqual([]);
    expect(screen.queryByText(/Re-rated/)).toBeNull();

    // A new general rating is its own rating: it does not replace the earlier unattributed one.
    fireEvent.click(overall(3));
    await screen.findByText('Saved.');
    await waitFor(() => expect(checked()).toEqual([3]));
    expect(screen.queryByText(/Re-rated/)).toBeNull();
    // The earlier unattributed rating and the new one are two subjects in general taste.
    expect(await screen.findByText('Limited sample: 2 rated subjects, fewer than 5')).toBeTruthy();
    const stored = (documents.value as { jsonl: string }).jsonl;
    expect(stored.startsWith((before as { jsonl: string }).jsonl)).toBe(true);
    expect(documents.revision).toBe(2);
  });

  it('re-rates the project rating saved earlier instead of adding a second one', async () => {
    const documents = new Documents();
    await seedJournal(documents, [{ id: 'l1', event: rated(PROJECT_A, 'legacy-a', 2) }]);
    render(panel(bind(documents, A), A));
    await screen.findByText('Project profile');
    expect(checked()).toEqual([2]);
    fireEvent.click(overall(5));
    await screen.findByText('Saved.');
    await waitFor(() => expect(checked()).toEqual([5]));
    expect(await screen.findByText('Re-rated; earlier 2')).toBeTruthy();
  });
});

describe('TastePanel when two projects reuse one version ID', () => {
  it('keeps each project’s general rating of that version apart', async () => {
    const documents = new Documents();
    const first = render(panel(bind(documents, A), A));
    await screen.findByText('Project profile');
    fireEvent.click(screen.getByLabelText('General taste'));
    fireEvent.click(overall(5));
    await screen.findByText('Saved.');
    await waitFor(() => expect(checked()).toEqual([5]));
    first.unmount();

    render(panel(bind(documents, B), B));
    await screen.findByText('Project profile');
    fireEvent.click(screen.getByLabelText('General taste'));
    // Project A’s rating of its own version is not this version’s rating.
    expect(checked()).toEqual([]);
    fireEvent.click(overall(1));
    await screen.findByText('Saved.');
    await waitFor(() => expect(checked()).toEqual([1]));
    expect(screen.queryByText(/Re-rated/)).toBeNull();
    expect(await screen.findByText('Limited sample: 2 rated subjects, fewer than 5')).toBeTruthy();
    cleanup();

    render(panel(bind(documents, A), A));
    await screen.findByText('Project profile');
    fireEvent.click(screen.getByLabelText('General taste'));
    expect(checked()).toEqual([5]);
  });
});
