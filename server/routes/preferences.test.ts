import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { resetK8sClient } from '../k8s/client';
import { MemoryPreferencesStore, PreferencesStore, setPreferencesStore } from '../preferences/store';

let server: Server;
let baseUrl: string;

const ALICE = { 'Remote-User': 'alice', 'Remote-Groups': 'guests' };
const BOB = { 'Remote-User': 'bob', 'Remote-Groups': 'guests' };

const jellyfin = {
  id: 'imported-route-media-jellyfin',
  name: 'Jellyfin',
  url: 'https://jellyfin.example.com',
  displayUrl: 'jellyfin.example.com',
  description: 'Media server',
  icon: 'tv',
  category: 'MEDIA',
  isPinned: true,
  launchesPerWeek: 3,
  lastAccessed: '1d ago',
  lastAccessedTimestamp: 1_700_000_000_000,
  status: 'active',
};

beforeAll(async () => {
  process.env.KUBECONFIG = '/dev/null';
  resetK8sClient();
  // The real app middleware, so body size limits are exercised too
  const app = createApp({ distPath: null });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  setPreferencesStore(null);
});

beforeEach(() => {
  setPreferencesStore(new MemoryPreferencesStore());
});

afterEach(() => {
  delete process.env.AUTH_MODE;
});

function call(path: string, headers: Record<string, string>, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, 'Content-Type': 'application/json' } });
}

const getPrefs = (headers: Record<string, string>) => call('/user/preferences', headers);
const putPrefs = (headers: Record<string, string>, body: unknown) =>
  call('/user/preferences', headers, { method: 'PUT', body: JSON.stringify(body) });
const launch = (headers: Record<string, string>, id: string) => call(`/services/${id}/launch`, headers, { method: 'POST' });

describe('preferences API', () => {
  test('requires a signed-in user', async () => {
    expect((await getPrefs({})).status).toBe(401);
    expect((await putPrefs({}, { services: [] })).status).toBe(401);
    expect((await launch({}, 'x')).status).toBe(401);
  });

  test('returns null preferences before the first save', async () => {
    const body = await (await getPrefs(ALICE)).json();
    expect(body).toEqual({ success: true, persisted: false, preferences: null });
  });

  test('saves preferences, seeds launch stats, and returns them merged', async () => {
    const saved = await (
      await putPrefs(ALICE, { services: [jellyfin], hiddenCategories: ['CLUSTER & OPS'], defaultTab: 'all' })
    ).json();
    expect(saved.success).toBe(true);
    expect(saved.preferences).toMatchObject({ hiddenCategories: ['CLUSTER & OPS'], defaultTab: 'all' });
    expect(saved.preferences.updatedAt).toBeString();
    expect(saved.preferences.services[0]).toMatchObject({
      id: jellyfin.id,
      isPinned: true,
      launchesPerWeek: 3,
      lastAccessedTimestamp: jellyfin.lastAccessedTimestamp,
    });

    const loaded = await (await getPrefs(ALICE)).json();
    expect(loaded.preferences).toEqual(saved.preferences);
  });

  test('accepts a full catalog larger than the default 100 kB body limit', async () => {
    const services = Array.from({ length: 300 }, (_, i) => ({
      ...jellyfin,
      id: `imported-route-media-service-${i}`,
      url: `https://service-${i}.example.com/a/reasonably/long/path/to/the/application/home`,
      description: 'A self-hosted application discovered from the cluster gateway routes. '.repeat(3),
    }));
    const body = { services };
    expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024);

    const res = await putPrefs(ALICE, body);
    expect(res.status).toBe(200);
    expect((await res.json()).preferences.services).toHaveLength(300);
  });

  test('rejects invalid payloads', async () => {
    const res = await putPrefs(ALICE, { services: [{ ...jellyfin, url: 'javascript:alert(1)' }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('services[0].url');
  });

  test('records launches per user and reflects them in preferences', async () => {
    await putPrefs(ALICE, { services: [{ ...jellyfin, launchesPerWeek: 0, lastAccessedTimestamp: 0 }] });
    const first = await (await launch(ALICE, jellyfin.id)).json();
    expect(first).toMatchObject({ success: true, id: jellyfin.id, count: 1 });
    expect((await (await launch(ALICE, jellyfin.id)).json()).count).toBe(2);

    const loaded = await (await getPrefs(ALICE)).json();
    expect(loaded.preferences.services[0].launchesPerWeek).toBe(2);
    expect(loaded.preferences.services[0].lastAccessed).toMatch(/s ago$/);

    // Bob's profile is separate: without his own catalog, nothing is counted
    expect((await (await getPrefs(BOB)).json()).preferences).toBeNull();
    expect((await launch(BOB, jellyfin.id)).status).toBe(404);
  });

  test('only counts launches of services in the saved catalog', async () => {
    expect((await launch(ALICE, jellyfin.id)).status).toBe(404);
    await putPrefs(ALICE, { services: [jellyfin] });
    expect((await launch(ALICE, 'not-in-catalog')).status).toBe(404);
    expect((await launch(ALICE, jellyfin.id)).status).toBe(200);
  });

  test('validates launch ids and reports the counter cap', async () => {
    expect((await launch(ALICE, 'bad id')).status).toBe(400);

    setPreferencesStore(new MemoryPreferencesStore(1));
    const second = { ...jellyfin, id: 'second', launchesPerWeek: 0, lastAccessedTimestamp: 0 };
    await putPrefs(ALICE, { services: [{ ...jellyfin, launchesPerWeek: 0, lastAccessedTimestamp: 0 }, second] });
    await launch(ALICE, jellyfin.id);
    expect((await launch(ALICE, 'second')).status).toBe(409);
  });

  test('AUTH_MODE=none uses a shared anonymous profile', async () => {
    process.env.AUTH_MODE = 'none';
    await putPrefs({}, { services: [jellyfin] });
    const loaded = await (await getPrefs({})).json();
    expect(loaded.preferences.services).toHaveLength(1);
  });

  test('reports 503 when the store is unavailable', async () => {
    const failing: PreferencesStore = {
      kind: 'valkey',
      load: async () => {
        throw new Error('connection refused');
      },
      save: async () => {
        throw new Error('connection refused');
      },
      recordLaunch: async () => {
        throw new Error('connection refused');
      },
      launchStats: async () => ({}),
      close: () => {},
    };
    setPreferencesStore(failing);

    for (const res of [await getPrefs(ALICE), await putPrefs(ALICE, { services: [] }), await launch(ALICE, 'a')]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ success: false, error: 'Preferences store unavailable' });
    }
  });
});
