import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { Header } from './Header';
import { AuthSession } from '../types';

const ADMIN: AuthSession = {
  authenticated: true,
  mode: 'forward-auth',
  user: { username: 'jdoe', name: 'Jane Doe', email: 'jane.doe@example.com', groups: ['admins'], role: 'admin' },
  viewerCategories: ['MEDIA'],
};
const VIEWER: AuthSession = {
  ...ADMIN,
  user: { username: 'alice.smith', name: null, email: null, groups: ['guests'], role: 'viewer' },
};

function renderHeader(session: AuthSession | null) {
  const handlers = { onViewChange: mock(), onOpenSearch: mock(), onOpenAutoDiscovery: mock(), onOpenClusterModal: mock() };
  render(
    <Header currentView="overview" session={session} pendingRoutesCount={2} argoSyncHealth="Synced" {...handlers} />
  );
  return handlers;
}

describe('Header', () => {
  test('administrators get operations navigation and a profile that opens config', () => {
    const { onViewChange, onOpenAutoDiscovery, onOpenClusterModal } = renderHeader(ADMIN);
    expect(screen.getByText('Jane Doe')).toBeDefined();
    expect(screen.getByText('admin')).toBeDefined();
    expect(screen.getByText('+2')).toBeDefined();

    fireEvent.click(screen.getByText('GitOps'));
    expect(onViewChange).toHaveBeenCalledWith('gitops');
    fireEvent.click(screen.getByTitle('Auto-discover Kubernetes HTTPRoutes'));
    expect(onOpenAutoDiscovery).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('View Cluster Nodes & Pod Telemetry'));
    expect(onOpenClusterModal).toHaveBeenCalled();

    const avatar = screen.getByLabelText('Settings and Preferences');
    expect(avatar.textContent).toBe('JD');
    expect(avatar.getAttribute('title')).toContain('jane.doe@example.com');
    fireEvent.click(avatar);
    expect(onViewChange).toHaveBeenCalledWith('config');
  });

  test('viewers see no operations controls and a non-interactive avatar', () => {
    renderHeader(VIEWER);
    expect(screen.queryByText('GitOps')).toBeNull();
    expect(screen.queryByTitle('View Cluster Nodes & Pod Telemetry')).toBeNull();
    expect(screen.queryByLabelText('Settings and Preferences')).toBeNull();
    expect(screen.getByText('viewer')).toBeDefined();
    expect(screen.getByText('AS').getAttribute('title')).toContain('Groups: guests');
  });

  test('signed-out sessions show a signed-out notice', () => {
    renderHeader({ authenticated: false, mode: 'forward-auth', user: null, viewerCategories: [] });
    expect(screen.getByText('Signed out')).toBeDefined();
    expect(screen.queryByText('GitOps')).toBeNull();
  });

  test('AUTH_MODE=none shows the generic settings avatar without a profile', () => {
    renderHeader({
      authenticated: true,
      mode: 'none',
      user: { username: 'anonymous', name: null, email: null, groups: [], role: 'admin' },
      viewerCategories: [],
    });
    expect(screen.getByLabelText('Settings and Preferences').textContent).toBe('person');
    expect(screen.queryByText('anonymous')).toBeNull();
    expect(screen.getByText('GitOps')).toBeDefined();
  });
});
