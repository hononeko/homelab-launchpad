import { describe, expect, test } from 'bun:test';
import { DEFAULT_PREFERENCES, MAX_SERVICES, parsePreferences } from './validate';

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
  ])('rejects %s', (_label, body, error) => {
    const result = parsePreferences(body);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toContain(error);
  });

  test('ignores invalid launch seeds instead of rejecting the payload', () => {
    const result = parsePreferences({ services: [{ ...validService, launchesPerWeek: -3, lastAccessedTimestamp: 'x' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.services[0]).toMatchObject({ launchesPerWeek: 0, lastAccessedTimestamp: 0 });
  });
});
