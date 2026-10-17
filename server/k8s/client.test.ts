import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { getK8sClient, k8sRequest, resetK8sClient } from './client';
import { FAKE_TOKEN, FakeCluster, startFakeCluster } from '../test/fakeKubeApi';

describe('simulation mode', () => {
  test('is used when no cluster is configured and rejects direct requests', async () => {
    process.env.KUBECONFIG = '/dev/null';
    resetK8sClient();
    const client = getK8sClient();
    expect(client.isConnected).toBe(false);
    expect(client.connectionMode).toBe('simulation');
    await expect(k8sRequest('/api/v1/nodes')).rejects.toThrow('simulation mode');
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

  test('loads the kubeconfig cluster and caches the client', () => {
    const client = getK8sClient();
    expect(client.isConnected).toBe(true);
    expect(client.connectionMode).toBe('kubeconfig');
    expect(client.clusterServer).toBe(cluster.url);
    expect(getK8sClient()).toBe(client);
  });

  test('sends the bearer token and parses JSON responses', async () => {
    cluster.on('GET /api/v1/nodes', { body: { items: [{ metadata: { name: 'node-a' } }] } });
    const res = await k8sRequest<{ items: Array<{ metadata: { name: string } }> }>('/api/v1/nodes');
    expect(res.items[0].metadata.name).toBe('node-a');
    expect(cluster.requests[0].headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(cluster.requests[0].headers.accept).toBe('application/json');
  });

  test('returns an empty object for empty bodies', async () => {
    cluster.on('DELETE /api/v1/thing', { status: 204 });
    expect(await k8sRequest<Record<string, unknown>>('/api/v1/thing', { method: 'DELETE' })).toEqual({});
  });

  test('serializes object bodies as JSON and passes string bodies through', async () => {
    cluster.on('PATCH /apis/x/v1/things/a', { body: {} });
    await k8sRequest('/apis/x/v1/things/a', { method: 'PATCH', body: [{ op: 'add', path: '/a', value: 1 }] });
    const sent = cluster.requests[0];
    expect(JSON.parse(sent.body)).toEqual([{ op: 'add', path: '/a', value: 1 }]);
    expect(sent.headers['content-type']).toBe('application/json');
    expect(sent.headers['content-length']).toBe(String(Buffer.byteLength(sent.body)));

    await k8sRequest('/apis/x/v1/things/a', {
      method: 'PATCH',
      body: '{"raw":true}',
      headers: { 'Content-Type': 'application/merge-patch+json' },
    });
    expect(cluster.requests[1].body).toBe('{"raw":true}');
    expect(cluster.requests[1].headers['content-type']).toBe('application/merge-patch+json');
  });

  test('rejects non-2xx responses with the status code', async () => {
    cluster.on('GET /api/v1/pods', { status: 403, body: { message: 'forbidden' } });
    await expect(k8sRequest('/api/v1/pods')).rejects.toThrow('Kubernetes API error HTTP 403');
  });

  test('rejects malformed JSON', async () => {
    cluster.on('GET /api/v1/pods', { raw: '{not json' });
    await expect(k8sRequest('/api/v1/pods')).rejects.toThrow('Failed to parse Kubernetes API JSON response');
  });

  test('times out slow requests', async () => {
    cluster.on('GET /api/v1/slow', { delayMs: 500, body: {} });
    await expect(k8sRequest('/api/v1/slow', 50)).rejects.toThrow('timed out after 50ms');
  });
});
