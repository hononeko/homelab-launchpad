import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { AuthSession, ServiceItem } from './types';
import { makeArgoApp, makeHealth, makeRoute, makeService } from './test/fixtures';
import { INITIAL_NODES, INITIAL_SERVICES, INITIAL_TELEMETRY } from './data/initialData';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private readonly listeners = new Map<string, (event: MessageEvent) => void>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }

  close() {}

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const SERVICES: ServiceItem[] = [
  makeService({ isPinned: true }),
  makeService({
    id: 'imported-mealie',
    name: 'Mealie',
    url: 'https://mealie.example.com',
    displayUrl: 'mealie.example.com',
    description: 'Recipe manager',
    category: 'HOME & LIVING',
    isPinned: true,
  }),
  makeService({
    id: 'imported-grafana',
    name: 'Grafana',
    url: 'https://grafana.example.com',
    displayUrl: 'grafana.example.com',
    description: 'Dashboards',
    category: 'CLUSTER & OPS',
    isPinned: true,
  }),
];

function session(role: 'admin' | 'viewer' | null): AuthSession {
  if (!role) return { authenticated: false, mode: 'forward-auth', user: null, viewerCategories: [] };
  return {
    authenticated: true,
    mode: 'forward-auth',
    user: { username: 'jdoe', name: 'Jane Doe', email: null, groups: [role === 'admin' ? 'admins' : 'guests'], role },
    viewerCategories: ['MEDIA', 'HOME & LIVING'],
  };
}

const originalFetch = globalThis.fetch;
const originalOpen = window.open;
const originalConfirm = window.confirm;
let requests: Array<{ url: string; init?: RequestInit }>;

interface ApiReply {
  status?: number;
  body?: unknown;
  // Simulates a network failure
  fail?: boolean;
  // Delays the response; may differ per HTTP method
  delayMs?: number | Partial<Record<string, number>>;
}

function installApi(authSession: AuthSession, overrides: Record<string, ApiReply> = {}) {
  requests = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    const override = overrides[url];
    const delay =
      typeof override?.delayMs === 'number' ? override.delayMs : override?.delayMs?.[init?.method ?? 'GET'];
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (override?.fail) throw new TypeError('Failed to fetch');
    let body: unknown = override?.body ?? { success: true };
    if (!override && url === '/api/auth/me') body = { success: true, ...authSession };
    else if (!override && url === '/api/services/health/targets') body = { success: true, results: {} };
    return new Response(JSON.stringify(body), {
      status: override?.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const requested = (url: string) => requests.some((r) => r.url === url);

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  localStorage.setItem('launchpad_services', JSON.stringify(SERVICES));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.open = originalOpen;
  window.confirm = originalConfirm;
});

describe('App role gating', () => {
  test('viewers only see authorized categories and no operations UI', async () => {
    installApi(session('viewer'));
    render(<App />);

    await screen.findByText('Mealie');
    expect(screen.getByText('Jellyfin')).toBeDefined();
    expect(screen.queryByText('Grafana')).toBeNull();
    expect(screen.queryByText('GitOps')).toBeNull();

    // Administrator-only data is never requested
    expect(requested('/api/routes')).toBe(false);
    expect(requested('/api/telemetry')).toBe(false);
    expect(requested('/api/argo/applications')).toBe(false);

    // Only visible service URLs are registered for health probing
    await waitFor(() => expect(requested('/api/services/health/targets')).toBe(true));
    const registration = requests.find((r) => r.url === '/api/services/health/targets')!;
    expect(JSON.parse(String(registration.init!.body)).urls).toEqual([
      'https://jellyfin.example.com',
      'https://mealie.example.com',
    ]);
  });

  test('administrators see every service and load cluster data', async () => {
    installApi(session('admin'));
    render(<App />);

    await screen.findByText('Grafana');
    expect(screen.getAllByText('GitOps').length).toBeGreaterThan(0);
    await waitFor(() => expect(requested('/api/routes')).toBe(true));
    expect(requested('/api/telemetry')).toBe(true);
  });

  test('signed-out visitors see a sign-in notice and no services', async () => {
    installApi(session(null));
    render(<App />);

    await screen.findByText('Sign in to view services');
    expect(screen.getByText('Signed out')).toBeDefined();
    expect(screen.queryByText('Jellyfin')).toBeNull();
    expect(requested('/api/services/health/targets')).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

describe('App live updates and actions', () => {
  test('health events from the stream update service cards', async () => {
    installApi(session('admin'));
    render(<App />);
    await screen.findByText('Grafana');
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));

    act(() => {
      FakeEventSource.instances.at(-1)!.emit('health:updated', {
        results: { 'https://jellyfin.example.com': makeHealth({ status: 'offline', error: 'ENOTFOUND' }) },
      });
    });
    expect(await screen.findByText('Offline • 2h ago')).toBeDefined();
  });

  test('launching a service opens it safely and records the launch', async () => {
    installApi(session('viewer'), {
      '/api/services/imported-mealie/launch': { body: { success: true, id: 'imported-mealie', count: 10, lastLaunchedAt: 1 } },
    });
    const open = mock();
    window.open = open as unknown as typeof window.open;
    render(<App />);

    fireEvent.click(await screen.findByText('Recipe manager'));
    expect(open).toHaveBeenCalledWith('https://mealie.example.com/', '_blank', 'noopener,noreferrer');
    // Optimistic increment first, then the server's atomic count
    expect(await screen.findByText('10 launches/wk')).toBeDefined();
    expect(posted('/api/services/imported-mealie/launch')).toHaveLength(1);
    const saved = JSON.parse(localStorage.getItem('launchpad_services')!);
    expect(saved.find((s: ServiceItem) => s.id === 'imported-mealie').launchesPerWeek).toBe(10);
  });
});

const ARGO_APPS = [
  makeArgoApp({ id: 'jellyfin', name: 'jellyfin', syncStatus: 'Synced' }),
  makeArgoApp({ id: 'mealie', name: 'mealie', syncStatus: 'OutOfSync' }),
];
const ROUTES = [makeRoute({ id: 'route-media-immich', name: 'Immich', host: 'immich.example.com' })];

function adminApi(overrides: Record<string, ApiReply> = {}) {
  installApi(session('admin'), {
    '/api/argo/applications': { body: { success: true, applications: ARGO_APPS } },
    '/api/routes': { body: { success: true, routes: ROUTES } },
    '/api/telemetry': { body: { success: true, telemetry: INITIAL_TELEMETRY, nodes: INITIAL_NODES } },
    ...overrides,
  });
}

async function renderAsAdmin(overrides: Record<string, ApiReply> = {}) {
  adminApi(overrides);
  render(<App />);
  await screen.findByText('Grafana');
  await waitFor(() => expect(requested('/api/argo/applications')).toBe(true));
}

const posted = (url: string) => requests.filter((r) => r.url === url && r.init?.method === 'POST');

describe('App administrator flows', () => {
  test('ArgoCD sync, sync-all, and refresh call the API and report the result', async () => {
    await renderAsAdmin({
      '/api/argo/sync-all': { body: { success: true, count: 1 } },
      '/api/argo/refresh': { body: { success: true, applications: ARGO_APPS, count: 2 } },
    });
    fireEvent.click(screen.getAllByText('GitOps')[0]);
    await screen.findByText('mealie');

    fireEvent.click(screen.getAllByText('Sync Now')[1]);
    expect(await screen.findByText('Sync operation submitted for mealie')).toBeDefined();
    expect(posted('/api/argo/applications/mealie/sync')).toHaveLength(1);

    fireEvent.click(screen.getByTitle('Reconcile all OutOfSync applications'));
    expect(await screen.findByText('Batch sync triggered for 1 applications')).toBeDefined();

    fireEvent.click(screen.getByTitle('Refresh applications from cluster'));
    expect(await screen.findByText('Refreshed 2 ArgoCD applications from cluster')).toBeDefined();
  });

  test('ArgoCD failures are reported', async () => {
    await renderAsAdmin({
      '/api/argo/applications/mealie/sync': { status: 500, body: { success: false, error: 'boom' } },
      '/api/argo/sync-all': { status: 500, body: {} },
      '/api/argo/refresh': { fail: true },
    });
    fireEvent.click(screen.getAllByText('GitOps')[0]);
    await screen.findByText('mealie');

    fireEvent.click(screen.getAllByText('Sync Now')[1]);
    expect(await screen.findByText('Failed to sync mealie: boom')).toBeDefined();
    fireEvent.click(screen.getByTitle('Reconcile all OutOfSync applications'));
    expect(await screen.findByText('Failed to trigger batch sync')).toBeDefined();
    fireEvent.click(screen.getByTitle('Refresh applications from cluster'));
    expect(await screen.findByText('Network error refreshing ArgoCD applications')).toBeDefined();
  });

  test('route discovery scans, imports, and adds services', async () => {
    await renderAsAdmin({
      '/api/routes/scan': { body: { success: true, routes: ROUTES, count: 1 } },
    });
    fireEvent.click(screen.getByTitle('Auto-discover Kubernetes HTTPRoutes'));
    await screen.findByText('immich.example.com');

    fireEvent.click(screen.getByText('Scan Ingress Routes'));
    expect(await screen.findByText('Cluster scan complete: 1 HTTPRoutes verified via Gateway API')).toBeDefined();

    fireEvent.click(screen.getByText('Add to Launchpad'));
    expect(await screen.findByText('Imported Immich into Launchpad!')).toBeDefined();
    expect(JSON.parse(String(posted('/api/routes/import')[0].init!.body))).toEqual({ routeId: 'route-media-immich' });
    const saved = JSON.parse(localStorage.getItem('launchpad_services')!);
    expect(saved[0]).toMatchObject({ id: 'imported-route-media-immich', url: 'https://immich.example.com/' });
  });

  test('stream events refresh routes, applications, and telemetry', async () => {
    await renderAsAdmin();
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    const stream = FakeEventSource.instances.at(-1)!;

    act(() => {
      stream.emit('argo:syncing', { name: 'jellyfin' });
      stream.emit('routes:updated', { routes: [makeRoute({ id: 'route-x', host: 'new.example.com' })] });
      stream.emit('telemetry:updated', { telemetry: { ...INITIAL_TELEMETRY, nodeCount: 9 }, nodes: INITIAL_NODES });
    });
    fireEvent.click(screen.getAllByText('GitOps')[0]);
    expect(await screen.findByText('Syncing...')).toBeDefined();

    act(() => {
      stream.emit('argo:updated', { applications: [makeArgoApp({ id: 'only', name: 'only-app' })] });
    });
    expect(await screen.findByText('only-app')).toBeDefined();
  });

  test('the cluster modal shows node telemetry', async () => {
    await renderAsAdmin();
    fireEvent.click(screen.getByTitle('View Cluster Nodes & Pod Telemetry'));
    expect(await screen.findByText(INITIAL_NODES[0].name)).toBeDefined();
  });

  test('config view resets services to defaults after confirmation', async () => {
    window.confirm = mock(() => true) as unknown as typeof window.confirm;
    await renderAsAdmin();
    fireEvent.click(screen.getByLabelText('Settings and Preferences'));
    fireEvent.click(await screen.findByText('Reset Services'));
    expect(await screen.findByText('Services reset to default configuration')).toBeDefined();
    expect(localStorage.getItem('launchpad_services')).toBe(JSON.stringify(INITIAL_SERVICES));
  });
});

describe('App navigation', () => {
  test('keyboard shortcuts open the command palette', async () => {
    installApi(session('viewer'));
    render(<App />);
    await screen.findByText('Mealie');

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await screen.findByPlaceholderText('Search services, DNS routes, pods...');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByPlaceholderText('Search services, DNS routes, pods...')).toBeNull());

    fireEvent.keyDown(window, { key: '/' });
    expect(await screen.findByPlaceholderText('Search services, DNS routes, pods...')).toBeDefined();
  });

  test('tabs switch between pinned, frequent, and all services', async () => {
    localStorage.setItem(
      'launchpad_services',
      JSON.stringify([makeService({ isPinned: false, launchesPerWeek: 9 }), { ...SERVICES[1], isPinned: true }])
    );
    installApi(session('viewer'));
    render(<App />);
    await screen.findByText('Mealie');
    expect(screen.queryByText('Media streaming server')).toBeNull();

    fireEvent.click(screen.getByText('Show remaining 1 services'));
    expect(await screen.findByText('Jellyfin')).toBeDefined();

    fireEvent.click(screen.getByText('Most Frequent'));
    expect(await screen.findByText('Media streaming server')).toBeDefined();
    expect(screen.getByText('SORTED BY: LAUNCH FREQUENCY')).toBeDefined();
  });

  test('the services view groups services by category', async () => {
    installApi(session('viewer'));
    render(<App />);
    await screen.findByText('Mealie');
    fireEvent.click(screen.getByText('Services'));
    expect(await screen.findByText('Cluster Services Directory')).toBeDefined();
    expect(screen.getByText('// MEDIA (1)')).toBeDefined();
    expect(screen.getByText('// HOME & LIVING (1)')).toBeDefined();
  });
});

describe('App preference sync', () => {
  const puts = () => requests.filter((r) => r.url === '/api/user/preferences' && r.init?.method === 'PUT');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 800));

  function serverPrefs(overrides: Record<string, unknown> = {}) {
    return {
      '/api/user/preferences': {
        body: {
          success: true,
          persisted: true,
          preferences: {
            services: [makeService({ id: 'imported-plex', name: 'Plex', description: 'Plex server', isPinned: true })],
            hiddenCategories: [],
            defaultTab: 'pinned',
            argoEnabled: true,
            autoSyncRoutes: false,
            updatedAt: '2026-01-01T00:00:00.000Z',
            ...overrides,
          },
        },
      },
    };
  }

  test('server preferences replace local state without being saved straight back', async () => {
    installApi(session('viewer'), serverPrefs({ defaultTab: 'frequent' }));
    render(<App />);

    expect(await screen.findByText('Plex')).toBeDefined();
    expect(screen.queryByText('Mealie')).toBeNull();
    expect(screen.getByText('SORTED BY: LAUNCH FREQUENCY')).toBeDefined();
    await settle();
    expect(puts()).toHaveLength(0);
  });

  test('hidden categories from the profile hide services', async () => {
    installApi(
      session('viewer'),
      serverPrefs({
        services: [makeService({ isPinned: true }), { ...SERVICES[1] }],
        hiddenCategories: ['HOME & LIVING'],
      })
    );
    render(<App />);

    // Local state (which includes Mealie) renders first; wait for the profile to apply
    await waitFor(() => expect(requested('/api/user/preferences')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Mealie')).toBeNull());
    expect(screen.getByText('Jellyfin')).toBeDefined();
  });

  test('the first sync uploads local services with their launch counts', async () => {
    installApi(session('viewer'));
    render(<App />);

    await waitFor(() => expect(puts()).toHaveLength(1));
    const body = JSON.parse(String(puts()[0].init!.body));
    expect(body.services.map((s: ServiceItem) => s.id)).toEqual(SERVICES.map((s) => s.id));
    expect(body.services[0].launchesPerWeek).toBe(3);
  });

  test('later changes are saved after a short debounce, without launch stats', async () => {
    installApi(session('viewer'));
    render(<App />);
    await waitFor(() => expect(puts()).toHaveLength(1));

    fireEvent.click((await screen.findAllByTitle('Unpin service'))[0]);
    await waitFor(() => expect(puts()).toHaveLength(2), { timeout: 2000 });

    const body = JSON.parse(String(puts()[1].init!.body));
    expect(body.services[0]).toMatchObject({ id: 'imported-jellyfin', isPinned: false });
    expect('launchesPerWeek' in body.services[0]).toBe(false);
  });

  test('when the server is unreachable, local changes are never pushed over the profile', async () => {
    installApi(session('viewer'), { '/api/user/preferences': { status: 503, body: { success: false } } });
    render(<App />);
    await screen.findByText('Mealie');

    fireEvent.click(screen.getAllByTitle('Unpin service')[0]);
    await settle();
    expect(puts()).toHaveLength(0);
    // The change is still kept locally
    expect(JSON.parse(localStorage.getItem('launchpad_services')!)[0].isPinned).toBe(false);
  });

  test('signed-out visitors never contact the preferences API', async () => {
    installApi(session(null));
    render(<App />);
    await screen.findByText('Sign in to view services');
    await settle();
    expect(requested('/api/user/preferences')).toBe(false);
  });

  test('switching tabs does not change the synced default tab', async () => {
    installApi(session('viewer'));
    render(<App />);
    await waitFor(() => expect(puts()).toHaveLength(1));

    fireEvent.click(screen.getByText('Most Frequent'));
    await settle();
    expect(puts()).toHaveLength(1);
  });

  test('changing the default tab in Config saves it', async () => {
    installApi(session('admin'));
    render(<App />);
    await waitFor(() => expect(puts()).toHaveLength(1));

    fireEvent.click(screen.getByLabelText('Settings and Preferences'));
    fireEvent.change(await screen.findByLabelText('Default Tab'), { target: { value: 'all' } });
    await waitFor(() => expect(puts()).toHaveLength(2), { timeout: 2000 });
    expect(JSON.parse(String(puts()[1].init!.body)).defaultTab).toBe('all');
  });

  test('an edit made while the profile is loading wins over the loaded profile', async () => {
    installApi(session('viewer'), {
      ...serverPrefs({ services: SERVICES }),
      '/api/user/preferences': {
        ...serverPrefs({ services: SERVICES })['/api/user/preferences'],
        delayMs: { GET: 400 },
      },
    });
    render(<App />);

    // Local state renders immediately; unpin before the profile arrives
    fireEvent.click((await screen.findAllByTitle('Unpin service'))[0]);
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 2000 });

    const body = JSON.parse(String(puts()[0].init!.body));
    expect(body.services[0]).toMatchObject({ id: 'imported-jellyfin', isPinned: false });
    // The loaded profile (still pinned) did not overwrite the local edit
    await settle();
    expect(JSON.parse(localStorage.getItem('launchpad_services')!)[0].isPinned).toBe(false);
  });

  test('saves are sent one at a time, in order', async () => {
    installApi(session('viewer'), { '/api/user/preferences': { delayMs: { PUT: 900 } } });
    render(<App />);
    await waitFor(() => expect(puts()).toHaveLength(1));

    // An edit made while the first upload is in flight is saved after it, not lost
    fireEvent.click(screen.getAllByTitle('Unpin service')[0]);
    await settle();
    expect(puts()).toHaveLength(1);

    await waitFor(() => expect(puts()).toHaveLength(2), { timeout: 3000 });
    expect(JSON.parse(String(puts()[1].init!.body)).services[0].isPinned).toBe(false);
  });
});
