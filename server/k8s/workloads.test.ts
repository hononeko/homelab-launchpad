import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  getScaleNamespaces,
  HOST_ANNOTATION,
  listScalableWorkloads,
  parseWorkloadKind,
  resetSimulatedWorkloads,
  SCALABLE_ANNOTATION,
  scaleWorkload,
  SIMULATED_TRANSITION_MS,
  WorkloadError,
  workloadState,
} from './workloads';
import { resetK8sClient } from './client';
import { FakeCluster, startFakeCluster } from '../test/fakeKubeApi';

const STATEFULSETS = '/apis/apps/v1/namespaces/games/statefulsets';
const DEPLOYMENTS = '/apis/apps/v1/namespaces/games/deployments';

function workload(name: string, annotations: Record<string, string>, replicas?: number, ready?: number) {
  return {
    metadata: { name, namespace: 'games', annotations },
    spec: replicas === undefined ? {} : { replicas },
    status: ready === undefined ? {} : { readyReplicas: ready },
  };
}

afterEach(() => {
  delete process.env.SCALE_NAMESPACES;
});

describe('helpers', () => {
  test('workload state follows desired and ready replicas', () => {
    expect(workloadState(0, 0)).toBe('stopped');
    expect(workloadState(0, 1)).toBe('stopping');
    expect(workloadState(1, 0)).toBe('starting');
    expect(workloadState(1, 1)).toBe('running');
  });

  test('scale namespaces come from SCALE_NAMESPACES, dropping invalid names', () => {
    expect(getScaleNamespaces()).toEqual([]);
    process.env.SCALE_NAMESPACES = ' games, Tools ,bad_ns,';
    expect(getScaleNamespaces()).toEqual(['games', 'tools']);
  });

  test('kinds are parsed from route parameters', () => {
    expect(parseWorkloadKind('StatefulSet')).toBe('StatefulSet');
    expect(parseWorkloadKind('deployment')).toBe('Deployment');
    expect(parseWorkloadKind('daemonset')).toBeNull();
    expect(parseWorkloadKind('constructor')).toBeNull();
  });
});

describe('simulation mode', () => {
  beforeAll(() => {
    process.env.KUBECONFIG = '/dev/null';
    resetK8sClient();
  });

  beforeEach(() => resetSimulatedWorkloads());

  test('lists sample workloads', async () => {
    const workloads = await listScalableWorkloads();
    expect(workloads.map((w) => `${w.namespace}/${w.name}:${w.state}`)).toEqual([
      'games/satisfactory:stopped',
      'tools/code-server:running',
    ]);
    expect(workloads[1].host).toBe('code.example.com');
  });

  test('a woken workload starts, then runs once the transition time has passed', async () => {
    const started = await scaleWorkload('games', 'StatefulSet', 'satisfactory', 1);
    expect(started).toMatchObject({ desiredReplicas: 1, readyReplicas: 0, state: 'starting' });
    const later = await listScalableWorkloads(Date.now() + SIMULATED_TRANSITION_MS);
    expect(later[0]).toMatchObject({ readyReplicas: 1, state: 'running' });
  });

  test('unknown workloads are not found', async () => {
    await expect(scaleWorkload('games', 'Deployment', 'satisfactory', 1)).rejects.toMatchObject({ status: 404 });
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
    process.env.SCALE_NAMESPACES = 'games';
    cluster.on(`GET ${STATEFULSETS}`, {
      body: {
        items: [
          workload('satisfactory', { [SCALABLE_ANNOTATION]: 'true', [HOST_ANNOTATION]: 'Satisfactory.Example.com' }, 0, 0),
          workload('not-opted-in', {}, 1, 1),
          workload('opted-out', { [SCALABLE_ANNOTATION]: 'false' }, 1, 1),
        ],
      },
    });
    cluster.on(`GET ${DEPLOYMENTS}`, {
      body: { items: [workload('builder', { [SCALABLE_ANNOTATION]: 'true' }), workload('web', { [SCALABLE_ANNOTATION]: 'true' }, 3, 3)] },
    });
  });

  test('lists only opted-in workloads in the allowed namespaces', async () => {
    const workloads = await listScalableWorkloads();
    expect(workloads).toEqual([
      // An unset replica count means 1
      { kind: 'Deployment', namespace: 'games', name: 'builder', desiredReplicas: 1, readyReplicas: 0, state: 'starting' },
      {
        kind: 'StatefulSet',
        namespace: 'games',
        name: 'satisfactory',
        desiredReplicas: 0,
        readyReplicas: 0,
        state: 'stopped',
        host: 'satisfactory.example.com',
      },
      { kind: 'Deployment', namespace: 'games', name: 'web', desiredReplicas: 3, readyReplicas: 3, state: 'running' },
    ]);
    expect(cluster.requests.map((r) => r.path).sort()).toEqual([DEPLOYMENTS, STATEFULSETS]);
  });

  test('without SCALE_NAMESPACES nothing is listed or requested', async () => {
    delete process.env.SCALE_NAMESPACES;
    expect(await listScalableWorkloads()).toEqual([]);
    expect(cluster.requests).toHaveLength(0);
  });

  test('scaling patches the scale subresource', async () => {
    cluster.on(`PATCH ${STATEFULSETS}/satisfactory/scale`, { body: { spec: { replicas: 1 } } });
    const result = await scaleWorkload('games', 'StatefulSet', 'satisfactory', 1);
    expect(result).toMatchObject({ name: 'satisfactory', desiredReplicas: 1, state: 'starting' });

    const patch = cluster.requests.find((r) => r.method === 'PATCH')!;
    expect(patch.headers['content-type']).toBe('application/merge-patch+json');
    expect(JSON.parse(patch.body)).toEqual({ spec: { replicas: 1 } });
  });

  test.each([
    ['a namespace outside SCALE_NAMESPACES', 'media', 'satisfactory', 403],
    ['a workload that did not opt in', 'games', 'not-opted-in', 404],
  ])('refuses %s', async (_label, namespace, name, status) => {
    const error = await scaleWorkload(namespace, 'StatefulSet', name, 0).catch((e) => e);
    expect(error).toBeInstanceOf(WorkloadError);
    expect(error.status).toBe(status);
    expect(cluster.requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  test('refuses workloads running more than one replica', async () => {
    await expect(scaleWorkload('games', 'Deployment', 'web', 0)).rejects.toMatchObject({ status: 409 });
  });

  test('cluster errors are passed on', async () => {
    cluster.on(`PATCH ${STATEFULSETS}/satisfactory/scale`, { status: 403, body: { message: 'forbidden' } });
    const error = await scaleWorkload('games', 'StatefulSet', 'satisfactory', 1).catch((e) => e);
    expect(error).not.toBeInstanceOf(WorkloadError);
    expect(String(error.message)).toContain('403');
  });
});
