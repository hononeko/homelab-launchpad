import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  classifyRoute,
  getCachedRoutes,
  getDiscoveryFilters,
  getExcludedRoutes,
  getLastScannedAt,
  globToRegExp,
  HIDDEN_ANNOTATION,
  markRouteImported,
  scanClusterRoutes,
} from './discovery';
import { resetK8sClient } from './client';
import { DEFAULT_MAPPINGS, setMappings } from './mappings';
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

// A minimal HTTPRoute serving one host through the given gateways
interface RouteExtras {
  namespace?: string;
  annotations?: Record<string, string>;
  rules?: unknown[];
}

function httpRoute(name: string, host: string, gateways: string[], extra: RouteExtras = {}) {
  return {
    metadata: { name, namespace: extra.namespace ?? 'apps', annotations: extra.annotations },
    spec: {
      hostnames: [host],
      parentRefs: gateways.map((g) => ({ name: g })),
      rules: extra.rules ?? [{ backendRefs: [{ name, port: 8080 }] }],
    },
  };
}

describe('globToRegExp', () => {
  test('matches whole hosts case-insensitively with * as a wildcard', () => {
    const pattern = globToRegExp('*-webhook.example.com');
    expect(pattern.test('renovate-webhook.example.com')).toBe(true);
    expect(pattern.test('Renovate-Webhook.Example.com')).toBe(true);
    expect(pattern.test('webhook.example.com.evil.test')).toBe(false);
  });

  test('treats regex characters in the glob literally', () => {
    const pattern = globToRegExp('app.example.com');
    expect(pattern.test('app.example.com')).toBe(true);
    expect(pattern.test('appxexample.com')).toBe(false);
  });
});

describe('getDiscoveryFilters', () => {
  afterEach(() => {
    delete process.env.DISCOVERY_EXCLUDE_NAMESPACES;
    delete process.env.DISCOVERY_EXCLUDE_HOSTS;
  });

  test('reads comma-separated namespaces and host globs, ignoring blanks', () => {
    process.env.DISCOVERY_EXCLUDE_NAMESPACES = ' kube-system, ,monitoring ';
    process.env.DISCOVERY_EXCLUDE_HOSTS = 'hooks.example.com,*.internal.example.com';
    const filters = getDiscoveryFilters();
    expect([...filters.excludeNamespaces]).toEqual(['kube-system', 'monitoring']);
    expect(filters.excludeHosts).toHaveLength(2);
  });

  test('excludes nothing by default', () => {
    const filters = getDiscoveryFilters();
    expect(filters.excludeNamespaces.size).toBe(0);
    expect(filters.excludeHosts).toHaveLength(0);
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
    expect(getExcludedRoutes()).toEqual([]);
    expect(getLastScannedAt()).not.toBeNull();
  });
});

describe('category mappings', () => {
  afterEach(() => setMappings(null));

  test('classification follows the active mappings', () => {
    setMappings({
      ...DEFAULT_MAPPINGS,
      appRules: [{ keywords: ['portal'], category: 'MEDIA', icon: 'cast' }, ...DEFAULT_MAPPINGS.appRules],
    });
    expect(classifyRoute('portal', 'unknown', 'portal.example.com', 'web')).toEqual({ category: 'MEDIA', icon: 'cast' });
  });

  test('host overrides correct simulated routes and are reported', async () => {
    process.env.KUBECONFIG = '/dev/null';
    resetK8sClient();
    const [first] = INITIAL_DISCOVERED_ROUTES;
    setMappings({ ...DEFAULT_MAPPINGS, overrides: { [first.host]: { name: 'Photos', category: 'HOME & LIVING' } } });

    const routes = await scanClusterRoutes();
    expect(routes.find((r) => r.id === first.id)).toMatchObject({
      name: 'Photos',
      suggestedCategory: 'HOME & LIVING',
      suggestedIcon: first.suggestedIcon,
      override: { name: 'Photos', category: 'HOME & LIVING' },
    });
    expect(routes.find((r) => r.id !== first.id)?.override).toBeUndefined();
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

  test('host overrides correct discovered routes', async () => {
    cluster.on(`GET ${HTTPROUTES_PATH}`, { body: { items: [jellyfinRoute] } });
    cluster.on(`GET ${INGRESSES_PATH}`, { body: { items: [] } });
    setMappings({ ...DEFAULT_MAPPINGS, overrides: { 'jellyfin.example.com': { icon: 'live_tv' } } });
    try {
      const [jellyfin] = await scanClusterRoutes();
      expect(jellyfin).toMatchObject({ name: 'Jellyfin', suggestedCategory: 'MEDIA', suggestedIcon: 'live_tv' });
    } finally {
      setMappings(null);
    }
  });

  test('applies defaults for sparse resources', async () => {
    cluster.on(`GET ${HTTPROUTES_PATH}`, {
      body: { items: [{ spec: { hostnames: ['bare.example.com'], rules: [{ backendRefs: [{}] }] } }] },
    });
    cluster.on(`GET ${INGRESSES_PATH}`, {
      body: { items: [{ metadata: { name: 'plain' }, spec: { rules: [{ host: 'plain.example.com' }] } }] },
    });

    const routes = await scanClusterRoutes();
    expect(routes.find((r) => r.host === 'bare.example.com')).toMatchObject({
      namespace: 'default',
      path: '/',
      gateway: 'unknown-gateway',
      backendService: 'unnamed-route',
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

  describe('several routes for one host', () => {
    beforeEach(() => {
      cluster.on(`GET ${INGRESSES_PATH}`, { body: { items: [] } });
    });

    test('prefers the internal route and lists the others as alternates', async () => {
      cluster.on(`GET ${HTTPROUTES_PATH}`, {
        body: {
          items: [
            httpRoute('app-external', 'app.example.com', ['external-gateway']),
            httpRoute('app', 'app.example.com', ['internal-gateway']),
          ],
        },
      });

      const routes = await scanClusterRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({ id: 'route-apps-app', gateway: 'internal-gateway' });
      expect(routes[0].alternates).toEqual([{ name: 'app-external', namespace: 'apps', gateways: ['external-gateway'] }]);
    });

    test('an "external" name loses to a route that is not, on the same gateways', async () => {
      cluster.on(`GET ${HTTPROUTES_PATH}`, {
        body: {
          items: [
            httpRoute('a-external-route', 'app.example.com', ['shared-gateway']),
            httpRoute('b-route', 'app.example.com', ['shared-gateway']),
          ],
        },
      });

      const [route] = await scanClusterRoutes();
      expect(route.id).toBe('route-apps-b-route');
    });

    test('equally preferred routes resolve by name', async () => {
      cluster.on(`GET ${HTTPROUTES_PATH}`, {
        body: { items: [httpRoute('zeta', 'app.example.com', ['gw']), httpRoute('alpha', 'app.example.com', ['gw'])] },
      });

      const [route] = await scanClusterRoutes();
      expect(route.id).toBe('route-apps-alpha');
      expect(route.alternates?.map((a) => a.name)).toEqual(['zeta']);
    });

    test('a single route has no alternates', async () => {
      cluster.on(`GET ${HTTPROUTES_PATH}`, { body: { items: [jellyfinRoute] } });
      const [route] = await scanClusterRoutes();
      expect(route.alternates).toBeUndefined();
    });

    test('the backend comes from the first rule that has one', async () => {
      cluster.on(`GET ${HTTPROUTES_PATH}`, {
        body: {
          items: [
            httpRoute('app', 'app.example.com', ['gw'], {
              rules: [
                { matches: [{ path: { value: '/old' } }], filters: [{ type: 'RequestRedirect' }] },
                { matches: [{ path: { value: '/ui' } }], backendRefs: [{ name: 'app-web', port: 3000 }] },
              ],
            }),
          ],
        },
      });

      const [route] = await scanClusterRoutes();
      expect(route).toMatchObject({ path: '/ui', backendService: 'app-web', port: 3000 });
    });
  });

  describe('exclusions', () => {
    afterEach(() => {
      delete process.env.DISCOVERY_EXCLUDE_NAMESPACES;
      delete process.env.DISCOVERY_EXCLUDE_HOSTS;
    });

    test('leaves out annotated, filtered, and backend-less routes and reports why', async () => {
      process.env.DISCOVERY_EXCLUDE_NAMESPACES = 'ops';
      process.env.DISCOVERY_EXCLUDE_HOSTS = '*-webhook.example.com';
      cluster.on(`GET ${HTTPROUTES_PATH}`, {
        body: {
          items: [
            httpRoute('app', 'app.example.com', ['gw']),
            httpRoute('secret-app', 'secret.example.com', ['gw'], { annotations: { [HIDDEN_ANNOTATION]: 'true' } }),
            httpRoute('visible-app', 'visible.example.com', ['gw'], { annotations: { [HIDDEN_ANNOTATION]: 'false' } }),
            httpRoute('metrics', 'metrics.example.com', ['gw'], { namespace: 'ops' }),
            httpRoute('ci-webhook', 'ci-webhook.example.com', ['gw']),
            httpRoute('old-name', 'old.example.com', ['gw'], {
              rules: [{ filters: [{ type: 'RequestRedirect', requestRedirect: { hostname: 'app.example.com' } }] }],
            }),
          ],
        },
      });
      cluster.on(`GET ${INGRESSES_PATH}`, {
        body: {
          items: [
            {
              metadata: { name: 'legacy', namespace: 'apps', annotations: { [HIDDEN_ANNOTATION]: 'true' } },
              spec: { rules: [{ host: 'legacy.example.com' }] },
            },
          ],
        },
      });

      const routes = await scanClusterRoutes();
      expect(routes.map((r) => r.host).sort((a, b) => a.localeCompare(b))).toEqual([
        'app.example.com',
        'visible.example.com',
      ]);
      expect(getExcludedRoutes()).toEqual([
        { name: 'ci-webhook', namespace: 'apps', host: 'ci-webhook.example.com', reason: 'host-pattern' },
        { name: 'legacy', namespace: 'apps', host: 'legacy.example.com', reason: 'annotation' },
        { name: 'metrics', namespace: 'ops', host: 'metrics.example.com', reason: 'namespace' },
        { name: 'old-name', namespace: 'apps', host: 'old.example.com', reason: 'no-backends' },
        { name: 'secret-app', namespace: 'apps', host: 'secret.example.com', reason: 'annotation' },
      ]);
    });

    test('an excluded route does not block its host from another route', async () => {
      cluster.on(`GET ${HTTPROUTES_PATH}`, {
        body: {
          items: [
            httpRoute('app', 'app.example.com', ['internal-gateway'], { annotations: { [HIDDEN_ANNOTATION]: 'true' } }),
            httpRoute('app-external', 'app.example.com', ['external-gateway']),
          ],
        },
      });
      cluster.on(`GET ${INGRESSES_PATH}`, { body: { items: [] } });

      const [route] = await scanClusterRoutes();
      expect(route.id).toBe('route-apps-app-external');
      expect(route.alternates).toBeUndefined();
    });
  });
});
