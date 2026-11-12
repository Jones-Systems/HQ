import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ModulePort } from '@hq/contracts';
import { PresentationShell } from '../PresentationShell';
import { ONBOARDING_KEY } from '../onboarding';
import { observedStatus } from '../services/observed-status';

const Stub = ({ destination }: ModulePort) => <div data-testid="destination">{destination}</div>;
const Design = (props: ModulePort) => <div onKeyDown={event => {
  if (event.key === 'k' && (event.metaKey || event.ctrlKey)) event.preventDefault();
}}><button>Design key owner</button><Stub {...props} /></div>;
const mount = () => render(<PresentationShell modules={{ design: Design, social: Stub, work: Stub, wiki: Stub }}
  presentation={{ design: 'fill', social: 'fill', work: 'fill', wiki: 'fill' }} referenceProviders={[]} />);

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ state: 'hidden' }));
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
  document.documentElement.dataset.hqMotion = 'reduce';
  observedStatus.reset();
});
afterEach(() => { cleanup(); observedStatus.reset(); delete document.documentElement.dataset.hqMotion; vi.restoreAllMocks(); });

it('mounts one palette and yields to a handled Design key', () => {
  mount();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Design key owner' }), { key: 'k', ctrlKey: true, metaKey: true });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search HQ and commands' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it('mounts onboarding and remembers a domain destination through shell navigation', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Search HQ and commands' }));
  fireEvent.click(screen.getByRole('option', { name: /Show getting started/ }));
  expect(screen.getByRole('heading', { name: 'Welcome to HQ' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
  const rail = screen.getByRole('navigation', { name: 'Domains' });
  fireEvent.click(rail.querySelector<HTMLButtonElement>('button[title="Work"]')!);
  const remembered = screen.getByTestId('destination').textContent;
  fireEvent.click(rail.querySelector<HTMLButtonElement>('button[title="Social"]')!);
  fireEvent.click(rail.querySelector<HTMLButtonElement>('button[title="Work"]')!);
  expect(screen.getByTestId('destination').textContent).toBe(remembered);
  expect(document.title).toContain('Work');
});
