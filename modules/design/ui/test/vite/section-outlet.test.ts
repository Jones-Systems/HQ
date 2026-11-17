// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesignSectionProps, SectionStateHandle } from '../../contract.ts';
import type { RegisteredSection } from '../../src/registry.ts';
import { SectionOutlet, type SectionOutletProps, type SectionView } from '../../src/view/SectionOutlet.tsx';

const handle: SectionStateHandle = { read: () => undefined, write: () => true } as unknown as SectionStateHandle;

function section(view: () => Promise<SectionView>): RegisteredSection<SectionView> {
  return { schema: 'hq.design.section/v1', id: 'stub', title: 'Stub', nav: 'review', order: 0, commands: [], path: 'stub', view } as unknown as RegisteredSection<SectionView>;
}

type RouteProps = Partial<Pick<SectionOutletProps, 'sub' | 'subExplicit' | 'navigateSub'>>;

function outlet(registered: RegisteredSection<SectionView>, route: RouteProps = {}) {
  return createElement(SectionOutlet, {
    section: registered, context: { id: 'alpha', name: 'Alpha' }, appearance: 'light', state: handle,
    sub: null, subExplicit: false, navigateSub: () => undefined,
    navigate: () => undefined, propose: () => undefined, onCommand: () => () => undefined, ...route,
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

  it('passes the view, whether the route named it, and navigateSub straight to the section', async () => {
    const seen: DesignSectionProps[] = [];
    const picked: (string | null)[] = [];
    const view: SectionView = (props: DesignSectionProps) => {
      seen.push(props);
      return createElement('button', { type: 'button', onClick: () => props.navigateSub('swipe') }, `sub:${props.sub ?? 'none'}`);
    };
    render(outlet(section(async () => view), { sub: 'matrix', subExplicit: true, navigateSub: (next) => { picked.push(next); } }));
    fireEvent.click(await screen.findByText('sub:matrix'));
    expect(picked).toEqual(['swipe']);
    const last = seen[seen.length - 1]!;
    expect(last.sub).toBe('matrix');
    expect(last.subExplicit).toBe(true);
    expect(last.state).toBe(handle);
    expect(last.sectionId).toBe('stub');
  });

  it('a changed view re-renders the section without reloading or remounting it', async () => {
    let loads = 0;
    const mounts = { count: 0 };
    const view: SectionView = (props: DesignSectionProps) => {
      useEffect(() => { mounts.count += 1; }, []);
      return createElement('p', null, `sub:${props.sub ?? 'none'}:${String(props.subExplicit)}`);
    };
    const registered = section(async () => { loads += 1; return view; });
    const mounted = render(outlet(registered, { sub: 'strip' }));
    expect(await screen.findByText('sub:strip:false')).toBeTruthy();
    mounted.rerender(outlet(registered, { sub: 'swipe', subExplicit: true }));
    expect(screen.getByText('sub:swipe:true')).toBeTruthy();
    mounted.rerender(outlet(registered, { sub: null }));
    expect(screen.getByText('sub:none:false')).toBeTruthy();
    expect(loads).toBe(1);
    expect(mounts.count).toBe(1);
  });

  it('a section that does not use views is unaffected by them', async () => {
    const view: SectionView = () => createElement('p', null, 'Plain section');
    render(outlet(section(async () => view), { sub: 'strip', subExplicit: true }));
    expect(await screen.findByText('Plain section')).toBeTruthy();
  });
});
