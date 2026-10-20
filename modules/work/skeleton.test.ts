// @vitest-environment happy-dom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseProjectContext, type ModulePort } from '@hq/contracts';
import { PRESERVED_CONTENT_KINDS } from '@hq/ui';
import { WorkModule } from '@hq/work';

afterEach(cleanup);

function port(destination: string): ModulePort & { navigate: Mock<(destination: string) => void> } {
  return {
    context: parseProjectContext({ id: 'fixture-project', name: 'Atlas Weekend Market' })!,
    destination, appearance: 'dark',
    desktop: { platform: 'browser', versions: { electron: null } },
    navigate: vi.fn<(destination: string) => void>(),
  };
}

describe('Work workspace skeleton', () => {
  it('resolves its workspace dependencies by package name', () => {
    expect(PRESERVED_CONTENT_KINDS).toContain('export');
  });

  it('renders an available, no-data stub with the shell context and destination', () => {
    const props = port('home');
    render(createElement(WorkModule, props));
    expect(screen.getByRole('heading', { level: 1, name: 'Work is available.' })).toBeTruthy();
    expect(screen.getByText('Atlas Weekend Market')).toBeTruthy();
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.getByText('Available · no data')).toBeTruthy();
    expect(props.navigate).not.toHaveBeenCalled();
  });
});
