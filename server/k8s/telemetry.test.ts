import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { fetchClusterTelemetry, parseCpuToNano, parseMemToKiB } from './telemetry';
import { resetK8sClient } from './client';
import { FakeCluster, startFakeCluster } from '../test/fakeKubeApi';
import { INITIAL_NODES, INITIAL_TELEMETRY } from '../../src/data/initialData';

const TB = 1099511627776;

function node(name: string, ready: boolean, controlPlane = false) {
  return {
    metadata: {
      name,
      creationTimestamp: '2026-01-01T00:00:00Z',
      labels: controlPlane ? { 'node-role.kubernetes.io/control-plane': '' } : {},
    },
    status: {
      addresses: [{ type: 'InternalIP', address: `10.0.0.${controlPlane ? 1 : 2}` }],
      allocatable: { cpu: '4', memory: '8Gi', pods: '110' },
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
      nodeInfo: { kubeletVersion: 'v1.32.0', osImage: 'Talos (v1.9.0)' },
    },
  };
}

function pod(nodeName: string, phase: string) {
  return { metadata: { name: `${nodeName}-${phase}`, namespace: 'default' }, spec: { nodeName }, status: { phase } };
}

describe('quantity parsing', () => {
  test.each([
    [undefined, 0],
    ['100n', 100],
    ['5u', 5000],
    ['250m', 250_000_000],
    ['2', 2_000_000_000],
  ])('cpu %p -> %p nanocores', (input, expected) => {
    expect(parseCpuToNano(input)).toBe(expected);
  });

  test.each([
    [undefined, 0],
    ['1024Ki', 1024],
    ['1Mi', 1024],
    ['1Gi', 1024 * 1024],
    ['1Ti', 1024 * 1024 * 1024],
    ['2048', 2],
  ])('memory %p -> %p KiB', (input, expected) => {
    expect(parseMemToKiB(input)).toBe(expected);
  });
});

describe('simulation mode', () => {
  beforeAll(() => {
    process.env.KUBECONFIG = '/dev/null';
    resetK8sClient();
  });

  test('returns sample telemetry', async () => {
    const data = await fetchClusterTelemetry(true);
    expect(data.telemetry).toEqual(INITIAL_TELEMETRY);
    expect(data.nodes).toEqual(INITIAL_NODES);
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

  // Runs first: before any successful fetch, failures fall back to sample data
  test('falls back to sample telemetry when nodes cannot be listed', async () => {
    const data = await fetchClusterTelemetry(true);
    expect(data.telemetry).toEqual(INITIAL_TELEMETRY);
  });

  test('aggregates nodes, metrics, pods, and Longhorn storage', async () => {
    cluster.on('GET /api/v1/nodes', { body: { items: [node('cp-1', true, true), node('worker-1', false)] } });
    cluster.on('GET /apis/metrics.k8s.io/v1beta1/nodes', {
      body: {
        items: [
          { metadata: { name: 'cp-1' }, usage: { cpu: '2', memory: '4Gi' } },
          { metadata: { name: 'worker-1' }, usage: { cpu: '1000m', memory: '2Gi' } },
        ],
      },
    });
    cluster.on('GET /api/v1/pods', {
      body: { items: [pod('cp-1', 'Running'), pod('cp-1', 'Running'), pod('worker-1', 'Running'), pod('worker-1', 'Pending')] },
    });
    cluster.on('GET /apis/longhorn.io/v1beta2/namespaces/longhorn-system/nodes', {
      body: { items: [{ status: { diskStatus: { nvme: { storageMaximum: 4 * TB, storageAvailable: 3 * TB } } } }] },
    });

    const { telemetry, nodes } = await fetchClusterTelemetry(true);
    expect(telemetry).toMatchObject({
      podsActive: 3,
      podsTotal: 4,
      podsPercent: 75,
      aggCpuCores: 8,
      aggCpuPercent: 37.5,
      nvmeUsedTb: 1,
      nvmeTotalTb: 4,
      nvmePercent: 25,
      nvmePoolName: 'Longhorn-NVMe',
      nodeCount: 2,
      osName: 'Talos (v1.9.0)',
      dns: 'CoreDNS (v1.32.0)',
      statusText: 'DEGRADED // NODE ATTENTION',
    });
    expect(nodes[0]).toMatchObject({
      name: 'cp-1',
      role: 'controlplane',
      status: 'Ready',
      ip: '10.0.0.1',
      cpuUsage: 50,
      memoryUsage: 50,
      pods: 2,
      maxPods: 110,
    });
    expect(nodes[1]).toMatchObject({ role: 'worker', status: 'NotReady', cpuUsage: 25, pods: 2 });
  });

  test('reports reconciling pods and uses defaults when optional APIs are missing', async () => {
    cluster.on('GET /api/v1/nodes', { body: { items: [node('cp-1', true, true)] } });
    cluster.on('GET /api/v1/pods', { body: { items: [pod('cp-1', 'Running'), pod('cp-1', 'Pending')] } });

    const { telemetry, nodes } = await fetchClusterTelemetry(true);
    expect(telemetry.statusText).toBe('PODS RECONCILING');
    expect(telemetry.aggCpuPercent).toBe(0);
    expect(telemetry.nvmeTotalTb).toBe(INITIAL_TELEMETRY.nvmeTotalTb);
    expect(nodes[0].cpuUsage).toBe(0);
  });

  test('reports a calm cluster when every node is ready and pods are running', async () => {
    cluster.on('GET /api/v1/nodes', { body: { items: [node('cp-1', true, true)] } });
    cluster.on('GET /api/v1/pods', { body: { items: [pod('cp-1', 'Running')] } });

    expect((await fetchClusterTelemetry(true)).telemetry.statusText).toBe('ALL SYSTEMS CALM');
  });

  test('serves cached telemetry within the TTL and on later failures', async () => {
    cluster.on('GET /api/v1/nodes', { body: { items: [node('cp-1', true, true)] } });
    const first = await fetchClusterTelemetry(true);
    const requestCount = cluster.requests.length;

    expect(await fetchClusterTelemetry()).toBe(first);
    expect(cluster.requests.length).toBe(requestCount);

    cluster.reset();
    expect(await fetchClusterTelemetry(true)).toBe(first);
  });
});
