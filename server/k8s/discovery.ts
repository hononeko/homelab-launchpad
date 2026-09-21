import { getK8sClient, k8sRequest } from './client';
import { INITIAL_DISCOVERED_ROUTES } from '../../src/data/initialData';

export type HomelabCategory = 'MEDIA' | 'HOME & LIVING' | 'TOOLS & DEV' | 'CLUSTER & OPS';

export interface DiscoveredRoute {
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
  suggestedCategory: HomelabCategory;
  suggestedIcon: string;
  argoAppName?: string;
}

// In-memory cache of discovered routes
let cachedRoutes: DiscoveredRoute[] = [];
let lastScannedAt: string | null = null;

interface ClassificationRule {
  readonly keywords: readonly string[];
  readonly category: HomelabCategory;
  readonly icon: string;
}

const APP_RULES: readonly ClassificationRule[] = [
  // Media
  { keywords: ['plex'], category: 'MEDIA', icon: 'play_circle' },
  { keywords: ['jellyfin'], category: 'MEDIA', icon: 'tv' },
  { keywords: ['sonarr', 'radarr', 'prowlarr', 'bazarr'], category: 'MEDIA', icon: 'movie' },
  { keywords: ['seerr', 'overseerr'], category: 'MEDIA', icon: 'visibility' },
  { keywords: ['tautulli', 'autobrr', 'posterizarr'], category: 'MEDIA', icon: 'smart_display' },
  { keywords: ['qbittorrent', 'torrent', 'download'], category: 'MEDIA', icon: 'download' },
  { keywords: ['nodecast'], category: 'MEDIA', icon: 'cast' },

  // Home & Living
  { keywords: ['home-assistant', 'hass'], category: 'HOME & LIVING', icon: 'home_iot_device' },
  { keywords: ['matter'], category: 'HOME & LIVING', icon: 'hub' },
  { keywords: ['zigbee', 'z2mqtt', 'mqtt'], category: 'HOME & LIVING', icon: 'router' },
  { keywords: ['mealie', 'recipe'], category: 'HOME & LIVING', icon: 'restaurant_menu' },
  { keywords: ['bar', 'cocktail'], category: 'HOME & LIVING', icon: 'local_bar' },
  { keywords: ['miniflux', 'rss', 'news'], category: 'HOME & LIVING', icon: 'rss_feed' },
  { keywords: ['wedding', 'event'], category: 'HOME & LIVING', icon: 'photo_camera' },
  { keywords: ['go2rtc', 'cam'], category: 'HOME & LIVING', icon: 'videocam' },

  // Tools & Dev
  { keywords: ['it-tools', 'tools'], category: 'TOOLS & DEV', icon: 'build' },
  { keywords: ['kaneo'], category: 'TOOLS & DEV', icon: 'task_alt' },
  { keywords: ['keeper'], category: 'TOOLS & DEV', icon: 'bookmark' },
  { keywords: ['excalidraw', 'draw'], category: 'TOOLS & DEV', icon: 'draw' },
  { keywords: ['bento', 'pdf'], category: 'TOOLS & DEV', icon: 'picture_as_pdf' },
  { keywords: ['speedtest', 'speed'], category: 'TOOLS & DEV', icon: 'speed' },
  { keywords: ['n8n', 'workflow', 'renovate'], category: 'TOOLS & DEV', icon: 'auto_mode' },
  { keywords: ['ntfy', 'notify'], category: 'TOOLS & DEV', icon: 'notifications' },
  { keywords: ['fluxer', 'chat', 'irc', 'lounge'], category: 'TOOLS & DEV', icon: 'chat' },
  { keywords: ['romm', 'game', 'retro'], category: 'TOOLS & DEV', icon: 'sports_esports' },
  { keywords: ['mermaid'], category: 'TOOLS & DEV', icon: 'account_tree' },
  { keywords: ['whoami'], category: 'TOOLS & DEV', icon: 'fingerprint' },
  { keywords: ['meilisearch', 'kafka'], category: 'TOOLS & DEV', icon: 'data_object' },

  // Cluster & Ops
  { keywords: ['argo'], category: 'CLUSTER & OPS', icon: 'published_with_changes' },
  { keywords: ['grafana', 'metrics'], category: 'CLUSTER & OPS', icon: 'monitoring' },
  { keywords: ['headlamp', 'cluster', 'k8s'], category: 'CLUSTER & OPS', icon: 'developer_board' },
  { keywords: ['authelia', 'auth', 'lldap'], category: 'CLUSTER & OPS', icon: 'security' },
  { keywords: ['longhorn', 'storage'], category: 'CLUSTER & OPS', icon: 'hard_drive' },
  { keywords: ['traefik', 'gateway', 'proxy'], category: 'CLUSTER & OPS', icon: 'alt_route' },
  { keywords: ['uptime', 'kuma'], category: 'CLUSTER & OPS', icon: 'health_and_safety' },
];

const NAMESPACE_RULES: Record<string, { category: HomelabCategory; icon: string }> = {
  media: { category: 'MEDIA', icon: 'movie' },
  home: { category: 'HOME & LIVING', icon: 'home' },
  iot: { category: 'HOME & LIVING', icon: 'home' },
  tools: { category: 'TOOLS & DEV', icon: 'terminal' },
  automation: { category: 'TOOLS & DEV', icon: 'terminal' },
  comms: { category: 'TOOLS & DEV', icon: 'terminal' },
  games: { category: 'TOOLS & DEV', icon: 'terminal' },
  argocd: { category: 'CLUSTER & OPS', icon: 'dns' },
  system: { category: 'CLUSTER & OPS', icon: 'dns' },
  security: { category: 'CLUSTER & OPS', icon: 'dns' },
  observability: { category: 'CLUSTER & OPS', icon: 'dns' },
  traefik: { category: 'CLUSTER & OPS', icon: 'dns' },
  'longhorn-system': { category: 'CLUSTER & OPS', icon: 'dns' },
  'kube-system': { category: 'CLUSTER & OPS', icon: 'dns' },
};

// Categorization helper based on namespace and name
export function classifyRoute(
  name: string,
  namespace: string,
  host: string,
  backendService: string
): { category: HomelabCategory; icon: string } {
  const text = `${name} ${namespace} ${host} ${backendService}`.toLowerCase();

  const matched = APP_RULES.find((rule) => rule.keywords.some((k) => text.includes(k)));
  if (matched) {
    return { category: matched.category, icon: matched.icon };
  }

  const nsMatch = NAMESPACE_RULES[namespace];
  if (nsMatch) {
    return nsMatch;
  }

  return { category: 'TOOLS & DEV', icon: 'hub' };
}

// Format route name into readable human string
function formatServiceName(rawName: string): string {
  return rawName
    .replace(/-route$|-httproute$|-ui$|-app$/i, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface BuildRouteParams {
  idPrefix: string;
  name: string;
  namespace: string;
  host: string;
  path: string;
  gateway: string;
  backendService: string;
  port: number;
  tlsEnabled: boolean;
  creationTimestamp?: string;
  argoAppName?: string;
  existingImportedIds: Set<string>;
}

function buildDiscoveredRoute(params: BuildRouteParams): DiscoveredRoute {
  const routeId = `${params.idPrefix}-${params.namespace}-${params.name}`;
  const isImported = params.existingImportedIds.has(routeId) || params.existingImportedIds.has(params.name);
  const { category, icon } = classifyRoute(params.name, params.namespace, params.host, params.backendService);

  return {
    id: routeId,
    name: formatServiceName(params.name),
    namespace: params.namespace,
    host: params.host,
    path: params.path,
    gateway: params.gateway,
    backendService: params.backendService,
    port: params.port,
    tlsEnabled: params.tlsEnabled,
    status: isImported ? 'imported' : 'pending',
    discoveredAt: params.creationTimestamp
      ? new Date(params.creationTimestamp).toISOString()
      : new Date().toISOString(),
    suggestedCategory: category,
    suggestedIcon: icon,
    argoAppName: params.argoAppName,
  };
}

function parseHttpRoutes(
  items: any[],
  seenHosts: Set<string>,
  existingImportedIds: Set<string>
): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  for (const item of items) {
    const metadata = item.metadata ?? {};
    const spec = item.spec ?? {};
    const hostnames: string[] = spec.hostnames ?? [];

    if (hostnames.length === 0) continue;
    const primaryHost = hostnames[0];
    if (seenHosts.has(primaryHost)) continue;
    seenHosts.add(primaryHost);

    const name = metadata.name ?? 'unnamed-route';
    const namespace = metadata.namespace ?? 'default';
    const rule = spec.rules?.[0] ?? {};
    const backendRef = rule.backendRefs?.[0] ?? {};
    const trackingId = metadata.annotations?.['argocd.argoproj.io/tracking-id'];

    routes.push(
      buildDiscoveredRoute({
        idPrefix: 'route',
        name,
        namespace,
        host: primaryHost,
        path: rule.matches?.[0]?.path?.value ?? '/',
        gateway: spec.parentRefs?.[0]?.name ?? 'cilium-gateway-l7',
        backendService: backendRef.name ?? name,
        port: backendRef.port ?? 80,
        tlsEnabled: true,
        creationTimestamp: metadata.creationTimestamp,
        argoAppName: trackingId ? trackingId.split(':')[0] : undefined,
        existingImportedIds,
      })
    );
  }

  return routes;
}

function parseIngresses(
  items: any[],
  seenHosts: Set<string>,
  existingImportedIds: Set<string>
): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  for (const item of items) {
    const metadata = item.metadata ?? {};
    const spec = item.spec ?? {};
    const rules = spec.rules ?? [];

    for (const rule of rules) {
      const host = rule.host;
      if (!host || seenHosts.has(host)) continue;
      seenHosts.add(host);

      const name = metadata.name ?? 'unnamed-ingress';
      const namespace = metadata.namespace ?? 'default';
      const pathRule = rule.http?.paths?.[0];
      const service = pathRule?.backend?.service;

      routes.push(
        buildDiscoveredRoute({
          idPrefix: 'ingress',
          name,
          namespace,
          host,
          path: pathRule?.path ?? '/',
          gateway: 'ingress-controller',
          backendService: service?.name ?? name,
          port: service?.port?.number ?? 80,
          tlsEnabled: Boolean(spec.tls?.length),
          creationTimestamp: metadata.creationTimestamp,
          existingImportedIds,
        })
      );
    }
  }

  return routes;
}

async function fetchHttpRoutes(client: ReturnType<typeof getK8sClient>): Promise<any[]> {
  try {
    const res = (await client.customObjectsApi.listClusterCustomObject({
      group: 'gateway.networking.k8s.io',
      version: 'v1',
      plural: 'httproutes',
    })) as { items: any[] };
    return Array.isArray(res?.items) ? res.items : [];
  } catch {
    try {
      const fallbackRes = await k8sRequest<{ items: any[] }>('/apis/gateway.networking.k8s.io/v1/httproutes');
      return Array.isArray(fallbackRes?.items) ? fallbackRes.items : [];
    } catch (err: any) {
      const safeErr = String(err?.message || err).replace(/[\r\n]/g, ' ');
      console.warn('[Route Discovery] Failed to list Gateway API HTTPRoutes: %s', safeErr);
      return [];
    }
  }
}

async function fetchIngresses(client: ReturnType<typeof getK8sClient>): Promise<any[]> {
  try {
    const res = await client.networkingV1Api.listIngressForAllNamespaces();
    return Array.isArray(res?.items) ? res.items : [];
  } catch {
    try {
      const fallbackRes = await k8sRequest<{ items: any[] }>('/apis/networking.k8s.io/v1/ingresses');
      return Array.isArray(fallbackRes?.items) ? fallbackRes.items : [];
    } catch (err: any) {
      const safeErr = String(err?.message || err).replace(/[\r\n]/g, ' ');
      console.warn('[Route Discovery] Failed to list Ingresses: %s', safeErr);
      return [];
    }
  }
}

// Discover HTTPRoutes and Ingresses from Kubernetes cluster
export async function scanClusterRoutes(existingImportedIds: Set<string> = new Set()): Promise<DiscoveredRoute[]> {
  const client = getK8sClient();

  if (!client.isConnected) {
    console.log('[Route Discovery] Running in simulation mode — using sample homelab routes');
    cachedRoutes = INITIAL_DISCOVERED_ROUTES.map((r) => ({
      ...r,
      status: existingImportedIds.has(r.id) ? 'imported' : r.status,
    }));
    lastScannedAt = new Date().toISOString();
    return cachedRoutes;
  }

  try {
    const seenHosts = new Set<string>();
    const [httpRouteItems, ingressItems] = await Promise.all([
      fetchHttpRoutes(client),
      fetchIngresses(client),
    ]);

    const discovered = [
      ...parseHttpRoutes(httpRouteItems, seenHosts, existingImportedIds),
      ...parseIngresses(ingressItems, seenHosts, existingImportedIds),
    ].sort((a, b) => a.name.localeCompare(b.name));

    cachedRoutes = discovered;
    lastScannedAt = new Date().toISOString();
    console.log(`[Route Discovery] Scanned ${cachedRoutes.length} active routes from cluster.`);
    return cachedRoutes;
  } catch (err: any) {
    const safeErr = String(err?.message || err).replace(/[\r\n]/g, ' ');
    console.error('[Route Discovery] Error scanning cluster routes: %s', safeErr);
    return cachedRoutes;
  }
}

export function getCachedRoutes(): DiscoveredRoute[] {
  return cachedRoutes;
}

export function getLastScannedAt(): string | null {
  return lastScannedAt;
}

export function markRouteImported(routeId: string): boolean {
  const route = cachedRoutes.find((r) => r.id === routeId);
  if (route) {
    route.status = 'imported';
    return true;
  }
  return false;
}
