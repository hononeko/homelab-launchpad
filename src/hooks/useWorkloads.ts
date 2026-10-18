import { useCallback, useEffect, useRef, useState } from 'react';
import { ScalableWorkload } from '../types';

// Poll quickly while a workload is starting or stopping, slowly otherwise
export const STEADY_POLL_MS = 30_000;
export const TRANSITION_POLL_MS = 3000;

export function workloadKey(w: Pick<ScalableWorkload, 'namespace' | 'kind' | 'name'>): string {
  return `${w.namespace}/${w.kind}/${w.name}`;
}

const isTransitioning = (w: ScalableWorkload) => w.state === 'starting' || w.state === 'stopping';

export type ScaleResult = { ok: true; workload: ScalableWorkload } | { ok: false; error: string };

/** Opted-in workloads and their sleep/wake controls, for administrators. */
export function useWorkloads(enabled: boolean) {
  const [workloads, setWorkloads] = useState<ScalableWorkload[]>([]);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/workloads');
      const data = res.ok ? await res.json() : null;
      if (mounted.current && Array.isArray(data?.workloads)) setWorkloads(data.workloads);
    } catch {
      // Keep the last known state; the next poll retries
    }
  }, []);

  const transitioning = workloads.some(isTransitioning);

  useEffect(() => {
    if (!enabled) {
      setWorkloads([]);
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), transitioning ? TRANSITION_POLL_MS : STEADY_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, transitioning, refresh, refreshTick]);

  const scale = useCallback(async (workload: ScalableWorkload, replicas: 0 | 1): Promise<ScaleResult> => {
    const key = workloadKey(workload);
    setBusy((prev) => new Set(prev).add(key));
    try {
      const path = [workload.namespace, workload.kind.toLowerCase(), workload.name].map(encodeURIComponent).join('/');
      const res = await fetch(`/api/workloads/${path}/scale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replicas }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.workload) {
        return { ok: false, error: typeof data?.error === 'string' ? data.error : `HTTP ${res.status}` };
      }
      setWorkloads((prev) => prev.map((w) => (workloadKey(w) === key ? data.workload : w)));
      // Restart polling at the faster rate straight away
      setRefreshTick((tick) => tick + 1);
      return { ok: true, workload: data.workload };
    } catch {
      return { ok: false, error: 'Could not reach the server' };
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  return { workloads, busy, scale };
}
