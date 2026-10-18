import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiRouter, broadcastTelemetry } from './api';
import { parseProbeTarget, resetHealthProbeState, runProbeRound } from '../health/probe';
import { resetK8sClient } from '../k8s/client';
import { INITIAL_NODES, INITIAL_TELEMETRY } from '../../src/data/initialData';

let server: Server;
let baseUrl: string;

const ADMIN = { 'Remote-User': 'jdoe', 'Remote-Groups': 'homelab,admins' };
const ALICE = { 'Remote-User': 'alice', 'Remote-Groups': 'guests' };
const BOB = { 'Remote-User': 'bob', 'Remote-Groups': 'guests' };

beforeAll(async () => {
  // Other test files point the shared client at fake clusters; pin simulation mode
  process.env.KUBECONFIG = '/dev/null';
  resetK8sClient();

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

afterEach(() => {
  resetHealthProbeState();
  for (const name of ['AUTH_MODE', 'AUTH_TRUSTED_PROXIES', 'HEALTH_PROBE_ALLOWED_DOMAINS']) {
    delete process.env[name];
  }
});

function call(path: string, headers: Record<string, string> = {}, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
}

function postJson(path: string, headers: Record<string, string>, body: unknown) {
  return call(path, { ...headers, 'Content-Type': 'application/json' }, { method: 'POST', body: JSON.stringify(body) });
}

describe('public endpoints', () => {
  test('/health is public but only administrators get cluster details', async () => {
    const anonymous = await (await call('/health')).json();
    expect(anonymous.status).toBe('ok');
    expect(anonymous.k8s).toBeUndefined();

    const viewer = await (await call('/health', ALICE)).json();
    expect(viewer.k8s).toBeUndefined();

    const admin = await (await call('/health', ADMIN)).json();
    expect(admin.k8s).toBeDefined();
    expect(admin.probes).toBeDefined();
  });

  test('/auth/me reports the session for signed-in and signed-out users', async () => {
    const signedOut = await (await call('/auth/me')).json();
    expect(signedOut).toMatchObject({ authenticated: false, mode: 'forward-auth', user: null, viewerCategories: [] });

    const viewer = await (await call('/auth/me', ALICE)).json();
    expect(viewer.authenticated).toBe(true);
    expect(viewer.user).toMatchObject({ username: 'alice', role: 'viewer', groups: ['guests'] });
    expect(viewer.viewerCategories).toEqual(['MEDIA', 'HOME & LIVING']);
  });
});

describe('role-based access control', () => {
  const adminOnly: Array<[string, string]> = [
    ['GET', '/routes'],
    ['POST', '/routes/scan'],
    ['POST', '/routes/import'],
    ['GET', '/argo/applications'],
    ['POST', '/argo/refresh'],
    ['POST', '/argo/applications/demo/sync'],
    ['POST', '/argo/sync-all'],
    ['GET', '/telemetry'],
    ['POST', '/telemetry/refresh'],
    ['GET', '/config/mappings'],
    ['PUT', '/config/mappings'],
    ['POST', '/config/mappings/reset'],
    ['PUT', '/config/mappings/overrides/app.example.com'],
    ['DELETE', '/config/mappings/overrides/app.example.com'],
  ];

  test.each(adminOnly)('%s %s requires authentication', async (method, path) => {
    const res = await call(path, {}, { method });
    expect(res.status).toBe(401);
  });

  test.each(adminOnly)('%s %s is forbidden for viewers', async (method, path) => {
    const res = await call(path, ALICE, { method });
    expect(res.status).toBe(403);
  });

  test('administrators can read cluster data', async () => {
    expect((await call('/routes', ADMIN)).status).toBe(200);
    expect((await call('/argo/applications', ADMIN)).status).toBe(200);
    expect((await call('/telemetry', ADMIN)).status).toBe(200);
  });

  test('viewers can use service health endpoints', async () => {
    expect((await call('/services/health', ALICE)).status).toBe(200);
    expect((await postJson('/services/health/targets', ALICE, { urls: [] })).status).toBe(200);
  });

  test('cross-site mutations are rejected even for administrators', async () => {
    const res = await call('/telemetry/refresh', { ...ADMIN, 'Sec-Fetch-Site': 'cross-site' }, { method: 'POST' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Cross-site request rejected');

    const sameOrigin = await call('/telemetry/refresh', { ...ADMIN, 'Sec-Fetch-Site': 'same-origin' }, { method: 'POST' });
    expect(sameOrigin.status).toBe(200);
  });

  test('sibling-subdomain (same-site) mutations are rejected', async () => {
    const res = await call('/telemetry/refresh', { ...ADMIN, 'Sec-Fetch-Site': 'same-site' }, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  test('falls back to Origin when Fetch Metadata is missing', async () => {
    const foreign = await call('/telemetry/refresh', { ...ADMIN, Origin: 'https://tools.example.com' }, { method: 'POST' });
    expect(foreign.status).toBe(403);

    const own = new URL(baseUrl).origin;
    const matching = await call('/telemetry/refresh', { ...ADMIN, Origin: own }, { method: 'POST' });
    expect(matching.status).toBe(200);

    const malformed = await call('/telemetry/refresh', { ...ADMIN, Origin: 'null' }, { method: 'POST' });
    expect(malformed.status).toBe(403);
  });

  test('identity headers from untrusted peers are ignored', async () => {
    process.env.AUTH_TRUSTED_PROXIES = '10.0.0.0/8';
    expect((await call('/routes', ADMIN)).status).toBe(401);

    process.env.AUTH_TRUSTED_PROXIES = '127.0.0.1';
    expect((await call('/routes', ADMIN)).status).toBe(200);
  });

  test('AUTH_MODE=none keeps the API open', async () => {
    process.env.AUTH_MODE = 'none';
    expect((await call('/routes')).status).toBe(200);
    const session = await (await call('/auth/me')).json();
    expect(session.user).toMatchObject({ username: 'anonymous', role: 'admin' });
  });
});

describe('administrator actions (simulation mode)', () => {
  test('route scan marks previously imported routes', async () => {
    // Scan first: other test files share the module-level route cache
    const { routes: initial } = await (await postJson('/routes/scan', ADMIN, {})).json();
    const importedId = initial[0].id;

    const scan = await (await postJson('/routes/scan', ADMIN, { importedIds: [importedId] })).json();
    expect(scan.success).toBe(true);
    expect(scan.count).toBe(initial.length);
    expect(scan.routes.find((r: { id: string }) => r.id === importedId).status).toBe('imported');
    // Simulation mode excludes nothing, but clients can always rely on the list
    expect(scan.excluded).toEqual([]);
  });

  test('route import validates the route id', async () => {
    const { routes } = await (await call('/routes', ADMIN)).json();
    expect((await postJson('/routes/import', ADMIN, {})).status).toBe(400);
    expect((await postJson('/routes/import', ADMIN, { routeId: 'missing' })).status).toBe(404);

    const imported = await postJson('/routes/import', ADMIN, { routeId: routes[0].id });
    expect(await imported.json()).toEqual({ success: true, routeId: routes[0].id });
  });

  test('ArgoCD refresh, single sync, and sync-all succeed', async () => {
    const refresh = await (await call('/argo/refresh', ADMIN, { method: 'POST' })).json();
    expect(refresh.success).toBe(true);
    expect(refresh.count).toBeGreaterThan(0);
    const appName = refresh.applications[0].name;

    const sync = await (await call(`/argo/applications/${appName}/sync`, ADMIN, { method: 'POST' })).json();
    expect(sync).toMatchObject({ success: true, name: appName });

    // Sync-all targets out-of-sync apps, or every app when all are synced
    const drifted = refresh.applications
      .filter((a: { syncStatus: string }) => a.syncStatus === 'OutOfSync' || a.syncStatus === 'Unknown')
      .map((a: { name: string }) => a.name);
    const expected = drifted.length > 0 ? drifted : refresh.applications.map((a: { name: string }) => a.name);

    const syncAll = await (await call('/argo/sync-all', ADMIN, { method: 'POST' })).json();
    expect(syncAll.success).toBe(true);
    expect(syncAll.triggered).toEqual(expected);
    expect(syncAll.count).toBe(expected.length);
  });

  test('sync rejects names that are not valid Kubernetes resource names', async () => {
    const res = await call('/argo/applications/Bad_Name/sync', ADMIN, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('telemetry refresh returns fresh telemetry', async () => {
    const data = await (await call('/telemetry/refresh', ADMIN, { method: 'POST' })).json();
    expect(data.success).toBe(true);
    expect(data.telemetry.nodeCount).toBeGreaterThan(0);
  });

  test('on-demand probes are throttled', async () => {
    const first = await (await call('/services/health/probe', ALICE, { method: 'POST' })).json();
    expect(first.success).toBe(true);
    expect(first.throttled).toBe(false);
    const second = await (await call('/services/health/probe', ALICE, { method: 'POST' })).json();
    expect(second.throttled).toBe(true);
  });

  test('admin health includes ArgoCD and route counts', async () => {
    await call('/argo/refresh', ADMIN, { method: 'POST' });
    await call('/routes/scan', ADMIN, { method: 'POST' });
    const health = await (await call('/health', ADMIN)).json();
    expect(health.argo.totalCached).toBeGreaterThan(0);
    expect(health.routes.lastScannedAt).not.toBeNull();
  });
});

describe('service health isolation', () => {
  test('only administrators may register hosts known only from cluster routes', async () => {
    // Populate the discovered-route cache with simulation data (test:unit sets
    // KUBECONFIG=/dev/null) and pick a host
    const { routes } = await (await call('/routes', ADMIN)).json();
    expect(routes?.length).toBeGreaterThan(0);
    const clusterUrl = `https://${routes[0].host}/`;
    process.env.HEALTH_PROBE_ALLOWED_DOMAINS = 'example.invalid';

    const viewer = await (await postJson('/services/health/targets', ALICE, { urls: [clusterUrl] })).json();
    expect(viewer.rejected).toEqual([clusterUrl]);

    // Checked without a request so the test never probes a real host
    expect(parseProbeTarget(clusterUrl, ['example.invalid'], true)).not.toBeNull();
    expect(parseProbeTarget(clusterUrl, ['example.invalid'], false)).toBeNull();
  });

  test('rejects oversized registration batches', async () => {
    const urls = Array.from({ length: 101 }, (_, i) => `http://127.0.0.1:1/${i}`);
    expect((await postJson('/services/health/targets', ALICE, { urls })).status).toBe(400);
  });

  test('users only see probe results for URLs they registered', async () => {
    process.env.HEALTH_PROBE_ALLOWED_DOMAINS = '127.0.0.1';
    const aliceUrl = 'http://127.0.0.1:1/alice';
    const bobUrl = 'http://127.0.0.1:1/bob';

    await postJson('/services/health/targets', ALICE, { urls: [aliceUrl] });
    await postJson('/services/health/targets', BOB, { urls: [bobUrl] });
    await runProbeRound();

    const alice = await (await call('/services/health', ALICE)).json();
    expect(Object.keys(alice.results)).toEqual([aliceUrl]);

    const bob = await (await call('/services/health', BOB)).json();
    expect(Object.keys(bob.results)).toEqual([bobUrl]);

    const admin = await (await call('/services/health', ADMIN)).json();
    expect(Object.keys(admin.results).sort((a, b) => a.localeCompare(b))).toEqual([aliceUrl, bobUrl]);
  });
});

describe('SSE stream', () => {
  async function openStream(headers: Record<string, string>) {
    const controller = new AbortController();
    const res = await call('/routes/stream', headers, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    async function readUntil(predicate: (text: string) => boolean, timeoutMs = 1000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(buffer) && Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
        ]);
        if (!chunk || chunk.done) break;
        buffer += decoder.decode(chunk.value);
      }
      return buffer;
    }

    return { status: res.status, readUntil, close: () => controller.abort() };
  }

  test('requires authentication', async () => {
    expect((await call('/routes/stream')).status).toBe(401);
  });

  test('broadcasting to a disconnected client does not crash the server', async () => {
    const stream = await openStream(ADMIN);
    await stream.readUntil((t) => t.includes('event: connected'));
    stream.close();

    const telemetry = { telemetry: INITIAL_TELEMETRY, nodes: INITIAL_NODES, lastFetchedAt: new Date().toISOString() };
    for (let i = 0; i < 5; i++) {
      broadcastTelemetry(telemetry);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await call('/health')).status).toBe(200);
  });

  test('streams cluster events to administrators only', async () => {
    const admin = await openStream(ADMIN);
    const viewer = await openStream(ALICE);
    try {
      expect(await admin.readUntil((t) => t.includes('event: connected'))).toContain('routesCount');
      const viewerConnected = await viewer.readUntil((t) => t.includes('event: connected'));
      expect(viewerConnected).not.toContain('routesCount');

      broadcastTelemetry({ telemetry: INITIAL_TELEMETRY, nodes: INITIAL_NODES, lastFetchedAt: new Date().toISOString() });

      expect(await admin.readUntil((t) => t.includes('event: telemetry:updated'))).toContain('telemetry:updated');
      expect(await viewer.readUntil((t) => t.includes('event: telemetry:updated'), 300)).not.toContain(
        'telemetry:updated'
      );
    } finally {
      admin.close();
      viewer.close();
    }
  });
});
