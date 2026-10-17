import { SERVICE_CATEGORIES, ServiceCategory, ServiceItem, TabFilter, UserPreferences } from '../../src/types';

export const MAX_SERVICES = 300;
export const SERVICE_ID_PATTERN = /^[\w.:-]{1,200}$/;
const ICON_PATTERN = /^[a-z0-9_]{1,64}$/;
const ARGO_APP_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const TABS: readonly TabFilter[] = ['pinned', 'frequent', 'all'];
const DISCOVERY_SOURCES: readonly NonNullable<ServiceItem['discoveredFrom']>[] = ['httproute', 'ingress', 'manual'];

export type PreferencesInput = Omit<UserPreferences, 'updatedAt'>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const DEFAULT_PREFERENCES: PreferencesInput = {
  services: [],
  hiddenCategories: [],
  defaultTab: 'pinned',
  argoEnabled: true,
  autoSyncRoutes: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, min: number, max: number): string | null {
  return typeof value === 'string' && value.length >= min && value.length <= max ? value : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isCategory(value: unknown): value is ServiceCategory {
  return SERVICE_CATEGORIES.includes(value as ServiceCategory);
}

/**
 * Validates one service and keeps only its persisted fields. Runtime state
 * (probe status, latency) is reset; launch stats are only used to seed
 * counters the server does not have yet.
 */
function parseService(raw: unknown, index: number): ParseResult<ServiceItem> {
  const fail = (field: string): ParseResult<ServiceItem> => ({ ok: false, error: `services[${index}].${field} is invalid` });
  if (!isRecord(raw)) return { ok: false, error: `services[${index}] must be an object` };

  const id = text(raw.id, 1, 200);
  if (!id || !SERVICE_ID_PATTERN.test(id)) return fail('id');
  const name = text(raw.name, 1, 100);
  if (!name) return fail('name');
  const url = text(raw.url, 1, 2048);
  if (!url || !isHttpUrl(url)) return fail('url');
  const displayUrl = text(raw.displayUrl, 0, 255);
  if (displayUrl === null) return fail('displayUrl');
  const description = text(raw.description, 0, 500);
  if (description === null) return fail('description');
  const icon = text(raw.icon, 1, 64);
  if (!icon || !ICON_PATTERN.test(icon)) return fail('icon');
  if (!isCategory(raw.category)) return fail('category');
  if (typeof raw.isPinned !== 'boolean') return fail('isPinned');

  const service: ServiceItem = {
    id,
    name,
    url,
    displayUrl,
    description,
    icon,
    category: raw.category,
    isPinned: raw.isPinned,
    launchesPerWeek: 0,
    lastAccessed: 'never',
    lastAccessedTimestamp: 0,
    status: 'active',
  };

  if (raw.argoAppName !== undefined) {
    const argoAppName = text(raw.argoAppName, 1, 253);
    if (!argoAppName || !ARGO_APP_PATTERN.test(argoAppName)) return fail('argoAppName');
    service.argoAppName = argoAppName;
  }
  if (raw.discoveredFrom !== undefined) {
    if (!DISCOVERY_SOURCES.includes(raw.discoveredFrom as never)) return fail('discoveredFrom');
    service.discoveredFrom = raw.discoveredFrom as ServiceItem['discoveredFrom'];
  }
  if (raw.custom !== undefined) {
    if (typeof raw.custom !== 'boolean') return fail('custom');
    service.custom = raw.custom;
  }
  // Seed values for counters the server has not recorded yet (first sync)
  if (Number.isSafeInteger(raw.launchesPerWeek) && (raw.launchesPerWeek as number) > 0) {
    service.launchesPerWeek = raw.launchesPerWeek as number;
  }
  if (Number.isSafeInteger(raw.lastAccessedTimestamp) && (raw.lastAccessedTimestamp as number) > 0) {
    service.lastAccessedTimestamp = raw.lastAccessedTimestamp as number;
  }
  return { ok: true, value: service };
}

export function parsePreferences(body: unknown): ParseResult<PreferencesInput> {
  if (!isRecord(body)) return { ok: false, error: 'Expected a JSON object' };

  if (!Array.isArray(body.services) || body.services.length > MAX_SERVICES) {
    return { ok: false, error: `"services" must be an array with at most ${MAX_SERVICES} entries` };
  }
  const services: ServiceItem[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of body.services.entries()) {
    const parsed = parseService(raw, index);
    if (parsed.ok === false) return { ok: false, error: parsed.error };
    if (seen.has(parsed.value.id)) return { ok: false, error: `services[${index}].id is duplicated` };
    seen.add(parsed.value.id);
    services.push(parsed.value);
  }

  const hidden = body.hiddenCategories ?? [];
  if (!Array.isArray(hidden) || !hidden.every(isCategory)) {
    return { ok: false, error: '"hiddenCategories" must list known categories' };
  }
  const defaultTab = body.defaultTab ?? DEFAULT_PREFERENCES.defaultTab;
  if (!TABS.includes(defaultTab as TabFilter)) return { ok: false, error: '"defaultTab" is invalid' };
  const argoEnabled = body.argoEnabled ?? DEFAULT_PREFERENCES.argoEnabled;
  const autoSyncRoutes = body.autoSyncRoutes ?? DEFAULT_PREFERENCES.autoSyncRoutes;
  if (typeof argoEnabled !== 'boolean' || typeof autoSyncRoutes !== 'boolean') {
    return { ok: false, error: '"argoEnabled" and "autoSyncRoutes" must be booleans' };
  }

  return {
    ok: true,
    value: {
      services,
      hiddenCategories: [...new Set(hidden as ServiceCategory[])],
      defaultTab: defaultTab as TabFilter,
      argoEnabled,
      autoSyncRoutes,
    },
  };
}
