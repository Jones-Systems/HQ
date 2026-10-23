// @vitest-environment happy-dom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { isDestination, parseProjectContext, type ModulePort } from '@hq/contracts';
import { PRESERVED_CONTENT_KINDS } from '@hq/ui';
import WorkDefault, { WorkModule } from '@hq/work';
import { resetWorkSessions } from './nav';

afterEach(() => {
  cleanup();
  resetWorkSessions();
});

function port(destination: string): ModulePort & { navigate: Mock<(destination: string) => void> } {
  return {
    context: parseProjectContext({ id: 'fixture-project', name: 'Atlas Weekend Market' })!,
    destination, appearance: 'dark',
    desktop: { platform: 'browser', versions: { electron: null } },
    navigate: vi.fn<(destination: string) => void>(),
  };
}

describe('Work workspace descriptor', () => {
  it('resolves its workspace dependencies by package name', () => {
    expect(PRESERVED_CONTENT_KINDS).toContain('export');
    expect(isDestination('home')).toBe(true);
    expect(WorkDefault).toBe(WorkModule);
  });

  it('mounts the Work domain at home on the Board without navigating', async () => {
    const props = port('home');
    render(createElement(WorkModule, props));
    expect(screen.getByRole('heading', { level: 1, name: 'Work · Status board' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Status board' })).toBeTruthy();
    expect(screen.getByText('Example data')).toBeTruthy();
    await act(async () => {});
    expect(props.navigate).not.toHaveBeenCalled();
  });
});
