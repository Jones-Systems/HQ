import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompactNav, DisclosureNav, ModuleNavHostProvider, useDomainNavSource, useModuleNavHost, type DomainNavSource, type NavExpansionState, type NavNode } from '../src/nav';

afterEach(cleanup);

const nodes: readonly NavNode[] = [
  { id: 'resources', label: 'Resources', destination: 'resources', children: [
    { id: 'library', label: 'Library', destination: null, children: [
      { id: 'tokens', label: 'Tokens', destination: 'resources/tokens' },
      { id: 'motion', label: 'Motion', destination: 'resources/motion' },
    ] },
  ] },
  { id: 'projects', label: 'Projects', destination: 'projects' },
];
const defaults = { label: 'Design navigation', projectId: 'project-a', nodes, destination: 'projects' };

describe('nested disclosure navigation', () => {
  it('separates navigation from toggling and uses lists, disclosure relations and exact current matching', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { container, rerender } = render(<DisclosureNav {...defaults} destination="resources/tokens" onNavigate={navigate} />);
    expect(screen.queryByRole('tree')).toBeNull();
    const resource = screen.getByRole('button', { name: /^Resources/ });
    expect(resource.getAttribute('aria-current')).toBeNull();
    expect(resource.textContent).toContain('Contains current page');
    const toggle = screen.getByRole('button', { name: 'Collapse Resources' });
    const controlled = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(controlled?.tagName).toBe('UL');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.querySelector('svg path')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tokens' }).getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    await user.click(toggle);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Tokens' })).toBeNull();
    await user.click(resource);
    expect(navigate).toHaveBeenCalledWith('resources', expect.objectContaining({ id: 'resources' }));
    rerender(<DisclosureNav {...defaults} destination="resources/tokens/unknown" onNavigate={navigate} />);
    expect(container.querySelector('[aria-current]')).toBeNull();
  });

  it('keeps natural Tab and native Enter/Space actions alongside visible-row arrow navigation', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<DisclosureNav {...defaults} onNavigate={navigate} />);
    const resource = screen.getByRole('button', { name: 'Resources' });
    await user.tab();
    expect(document.activeElement).toBe(resource);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand Resources' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Expand Library' })).toBeTruthy();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand Library' }));
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Collapse Library' })).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tokens' }));
    await user.keyboard('{Enter} ');
    expect(navigate).toHaveBeenCalledTimes(2);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Collapse Library' }));
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('button', { name: 'Tokens' })).toBeNull();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Projects' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(resource);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(resource);
  });

  it('recovers focus to a surviving ancestor after externally controlled collapse or snapshot removal', () => {
    const navigate = vi.fn();
    const open: NavExpansionState = { projectId: 'project-a', locationKey: 'tokens', expandedIds: ['resources', 'library'] };
    const { rerender } = render(<DisclosureNav {...defaults} destination="resources/tokens" locationKey="tokens" expansion={open} onNavigate={navigate} />);
    screen.getByRole('button', { name: 'Tokens' }).focus();
    rerender(<DisclosureNav {...defaults} destination="resources/tokens" locationKey="tokens" expansion={{ ...open, expandedIds: ['resources'] }} onNavigate={navigate} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand Library' }));
    rerender(<DisclosureNav {...defaults} nodes={[nodes[1]!]} destination="resources/tokens" locationKey="tokens" expansion={open} onNavigate={navigate} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Projects' }));
  });

  it('auto-expands a changed location once and keeps a later manual collapse through source refresh', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DisclosureNav {...defaults} destination="resources/tokens" onNavigate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Collapse Resources' }));
    rerender(<DisclosureNav {...defaults} nodes={[...nodes]} destination="resources/tokens" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Expand Resources' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tokens' })).toBeNull();
    rerender(<DisclosureNav {...defaults} destination="resources/motion" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Motion' }).getAttribute('aria-current')).toBe('page');
  });

  it('describes loading, stale, error and bounded snapshots without activating a source', async () => {
    const expand = vi.fn();
    const lazy: readonly NavNode[] = [{ id: 'components', label: 'Components', destination: null, lazy: true, status: 'loading' }];
    const { rerender } = render(<DisclosureNav {...defaults} nodes={lazy} status="stale" onNavigate={vi.fn()} onExpand={expand} />);
    const toggle = screen.getByRole('button', { name: 'Expand Components' });
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe('Loading destinations');
    expect(screen.getByRole('status').textContent).toBe('Navigation may be out of date');
    fireEvent.click(toggle);
    expect(expand).toHaveBeenCalledWith('components');
    rerender(<DisclosureNav {...defaults} nodes={[]} status="loading" onNavigate={vi.fn()} />);
    expect(screen.getByRole('navigation').getAttribute('aria-busy')).toBe('true');
    rerender(<DisclosureNav {...defaults} nodes={[]} status="error" onNavigate={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Navigation could not be loaded');
    rerender(<DisclosureNav {...defaults} nodes={[{ id: 'bad id', label: 'Bad', destination: 'bad' }]} onNavigate={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Some navigation entries are unavailable');
  });
});

describe('compact injected navigation', () => {
  function Harness({ navigate, workspace }: { navigate: ReturnType<typeof vi.fn>; workspace: ReturnType<typeof vi.fn> }) {
    const [open, setOpen] = useState(false);
    return <><button type="button">Outside</button><CompactNav {...defaults} triggerLabel="Open Design navigation" open={open}
      onOpenChange={setOpen} onNavigate={navigate} onWorkspaceFocus={workspace} /></>;
  }

  it('contains focus, closes on Escape/scrim, restores the trigger and requests workspace focus only on selection', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const workspace = vi.fn();
    const { container } = render(<Harness navigate={navigate} workspace={workspace} />);
    const trigger = screen.getByRole('button', { name: 'Open Design navigation' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Design navigation' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Projects' }));
    within(dialog).getByRole('button', { name: 'Close navigation' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Resources' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close navigation' }));
    screen.getByRole('button', { name: 'Outside' }).focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(workspace).not.toHaveBeenCalled();
    await user.click(trigger);
    fireEvent.click(container.querySelector('.hq-compact-nav-scrim')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(navigate).toHaveBeenCalledWith('projects', expect.objectContaining({ id: 'projects' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(workspace).toHaveBeenCalledOnce();
  });

  it('keeps every nested child accessible and removes its focus guard on unmount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness navigate={vi.fn()} workspace={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Open Design navigation' }));
    await user.click(screen.getByRole('button', { name: 'Expand Resources' }));
    await user.click(screen.getByRole('button', { name: 'Expand Library' }));
    expect(screen.getByRole('button', { name: 'Tokens' })).toBeTruthy();
    unmount();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('opens on a visible control when the current destination is inside a deliberately collapsed group', () => {
    render(<CompactNav {...defaults} destination="resources/tokens" locationKey="tokens"
      expansion={{ projectId: 'project-a', locationKey: 'tokens', expandedIds: [] }}
      triggerLabel="Open Design navigation" open onOpenChange={vi.fn()} onNavigate={vi.fn()} onWorkspaceFocus={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Tokens' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Resources/ }));
  });
});

describe('project-bound source and default-off host context', () => {
  it('subscribes only to an injected project, ignores old notifications and unsubscribes on replacement/unmount', () => {
    const listeners = new Map<string, () => void>();
    const stops: string[] = [];
    const reads: string[] = [];
    const source: DomainNavSource = {
      getSnapshot(project) { reads.push(project); return [{ id: project, label: project, destination: project }]; },
      subscribe(project, listener) { listeners.set(project, listener); return () => { stops.push(project); }; },
      currentId: (project, destination) => project === destination ? project : null,
      activate: vi.fn(),
    };
    function Source({ project, selectedSource = source }: { project: string; selectedSource?: DomainNavSource | null }) {
      const snapshot = useDomainNavSource(selectedSource, project);
      return <DisclosureNav {...defaults} projectId={project} nodes={snapshot.model.nodes} destination={project}
        limited={snapshot.model.limited} status={snapshot.status === 'idle' ? 'ready' : snapshot.status} onNavigate={vi.fn()} />;
    }
    const { rerender, unmount } = render(<Source project="alpha" />);
    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy();
    const old = listeners.get('alpha')!;
    rerender(<Source project="beta" />);
    expect(stops).toEqual(['alpha']);
    expect(screen.queryByRole('button', { name: 'alpha' })).toBeNull();
    expect(screen.getByRole('button', { name: 'beta' })).toBeTruthy();
    const before = reads.length;
    act(old);
    expect(reads).toHaveLength(before);
    act(() => listeners.get('beta')!());
    expect(reads.at(-1)).toBe('beta');
    const replacement: DomainNavSource = { ...source, getSnapshot: () => [{ id: 'new', label: 'New source', destination: 'new' }] };
    rerender(<Source project="beta" selectedSource={replacement} />);
    expect(stops).toEqual(['alpha', 'beta']);
    expect(screen.getByRole('button', { name: 'New source' })).toBeTruthy();
    unmount();
    expect(stops).toEqual(['alpha', 'beta', 'beta']);
    expect(source.activate).not.toHaveBeenCalled();
  });

  it('fails closed for source read/subscription errors and has no provider lookup while disabled', () => {
    function Probe({ source }: { source: DomainNavSource | null }) {
      const snapshot = useDomainNavSource(source, 'project-a');
      return <output>{snapshot.status}:{snapshot.model.nodes.length}:{String(useModuleNavHost())}</output>;
    }
    const source: DomainNavSource = { getSnapshot() { throw new Error('read failed'); }, subscribe: () => vi.fn(), currentId: () => null };
    const { rerender } = render(<Probe source={null} />);
    expect(screen.getByRole('status').textContent).toBe('idle:0:false');
    rerender(<Probe source={source} />);
    expect(screen.getByRole('status').textContent).toBe('error:0:false');
    rerender(<ModuleNavHostProvider enabled><Probe source={null} /></ModuleNavHostProvider>);
    expect(screen.getByRole('status').textContent).toBe('idle:0:true');
    rerender(<ModuleNavHostProvider><Probe source={{ ...source, subscribe() { throw new Error('subscription failed'); } }} /></ModuleNavHostProvider>);
    expect(screen.getByRole('status').textContent).toBe('error:0:false');
  });
});
