import { describe, expect, mock, test } from 'bun:test';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AutoDiscoveryModal } from './AutoDiscoveryModal';
import { makeRoute } from '../test/fixtures';

const routes = [
  makeRoute(),
  makeRoute({ id: 'route-home-mealie', name: 'Mealie', namespace: 'home', host: 'mealie.example.com' }),
  makeRoute({ id: 'route-media-plex', name: 'Plex', host: 'plex.example.com', status: 'imported' }),
];

function renderModal(props: Partial<ComponentProps<typeof AutoDiscoveryModal>> = {}) {
  const handlers = {
    onClose: mock(),
    onImportRoute: mock(),
    onImportAll: mock(),
    onScanCluster: mock(),
    onToggleAutoSync: mock(),
    onAddCustomRoute: mock(),
  };
  render(
    <AutoDiscoveryModal
      isOpen
      discoveredRoutes={routes}
      isScanning={false}
      autoSyncEnabled={false}
      k8sStatus={{ connected: true, server: 'https://10.0.0.1:6443', mode: 'cluster' }}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe('AutoDiscoveryModal', () => {
  test('shows scanning progress while a scan runs', () => {
    renderModal({ isScanning: true });
    expect(screen.getByText('Probing Cluster...').closest('button')!.disabled).toBe(true);
  });

  test('renders nothing when closed', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText('jellyfin.example.com')).toBeNull();
  });

  test('lists routes and imports pending ones', () => {
    const { onImportRoute, onImportAll } = renderModal();
    expect(screen.getByText('jellyfin.example.com')).toBeDefined();
    expect(screen.getAllByText('Imported')).toHaveLength(1);

    fireEvent.click(screen.getAllByText('Add to Launchpad')[0]);
    expect(onImportRoute.mock.calls[0][0].id).toBe('route-media-jellyfin');

    fireEvent.click(screen.getByText('Import All (2)'));
    expect(onImportAll).toHaveBeenCalled();
  });

  test('filters routes by namespace', () => {
    renderModal();
    expect(screen.getByText('Showing 3 of 3 routes')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'home' }));
    expect(screen.queryByText('jellyfin.example.com')).toBeNull();
    expect(screen.getByText('mealie.example.com')).toBeDefined();
    expect(screen.getByText('Showing 1 of 3 routes in home')).toBeDefined();
  });

  test('reports how many routes are not on the launchpad yet', () => {
    renderModal();
    expect(screen.getByText('2 not yet on the launchpad')).toBeDefined();
  });

  test('route details carry their full values instead of being truncated', () => {
    renderModal();
    const details = screen.getByText('jellyfin.example.com').parentElement!;
    expect(details.getAttribute('title')).toBe('jellyfin.example.com → jellyfin:8096 (internal-gw)');
    expect(details.className).not.toContain('truncate');
  });

  test('adds a custom route from the form', () => {
    const { onAddCustomRoute } = renderModal();
    fireEvent.click(screen.getByText('+ Custom Route'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Immich, Paperless'), { target: { value: 'Photo Vault' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. photos.kerrlab.app'), { target: { value: 'photos.example.com' } });
    fireEvent.submit(screen.getByPlaceholderText('e.g. photos.kerrlab.app').closest('form')!);

    expect(onAddCustomRoute).toHaveBeenCalledTimes(1);
    expect(onAddCustomRoute.mock.calls[0][0]).toMatchObject({
      name: 'Photo Vault',
      host: 'photos.example.com',
      backendService: 'photo-vault-svc',
      status: 'pending',
    });
  });

  test('ignores incomplete custom routes', () => {
    const { onAddCustomRoute } = renderModal();
    fireEvent.click(screen.getByText('+ Custom Route'));
    fireEvent.submit(screen.getByPlaceholderText('e.g. photos.kerrlab.app').closest('form')!);
    expect(onAddCustomRoute).not.toHaveBeenCalled();
  });

  test('scan, auto-sync, and close controls call their handlers', () => {
    const { onScanCluster, onToggleAutoSync, onClose } = renderModal();
    fireEvent.click(screen.getByText('Scan Ingress Routes'));
    expect(onScanCluster).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Auto-import:').nextElementSibling!);
    expect(onToggleAutoSync).toHaveBeenCalled();
    fireEvent.click(screen.getByText('jellyfin.example.com').closest('.fixed')!);
    expect(onClose).toHaveBeenCalled();
  });
});
