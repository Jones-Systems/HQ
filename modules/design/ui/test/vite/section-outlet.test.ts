// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesignSectionProps, SectionStateHandle } from '../../contract.ts';
import type { RegisteredSection } from '../../src/registry.ts';
import { SectionOutlet, type SectionView } from '../../src/view/SectionOutlet.tsx';

const handle: SectionStateHandle = { read: () => undefined, write: () => true } as unknown as SectionStateHandle;

function section(view: () => Promise<SectionView>): RegisteredSection<SectionView> {
  return { schema: 'hq.design.section/v1', id: 'stub', title: 'Stub', nav: 'review', order: 0, commands: [], path: 'stub', view } as unknown as RegisteredSection<SectionView>;
}

function outlet(registered: RegisteredSection<SectionView>) {
  return createElement(SectionOutlet, {
    section: registered, context: { id: 'alpha', name: 'Alpha' }, appearance: 'light', state: handle,
    navigate: () => undefined, propose: () => undefined, onCommand: () => () => undefined,
  });
}

afterEach(cleanup);

describe('section outlet', () => {
  it('shows a busy skeleton with a status while the section loads', async () => {
    let resolve: (view: SectionView) => void = () => undefined;
    const pending = new Promise<SectionView>((done) => { resolve = done; });
    render(outlet(section(() => pending)));
    expect(screen.getByRole('status').textContent).toBe('Loading Stub…');
    expect(document.querySelector('.hqd-section-loading')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => { resolve(() => createElement('p', null, 'Loaded')); await pending; });
    expect(await screen.findByText('Loaded')).toBeTruthy();
    expect(document.querySelector('.hqd-section-loading')).toBeNull();
  });

  it('keeps a failure inside the section and loads it again on Try again', async () => {
    let attempts = 0;
    const view = async (): Promise<SectionView> => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk failed');
      return (_props: DesignSectionProps) => createElement('p', null, 'Recovered');
    };
    const quiet = console.error;
    console.error = () => undefined;
    try {
      render(outlet(section(view)));
      expect(await screen.findByText('Stub could not be shown')).toBeTruthy();
      expect(screen.getByText(/nothing you saved was changed/u)).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
      expect(await screen.findByText('Recovered')).toBeTruthy();
      expect(attempts).toBe(2);
    } finally {
      console.error = quiet;
    }
  });
});
