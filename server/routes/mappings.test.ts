import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { resetK8sClient } from '../k8s/client';
import { getCachedRoutes, scanClusterRoutes } from '../k8s/discovery';
import { DEFAULT_MAPPINGS, getMappings, isCustomized, setMappings } from '../k8s/mappings';
import { MemoryPreferencesStore, PreferencesStore, setPreferencesStore } from '../preferences/store';
import { INITIAL_DISCOVERED_ROUTES } from '../../src/data/initialData';
import { restoreMappings } from './mappings';
import type { CategoryMappings } from '../../src/types';

let server: Server;
let baseUrl: string;
let store: MemoryPreferencesStore;

const ADMIN = { 'Remote-User': 'jdoe', 'Remote-Groups': 'homelab,admins' };
const [ROUTE] = INITIAL_DISCOVERED_ROUTES;

const customRules: CategoryMappings = {
  appRules: [{ keywords: ['immich'], category: 'HOME & LIVING', icon: 'photo_camera' }],
  namespaceRules: { media: { category: 'MEDIA', icon: 'movie' } },
  overrides: {},
};

beforeAll(async () => {
  process.env.KUBECONFIG = '/dev/null';
  resetK8sClient();
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
  setMappings(null);
});

beforeEach(async () => {
  store = new MemoryPreferencesStore();
  setPreferencesStore(store);
  setMappings(null);
  await scanClusterRoutes();
});

function call(path: string, method = 'GET', body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const routeFor = (id: string) => getCachedRoutes().find((r) => r.id === id);

describe('category mappings API', () => {
  test('GET returns the active rules and the defaults', async () => {
    const body = await (await call('/config/mappings')).json();
    expect(body).toMatchObject({ success: true, customized: false });
    expect(body.mappings).toEqual(DEFAULT_MAPPINGS);
    expect(body.defaults).toEqual(DEFAULT_MAPPINGS);
  });

  test('PUT validates, saves and applies new rules, then reset restores the defaults', async () => {
    const bad = await call('/config/mappings', 'PUT', { appRules: 'nope' });
    expect(bad.status).toBe(400);
    expect(isCustomized()).toBe(false);

    const res = await call('/config/mappings', 'PUT', customRules);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, customized: true, mappings: customRules });
    expect(await store.loadSetting('category-mappings')).toEqual(customRules);
    // Discovery re-ran with the new rules (simulated routes keep their own suggestions)
    expect(getMappings()).toEqual(customRules);

    const reset = await call('/config/mappings/reset', 'POST');
    expect(await reset.json()).toMatchObject({ customized: false, mappings: DEFAULT_MAPPINGS });
    expect(await store.loadSetting('category-mappings')).toBeNull();
  });

  test('route overrides are added, applied to discovered routes, and removed', async () => {
    const host = ROUTE.host.toUpperCase();
    const res = await call(`/config/mappings/overrides/${host}`, 'PUT', { name: 'Photos', icon: 'photo_camera' });
    expect(res.status).toBe(200);
    expect((await res.json()).mappings.overrides).toEqual({ [ROUTE.host]: { name: 'Photos', icon: 'photo_camera' } });
    expect(routeFor(ROUTE.id)).toMatchObject({ name: 'Photos', suggestedIcon: 'photo_camera' });

    expect((await call(`/config/mappings/overrides/${ROUTE.host}`, 'DELETE')).status).toBe(200);
    expect(getMappings().overrides).toEqual({});
    expect(routeFor(ROUTE.id)).toMatchObject({ name: ROUTE.name, suggestedIcon: ROUTE.suggestedIcon });
    expect((await call(`/config/mappings/overrides/${ROUTE.host}`, 'DELETE')).status).toBe(404);
  });

  test('imported routes stay imported when the rules change', async () => {
    await call('/routes/import', 'POST', { routeId: ROUTE.id });
    await call('/config/mappings', 'PUT', customRules);
    expect(routeFor(ROUTE.id)?.status).toBe('imported');
  });

  test.each([
    ['an invalid host', '/config/mappings/overrides/bad_host!', { name: 'App' }],
    ['an empty override', '/config/mappings/overrides/app.example.com', {}],
  ])('rejects %s', async (_label, path, body) => {
    expect((await call(path, 'PUT', body)).status).toBe(400);
  });

  test('reports 503 and keeps the active rules when the store fails', async () => {
    const failing: PreferencesStore = {
      ...store,
      kind: 'valkey',
      load: async () => null,
      save: async () => {},
      recordLaunch: async () => null,
      launchStats: async () => ({}),
      loadSetting: async () => null,
      saveSetting: async () => {
        throw new Error('connection refused');
      },
      close: () => {},
    };
    setPreferencesStore(failing);
    const res = await call('/config/mappings', 'PUT', customRules);
    expect(res.status).toBe(503);
    expect(isCustomized()).toBe(false);
  });
});

describe('restoreMappings', () => {
  test('activates saved rules', async () => {
    await store.saveSetting('category-mappings', customRules);
    expect(await restoreMappings(store)).toBe('Restored saved category mappings.');
    expect(getMappings()).toEqual(customRules);
  });

  test('keeps the defaults when nothing is saved or the saved rules are invalid', async () => {
    expect(await restoreMappings(store)).toBe('Using the default category mappings.');
    await store.saveSetting('category-mappings', { appRules: 'nope' });
    expect(await restoreMappings(store)).toBe('Using the default category mappings.');
    expect(isCustomized()).toBe(false);
  });
});
