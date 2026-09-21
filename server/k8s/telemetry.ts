import { INITIAL_TELEMETRY, INITIAL_NODES } from '../../src/data/initialData';
import { ClusterTelemetry, ClusterNode } from '../../src/types';
import { getK8sClient, k8sRequest } from './client';

export interface TelemetryData {
  telemetry: ClusterTelemetry;
  nodes: ClusterNode[];
  lastFetchedAt: string;
}

let cachedTelemetry: TelemetryData | null = null;
let lastFetchTimeMs = 0;
const CACHE_TTL_MS = 5000;

export function parseCpuToNano(cpuStr?: string): number {
  if (!cpuStr) return 0;
  if (cpuStr.endsWith('n')) return Number.parseInt(cpuStr.slice(0, -1), 10);
  if (cpuStr.endsWith('u')) return Number.parseInt(cpuStr.slice(0, -1), 10) * 1000;
  if (cpuStr.endsWith('m')) return Number.parseInt(cpuStr.slice(0, -1), 10) * 1000000;
  return Number.parseFloat(cpuStr) * 1000000000;
}

export function parseMemToKiB(memStr?: string): number {
  if (!memStr) return 0;
  if (memStr.endsWith('Ki')) return Number.parseInt(memStr.slice(0, -2), 10);
  if (memStr.endsWith('Mi')) return Number.parseInt(memStr.slice(0, -2), 10) * 1024;
  if (memStr.endsWith('Gi')) return Number.parseInt(memStr.slice(0, -2), 10) * 1024 * 1024;
  if (memStr.endsWith('Ti')) return Number.parseInt(memStr.slice(0, -2), 10) * 1024 * 1024 * 1024;
  return Math.round(Number.parseInt(memStr, 10) / 1024);
}

function calculateUptime(creationTimestamp?: string): string {
  if (!creationTimestamp) return '0d 0h';
  const ageMs = Math.max(0, Date.now() - new Date(creationTimestamp).getTime());
  const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `${days}d ${hours}h`;
}

interface K8sNodeItem {
  metadata: {
    name: string;
    labels?: Record<string, string>;
    creationTimestamp?: string;
  };
  status: {
    addresses?: Array<{ type: string; address: string }>;
    allocatable: {
      cpu?: string;
      memory?: string;
      pods?: string;
    };
    conditions?: Array<{ type: string; status: string }>;
    nodeInfo: {
      kubeletVersion?: string;
      osImage?: string;
      kernelVersion?: string;
    };
  };
}

interface MetricsItem {
  metadata: { name: string };
  usage: { cpu?: string; memory?: string };
}

interface PodItem {
  metadata?: { name: string; namespace: string };
  spec?: { nodeName?: string };
  status?: { phase?: string };
}

interface LonghornNodeItem {
  status?: {
    diskStatus?: Record<string, { storageMaximum?: number; storageAvailable?: number; storageScheduled?: number }>;
  };
}

function mapClusterNodes(
  nodeItems: K8sNodeItem[],
  metricsMap: Map<string, { cpu?: string; memory?: string }>,
  pods: PodItem[]
): { nodes: ClusterNode[]; totalAllocCpu: number; totalUsedCpu: number } {
  let totalAllocCpu = 0;
  let totalUsedCpu = 0;

  const nodes: ClusterNode[] = nodeItems.map((n) => {
    const name = n.metadata.name;
    const isControlPlane = n.metadata.labels?.['node-role.kubernetes.io/control-plane'] !== undefined;
    const allocCpuNano = parseCpuToNano(n.status.allocatable.cpu);
    const allocMemKiB = parseMemToKiB(n.status.allocatable.memory);
    const maxPods = Number.parseInt(n.status.allocatable.pods || '110', 10);
    const nodePods = pods.filter((p) => p.spec?.nodeName === name).length;

    const usage = metricsMap.get(name);
    const usedCpuNano = usage ? parseCpuToNano(usage.cpu) : 0;
    const usedMemKiB = usage ? parseMemToKiB(usage.memory) : 0;

    totalAllocCpu += allocCpuNano;
    totalUsedCpu += usedCpuNano;

    const cpuUsage = allocCpuNano > 0 ? Math.round((usedCpuNano / allocCpuNano) * 1000) / 10 : 0;
    const memoryUsage = allocMemKiB > 0 ? Math.round((usedMemKiB / allocMemKiB) * 1000) / 10 : 0;
    const isReady = n.status.conditions?.find((c) => c.type === 'Ready')?.status === 'True';
    const ip = n.status.addresses?.find((a) => a.type === 'InternalIP')?.address || '';

    return {
      name,
      role: isControlPlane ? 'controlplane' : 'worker',
      status: isReady ? 'Ready' : 'NotReady',
      ip,
      cpuUsage,
      memoryUsage,
      pods: nodePods,
      maxPods,
      uptime: calculateUptime(n.metadata.creationTimestamp),
      version: `${n.status.nodeInfo.kubeletVersion || 'v1.31'} (${n.status.nodeInfo.osImage || 'Talos'})`,
    };
  });

  return { nodes, totalAllocCpu, totalUsedCpu };
}

function calculateStorage(longhornNodes: LonghornNodeItem[]): {
  nvmeUsedTb: number;
  nvmeTotalTb: number;
  nvmePercent: number;
  nvmePoolName: string;
} {
  let maxBytes = 0;
  let availBytes = 0;

  for (const n of longhornNodes) {
    const diskStatus = n.status?.diskStatus || {};
    for (const disk of Object.values(diskStatus)) {
      maxBytes += disk.storageMaximum || 0;
      availBytes += disk.storageAvailable || 0;
    }
  }

  const ONE_TB_BYTES = 1099511627776;
  if (maxBytes > 0) {
    const usedBytes = Math.max(0, maxBytes - availBytes);
    return {
      nvmeUsedTb: Math.round((usedBytes / ONE_TB_BYTES) * 100) / 100,
      nvmeTotalTb: Math.round((maxBytes / ONE_TB_BYTES) * 100) / 100,
      nvmePercent: Math.round((usedBytes / maxBytes) * 1000) / 10,
      nvmePoolName: 'Longhorn-NVMe',
    };
  }

  return {
    nvmeUsedTb: INITIAL_TELEMETRY.nvmeUsedTb,
    nvmeTotalTb: INITIAL_TELEMETRY.nvmeTotalTb,
    nvmePercent: INITIAL_TELEMETRY.nvmePercent,
    nvmePoolName: INITIAL_TELEMETRY.nvmePoolName,
  };
}

export async function fetchClusterTelemetry(forceRefresh = false): Promise<TelemetryData> {
  const now = Date.now();
  if (!forceRefresh && cachedTelemetry && now - lastFetchTimeMs < CACHE_TTL_MS) {
    return cachedTelemetry;
  }

  const client = getK8sClient();
  if (!client.isConnected) {
    return {
      telemetry: INITIAL_TELEMETRY,
      nodes: INITIAL_NODES,
      lastFetchedAt: new Date().toISOString(),
    };
  }

  try {
    const startTime = performance.now();

    const [nodesRes, metricsRes, podsRes, lhRes] = await Promise.all([
      k8sRequest<{ items: K8sNodeItem[] }>('/api/v1/nodes'),
      k8sRequest<{ items: MetricsItem[] }>('/apis/metrics.k8s.io/v1beta1/nodes').catch(() => ({ items: [] })),
      k8sRequest<{ items: PodItem[] }>('/api/v1/pods').catch(() => ({ items: [] })),
      k8sRequest<{ items: LonghornNodeItem[] }>('/apis/longhorn.io/v1beta2/namespaces/longhorn-system/nodes').catch(
        () => ({ items: [] })
      ),
    ]);

    const rttMs = Math.round((performance.now() - startTime) * 10) / 10;

    const metricsMap = new Map<string, { cpu?: string; memory?: string }>();
    for (const m of metricsRes.items) {
      metricsMap.set(m.metadata.name, m.usage);
    }

    const pods = podsRes.items;
    const runningPods = pods.filter((p) => p.status?.phase === 'Running').length;
    const totalPods = pods.length;

    const { nodes, totalAllocCpu, totalUsedCpu } = mapClusterNodes(nodesRes.items, metricsMap, pods);
    const storage = calculateStorage(lhRes.items);

    const firstNode = nodesRes.items[0];
    const osImage = firstNode?.status.nodeInfo.osImage || 'Talos Linux';
    const kubeletVersion = firstNode?.status.nodeInfo.kubeletVersion || 'v1.31';

    const allReady = nodes.every((n) => n.status === 'Ready');
    let statusText = 'ALL SYSTEMS CALM';
    if (!allReady) {
      statusText = 'DEGRADED // NODE ATTENTION';
    } else if (runningPods / Math.max(1, totalPods) < 0.9) {
      statusText = 'PODS RECONCILING';
    }

    const telemetry: ClusterTelemetry = {
      podsActive: runningPods,
      podsTotal: totalPods,
      podsPercent: totalPods > 0 ? Math.round((runningPods / totalPods) * 10000) / 100 : 100,
      aggCpuCores: Math.round((totalAllocCpu / 1000000000) * 10) / 10,
      aggCpuPercent: totalAllocCpu > 0 ? Math.round((totalUsedCpu / totalAllocCpu) * 1000) / 10 : 0,
      nvmeUsedTb: storage.nvmeUsedTb,
      nvmeTotalTb: storage.nvmeTotalTb,
      nvmePercent: storage.nvmePercent,
      nvmePoolName: storage.nvmePoolName,
      ingressRate: INITIAL_TELEMETRY.ingressRate,
      ingressPercent: INITIAL_TELEMETRY.ingressPercent,
      ingressState: INITIAL_TELEMETRY.ingressState,
      rttMs,
      nodeCount: nodes.length,
      osName: osImage,
      cni: 'Cilium eBPF L7',
      dns: `CoreDNS (${kubeletVersion})`,
      statusText,
    };

    cachedTelemetry = {
      telemetry,
      nodes,
      lastFetchedAt: new Date().toISOString(),
    };
    lastFetchTimeMs = Date.now();

    return cachedTelemetry;
  } catch (err) {
    const safeErr = String((err as Error)?.message || err).replace(/\n|\r/g, '');
    console.error('[Telemetry] Failed to fetch live cluster telemetry: %s', safeErr);
    if (cachedTelemetry) {
      return cachedTelemetry;
    }
    return {
      telemetry: INITIAL_TELEMETRY,
      nodes: INITIAL_NODES,
      lastFetchedAt: new Date().toISOString(),
    };
  }
}
