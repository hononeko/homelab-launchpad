import { describe, expect, mock, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ArgoCDView } from './ArgoCDView';
import { makeArgoApp, makeService } from '../test/fixtures';

const apps = [
  makeArgoApp({ id: 'jellyfin', name: 'jellyfin', syncStatus: 'Synced' }),
  makeArgoApp({ id: 'mealie', name: 'mealie', project: 'home', syncStatus: 'OutOfSync', healthStatus: 'Degraded' }),
  makeArgoApp({ id: 'grafana', name: 'grafana', project: 'ops', syncStatus: 'Syncing' }),
];

function renderView(props: Partial<ComponentProps<typeof ArgoCDView>> = {}) {
  const handlers = {
    onToggleArgo: mock(),
    onSyncApp: mock(),
    onSyncAll: mock(),
    onLaunchService: mock(),
    onRefresh: mock(),
  };
  render(
    <ArgoCDView
      argoEnabled
      applications={apps}
      isSyncingAll={false}
      services={[makeService({ argoAppName: 'jellyfin' })]}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

const visibleApps = () => ['jellyfin', 'mealie', 'grafana'].filter((name) => screen.queryByText(name));

describe('ArgoCDView', () => {
  test('offers to enable the integration when disabled', () => {
    const { onToggleArgo } = renderView({ argoEnabled: false });
    fireEvent.click(screen.getByText('Enable ArgoCD Sync'));
    expect(onToggleArgo).toHaveBeenCalled();
    expect(screen.queryByText('jellyfin')).toBeNull();
  });

  test('summarizes sync and health state', () => {
    renderView();
    expect(screen.getByText('All (3)')).toBeDefined();
    expect(screen.getByText('Out of Sync (1)')).toBeDefined();
    expect(screen.getByText('Synced (1)')).toBeDefined();
    expect(screen.getByText('Syncing (1)')).toBeDefined();
    expect(screen.getByText('67% HEALTHY')).toBeDefined();
  });

  test('filters by status', () => {
    renderView();
    fireEvent.click(screen.getByText('Out of Sync (1)'));
    expect(visibleApps()).toEqual(['mealie']);
    fireEvent.click(screen.getByText('Synced (1)'));
    expect(visibleApps()).toEqual(['jellyfin']);
    fireEvent.click(screen.getByText('Syncing (1)'));
    expect(visibleApps()).toEqual(['grafana']);
    fireEvent.click(screen.getByText('All (3)'));
    expect(visibleApps()).toEqual(['jellyfin', 'mealie', 'grafana']);
  });

  test('searches by name or project and can clear the search', () => {
    renderView();
    const search = screen.getByPlaceholderText('Search applications...');
    fireEvent.change(search, { target: { value: 'ops' } });
    expect(visibleApps()).toEqual(['grafana']);

    fireEvent.change(search, { target: { value: 'nope' } });
    expect(visibleApps()).toEqual([]);
    fireEvent.click(screen.getByText('Clear search'));
    expect(visibleApps()).toHaveLength(3);
  });

  test('triggers per-app sync, sync-all, refresh, and launches linked services', () => {
    const { onSyncApp, onSyncAll, onRefresh, onLaunchService } = renderView();
    fireEvent.click(screen.getAllByText('Sync Now')[0]);
    expect(onSyncApp).toHaveBeenCalledWith('jellyfin');

    fireEvent.click(screen.getByTitle('Reconcile all OutOfSync applications'));
    expect(onSyncAll).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Refresh applications from cluster'));
    expect(onRefresh).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Launch Jellyfin'));
    expect(onLaunchService.mock.calls[0][0].argoAppName).toBe('jellyfin');
    // Only apps with a linked service get a launch button
    expect(screen.getAllByTitle(/^Launch /)).toHaveLength(1);
  });

  test('disables the sync button for apps that are already syncing', () => {
    renderView();
    const syncing = screen.getByText('Syncing...').closest('button')!;
    expect(syncing.disabled).toBe(true);
  });
});
