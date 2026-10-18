import { describe, expect, test } from 'bun:test';
import { DEFAULT_PREFERENCES, MAX_HIDDEN_ROUTES, MAX_SERVICES, parsePreferences } from './validate';

const validService = {
  id: 'imported-route-media-jellyfin',
  name: 'Jellyfin',
  url: 'https://jellyfin.example.com',
  displayUrl: 'jellyfin.example.com',
  description: 'Media server',
  icon: 'tv',
  category: 'MEDIA',
  isPinned: true,
  launchesPerWeek: 4,
  lastAccessed: '2h ago',
  lastAccessedTimestamp: 1700000000000,
  status: 'offline',
  latencyMs: 12,
  argoAppName: 'jellyfin',
  discoveredFrom: 'httproute',
};

describe('parsePreferences', () => {
  test('accepts a full payload and keeps only persisted service fields', () => {
    const result = parsePreferences({
      services: [validService],
      hiddenCategories: ['CLUSTER & OPS', 'CLUSTER & OPS'],
      defaultTab: 'frequent',
      argoEnabled: false,
      autoSyncRoutes: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;

    expect(result.value.hiddenCategories).toEqual(['CLUSTER & OPS']);
    expect(result.value.defaultTab).toBe('frequent');
    const [service] = result.value.services;
    expect(service).toMatchObject({ id: validService.id, isPinned: true, argoAppName: 'jellyfin', discoveredFrom: 'httproute' });
    // Runtime state is reset; launch stats are kept only as seeds
    expect(service.status).toBe('active');
    expect('latencyMs' in service).toBe(false);
    expect(service.launchesPerWeek).toBe(4);
    expect(service.lastAccessedTimestamp).toBe(1700000000000);
  });

  test('applies defaults for omitted settings', () => {
    const result = parsePreferences({ services: [] });
    expect(result).toEqual({ ok: true, value: DEFAULT_PREFERENCES });
  });

  test.each([
    ['a non-object body', [], 'Expected a JSON object'],
    ['missing services', {}, '"services" must be an array'],
    ['too many services', { services: Array.from({ length: MAX_SERVICES + 1 }, () => validService) }, 'at most'],
    ['a javascript: URL', { services: [{ ...validService, url: 'javascript:alert(1)' }] }, 'services[0].url'],
    ['an invalid id', { services: [{ ...validService, id: 'bad id!' }] }, 'services[0].id'],
    ['an unknown category', { services: [{ ...validService, category: 'GAMES' }] }, 'services[0].category'],
    ['an invalid icon', { services: [{ ...validService, icon: '<svg>' }] }, 'services[0].icon'],
    ['an overlong name', { services: [{ ...validService, name: 'x'.repeat(101) }] }, 'services[0].name'],
    ['a non-boolean pin', { services: [{ ...validService, isPinned: 'yes' }] }, 'services[0].isPinned'],
    ['an invalid ArgoCD app name', { services: [{ ...validService, argoAppName: 'Bad_App' }] }, 'services[0].argoAppName'],
    ['an unknown discovery source', { services: [{ ...validService, discoveredFrom: 'dns' }] }, 'services[0].discoveredFrom'],
    ['a non-boolean custom flag', { services: [{ ...validService, custom: 1 }] }, 'services[0].custom'],
    ['duplicate ids', { services: [validService, validService] }, 'services[1].id is duplicated'],
    ['a non-object service', { services: ['jellyfin'] }, 'services[0] must be an object'],
    ['unknown hidden categories', { services: [], hiddenCategories: ['GAMES'] }, '"hiddenCategories"'],
    ['an unknown default tab', { services: [], defaultTab: 'recent' }, '"defaultTab"'],
    ['non-boolean toggles', { services: [], argoEnabled: 'no' }, 'must be booleans'],
    ['a non-boolean hidden flag', { services: [{ ...validService, hidden: 'yes' }] }, 'services[0].hidden'],
    ['an original identity without a name', { services: [{ ...validService, original: { icon: 'tv' } }] }, 'services[0].original'],
    ['an original identity with an invalid icon', { services: [{ ...validService, original: { name: 'Jellyfin', icon: '<svg>' } }] }, 'services[0].original'],
    ['hidden route ids that are not a list', { services: [], hiddenRouteIds: 'route-a' }, '"hiddenRouteIds"'],
    ['an invalid hidden route id', { services: [], hiddenRouteIds: ['bad id!'] }, '"hiddenRouteIds"'],
    [
      'too many hidden routes',
      { services: [], hiddenRouteIds: Array.from({ length: MAX_HIDDEN_ROUTES + 1 }, (_, i) => `route-${i}`) },
      '"hiddenRouteIds"',
    ],
  ])('rejects %s', (_label, body, error) => {
    const result = parsePreferences(body);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toContain(error);
  });

  test('keeps hidden services and de-duplicates hidden route ids', () => {
    const result = parsePreferences({
      services: [{ ...validService, hidden: true }, { ...validService, id: 'custom-a', hidden: false }],
      hiddenRouteIds: ['route-apps-a', 'route-apps-a', 'route-apps-b'],
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.value.services[0].hidden).toBe(true);
    // Only `true` is stored, so visible services look the same whether or not they were ever hidden
    expect('hidden' in result.value.services[1]).toBe(false);
    expect(result.value.hiddenRouteIds).toEqual(['route-apps-a', 'route-apps-b']);
  });

  test('keeps the original identity of an edited service and drops extra fields', () => {
    const result = parsePreferences({
      services: [{ ...validService, name: 'Movies', icon: 'movie', original: { name: 'Jellyfin', icon: 'tv', extra: 1 } }],
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.value.services[0]).toMatchObject({ name: 'Movies', icon: 'movie' });
    expect(result.value.services[0].original).toEqual({ name: 'Jellyfin', icon: 'tv' });
  });

  test('ignores invalid launch seeds instead of rejecting the payload', () => {
    const result = parsePreferences({ services: [{ ...validService, launchesPerWeek: -3, lastAccessedTimestamp: 'x' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.services[0]).toMatchObject({ launchesPerWeek: 0, lastAccessedTimestamp: 0 });
  });
});
