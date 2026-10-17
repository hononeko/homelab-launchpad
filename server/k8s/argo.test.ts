import { afterAll, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
  fetchArgoApplications,
  formatRelativeTime,
  getCachedArgoApps,
  getLastArgoScannedAt,
  mapCrdToArgoApp,
  syncAllArgoApplications,
  syncArgoApplication,
} from './argo';
import { resetK8sClient } from './client';
import { FakeCluster, startFakeCluster } from '../test/fakeKubeApi';
import { INITIAL_ARGO_APPS } from '../../src/data/initialData';

const APPS_PATH = '/apis/argoproj.io/v1alpha1/applications';
const NS_APPS_PATH = '/apis/argoproj.io/v1alpha1/namespaces/argocd/applications';

function crd(name: string, syncStatus: string, extra: Record<string, unknown> = {}) {
  return {
    metadata: { name, creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: { project: 'apps', source: { repoURL: 'https://git.example.com/repo.git', targetRevision: 'main', path: `apps/${name}` } },
    status: { sync: { status: syncStatus, revision: 'abcdef1234567' }, health: { status: 'Healthy' } },
    ...extra,
  };
}

describe('formatRelativeTime', () => {
  beforeAll(() => {
    setSystemTime(new Date('2026-06-01T12:00:00Z'));
  });

  afterAll(() => {
    setSystemTime();
  });

  test.each([
    [undefined, 'unknown'],
    ['not a date', 'unknown'],
    ['2026-06-01T13:00:00Z', 'just now'],
    ['2026-06-01T11:59:30Z', '30s ago'],
    ['2026-06-01T11:45:00Z', '15m ago'],
    ['2026-06-01T09:00:00Z', '3h ago'],
    ['2026-05-29T12:00:00Z', '3d ago'],
  ])('%p -> %p', (input, expected) => {
    expect(formatRelativeTime(input)).toBe(expected);
  });

  test('accepts Date objects', () => {
    expect(formatRelativeTime(new Date('2026-06-01T11:59:00Z'))).toBe('60s ago'.replace('60s', '1m'));
  });
});

describe('mapCrdToArgoApp', () => {
  test('maps source, revision, and statuses', () => {
    expect(mapCrdToArgoApp(crd('jellyfin', 'OutOfSync'))).toMatchObject({
      id: 'jellyfin',
      name: 'jellyfin',
      project: 'apps',
      repoUrl: 'https://git.example.com/repo.git',
      targetRevision: 'main (abcdef1)',
      commitMessage: 'apps/jellyfin',
      syncStatus: 'OutOfSync',
      healthStatus: 'Healthy',
      serviceId: 'jellyfin',
    });
  });

  test('detects running operations and normalizes unknown states', () => {
    expect(mapCrdToArgoApp(crd('a', 'Synced', { operation: { sync: {} } })).syncStatus).toBe('Syncing');
    expect(mapCrdToArgoApp({ status: { operationState: { phase: 'Running' } } }).syncStatus).toBe('Syncing');
    expect(mapCrdToArgoApp({ status: { sync: { status: 'Weird' }, health: { status: 'Suspended' } } })).toMatchObject({
      syncStatus: 'Unknown',
      healthStatus: 'Progressing',
    });
  });

  test('uses defaults for empty resources and multi-source specs', () => {
    expect(mapCrdToArgoApp(null)).toMatchObject({ name: 'unnamed', project: 'default', targetRevision: 'HEAD' });
    const multi = mapCrdToArgoApp({ metadata: { name: 'm' }, spec: { sources: [{ repoURL: 'https://git.example.com/b.git' }] } });
    expect(multi.repoUrl).toBe('https://git.example.com/b.git');
    expect(multi.commitMessage).toBe('GitOps synchronized');
  });
});

describe('simulation mode', () => {
  beforeAll(() => {
    process.env.KUBECONFIG = '/dev/null';
    resetK8sClient();
  });

  test('returns sample applications and simulates syncs', async () => {
    const apps = await fetchArgoApplications();
    expect(apps).toEqual(INITIAL_ARGO_APPS);
    expect(getLastArgoScannedAt()).not.toBeNull();

    const result = await syncArgoApplication(apps[0].name);
    expect(result.message).toContain('(simulation)');
  });

  test('rejects invalid application names', async () => {
    await expect(syncArgoApplication('Bad_Name')).rejects.toThrow('Invalid application name');
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

  test('lists applications sorted by name', async () => {
    cluster.on(`GET ${APPS_PATH}`, { body: { items: [crd('zigbee', 'Synced'), crd('argocd', 'OutOfSync')] } });
    const apps = await fetchArgoApplications();
    expect(apps.map((a) => a.name)).toEqual(['argocd', 'zigbee']);
    expect(getCachedArgoApps()).toBe(apps);
  });

  test('falls back to the argocd namespace when the cluster-wide list is denied', async () => {
    cluster.on(`GET ${APPS_PATH}`, { status: 403, body: {} });
    cluster.on(`GET ${NS_APPS_PATH}`, { body: { items: [crd('mealie', 'Synced')] } });
    const apps = await fetchArgoApplications();
    expect(apps.map((a) => a.name)).toEqual(['mealie']);
  });

  test('returns no applications when every lookup fails', async () => {
    expect(await fetchArgoApplications()).toEqual([]);
  });

  test('sync patches the operation field', async () => {
    cluster.on(`PATCH ${NS_APPS_PATH}/jellyfin`, { body: {} });
    const result = await syncArgoApplication('jellyfin');
    expect(result.success).toBe(true);

    const patch = cluster.requests.find((r) => r.method === 'PATCH');
    expect(patch?.headers['content-type']).toContain('application/json-patch+json');
    expect(JSON.parse(patch!.body)).toEqual([
      {
        op: 'add',
        path: '/operation',
        value: { initiatedBy: { username: 'launchpad' }, sync: { prune: true, dryRun: false } },
      },
    ]);
  });

  test('failed syncs throw and mark the cached app OutOfSync', async () => {
    cluster.on(`GET ${APPS_PATH}`, { body: { items: [crd('jellyfin', 'Synced')] } });
    await fetchArgoApplications();
    cluster.on(`PATCH ${NS_APPS_PATH}/jellyfin`, { status: 403, body: { message: 'forbidden' } });

    await expect(syncArgoApplication('jellyfin')).rejects.toThrow();
    expect(getCachedArgoApps()[0].syncStatus).toBe('OutOfSync');
  });

  test('sync-all only targets out-of-sync applications when there are any', async () => {
    cluster.on(`GET ${APPS_PATH}`, {
      body: { items: [crd('a-synced', 'Synced'), crd('b-drifted', 'OutOfSync'), crd('c-broken', 'OutOfSync')] },
    });
    await fetchArgoApplications();
    cluster.on(`PATCH ${NS_APPS_PATH}/b-drifted`, { body: {} });
    cluster.on(`PATCH ${NS_APPS_PATH}/c-broken`, { status: 500, body: {} });

    const result = await syncAllArgoApplications();
    expect(result.triggered).toEqual(['b-drifted']);
    expect(result.count).toBe(1);
  });

  test('sync-all targets every application when all are synced', async () => {
    cluster.on(`GET ${APPS_PATH}`, { body: { items: [crd('a', 'Synced'), crd('b', 'Synced')] } });
    await fetchArgoApplications();
    cluster.on(`PATCH ${NS_APPS_PATH}/a`, { body: {} });
    cluster.on(`PATCH ${NS_APPS_PATH}/b`, { body: {} });

    expect((await syncAllArgoApplications()).triggered).toEqual(['a', 'b']);
  });
});
