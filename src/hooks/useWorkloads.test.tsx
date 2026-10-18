import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useWorkloads, workloadKey } from './useWorkloads';
import type { ScalableWorkload } from '../types';

const sleeping: ScalableWorkload = {
  kind: 'StatefulSet',
  namespace: 'games',
  name: 'satisfactory',
  desiredReplicas: 0,
  readyReplicas: 0,
  state: 'stopped',
};

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; init?: RequestInit }>;

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('useWorkloads', () => {
  test('does nothing while disabled', () => {
    installFetch(() => json({ success: true, workloads: [sleeping] }));
    const { result } = renderHook(() => useWorkloads(false));
    expect(result.current.workloads).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('loads workloads and refreshes after scaling', async () => {
    installFetch((url) =>
      url === '/api/workloads'
        ? json({ success: true, workloads: [sleeping] })
        : json({ success: true, workload: { ...sleeping, desiredReplicas: 1, state: 'starting' } })
    );
    const { result } = renderHook(() => useWorkloads(true));
    await waitFor(() => expect(result.current.workloads).toHaveLength(1));

    let outcome: Awaited<ReturnType<typeof result.current.scale>> | undefined;
    await act(async () => {
      outcome = await result.current.scale(sleeping, 1);
    });
    expect(outcome).toMatchObject({ ok: true, workload: { state: 'starting' } });
    expect(calls.find((c) => c.init?.method === 'POST')!.url).toBe('/api/workloads/games/statefulset/satisfactory/scale');
    // The list is fetched again so polling restarts at the faster rate
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/workloads').length).toBeGreaterThanOrEqual(2));
    expect(result.current.busy.has(workloadKey(sleeping))).toBe(false);
  });

  test('reports server and network errors', async () => {
    let fail: 'server' | 'network' = 'server';
    installFetch((url) => {
      if (url === '/api/workloads') return json({ success: true, workloads: [sleeping] });
      if (fail === 'network') throw new TypeError('Failed to fetch');
      return json({ success: false, error: 'No scalable workload with that name' }, 404);
    });
    const { result } = renderHook(() => useWorkloads(true));
    await waitFor(() => expect(result.current.workloads).toHaveLength(1));

    await act(async () => {
      expect(await result.current.scale(sleeping, 1)).toEqual({ ok: false, error: 'No scalable workload with that name' });
    });
    fail = 'network';
    await act(async () => {
      expect(await result.current.scale(sleeping, 1)).toEqual({ ok: false, error: 'Could not reach the server' });
    });
  });
});
