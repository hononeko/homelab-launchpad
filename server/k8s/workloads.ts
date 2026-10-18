import { getK8sClient, k8sRequest } from './client';
import type { ScalableWorkload, WorkloadKind, WorkloadState } from '../../src/types';

// A Deployment or StatefulSet opts in with `launchpad.kerrlab.app/scalable: "true"`
export const SCALABLE_ANNOTATION = 'launchpad.kerrlab.app/scalable';
// Optional host of the service it backs, so that service's card shows the power control
export const HOST_ANNOTATION = 'launchpad.kerrlab.app/host';

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

const PLURALS: Record<WorkloadKind, string> = { Deployment: 'deployments', StatefulSet: 'statefulsets' };
const KINDS_BY_PARAM: Record<string, WorkloadKind> = { deployment: 'Deployment', statefulset: 'StatefulSet' };

export class WorkloadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Namespaces from SCALE_NAMESPACES (comma-separated); workloads elsewhere are never listed or scaled. */
export function getScaleNamespaces(): string[] {
  return (process.env.SCALE_NAMESPACES ?? '')
    .split(',')
    .map((ns) => ns.trim().toLowerCase())
    .filter((ns) => DNS_LABEL.test(ns));
}

export function parseWorkloadKind(param: string): WorkloadKind | null {
  return Object.hasOwn(KINDS_BY_PARAM, param.toLowerCase()) ? KINDS_BY_PARAM[param.toLowerCase()] : null;
}

export function workloadState(desired: number, ready: number): WorkloadState {
  if (desired === 0) return ready > 0 ? 'stopping' : 'stopped';
  return ready >= desired ? 'running' : 'starting';
}

interface K8sWorkload {
  metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
  spec?: { replicas?: number };
  status?: { readyReplicas?: number };
}

function toWorkload(kind: WorkloadKind, namespace: string, item: K8sWorkload): ScalableWorkload | null {
  const annotations = item.metadata?.annotations ?? {};
  const name = item.metadata?.name;
  if (annotations[SCALABLE_ANNOTATION] !== 'true' || !name) return null;
  // Kubernetes defaults an unset replica count to 1
  const desiredReplicas = item.spec?.replicas ?? 1;
  const readyReplicas = item.status?.readyReplicas ?? 0;
  const host = annotations[HOST_ANNOTATION]?.trim().toLowerCase();
  return {
    kind,
    namespace,
    name,
    desiredReplicas,
    readyReplicas,
    state: workloadState(desiredReplicas, readyReplicas),
    ...(host && HOST_PATTERN.test(host) ? { host } : {}),
  };
}

// --- Simulation mode: sample workloads that take a few seconds to start or stop

export const SIMULATED_TRANSITION_MS = 4000;

interface SimulatedWorkload {
  workload: Omit<ScalableWorkload, 'desiredReplicas' | 'readyReplicas' | 'state'>;
  desired: number;
  ready: number;
  changedAt: number;
}

let simulated: SimulatedWorkload[] = [];

function simulatedEntry(workload: SimulatedWorkload['workload'], running: boolean): SimulatedWorkload {
  const replicas = running ? 1 : 0;
  return { workload, desired: replicas, ready: replicas, changedAt: 0 };
}

export function resetSimulatedWorkloads(): void {
  simulated = [
    simulatedEntry({ kind: 'StatefulSet', namespace: 'games', name: 'satisfactory' }, false),
    simulatedEntry({ kind: 'Deployment', namespace: 'tools', name: 'code-server', host: 'code.example.com' }, true),
  ];
}
resetSimulatedWorkloads();

function simulatedView(entry: SimulatedWorkload, now: number): ScalableWorkload {
  // The ready count catches up with the desired count after the transition time
  if (entry.ready !== entry.desired && now - entry.changedAt >= SIMULATED_TRANSITION_MS) entry.ready = entry.desired;
  return {
    ...entry.workload,
    desiredReplicas: entry.desired,
    readyReplicas: entry.ready,
    state: workloadState(entry.desired, entry.ready),
  };
}

// --- Cluster access

function workloadsPath(namespace: string, kind: WorkloadKind): string {
  return `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/${PLURALS[kind]}`;
}

/** Scalable workloads in the allowed namespaces, sorted by namespace and name. */
export async function listScalableWorkloads(now = Date.now()): Promise<ScalableWorkload[]> {
  if (!getK8sClient().isConnected) return simulated.map((entry) => simulatedView(entry, now));

  const lists = await Promise.all(
    getScaleNamespaces().flatMap((namespace) =>
      (Object.keys(PLURALS) as WorkloadKind[]).map(async (kind) => {
        const res = await k8sRequest<{ items?: K8sWorkload[] }>(workloadsPath(namespace, kind));
        return (res.items ?? []).map((item) => toWorkload(kind, namespace, item));
      })
    )
  );
  return lists
    .flat()
    .filter((w): w is ScalableWorkload => w !== null)
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}

async function findWorkload(namespace: string, kind: WorkloadKind, name: string): Promise<ScalableWorkload> {
  if (!getScaleNamespaces().includes(namespace) && getK8sClient().isConnected) {
    throw new WorkloadError(`Namespace ${namespace} is not in SCALE_NAMESPACES`, 403);
  }
  const workload = (await listScalableWorkloads()).find(
    (w) => w.namespace === namespace && w.kind === kind && w.name === name
  );
  if (!workload) throw new WorkloadError('No scalable workload with that name', 404);
  return workload;
}

/**
 * Scales an opted-in workload to 0 (sleep) or 1 (wake). Workloads running more
 * than one replica are refused: they are not single-instance and a 0/1 toggle
 * would silently cut their capacity.
 */
export async function scaleWorkload(
  namespace: string,
  kind: WorkloadKind,
  name: string,
  replicas: 0 | 1
): Promise<ScalableWorkload> {
  const workload = await findWorkload(namespace, kind, name);
  if (workload.desiredReplicas > 1) {
    throw new WorkloadError(`${name} runs ${workload.desiredReplicas} replicas; only 0/1 workloads can be toggled`, 409);
  }

  if (!getK8sClient().isConnected) {
    const entry = simulated.find((s) => s.workload.namespace === namespace && s.workload.name === name);
    if (!entry) throw new WorkloadError('No scalable workload with that name', 404);
    if (entry.desired !== replicas) {
      entry.desired = replicas;
      entry.changedAt = Date.now();
    }
    return simulatedView(entry, Date.now());
  }

  const updated = await k8sRequest<{ spec?: { replicas?: number }; status?: { replicas?: number } }>(
    `${workloadsPath(namespace, kind)}/${encodeURIComponent(name)}/scale`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: { spec: { replicas } },
    }
  );
  const desiredReplicas = updated.spec?.replicas ?? replicas;
  return {
    ...workload,
    desiredReplicas,
    state: workloadState(desiredReplicas, workload.readyReplicas),
  };
}
