import { afterEach, describe, expect, test } from 'bun:test';
import {
  classify,
  DEFAULT_MAPPINGS,
  FALLBACK_CLASSIFICATION,
  getMappings,
  getOverride,
  isCustomized,
  MAX_APP_RULES,
  MAX_KEYWORDS_PER_RULE,
  parseMappings,
  parseRouteOverride,
  setMappings,
} from './mappings';
import type { CategoryMappings } from '../../src/types';

const mappings: CategoryMappings = {
  appRules: [
    { keywords: ['grafana'], category: 'CLUSTER & OPS', icon: 'monitoring' },
    { keywords: ['graf', 'photos'], category: 'MEDIA', icon: 'photo_library' },
  ],
  namespaceRules: { media: { category: 'MEDIA', icon: 'movie' } },
  overrides: { 'app.example.com': { name: 'App', icon: 'apps' } },
};

afterEach(() => setMappings(null));

describe('default mappings', () => {
  test('the bundled file is valid and active until changed', () => {
    expect(DEFAULT_MAPPINGS.appRules.length).toBeGreaterThan(30);
    expect(DEFAULT_MAPPINGS.namespaceRules.media).toEqual({ category: 'MEDIA', icon: 'movie' });
    expect(DEFAULT_MAPPINGS.overrides).toEqual({});
    expect(getMappings()).toBe(DEFAULT_MAPPINGS);
    expect(isCustomized()).toBe(false);
  });

  test('setMappings swaps the active rules and null restores the defaults', () => {
    setMappings(mappings);
    expect(getMappings()).toBe(mappings);
    expect(isCustomized()).toBe(true);
    setMappings(null);
    expect(getMappings()).toBe(DEFAULT_MAPPINGS);
    expect(isCustomized()).toBe(false);
  });
});

describe('classify', () => {
  test('the first matching keyword rule wins', () => {
    expect(classify('Grafana observability', 'observability', mappings)).toEqual({
      category: 'CLUSTER & OPS',
      icon: 'monitoring',
    });
    expect(classify('photos media', 'media', mappings)).toEqual({ category: 'MEDIA', icon: 'photo_library' });
  });

  test('falls back to the namespace, then to a generic default', () => {
    expect(classify('portal', 'media', mappings)).toEqual({ category: 'MEDIA', icon: 'movie' });
    expect(classify('portal', 'other', mappings)).toEqual(FALLBACK_CLASSIFICATION);
  });

  test('inherited object keys are not namespace rules', () => {
    expect(classify('portal', 'constructor', mappings)).toEqual(FALLBACK_CLASSIFICATION);
    expect(getOverride('constructor', mappings)).toBeUndefined();
  });

  test('looks up host overrides', () => {
    expect(getOverride('app.example.com', mappings)).toEqual({ name: 'App', icon: 'apps' });
    expect(getOverride('other.example.com', mappings)).toBeUndefined();
  });
});

describe('parseMappings', () => {
  test('returns a clean copy, de-duplicating keywords and trimming names', () => {
    const result = parseMappings({
      appRules: [{ keywords: ['plex', 'plex'], category: 'MEDIA', icon: 'tv', extra: true }],
      overrides: { 'app.example.com': { name: '  App  ', extra: 1 } },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        appRules: [{ keywords: ['plex'], category: 'MEDIA', icon: 'tv' }],
        namespaceRules: {},
        overrides: { 'app.example.com': { name: 'App' } },
      },
    });
  });

  const rule = { keywords: ['plex'], category: 'MEDIA', icon: 'tv' };
  test.each([
    ['a non-object', 'rules', 'Expected a JSON object'],
    ['missing rules', {}, '"appRules"'],
    ['too many rules', { appRules: Array.from({ length: MAX_APP_RULES + 1 }, () => rule) }, '"appRules"'],
    ['a rule without keywords', { appRules: [{ ...rule, keywords: [] }] }, 'appRules[0].keywords'],
    [
      'too many keywords',
      { appRules: [{ ...rule, keywords: Array.from({ length: MAX_KEYWORDS_PER_RULE + 1 }, (_, i) => `k${i}`) }] },
      'appRules[0].keywords',
    ],
    ['an uppercase keyword', { appRules: [{ ...rule, keywords: ['Plex'] }] }, 'appRules[0].keywords'],
    ['an unknown category', { appRules: [{ ...rule, category: 'GAMES' }] }, 'appRules[0].category'],
    ['an invalid icon', { appRules: [{ ...rule, icon: '<svg>' }] }, 'appRules[0].icon'],
    ['a non-object rule', { appRules: ['plex'] }, 'appRules[0] must be an object'],
    ['an invalid namespace', { appRules: [], namespaceRules: { 'Bad NS': { category: 'MEDIA', icon: 'tv' } } }, '"namespaceRules" has an invalid key'],
    ['a namespace rule without an icon', { appRules: [], namespaceRules: { media: { category: 'MEDIA' } } }, 'namespaceRules.media'],
    ['an invalid host', { appRules: [], overrides: { 'https://app': { name: 'App' } } }, '"overrides" has an invalid key'],
    ['an empty override', { appRules: [], overrides: { 'app.example.com': {} } }, 'overrides.app.example.com sets nothing'],
    ['a blank override name', { appRules: [], overrides: { 'app.example.com': { name: '  ' } } }, 'overrides.app.example.com.name'],
    ['an override with an unknown category', { appRules: [], overrides: { 'app.example.com': { category: 'GAMES' } } }, '.category'],
    ['an override with an invalid icon', { appRules: [], overrides: { 'app.example.com': { icon: 'Bad Icon' } } }, '.icon'],
    ['overrides that are not an object', { appRules: [], overrides: [] }, '"overrides"'],
  ])('rejects %s', (_label, body, error) => {
    const result = parseMappings(body);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toContain(error);
  });

  test('parseRouteOverride validates a single override', () => {
    expect(parseRouteOverride({ category: 'MEDIA' })).toEqual({ ok: true, value: { category: 'MEDIA' } });
    expect(parseRouteOverride('App').ok).toBe(false);
  });
});
