export interface ServiceItem {
  id: string;
  name: string;
  url: string;
  displayUrl: string;
  description: string;
  icon: string;
  category: 'MEDIA' | 'HOME & LIVING' | 'TOOLS & DEV' | 'CLUSTER & OPS';
  isPinned: boolean;
  launchesPerWeek: number;
  lastAccessed: string;
  lastAccessedTimestamp: number;
  status: 'active' | 'synced' | 'used' | 'degraded' | 'offline';
  latencyMs?: number;
  argoAppName?: string;
  discoveredFrom?: 'httproute' | 'ingress' | 'manual';
  custom?: boolean;
}

export interface ArgoApplication {
  id: string;
  name: string;
  project: string;
  repoUrl: string;
  targetRevision: string;
  commitMessage: string;
  syncStatus: 'Synced' | 'OutOfSync' | 'Syncing' | 'Unknown';
  healthStatus: 'Healthy' | 'Progressing' | 'Degraded' | 'Missing';
  lastSyncedAt: string;
  serviceId?: string;
}

export interface DiscoveredHTTPRoute {
  id: string;
  name: string;
  namespace: string;
  host: string;
  path: string;
  gateway: string;
  backendService: string;
  port: number;
  tlsEnabled: boolean;
  status: 'active' | 'pending' | 'imported';
  discoveredAt: string;
  suggestedCategory: 'MEDIA' | 'HOME & LIVING' | 'TOOLS & DEV' | 'CLUSTER & OPS';
  suggestedIcon: string;
}

export interface ClusterTelemetry {
  podsActive: number;
  podsTotal: number;
  podsPercent: number;
  aggCpuCores: number;
  aggCpuPercent: number;
  nvmeUsedTb: number;
  nvmeTotalTb: number;
  nvmePercent: number;
  nvmePoolName: string;
  ingressRate: string;
  ingressPercent: number;
  ingressState: string;
  rttMs: number;
  nodeCount: number;
  osName: string;
  cni: string;
  dns: string;
  statusText: string;
}

export interface ClusterNode {
  name: string;
  role: 'controlplane' | 'worker';
  status: 'Ready' | 'NotReady';
  ip: string;
  cpuUsage: number;
  memoryUsage: number;
  pods: number;
  maxPods: number;
  uptime: string;
  version: string;
}

export type TabFilter = 'pinned' | 'frequent' | 'all';
export type MainView = 'overview' | 'services' | 'gitops' | 'cluster' | 'config';
