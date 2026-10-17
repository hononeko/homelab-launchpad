import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MemoryPreferencesStore, PreferencesStore, StoredPreferences, ValkeyPreferencesStore } from './store';
import { DEFAULT_PREFERENCES } from './validate';
import { ServiceItem } from '../../src/types';

const VALKEY_TEST_URL = process.env.VALKEY_TEST_URL;

function service(id: string, overrides: Partial<ServiceItem> = {}): ServiceItem {
  return {
    id,
    name: id,
    url: `https://${id}.example.com`,
    displayUrl: `${id}.example.com`,
    description: '',
    icon: 'hub',
    category: 'MEDIA',
    isPinned: false,
    launchesPerWeek: 0,
    lastAccessed: 'never',
    lastAccessedTimestamp: 0,
    status: 'active',
    ...overrides,
  };
}

function prefs(services: ServiceItem[]): StoredPreferences {
  return { ...DEFAULT_PREFERENCES, services, updatedAt: '2026-01-01T00:00:00.000Z' };
}

const stores: PreferencesStore[] = [];
afterAll(() => {
  for (const store of stores) store.close();
});

// The same contract runs against every implementation; Valkey only when a test server is configured
const implementations: Array<[string, (cap?: number) => PreferencesStore, boolean]> = [
  ['memory', (cap) => new MemoryPreferencesStore(cap), false],
  ['valkey', (cap) => new ValkeyPreferencesStore(VALKEY_TEST_URL ?? '', cap), !VALKEY_TEST_URL],
];

describe.each(implementations)('%s store', (_name, create, skip) => {
  const make = (cap?: number) => {
    const store = create(cap);
    stores.push(store);
    return store;
  };
  // Unique users keep runs against a shared Valkey independent
  const user = () => `test-${randomUUID()}`;

  test.skipIf(skip)('returns null before anything is saved', async () => {
    const store = make();
    expect(await store.load(user())).toBeNull();
    expect(await store.launchStats(user())).toEqual({});
  });

  test.skipIf(skip)('round-trips preferences per user', async () => {
    const store = make();
    const [alice, bob] = [user(), user()];
    const saved = { ...prefs([service('a', { isPinned: true })]), hiddenCategories: ['MEDIA' as const] };
    await store.save(alice, saved);

    expect(await store.load(alice)).toEqual(saved);
    expect(await store.load(bob)).toBeNull();
  });

  test.skipIf(skip)('counts launches and records the last launch time', async () => {
    const store = make();
    const alice = user();
    expect(await store.recordLaunch(alice, 'a', 1000)).toEqual({ count: 1, lastLaunchedAt: 1000 });
    expect(await store.recordLaunch(alice, 'a', 2000)).toEqual({ count: 2, lastLaunchedAt: 2000 });
    await store.recordLaunch(alice, 'b', 3000);

    expect(await store.launchStats(alice)).toEqual({
      a: { count: 2, lastLaunchedAt: 2000 },
      b: { count: 1, lastLaunchedAt: 3000 },
    });
    expect(await store.launchStats(user())).toEqual({});
  });

  test.skipIf(skip)('concurrent launches are not lost', async () => {
    const store = make();
    const alice = user();
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.recordLaunch(alice, 'a', i + 1)));
    expect((await store.launchStats(alice)).a.count).toBe(25);
  });

  test.skipIf(skip)('saving seeds missing counters without overwriting existing ones', async () => {
    const store = make();
    const alice = user();
    await store.recordLaunch(alice, 'a', 5000);
    await store.save(
      alice,
      prefs([
        service('a', { launchesPerWeek: 40, lastAccessedTimestamp: 100 }),
        service('b', { launchesPerWeek: 7, lastAccessedTimestamp: 200 }),
        service('c'),
      ])
    );

    expect(await store.launchStats(alice)).toEqual({
      a: { count: 1, lastLaunchedAt: 5000 },
      b: { count: 7, lastLaunchedAt: 200 },
    });
  });

  test.skipIf(skip)('caps the number of distinct counters per user', async () => {
    const store = make(2);
    const alice = user();
    await store.recordLaunch(alice, 'a', 1);
    await store.recordLaunch(alice, 'b', 1);
    expect(await store.recordLaunch(alice, 'c', 1)).toBeNull();
    // Existing counters still increment at the cap
    expect((await store.recordLaunch(alice, 'a', 2))?.count).toBe(2);

    await store.save(alice, prefs([service('a'), service('b'), service('d', { launchesPerWeek: 3 })]));
    expect(Object.keys(await store.launchStats(alice)).sort()).toEqual(['a', 'b']);
  });

  test.skipIf(skip)('saving drops counters for services removed from the catalog', async () => {
    const store = make();
    const alice = user();
    await store.recordLaunch(alice, 'kept', 1);
    await store.recordLaunch(alice, 'removed', 2);
    await store.save(alice, prefs([service('kept')]));

    expect(await store.launchStats(alice)).toEqual({ kept: { count: 1, lastLaunchedAt: 1 } });
  });

  test.skipIf(skip)('seeds a last-launch time even without a launch count', async () => {
    const store = make();
    const alice = user();
    await store.save(alice, prefs([service('a', { lastAccessedTimestamp: 1234 })]));
    expect(await store.launchStats(alice)).toEqual({ a: { count: 0, lastLaunchedAt: 1234 } });
  });
});

describe('valkey store failures', () => {
  test('rejects quickly when Valkey is unreachable', async () => {
    const store = new ValkeyPreferencesStore('redis://127.0.0.1:1');
    stores.push(store);
    const started = Date.now();
    await expect(store.load('anyone')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
