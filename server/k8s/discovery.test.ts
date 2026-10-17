import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { classifyRoute, getCachedRoutes, getLastScannedAt, markRouteImported, scanClusterRoutes } from './discovery';
import { resetK8sClient } from './client';
import { FAKE_TOKEN, FakeCluster, startFakeCluster } from '../test/fakeKubeApi';
import { INITIAL_DISCOVERED_ROUTES } from '../../src/data/initialData';

const HTTPROUTES_PATH = '/apis/gateway.networking.k8s.io/v1/httproutes';
const INGRESSES_PATH = '/apis/networking.k8s.io/v1/ingresses';

const jellyfinRoute = {
  metadata: {
    name: 'jellyfin-route',
    namespace: 'media',
    creationTimestamp: '2026-01-01T00:00:00Z',
    annotations: { 'argocd.argoproj.io/tracking-id': 'jellyfin:gateway.networking.k8s.io/HTTPRoute:media/jellyfin-route' },
  },
  spec: {
    hostnames: ['jellyfin.example.com', 'tv.example.com'],
    parentRefs: [{ name: 'internal-gw' }],
    rules: [{ matches: [{ path: { value: '/web' } }], backendRefs: [{ name: 'jellyfin', port: 8096 }] }],
  },
};

const grafanaIngress = {
  metadata: { name: 'grafana', namespace: 'observability' },
  spec: {
    tls: [{ hosts: ['grafana.example.com'] }],
    rules: [
      {
        host: 'grafana.example.com',
        http: { paths: [{ path: '/', backend: { service: { name: 'grafana', port: { number: 3000 } } } }] },
      },
      // Duplicate of an HTTPRoute host and a rule without a host: both skipped
      { host: 'jellyfin.example.com' },
      {},
    ],
  },
};

describe('classifyRoute', () => {
  test('matches application keywords first', () => {
    expect(classifyRoute('jellyfin', 'default', 'tv.example.com', 'svc')).toEqual({ category: 'MEDIA', icon: 'tv' });
    expect(classifyRoute('dashboards', 'observability', 'grafana.example.com', 'svc')).toEqual({
      category: 'CLUSTER & OPS',
      icon: 'monitoring',
    });
  });

  test('falls back to namespace rules, then a default', () => {
    expect(classifyRoute('portal', 'iot', 'portal.example.com', 'web')).toEqual({ category: 'HOME & LIVING', icon: 'home' });
    expect(classifyRoute('portal', 'unknown', 'portal.example.com', 'web')).toEqual({ category: 'TOOLS & DEV', icon: 'hub' });
  });
});

describe('simulation mode', () => {
  beforeAll(() => {
    process.env.KUBECONFIG = '/dev/null';
    resetK8sClient();
  });

  test('returns sample routes and honors imported ids', async () => {
    const importedId = INITIAL_DISCOVERED_ROUTES[0].id;
    const routes = await scanClusterRoutes(new Set([importedId]));
    expect(routes).toHaveLength(INITIAL_DISCOVERED_ROUTES.length);
    expect(routes.find((r) => r.id === importedId)?.status).toBe('imported');
    expect(getCachedRoutes()).toBe(routes);
    expect(getLastScannedAt()).not.toBeNull();
  });
});

describe('connected mode', () => {
  let cluster: FakeCluster;

  beforeAll(async () => {
    cluster = await startFakeCluster();
  });

  afterAll(async () => {
    await cluster.close();
  });

  beforeEach(() => {
    cluster.reset();
  });

  test('parses HTTPRoutes and Ingresses, de-duplicating hosts and sorting by name', async () => {
    cluster.on(`GET ${HTTPROUTES_PATH}`, {
      body: { items: [jellyfinRoute, { metadata: { name: 'no-hosts' }, spec: {} }] },
    });
    cluster.on(`GET ${INGRESSES_PATH}`, { body: { items: [grafanaIngress] } });

    const routes = await scanClusterRoutes(new Set(['route-media-jellyfin-route']));
    expect(routes.map((r) => r.name)).toEqual(['Grafana', 'Jellyfin']);

    const [grafana, jellyfin] = routes;
    expect(jellyfin).toMatchObject({
      id: 'route-media-jellyfin-route',
      host: 'jellyfin.example.com',
      path: '/web',
      gateway: 'internal-gw',
      backendService: 'jellyfin',
      port: 8096,
      tlsEnabled: true,
      status: 'imported',
      suggestedCategory: 'MEDIA',
      suggestedIcon: 'tv',
      argoAppName: 'jellyfin',
      discoveredAt: '2026-01-01T00:00:00.000Z',
    });
    expect(grafana).toMatchObject({
      id: 'ingress-observability-grafana',
      host: 'grafana.example.com',
      gateway: 'ingress-controller',
      backendService: 'grafana',
      port: 3000,
      tlsEnabled: true,
      status: 'pending',
      suggestedCategory: 'CLUSTER & OPS',
    });
    expect(cluster.requests.every((r) => r.headers.authorization === `Bearer ${FAKE_TOKEN}`)).toBe(true);
  });

  test('applies defaults for sparse resources', async () => {
    cluster.on(`GET ${HTTPROUTES_PATH}`, { body: { items: [{ spec: { hostnames: ['bare.example.com'] } }] } });
    cluster.on(`GET ${INGRESSES_PATH}`, {
      body: { items: [{ metadata: { name: 'plain' }, spec: { rules: [{ host: 'plain.example.com' }] } }] },
    });

    const routes = await scanClusterRoutes();
    expect(routes.find((r) => r.host === 'bare.example.com')).toMatchObject({
      namespace: 'default',
      path: '/',
      gateway: 'cilium-gateway-l7',
      port: 80,
    });
    expect(routes.find((r) => r.host === 'plain.example.com')).toMatchObject({ tlsEnabled: false, port: 80 });
  });

  test('retries a failed list with a direct API request', async () => {
    cluster.on(`GET ${HTTPROUTES_PATH}`, (_req, count) =>
      count === 1 ? { status: 500, body: { message: 'boom' } } : { body: { items: [jellyfinRoute] } }
    );
    cluster.on(`GET ${INGRESSES_PATH}`, { body: { items: [] } });

    const routes = await scanClusterRoutes();
    expect(routes.map((r) => r.host)).toEqual(['jellyfin.example.com']);
    expect(cluster.requests.filter((r) => r.path === HTTPROUTES_PATH)).toHaveLength(2);
  });

  test('a resource that cannot be listed yields no routes without failing the scan', async () => {
    cluster.on(`GET ${HTTPROUTES_PATH}`, { status: 403, body: { message: 'forbidden' } });
    cluster.on(`GET ${INGRESSES_PATH}`, { body: { items: [grafanaIngress] } });

    // Without the HTTPRoute, the Ingress's second rule is no longer a duplicate host
    const routes = await scanClusterRoutes();
    expect(routes.map((r) => r.host).sort((a, b) => a.localeCompare(b))).toEqual([
      'grafana.example.com',
      'jellyfin.example.com',
    ]);
    expect(cluster.requests.filter((r) => r.path === HTTPROUTES_PATH)).toHaveLength(2);
  });

  test('the client library path is used when it succeeds', async () => {
    cluster.on(`GET ${HTTPROUTES_PATH}`, { body: { items: [jellyfinRoute] } });
    cluster.on(`GET ${INGRESSES_PATH}`, { body: { items: [] } });

    await scanClusterRoutes();
    expect(cluster.requests.filter((r) => r.path === HTTPROUTES_PATH)).toHaveLength(1);
  });

  test('markRouteImported updates cached routes only', async () => {
    cluster.on(`GET ${HTTPROUTES_PATH}`, { body: { items: [jellyfinRoute] } });
    cluster.on(`GET ${INGRESSES_PATH}`, { body: { items: [] } });
    await scanClusterRoutes();

    expect(markRouteImported('route-media-jellyfin-route')).toBe(true);
    expect(getCachedRoutes()[0].status).toBe('imported');
    expect(markRouteImported('missing')).toBe(false);
  });
});
