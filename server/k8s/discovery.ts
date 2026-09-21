import { getK8sClient } from './client';
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

// Categorization helper based on namespace and name
export function classifyRoute(
  name: string,
  namespace: string,
  host: string,
  backendService: string
): { category: HomelabCategory; icon: string } {
  const text = `${name} ${namespace} ${host} ${backendService}`.toLowerCase();

  // 1. Check for specific application patterns and icons
  if (text.includes('plex')) {
    return { category: 'MEDIA', icon: 'play_circle' };
  }
  if (text.includes('jellyfin')) {
    return { category: 'MEDIA', icon: 'tv' };
  }
  if (text.includes('sonarr') || text.includes('radarr') || text.includes('prowlarr') || text.includes('bazarr')) {
    return { category: 'MEDIA', icon: 'movie' };
  }
  if (text.includes('seerr') || text.includes('overseerr')) {
    return { category: 'MEDIA', icon: 'visibility' };
  }
  if (text.includes('tautulli') || text.includes('autobrr') || text.includes('posterizarr')) {
    return { category: 'MEDIA', icon: 'smart_display' };
  }
  if (text.includes('qbittorrent') || text.includes('torrent') || text.includes('download')) {
    return { category: 'MEDIA', icon: 'download' };
  }
  if (text.includes('nodecast')) {
    return { category: 'MEDIA', icon: 'cast' };
  }

  // Home & Living
  if (text.includes('home-assistant') || text.includes('hass')) {
    return { category: 'HOME & LIVING', icon: 'home_iot_device' };
  }
  if (text.includes('matter')) {
    return { category: 'HOME & LIVING', icon: 'hub' };
  }
  if (text.includes('zigbee') || text.includes('z2mqtt') || text.includes('mqtt')) {
    return { category: 'HOME & LIVING', icon: 'router' };
  }
  if (text.includes('mealie') || text.includes('recipe')) {
    return { category: 'HOME & LIVING', icon: 'restaurant_menu' };
  }
  if (text.includes('bar') || text.includes('cocktail')) {
    return { category: 'HOME & LIVING', icon: 'local_bar' };
  }
  if (text.includes('miniflux') || text.includes('rss') || text.includes('news')) {
    return { category: 'HOME & LIVING', icon: 'rss_feed' };
  }
  if (text.includes('wedding') || text.includes('event')) {
    return { category: 'HOME & LIVING', icon: 'photo_camera' };
  }
  if (text.includes('go2rtc') || text.includes('cam')) {
    return { category: 'HOME & LIVING', icon: 'videocam' };
  }

  // Tools & Dev
  if (text.includes('it-tools') || text.includes('tools')) {
    return { category: 'TOOLS & DEV', icon: 'build' };
  }
  if (text.includes('kaneo')) {
    return { category: 'TOOLS & DEV', icon: 'task_alt' };
  }
  if (text.includes('keeper')) {
    return { category: 'TOOLS & DEV', icon: 'bookmark' };
  }
  if (text.includes('excalidraw') || text.includes('draw')) {
    return { category: 'TOOLS & DEV', icon: 'draw' };
  }
  if (text.includes('bento') || text.includes('pdf')) {
    return { category: 'TOOLS & DEV', icon: 'picture_as_pdf' };
  }
  if (text.includes('speedtest') || text.includes('speed')) {
    return { category: 'TOOLS & DEV', icon: 'speed' };
  }
  if (text.includes('n8n') || text.includes('workflow') || text.includes('renovate')) {
    return { category: 'TOOLS & DEV', icon: 'auto_mode' };
  }
  if (text.includes('ntfy') || text.includes('notify')) {
    return { category: 'TOOLS & DEV', icon: 'notifications' };
  }
  if (text.includes('fluxer') || text.includes('chat') || text.includes('irc') || text.includes('lounge')) {
    return { category: 'TOOLS & DEV', icon: 'chat' };
  }
  if (text.includes('romm') || text.includes('game') || text.includes('retro')) {
    return { category: 'TOOLS & DEV', icon: 'sports_esports' };
  }
  if (text.includes('mermaid')) {
    return { category: 'TOOLS & DEV', icon: 'account_tree' };
  }
  if (text.includes('whoami')) {
    return { category: 'TOOLS & DEV', icon: 'fingerprint' };
  }
  if (text.includes('meilisearch') || text.includes('kafka')) {
    return { category: 'TOOLS & DEV', icon: 'data_object' };
  }

  // Cluster & Ops
  if (text.includes('argo')) {
    return { category: 'CLUSTER & OPS', icon: 'published_with_changes' };
  }
  if (text.includes('grafana') || text.includes('metrics')) {
    return { category: 'CLUSTER & OPS', icon: 'monitoring' };
  }
  if (text.includes('headlamp') || text.includes('cluster') || text.includes('k8s')) {
    return { category: 'CLUSTER & OPS', icon: 'developer_board' };
  }
  if (text.includes('authelia') || text.includes('auth') || text.includes('lldap')) {
    return { category: 'CLUSTER & OPS', icon: 'security' };
  }
  if (text.includes('longhorn') || text.includes('storage')) {
    return { category: 'CLUSTER & OPS', icon: 'hard_drive' };
  }
  if (text.includes('traefik') || text.includes('gateway') || text.includes('proxy')) {
    return { category: 'CLUSTER & OPS', icon: 'alt_route' };
  }
  if (text.includes('uptime') || text.includes('kuma')) {
    return { category: 'CLUSTER & OPS', icon: 'health_and_safety' };
  }

  // 2. Fallback classification based strictly on namespace
  if (namespace === 'media') {
    return { category: 'MEDIA', icon: 'movie' };
  }
  if (namespace === 'home' || namespace === 'iot') {
    return { category: 'HOME & LIVING', icon: 'home' };
  }
  if (namespace === 'tools' || namespace === 'automation' || namespace === 'comms' || namespace === 'games') {
    return { category: 'TOOLS & DEV', icon: 'terminal' };
  }
  if (
    namespace === 'argocd' ||
    namespace === 'system' ||
    namespace === 'security' ||
    namespace === 'observability' ||
    namespace === 'traefik' ||
    namespace === 'longhorn-system' ||
    namespace === 'kube-system'
  ) {
    return { category: 'CLUSTER & OPS', icon: 'dns' };
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
    const discovered: DiscoveredRoute[] = [];
    const seenHosts = new Set<string>();

    // 1. Query Gateway API HTTPRoutes
    try {
      const httpRouteList = (await client.customObjectsApi.listClusterCustomObject({
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        plural: 'httproutes',
      })) as { items: any[] };

      if (httpRouteList && Array.isArray(httpRouteList.items)) {
        for (const item of httpRouteList.items) {
          const metadata = item.metadata || {};
          const spec = item.spec || {};

          const name = metadata.name || 'unnamed-route';
          const namespace = metadata.namespace || 'default';
          const hostnames: string[] = spec.hostnames || [];

          if (hostnames.length === 0) continue;

          // Deduplicate by primary host
          const primaryHost = hostnames[0];
          if (seenHosts.has(primaryHost)) continue;
          seenHosts.add(primaryHost);

          const parentGateway = spec.parentRefs?.[0]?.name || 'cilium-gateway-l7';
          const rule = spec.rules?.[0] || {};
          const backendRef = rule.backendRefs?.[0] || {};
          const backendService = backendRef.name || name;
          const port = backendRef.port || 80;
          const path = rule.matches?.[0]?.path?.value || '/';

          // Extract ArgoCD app tracking if present
          const trackingId = metadata.annotations?.['argocd.argoproj.io/tracking-id'];
          const argoAppName = trackingId ? trackingId.split(':')[0] : undefined;

          const routeId = `route-${namespace}-${name}`;
          const isImported = existingImportedIds.has(routeId) || existingImportedIds.has(name);
          const { category, icon } = classifyRoute(name, namespace, primaryHost, backendService);

          discovered.push({
            id: routeId,
            name: formatServiceName(name),
            namespace,
            host: primaryHost,
            path,
            gateway: parentGateway,
            backendService,
            port,
            tlsEnabled: true,
            status: isImported ? 'imported' : 'pending',
            discoveredAt: metadata.creationTimestamp ? new Date(metadata.creationTimestamp).toISOString() : new Date().toISOString(),
            suggestedCategory: category,
            suggestedIcon: icon,
            argoAppName,
          });
        }
      }
    } catch (routeErr: any) {
      console.warn('[Route Discovery] Failed to list Gateway API HTTPRoutes:', routeErr?.message || routeErr);
    }

    // 2. Query Standard Ingresses as complementary / legacy source
    try {
      const ingressList = await client.networkingV1Api.listIngressForAllNamespaces();
      if (ingressList && Array.isArray(ingressList.items)) {
        for (const item of ingressList.items) {
          const metadata = item.metadata || {};
          const spec = item.spec || {};
          const rules = spec.rules || [];

          for (const rule of rules) {
            const host = rule.host;
            if (!host || seenHosts.has(host)) continue;
            seenHosts.add(host);

            const name = metadata.name || 'unnamed-ingress';
            const namespace = metadata.namespace || 'default';
            const pathRule = rule.http?.paths?.[0];
            const backendService = pathRule?.backend?.service?.name || name;
            const port = pathRule?.backend?.service?.port?.number || 80;
            const path = pathRule?.path || '/';

            const routeId = `ingress-${namespace}-${name}`;
            const isImported = existingImportedIds.has(routeId);
            const { category, icon } = classifyRoute(name, namespace, host, backendService);

            discovered.push({
              id: routeId,
              name: formatServiceName(name),
              namespace,
              host,
              path,
              gateway: 'ingress-controller',
              backendService,
              port,
              tlsEnabled: !!spec.tls?.length,
              status: isImported ? 'imported' : 'pending',
              discoveredAt: metadata.creationTimestamp ? new Date(metadata.creationTimestamp).toISOString() : new Date().toISOString(),
              suggestedCategory: category,
              suggestedIcon: icon,
            });
          }
        }
      }
    } catch (ingErr: any) {
      console.warn('[Route Discovery] Failed to list Ingresses:', ingErr?.message || ingErr);
    }

    // Sort alphabetically by name
    discovered.sort((a, b) => a.name.localeCompare(b.name));

    cachedRoutes = discovered;
    lastScannedAt = new Date().toISOString();
    console.log(`[Route Discovery] Scanned ${cachedRoutes.length} active routes from cluster.`);
    return cachedRoutes;
  } catch (err: any) {
    console.error('[Route Discovery] Error scanning cluster routes:', err);
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
