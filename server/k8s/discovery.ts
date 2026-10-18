import { getK8sClient, k8sRequest } from './client';
import { INITIAL_DISCOVERED_ROUTES } from '../../src/data/initialData';
import { classify, getOverride } from './mappings';
import type { ExcludedRoute, ExclusionReason, RouteAlternate, RouteOverride } from '../../src/types';

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
  alternates?: RouteAlternate[];
  // Set when an administrator corrected this host's name, category or icon
  override?: RouteOverride;
}

// Routes annotated `launchpad.kerrlab.app/hidden: "true"` are never discovered
export const HIDDEN_ANNOTATION = 'launchpad.kerrlab.app/hidden';

export interface DiscoveryFilters {
  excludeNamespaces: Set<string>;
  excludeHosts: RegExp[];
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Case-insensitive match for a host glob where `*` matches any characters. */
export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.split('*').map(escapeRegExp).join('.*')}$`, 'i');
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function getDiscoveryFilters(): DiscoveryFilters {
  return {
    excludeNamespaces: new Set(csv(process.env.DISCOVERY_EXCLUDE_NAMESPACES)),
    excludeHosts: csv(process.env.DISCOVERY_EXCLUDE_HOSTS).map(globToRegExp),
  };
}

// In-memory cache of discovered routes
let cachedRoutes: DiscoveredRoute[] = [];
let cachedExcluded: ExcludedRoute[] = [];
let lastScannedAt: string | null = null;

// Categorization helper based on the route's name, namespace, host and backend
export function classifyRoute(
  name: string,
  namespace: string,
  host: string,
  backendService: string
): { category: HomelabCategory; icon: string } {
  return classify(`${name} ${namespace} ${host} ${backendService}`, namespace);
}

/** Applies the administrator's per-host correction, if any. */
function withOverride(route: DiscoveredRoute): DiscoveredRoute {
  const override = getOverride(route.host);
  if (!override) return route;
  return {
    ...route,
    name: override.name ?? route.name,
    suggestedCategory: override.category ?? route.suggestedCategory,
    suggestedIcon: override.icon ?? route.suggestedIcon,
    override,
  };
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

  return withOverride({
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
  });
}

interface HttpRouteCandidate {
  name: string;
  namespace: string;
  host: string;
  gateways: string[];
  metadata: any;
  spec: any;
}

function exclusionReason(
  candidate: { name: string; namespace: string; host: string; metadata: any },
  filters: DiscoveryFilters
): ExclusionReason | null {
  if (candidate.metadata.annotations?.[HIDDEN_ANNOTATION] === 'true') return 'annotation';
  if (filters.excludeNamespaces.has(candidate.namespace)) return 'namespace';
  if (filters.excludeHosts.some((pattern) => pattern.test(candidate.host))) return 'host-pattern';
  return null;
}

// Redirect-only routes (e.g. an old hostname pointing at a new one) and empty routes have nothing to launch
function hasBackends(spec: any): boolean {
  return (spec.rules ?? []).some((rule: any) => (rule.backendRefs ?? []).length > 0);
}

// Lower is preferred: the internal route of a host wins over its external twin
function routePreference(candidate: HttpRouteCandidate): number {
  const externalOnly =
    candidate.gateways.some((g) => /external|public|dmz/i.test(g)) &&
    !candidate.gateways.some((g) => /internal/i.test(g));
  return (externalOnly ? 2 : 0) + (/external/i.test(candidate.name) ? 1 : 0);
}

function parseHttpRoutes(
  items: any[],
  seenHosts: Set<string>,
  existingImportedIds: Set<string>,
  filters: DiscoveryFilters,
  excluded: ExcludedRoute[]
): DiscoveredRoute[] {
  // Several routes often serve one host (internal and external gateways): group them first
  const byHost = new Map<string, HttpRouteCandidate[]>();

  for (const item of items) {
    const metadata = item.metadata ?? {};
    const spec = item.spec ?? {};
    const hostnames: string[] = spec.hostnames ?? [];
    if (hostnames.length === 0) continue;

    const candidate: HttpRouteCandidate = {
      name: metadata.name ?? 'unnamed-route',
      namespace: metadata.namespace ?? 'default',
      host: hostnames[0],
      gateways: (spec.parentRefs ?? []).map((ref: any) => ref.name).filter(Boolean),
      metadata,
      spec,
    };

    const reason = exclusionReason(candidate, filters) ?? (hasBackends(spec) ? null : 'no-backends');
    if (reason) {
      excluded.push({ name: candidate.name, namespace: candidate.namespace, host: candidate.host, reason });
      continue;
    }

    const group = byHost.get(candidate.host) ?? [];
    group.push(candidate);
    byHost.set(candidate.host, group);
  }

  const routes: DiscoveredRoute[] = [];
  for (const [host, candidates] of byHost) {
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);

    const [primary, ...others] = [...candidates].sort(
      (a, b) => routePreference(a) - routePreference(b) || a.name.localeCompare(b.name)
    );
    const rule = primary.spec.rules?.find((r: any) => (r.backendRefs ?? []).length > 0) ?? {};
    const backendRef = rule.backendRefs?.[0] ?? {};
    const trackingId = primary.metadata.annotations?.['argocd.argoproj.io/tracking-id'];

    const route = buildDiscoveredRoute({
      idPrefix: 'route',
      name: primary.name,
      namespace: primary.namespace,
      host,
      path: rule.matches?.[0]?.path?.value ?? '/',
      gateway: primary.gateways[0] ?? 'unknown-gateway',
      backendService: backendRef.name ?? primary.name,
      port: backendRef.port ?? 80,
      tlsEnabled: true,
      creationTimestamp: primary.metadata.creationTimestamp,
      argoAppName: trackingId ? trackingId.split(':')[0] : undefined,
      existingImportedIds,
    });
    if (others.length > 0) {
      route.alternates = others.map((o) => ({ name: o.name, namespace: o.namespace, gateways: o.gateways }));
    }
    routes.push(route);
  }

  return routes;
}

function parseIngresses(
  items: any[],
  seenHosts: Set<string>,
  existingImportedIds: Set<string>,
  filters: DiscoveryFilters,
  excluded: ExcludedRoute[]
): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  for (const item of items) {
    const metadata = item.metadata ?? {};
    const spec = item.spec ?? {};
    const rules = spec.rules ?? [];

    for (const rule of rules) {
      const host = rule.host;
      if (!host || seenHosts.has(host)) continue;

      const name = metadata.name ?? 'unnamed-ingress';
      const namespace = metadata.namespace ?? 'default';
      const reason = exclusionReason({ name, namespace, host, metadata }, filters);
      if (reason) {
        excluded.push({ name, namespace, host, reason });
        continue;
      }
      seenHosts.add(host);
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

async function fetchWithFallback<T>(
  primary: () => Promise<T>,
  fallbackPath: string,
  resourceName: string
): Promise<any[]> {
  try {
    const res = (await primary()) as { items?: any[] };
    return Array.isArray(res?.items) ? res.items : [];
  } catch {
    try {
      const fallbackRes = await k8sRequest<{ items?: any[] }>(fallbackPath);
      return Array.isArray(fallbackRes?.items) ? fallbackRes.items : [];
    } catch (err: any) {
      const safeErr = String(err?.message || err).replace(/\n|\r/g, '');
      console.warn(`[Route Discovery] Failed to list ${resourceName}: %s`, safeErr);
      return [];
    }
  }
}

async function fetchHttpRoutes(client: ReturnType<typeof getK8sClient>): Promise<any[]> {
  return fetchWithFallback(
    () => client.customObjectsApi.listClusterCustomObject({
      group: 'gateway.networking.k8s.io',
      version: 'v1',
      plural: 'httproutes',
    }),
    '/apis/gateway.networking.k8s.io/v1/httproutes',
    'Gateway API HTTPRoutes'
  );
}

async function fetchIngresses(client: ReturnType<typeof getK8sClient>): Promise<any[]> {
  return fetchWithFallback(
    () => client.networkingV1Api.listIngressForAllNamespaces(),
    '/apis/networking.k8s.io/v1/ingresses',
    'Ingresses'
  );
}

// Discover HTTPRoutes and Ingresses from Kubernetes cluster
export async function scanClusterRoutes(existingImportedIds: Set<string> = new Set()): Promise<DiscoveredRoute[]> {
  const client = getK8sClient();

  if (!client.isConnected) {
    console.log('[Route Discovery] Running in simulation mode — using sample homelab routes');
    cachedExcluded = [];
    cachedRoutes = INITIAL_DISCOVERED_ROUTES.map((r) =>
      withOverride({
        ...r,
        status: existingImportedIds.has(r.id) ? 'imported' : r.status,
      })
    );
    lastScannedAt = new Date().toISOString();
    return cachedRoutes;
  }

  try {
    const seenHosts = new Set<string>();
    const filters = getDiscoveryFilters();
    const excluded: ExcludedRoute[] = [];
    const [httpRouteItems, ingressItems] = await Promise.all([
      fetchHttpRoutes(client),
      fetchIngresses(client),
    ]);

    const discovered = [
      ...parseHttpRoutes(httpRouteItems, seenHosts, existingImportedIds, filters, excluded),
      ...parseIngresses(ingressItems, seenHosts, existingImportedIds, filters, excluded),
    ].sort((a, b) => a.name.localeCompare(b.name));

    excluded.sort((a, b) => a.host.localeCompare(b.host));
    cachedRoutes = discovered;
    cachedExcluded = excluded;
    lastScannedAt = new Date().toISOString();
    console.log(
      `[Route Discovery] Scanned ${cachedRoutes.length} active routes from cluster (${cachedExcluded.length} excluded).`
    );
    return cachedRoutes;
  } catch (err: any) {
    const safeErr = String(err?.message || err).replace(/\n|\r/g, '');
    console.error('[Route Discovery] Error scanning cluster routes: %s', safeErr);
    return cachedRoutes;
  }
}

export function getCachedRoutes(): DiscoveredRoute[] {
  return cachedRoutes;
}

export function getExcludedRoutes(): ExcludedRoute[] {
  return cachedExcluded;
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
