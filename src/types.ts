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
  // Kept in the catalog but left off the dashboard; unhidden from the Config view
  hidden?: boolean;
  // The name and icon from before the user edited them, kept so the edit can be reset
  original?: ServiceIdentity;
}

export interface ServiceIdentity {
  name: string;
  icon: string;
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
  argoAppName?: string;
  // Other routes serving the same host (e.g. the external twin of an internal route)
  alternates?: RouteAlternate[];
  // Set when an administrator corrected this host's name, category or icon
  override?: RouteOverride;
}

export interface RouteAlternate {
  name: string;
  namespace: string;
  gateways: string[];
}

export type ExclusionReason = 'annotation' | 'namespace' | 'host-pattern' | 'no-backends';

/** A route the server left out of discovery, reported so the UI can explain why it's missing. */
export interface ExcludedRoute {
  name: string;
  namespace: string;
  host: string;
  reason: ExclusionReason;
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

export type ProbeStatus = 'active' | 'degraded' | 'offline';

export interface ProbeTimings {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  totalMs: number;
}

export interface ServiceHealth {
  url: string;
  status: ProbeStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  timings: ProbeTimings | null;
  error: string | null;
  checkedAt: string;
}

export type UserRole = 'admin' | 'viewer';

export interface AuthUser {
  username: string;
  name: string | null;
  email: string | null;
  groups: string[];
  role: UserRole;
}

export interface AuthSession {
  authenticated: boolean;
  mode: 'forward-auth' | 'none';
  user: AuthUser | null;
  viewerCategories: string[];
}

export type TabFilter = 'pinned' | 'frequent' | 'all';

export const TAB_FILTERS: readonly TabFilter[] = ['pinned', 'frequent', 'all'];

export type ServiceCategory = ServiceItem['category'];

export const SERVICE_CATEGORIES: readonly ServiceCategory[] = ['MEDIA', 'HOME & LIVING', 'TOOLS & DEV', 'CLUSTER & OPS'];

/** Per-user layout and settings synced through `/api/user/preferences`. */
export interface UserPreferences {
  // The user's service catalog; array order is the display order
  services: ServiceItem[];
  hiddenCategories: ServiceCategory[];
  // Discovered routes the user hid from the discovery list
  hiddenRouteIds: string[];
  defaultTab: TabFilter;
  argoEnabled: boolean;
  autoSyncRoutes: boolean;
  updatedAt: string | null;
}

export interface LaunchStats {
  count: number;
  lastLaunchedAt: number;
}
export type MainView = 'overview' | 'services' | 'gitops' | 'cluster' | 'config';

/** Classifies discovered routes whose name, namespace, host or backend contains any keyword. */
export interface KeywordRule {
  keywords: string[];
  category: ServiceCategory;
  icon: string;
}

export interface CategoryIcon {
  category: ServiceCategory;
  icon: string;
}

/** Per-host corrections; any field left out keeps the classified value. */
export interface RouteOverride {
  name?: string;
  category?: ServiceCategory;
  icon?: string;
}

/**
 * How discovered routes get their suggested category and icon. Keyword rules
 * are tried in order, then the route's namespace; host overrides win over both.
 */
export interface CategoryMappings {
  appRules: KeywordRule[];
  namespaceRules: Record<string, CategoryIcon>;
  overrides: Record<string, RouteOverride>;
}

export type WorkloadKind = 'Deployment' | 'StatefulSet';

// "starting" and "stopping" while the ready replicas catch up with the desired count
export type WorkloadState = 'running' | 'stopped' | 'starting' | 'stopping';

/** A Deployment or StatefulSet that administrators can put to sleep (0 replicas) or wake (1). */
export interface ScalableWorkload {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  desiredReplicas: number;
  readyReplicas: number;
  state: WorkloadState;
  // Host of the service it backs (from its annotation), linking it to that service's card
  host?: string;
}
