import { SERVICE_CATEGORIES, ServiceCategory, ServiceItem, TAB_FILTERS, TabFilter, UserPreferences } from '../../src/types';

export const MAX_SERVICES = 300;
export const MAX_HIDDEN_ROUTES = 500;
export const SERVICE_ID_PATTERN = /^[\w.:-]{1,200}$/;
export const ICON_PATTERN = /^[a-z0-9_]{1,64}$/;
const ARGO_APP_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const TABS = new Set<unknown>(TAB_FILTERS);
const CATEGORIES = new Set<unknown>(SERVICE_CATEGORIES);
const DISCOVERY_SOURCES = new Set<unknown>(['httproute', 'ingress', 'manual']);

export type PreferencesInput = Omit<UserPreferences, 'updatedAt'>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const DEFAULT_PREFERENCES: PreferencesInput = {
  services: [],
  hiddenCategories: [],
  hiddenRouteIds: [],
  defaultTab: 'pinned',
  argoEnabled: true,
  autoSyncRoutes: false,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function isCategory(value: unknown): value is ServiceCategory {
  return CATEGORIES.has(value);
}

function matches(value: unknown, min: number, max: number, pattern: RegExp): boolean {
  const str = text(value, min, max);
  return str !== null && pattern.test(str);
}

function isIdentity(value: unknown): boolean {
  return isRecord(value) && text(value.name, 1, 100) !== null && matches(value.icon, 1, 64, ICON_PATTERN);
}

function positiveInt(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0;
}

/** Name of the first invalid field, or null. Order matches the error messages tests expect. */
function invalidServiceField(raw: Record<string, unknown>): string | null {
  const url = text(raw.url, 1, 2048);
  const checks: Array<[string, boolean]> = [
    ['id', matches(raw.id, 1, 200, SERVICE_ID_PATTERN)],
    ['name', text(raw.name, 1, 100) !== null],
    ['url', url !== null && isHttpUrl(url)],
    ['displayUrl', text(raw.displayUrl, 0, 255) !== null],
    ['description', text(raw.description, 0, 500) !== null],
    ['icon', matches(raw.icon, 1, 64, ICON_PATTERN)],
    ['category', isCategory(raw.category)],
    ['isPinned', typeof raw.isPinned === 'boolean'],
    ['argoAppName', raw.argoAppName === undefined || matches(raw.argoAppName, 1, 253, ARGO_APP_PATTERN)],
    ['discoveredFrom', raw.discoveredFrom === undefined || DISCOVERY_SOURCES.has(raw.discoveredFrom)],
    ['custom', raw.custom === undefined || typeof raw.custom === 'boolean'],
    ['hidden', raw.hidden === undefined || typeof raw.hidden === 'boolean'],
    ['original', raw.original === undefined || isIdentity(raw.original)],
  ];
  return checks.find(([, valid]) => !valid)?.[0] ?? null;
}

/**
 * Validates one service and keeps only its persisted fields. Runtime state
 * (probe status, latency) is reset; launch stats are only used to seed
 * counters the server does not have yet (first sync), so invalid ones are ignored.
 */
function parseService(raw: unknown, index: number): ParseResult<ServiceItem> {
  if (!isRecord(raw)) return { ok: false, error: `services[${index}] must be an object` };
  const invalid = invalidServiceField(raw);
  if (invalid) return { ok: false, error: `services[${index}].${invalid} is invalid` };

  const service: ServiceItem = {
    id: raw.id as string,
    name: raw.name as string,
    url: raw.url as string,
    displayUrl: raw.displayUrl as string,
    description: raw.description as string,
    icon: raw.icon as string,
    category: raw.category as ServiceCategory,
    isPinned: raw.isPinned as boolean,
    launchesPerWeek: positiveInt(raw.launchesPerWeek),
    lastAccessed: 'never',
    lastAccessedTimestamp: positiveInt(raw.lastAccessedTimestamp),
    status: 'active',
  };
  if (raw.argoAppName !== undefined) service.argoAppName = raw.argoAppName as string;
  if (raw.discoveredFrom !== undefined) service.discoveredFrom = raw.discoveredFrom as ServiceItem['discoveredFrom'];
  if (raw.custom !== undefined) service.custom = raw.custom as boolean;
  if (raw.hidden === true) service.hidden = true;
  if (raw.original !== undefined) {
    const original = raw.original as Record<string, unknown>;
    service.original = { name: original.name as string, icon: original.icon as string };
  }
  return { ok: true, value: service };
}

function parseServices(raw: unknown): ParseResult<ServiceItem[]> {
  if (!Array.isArray(raw) || raw.length > MAX_SERVICES) {
    return { ok: false, error: `"services" must be an array with at most ${MAX_SERVICES} entries` };
  }
  const services: ServiceItem[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const parsed = parseService(item, index);
    if (parsed.ok === false) return { ok: false, error: parsed.error };
    if (seen.has(parsed.value.id)) return { ok: false, error: `services[${index}].id is duplicated` };
    seen.add(parsed.value.id);
    services.push(parsed.value);
  }
  return { ok: true, value: services };
}

type Settings = Omit<PreferencesInput, 'services'>;

function parseSettings(body: Record<string, unknown>): ParseResult<Settings> {
  const hidden = body.hiddenCategories ?? [];
  if (!Array.isArray(hidden) || !hidden.every(isCategory)) {
    return { ok: false, error: '"hiddenCategories" must list known categories' };
  }
  const hiddenRouteIds = body.hiddenRouteIds ?? [];
  if (
    !Array.isArray(hiddenRouteIds) ||
    hiddenRouteIds.length > MAX_HIDDEN_ROUTES ||
    !hiddenRouteIds.every((id) => matches(id, 1, 200, SERVICE_ID_PATTERN))
  ) {
    return { ok: false, error: `"hiddenRouteIds" must list at most ${MAX_HIDDEN_ROUTES} route ids` };
  }
  const defaultTab = body.defaultTab ?? DEFAULT_PREFERENCES.defaultTab;
  if (!TABS.has(defaultTab)) return { ok: false, error: '"defaultTab" is invalid' };
  const argoEnabled = body.argoEnabled ?? DEFAULT_PREFERENCES.argoEnabled;
  const autoSyncRoutes = body.autoSyncRoutes ?? DEFAULT_PREFERENCES.autoSyncRoutes;
  if (typeof argoEnabled !== 'boolean' || typeof autoSyncRoutes !== 'boolean') {
    return { ok: false, error: '"argoEnabled" and "autoSyncRoutes" must be booleans' };
  }
  return {
    ok: true,
    value: {
      hiddenCategories: [...new Set(hidden)],
      hiddenRouteIds: [...new Set<string>(hiddenRouteIds)],
      defaultTab: defaultTab as TabFilter,
      argoEnabled,
      autoSyncRoutes,
    },
  };
}

export function parsePreferences(body: unknown): ParseResult<PreferencesInput> {
  if (!isRecord(body)) return { ok: false, error: 'Expected a JSON object' };
  const services = parseServices(body.services);
  if (services.ok === false) return services;
  const settings = parseSettings(body);
  if (settings.ok === false) return settings;
  return { ok: true, value: { services: services.value, ...settings.value } };
}
