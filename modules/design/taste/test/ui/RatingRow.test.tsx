// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessmentId, aspectId, type AssessmentView, type RatingValue, subjectId } from '../../src/contract.ts';
import { RatingRow } from '../../src/ui/RatingRow.tsx';
import { LIKING_LABELS, type RatingSlot } from '../../src/ui/view-model.ts';

/** The segmented 1–5 control: what it renders, how the keys behave, and when it says "Saved". */

function view(id: string, value: RatingValue): AssessmentView {
  return {
    assessmentId: assessmentId(id), seq: 1, recordedAt: '2026-11-03T10:00:00.000Z', scope: { kind: 'general' },
    subject: { id: subjectId('s'), kind: 'other', label: 'Synthetic' }, judgment: 'liking', target: { kind: 'overall' },
    value, supersedes: null, supersededBy: null,
  };
}

function slot(current: AssessmentView | null, label = 'Overall'): RatingSlot {
  return { key: `liking:${label}`, judgment: 'liking', target: { kind: 'overall' }, label, current, history: [] };
}

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[];

afterEach(cleanup);

describe('RatingRow segmented control', () => {
  it('labels five steps, shows the chosen one as pressed and puts the pill under it', () => {
    const html = renderToStaticMarkup(<RatingRow slot={slot(view('a', 4))} name="n" disabled={false} onRate={() => undefined}
      labels={LIKING_LABELS} />);
    expect(html).toContain('class="taste-seg" data-value="4"');
    expect(html).toContain('class="taste-seg-pill"');
    for (const [value, word] of Object.entries(LIKING_LABELS)) expect(html).toContain(`aria-label="Overall: ${value}, ${word}"`);
    expect(html).toMatch(/<input type="radio"[^>]*aria-label="Overall: 4, Like"[^>]*checked=""|<input type="radio"[^>]*checked=""[^>]*aria-label="Overall: 4, Like"/u);
    expect((html.match(/checked=""/gu) ?? []).length).toBe(1);
    // The visible words: each step shows its number, and the chosen word is written out beside the control.
    expect(html).toContain('<span aria-hidden="true">4</span>');
    expect(html).toContain('<span class="taste-seg-word" aria-hidden="true">Like</span>');
  });

  it('has no pill value before anything is chosen, and shows both ends of a description scale', () => {
    const html = renderToStaticMarkup(<RatingRow slot={slot(null, 'Typography')} name="n" disabled={false} onRate={() => undefined}
      anchors={['Plain', 'Expressive']} />);
    expect(html).not.toContain('data-value');
    expect(html).toContain('>Plain</span>');
    expect(html).toContain('>Expressive</span>');
    expect(html).toContain('aria-label="Typography: 3 of 5"');
  });

  it('chooses a value with the pointer, and nothing else does', () => {
    const onRate = vi.fn();
    render(<RatingRow slot={slot(null)} name="n" disabled={false} onRate={onRate} labels={LIKING_LABELS} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Overall: 5, Love' }));
    expect(onRate).toHaveBeenCalledWith(5);
  });

  it('moves focus along the row with the arrows without choosing, and chooses with Enter', () => {
    const onRate = vi.fn();
    render(<RatingRow slot={slot(view('a', 2))} name="n" disabled={false} onRate={onRate} labels={LIKING_LABELS} />);
    const [one, two, three, four, five] = radios();
    two!.focus();
    fireEvent.keyDown(two!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(three);
    fireEvent.keyDown(three!, { key: 'ArrowRight' });
    fireEvent.keyDown(four!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(five);
    fireEvent.keyDown(five!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(five);
    fireEvent.keyDown(five!, { key: 'Home' });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one!, { key: 'End' });
    expect(document.activeElement).toBe(five);
    // Passing over steps rated nothing.
    expect(onRate).not.toHaveBeenCalled();
    fireEvent.keyDown(five!, { key: 'Enter' });
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate).toHaveBeenCalledWith(5);
  });

  it('does not re-choose the value that is already chosen', () => {
    const onRate = vi.fn();
    render(<RatingRow slot={slot(view('a', 3))} name="n" disabled={false} onRate={onRate} labels={LIKING_LABELS} />);
    const three = radios()[2]!;
    three.focus();
    fireEvent.keyDown(three, { key: 'Enter' });
    expect(onRate).not.toHaveBeenCalled();
  });

  it('is disabled as a whole row, through its fieldset', () => {
    render(<RatingRow slot={slot(null)} name="n" disabled onRate={() => undefined} labels={LIKING_LABELS} />);
    expect((document.querySelector('fieldset.taste-row') as HTMLFieldSetElement).disabled).toBe(true);
  });
});

describe('RatingRow saved state', () => {
  const ui = (current: AssessmentView | null, name = 'n') => <RatingRow slot={slot(current)} name={name} disabled={false} onRate={() => undefined}
    labels={LIKING_LABELS} />;

  it('stays quiet on first render, even for a rating that was already there', () => {
    render(ui(view('a', 4)));
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('says Saved only once the read-back rating changes, and clears it after a few seconds', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(ui(null));
      expect(screen.queryByText('Saved')).toBeNull();
      // A click alone says nothing; the snapshot has to come back with the new rating.
      fireEvent.click(screen.getByRole('radio', { name: 'Overall: 4, Like' }));
      expect(screen.queryByText('Saved')).toBeNull();
      rerender(ui(view('a', 4)));
      expect(screen.getByText('Saved')).toBeTruthy();
      expect(document.querySelector('.taste-row')?.classList.contains('hq-flash')).toBe(true);
      act(() => { vi.advanceTimersByTime(3500); });
      expect(screen.queryByText('Saved')).toBeNull();
      rerender(ui(view('b', 2)));
      expect(screen.getByText('Saved')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not call a change of scope a save', () => {
    const { rerender } = render(ui(view('a', 4), 'project'));
    rerender(ui(view('z', 1), 'general'));
    expect(screen.queryByText('Saved')).toBeNull();
    expect(document.querySelector('.taste-row')?.classList.contains('hq-flash')).toBe(false);
  });

  it('labels aspect scales for the description section the same way', () => {
    const description: RatingSlot = { key: 'descriptive:typography', judgment: 'descriptive', target: { kind: 'aspect', aspect: aspectId('typography') }, label: 'Typography', current: null, history: [] };
    render(<RatingRow slot={description} name="d" disabled={false} onRate={() => undefined} anchors={['Plain', 'Expressive']} />);
    expect(screen.getByRole('radio', { name: 'Typography: 1 of 5' })).toBeTruthy();
    expect(radios().length).toBe(5);
  });
});
