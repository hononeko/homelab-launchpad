import { ArgoApplication, DiscoveredHTTPRoute, ServiceHealth, ServiceItem } from '../types';

export function makeService(overrides: Partial<ServiceItem> = {}): ServiceItem {
  return {
    id: 'imported-jellyfin',
    name: 'Jellyfin',
    url: 'https://jellyfin.example.com',
    displayUrl: 'jellyfin.example.com',
    description: 'Media streaming server',
    icon: 'tv',
    category: 'MEDIA',
    isPinned: false,
    launchesPerWeek: 3,
    lastAccessed: '2h ago',
    lastAccessedTimestamp: 0,
    status: 'active',
    ...overrides,
  };
}

export function makeArgoApp(overrides: Partial<ArgoApplication> = {}): ArgoApplication {
  return {
    id: 'jellyfin',
    name: 'jellyfin',
    project: 'media',
    repoUrl: 'https://git.example.com/homelab.git',
    targetRevision: 'main (abc1234)',
    commitMessage: 'apps/media/jellyfin',
    syncStatus: 'Synced',
    healthStatus: 'Healthy',
    lastSyncedAt: '5m ago',
    ...overrides,
  };
}

export function makeRoute(overrides: Partial<DiscoveredHTTPRoute> = {}): DiscoveredHTTPRoute {
  return {
    id: 'route-media-jellyfin',
    name: 'Jellyfin',
    namespace: 'media',
    host: 'jellyfin.example.com',
    path: '/',
    gateway: 'internal-gw',
    backendService: 'jellyfin',
    port: 8096,
    tlsEnabled: true,
    status: 'pending',
    discoveredAt: '2026-01-01T00:00:00.000Z',
    suggestedCategory: 'MEDIA',
    suggestedIcon: 'tv',
    ...overrides,
  };
}

export function makeHealth(overrides: Partial<ServiceHealth> = {}): ServiceHealth {
  return {
    url: 'https://jellyfin.example.com',
    status: 'active',
    httpStatus: 200,
    latencyMs: 42,
    timings: { dnsMs: 1, connectMs: 2, tlsMs: 3, ttfbMs: 36, totalMs: 42 },
    error: null,
    checkedAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}
