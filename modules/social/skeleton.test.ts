// @vitest-environment happy-dom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseProjectContext, type ModulePort } from '@hq/contracts';
import { PRESERVED_CONTENT_KINDS } from '@hq/ui';
import { SocialModule } from '@hq/social';

afterEach(cleanup);

function port(destination: string): ModulePort & { navigate: Mock<(destination: string) => void> } {
  return {
    context: parseProjectContext({ id: 'fixture-project', name: 'Larkspur Tea Co.' })!,
    destination, appearance: 'light',
    desktop: { platform: 'browser', versions: { electron: null } },
    navigate: vi.fn<(destination: string) => void>(),
  };
}

describe('Social workspace skeleton', () => {
  it('resolves its workspace dependencies by package name', () => {
    expect(PRESERVED_CONTENT_KINDS).toContain('captured');
  });

  it('renders an available, no-data stub with the shell context and destination', () => {
    const props = port('library');
    render(createElement(SocialModule, props));
    expect(screen.getByRole('heading', { level: 1, name: 'Social is available.' })).toBeTruthy();
    expect(screen.getByText('Larkspur Tea Co.')).toBeTruthy();
    expect(screen.getByText('library')).toBeTruthy();
    expect(screen.getByText('Available · no data')).toBeTruthy();
    expect(props.navigate).not.toHaveBeenCalled();
  });
});
