import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { resetK8sClient } from '../k8s/client';
import { resetSimulatedWorkloads } from '../k8s/workloads';

let server: Server;
let baseUrl: string;

const ADMIN = { 'Remote-User': 'jdoe', 'Remote-Groups': 'homelab,admins' };

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
});

beforeEach(() => resetSimulatedWorkloads());

const scale = (path: string, body: unknown) =>
  fetch(`${baseUrl}/workloads/${path}/scale`, {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('workloads API (simulation mode)', () => {
  test('lists the scalable workloads', async () => {
    const body = await (await fetch(`${baseUrl}/workloads`, { headers: ADMIN })).json();
    expect(body.success).toBe(true);
    expect(body.workloads.map((w: { name: string }) => w.name)).toEqual(['satisfactory', 'code-server']);
  });

  test('wakes a workload', async () => {
    const res = await scale('games/statefulset/satisfactory', { replicas: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).workload).toMatchObject({ name: 'satisfactory', desiredReplicas: 1, state: 'starting' });
  });

  test.each([
    ['replicas other than 0 or 1', 'games/statefulset/satisfactory', { replicas: 2 }, 400],
    ['a string replica count', 'games/statefulset/satisfactory', { replicas: '1' }, 400],
    ['an unsupported kind', 'games/daemonset/satisfactory', { replicas: 1 }, 400],
    ['an unknown workload', 'games/statefulset/valheim', { replicas: 1 }, 404],
  ])('rejects %s', async (_label, path, body, status) => {
    expect((await scale(path, body)).status).toBe(status);
  });
});
