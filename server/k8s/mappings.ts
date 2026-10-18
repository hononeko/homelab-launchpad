import defaultMappings from '../config/category-mappings.json';
import { ICON_PATTERN, isCategory, isRecord, ParseResult } from '../preferences/validate';
import type { CategoryIcon, CategoryMappings, KeywordRule, RouteOverride } from '../../src/types';

export const MAX_APP_RULES = 200;
export const MAX_KEYWORDS_PER_RULE = 20;
export const MAX_NAMESPACE_RULES = 200;
export const MAX_OVERRIDES = 500;

// Keywords are matched against lowercased route text
const KEYWORD_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;
// Kubernetes namespace names are DNS labels
const NAMESPACE_PATTERN = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/** Category and icon for routes that match no rule. */
export const FALLBACK_CLASSIFICATION: CategoryIcon = { category: 'TOOLS & DEV', icon: 'hub' };

function isIcon(value: unknown): value is string {
  return typeof value === 'string' && ICON_PATTERN.test(value);
}

function parseKeywordRule(raw: unknown, index: number): ParseResult<KeywordRule> {
  const error = `appRules[${index}]`;
  if (!isRecord(raw)) return { ok: false, error: `${error} must be an object` };
  const { keywords, category, icon } = raw;
  if (
    !Array.isArray(keywords) ||
    keywords.length === 0 ||
    keywords.length > MAX_KEYWORDS_PER_RULE ||
    !keywords.every((k) => typeof k === 'string' && KEYWORD_PATTERN.test(k))
  ) {
    return { ok: false, error: `${error}.keywords must list 1-${MAX_KEYWORDS_PER_RULE} lowercase keywords` };
  }
  if (!isCategory(category)) return { ok: false, error: `${error}.category is invalid` };
  if (!isIcon(icon)) return { ok: false, error: `${error}.icon is invalid` };
  return { ok: true, value: { keywords: [...new Set<string>(keywords)], category, icon } };
}

function parseCategoryIcon(raw: unknown, path: string): ParseResult<CategoryIcon> {
  if (!isRecord(raw) || !isCategory(raw.category) || !isIcon(raw.icon)) {
    return { ok: false, error: `${path} needs a valid category and icon` };
  }
  return { ok: true, value: { category: raw.category, icon: raw.icon } };
}

function parseOverride(raw: unknown, path: string): ParseResult<RouteOverride> {
  if (!isRecord(raw)) return { ok: false, error: `${path} must be an object` };
  const override: RouteOverride = {};
  if (raw.name !== undefined) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name.length === 0 || name.length > 100) return { ok: false, error: `${path}.name is invalid` };
    override.name = name;
  }
  if (raw.category !== undefined) {
    if (!isCategory(raw.category)) return { ok: false, error: `${path}.category is invalid` };
    override.category = raw.category;
  }
  if (raw.icon !== undefined) {
    if (!isIcon(raw.icon)) return { ok: false, error: `${path}.icon is invalid` };
    override.icon = raw.icon;
  }
  if (Object.keys(override).length === 0) return { ok: false, error: `${path} sets nothing` };
  return { ok: true, value: override };
}

/** Validates a map whose keys must match `pattern`, parsing each value. */
function parseKeyed<T>(
  raw: unknown,
  field: string,
  pattern: RegExp,
  max: number,
  parse: (value: unknown, path: string) => ParseResult<T>
): ParseResult<Record<string, T>> {
  if (!isRecord(raw) || Object.keys(raw).length > max) {
    return { ok: false, error: `"${field}" must be an object with at most ${max} entries` };
  }
  const entries: Array<[string, T]> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!pattern.test(key)) return { ok: false, error: `"${field}" has an invalid key: ${key.slice(0, 64)}` };
    const parsed = parse(value, `${field}.${key}`);
    if (parsed.ok === false) return parsed;
    entries.push([key, parsed.value]);
  }
  return { ok: true, value: Object.fromEntries(entries) };
}

export function parseRouteOverride(raw: unknown): ParseResult<RouteOverride> {
  return parseOverride(raw, 'override');
}

export function isRouteHost(value: unknown): value is string {
  return typeof value === 'string' && HOST_PATTERN.test(value);
}

/** Validates a full mappings document and returns a clean copy. */
export function parseMappings(body: unknown): ParseResult<CategoryMappings> {
  if (!isRecord(body)) return { ok: false, error: 'Expected a JSON object' };
  if (!Array.isArray(body.appRules) || body.appRules.length > MAX_APP_RULES) {
    return { ok: false, error: `"appRules" must be an array with at most ${MAX_APP_RULES} rules` };
  }
  const appRules: KeywordRule[] = [];
  for (const [index, raw] of body.appRules.entries()) {
    const parsed = parseKeywordRule(raw, index);
    if (parsed.ok === false) return parsed;
    appRules.push(parsed.value);
  }
  const namespaceRules = parseKeyed(body.namespaceRules ?? {}, 'namespaceRules', NAMESPACE_PATTERN, MAX_NAMESPACE_RULES, parseCategoryIcon);
  if (namespaceRules.ok === false) return namespaceRules;
  const overrides = parseKeyed(body.overrides ?? {}, 'overrides', HOST_PATTERN, MAX_OVERRIDES, parseOverride);
  if (overrides.ok === false) return overrides;
  return { ok: true, value: { appRules, namespaceRules: namespaceRules.value, overrides: overrides.value } };
}

function loadDefaults(): CategoryMappings {
  const parsed = parseMappings(defaultMappings);
  // The bundled file is covered by tests, so this only fires on a bad edit
  if (parsed.ok === false) throw new Error(`Invalid server/config/category-mappings.json: ${parsed.error}`);
  return parsed.value;
}

export const DEFAULT_MAPPINGS: CategoryMappings = loadDefaults();

let activeMappings: CategoryMappings = DEFAULT_MAPPINGS;
let customized = false;

export function getMappings(): CategoryMappings {
  return activeMappings;
}

/** Whether the active mappings were changed from the bundled defaults. */
export function isCustomized(): boolean {
  return customized;
}

/** Replaces the active mappings; null restores the defaults. */
export function setMappings(next: CategoryMappings | null): void {
  activeMappings = next ?? DEFAULT_MAPPINGS;
  customized = next !== null;
}

/** Category and icon for a route: the first matching keyword rule, then its namespace. */
export function classify(text: string, namespace: string, mappings = activeMappings): CategoryIcon {
  const lower = text.toLowerCase();
  const matched = mappings.appRules.find((rule) => rule.keywords.some((k) => lower.includes(k)));
  if (matched) return { category: matched.category, icon: matched.icon };
  const byNamespace = Object.hasOwn(mappings.namespaceRules, namespace) ? mappings.namespaceRules[namespace] : undefined;
  return byNamespace ? { ...byNamespace } : { ...FALLBACK_CLASSIFICATION };
}

export function getOverride(host: string, mappings = activeMappings): RouteOverride | undefined {
  return Object.hasOwn(mappings.overrides, host) ? mappings.overrides[host] : undefined;
}
