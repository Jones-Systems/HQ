// @vitest-environment happy-dom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseProjectContext, type ModulePort } from '@hq/contracts';
import { PRESERVED_CONTENT_KINDS } from '@hq/ui';
import SocialDefault, { SocialModule } from '@hq/social';
import { resetSocialSessions } from './core';
import { setSocialWorkspacePort } from './nav';

afterEach(() => {
  cleanup();
  resetSocialSessions();
  setSocialWorkspacePort(null);
});

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

  it('mounts the Social domain descriptor under the shell context without navigating', async () => {
    expect(SocialDefault).toBe(SocialModule);
    const props = port('home');
    render(createElement(SocialModule, props));
    expect(screen.getByRole('navigation', { name: 'Social' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeTruthy();
    expect(screen.getByText(/^Fictional example workspace/u)).toBeTruthy();
    expect(props.navigate).not.toHaveBeenCalled();
  });
});
