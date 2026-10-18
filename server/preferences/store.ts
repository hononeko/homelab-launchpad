import { RedisClient } from 'bun';
import { LaunchStats } from '../../src/types';
import { PreferencesInput } from './validate';

export interface StoredPreferences extends PreferencesInput {
  updatedAt: string;
}

// Upper bound on distinct launch counters per user
export const MAX_LAUNCH_COUNTERS = 1000;

export interface PreferencesStore {
  readonly kind: 'valkey' | 'memory';
  load(user: string): Promise<StoredPreferences | null>;
  /**
   * Saves preferences, drops counters for services no longer in the catalog,
   * and seeds launch stats only for services without counters.
   */
  save(user: string, prefs: StoredPreferences): Promise<void>;
  /** Atomically increments a launch counter; null when the per-user cap is reached. */
  recordLaunch(user: string, serviceId: string, at: number): Promise<LaunchStats | null>;
  launchStats(user: string): Promise<Record<string, LaunchStats>>;
  /** A server-wide setting (e.g. category mappings), or null when unset. */
  loadSetting(name: string): Promise<unknown>;
  /** Stores a server-wide setting; null removes it. */
  saveSetting(name: string, value: unknown): Promise<void>;
  close(): void;
}

function seedsFor(prefs: StoredPreferences): Array<[string, number, number]> {
  return prefs.services
    .filter((s) => s.launchesPerWeek > 0 || s.lastAccessedTimestamp > 0)
    .map((s) => [s.id, s.launchesPerWeek, s.lastAccessedTimestamp]);
}

/** Non-persistent store for development and tests. */
export class MemoryPreferencesStore implements PreferencesStore {
  readonly kind = 'memory' as const;
  private readonly prefs = new Map<string, StoredPreferences>();
  private readonly stats = new Map<string, Map<string, LaunchStats>>();
  private readonly settings = new Map<string, unknown>();

  constructor(private readonly maxLaunchCounters = MAX_LAUNCH_COUNTERS) {}

  private statsFor(user: string): Map<string, LaunchStats> {
    let userStats = this.stats.get(user);
    if (!userStats) {
      userStats = new Map();
      this.stats.set(user, userStats);
    }
    return userStats;
  }

  load(user: string): Promise<StoredPreferences | null> {
    const prefs = this.prefs.get(user);
    return Promise.resolve(prefs ? structuredClone(prefs) : null);
  }

  save(user: string, prefs: StoredPreferences): Promise<void> {
    this.prefs.set(user, structuredClone(prefs));
    const userStats = this.statsFor(user);
    // Counters for services no longer in the catalog are dropped
    const ids = new Set(prefs.services.map((s) => s.id));
    for (const id of userStats.keys()) {
      if (!ids.has(id)) userStats.delete(id);
    }
    for (const [id, count, lastLaunchedAt] of seedsFor(prefs)) {
      if (!userStats.has(id) && userStats.size < this.maxLaunchCounters) {
        userStats.set(id, { count, lastLaunchedAt });
      }
    }
    return Promise.resolve();
  }

  recordLaunch(user: string, serviceId: string, at: number): Promise<LaunchStats | null> {
    const userStats = this.statsFor(user);
    const current = userStats.get(serviceId);
    if (!current && userStats.size >= this.maxLaunchCounters) return Promise.resolve(null);
    const next = { count: (current?.count ?? 0) + 1, lastLaunchedAt: at };
    userStats.set(serviceId, next);
    return Promise.resolve(next);
  }

  launchStats(user: string): Promise<Record<string, LaunchStats>> {
    return Promise.resolve(Object.fromEntries(this.stats.get(user) ?? []));
  }

  loadSetting(name: string): Promise<unknown> {
    const value = this.settings.get(name);
    return Promise.resolve(value === undefined ? null : structuredClone(value));
  }

  saveSetting(name: string, value: unknown): Promise<void> {
    if (value === null) this.settings.delete(name);
    else this.settings.set(name, structuredClone(value));
    return Promise.resolve();
  }

  close(): void {
    // Nothing to release: data lives in this process only
  }
}

// KEYS: counts hash, last-launch hash. ARGV: service id, timestamp, counter cap.
const RECORD_LAUNCH_SCRIPT = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 and redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then
  return nil
end
local count = redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
return count
`;

// KEYS: prefs, counts hash, last-launch hash.
// ARGV: prefs JSON, counter cap, catalog size N, N service ids, then (id, count, last) seed triples.
const SAVE_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1])
local cap = tonumber(ARGV[2])
local idCount = tonumber(ARGV[3])
local catalog = {}
for i = 4, 3 + idCount do
  catalog[ARGV[i]] = true
end
for _, id in ipairs(redis.call('HKEYS', KEYS[2])) do
  if not catalog[id] then
    redis.call('HDEL', KEYS[2], id)
    redis.call('HDEL', KEYS[3], id)
  end
end
for i = 4 + idCount, #ARGV, 3 do
  if redis.call('HEXISTS', KEYS[2], ARGV[i]) == 0 and redis.call('HLEN', KEYS[2]) < cap then
    redis.call('HSET', KEYS[2], ARGV[i], ARGV[i + 1])
    redis.call('HSET', KEYS[3], ARGV[i], ARGV[i + 2])
  end
end
return 1
`;

function settingKey(name: string): string {
  return `launchpad:v1:settings:${encodeURIComponent(name)}`;
}

/** Valkey-backed store. Keys are namespaced per Authelia username. */
export class ValkeyPreferencesStore implements PreferencesStore {
  readonly kind = 'valkey' as const;
  private readonly client: RedisClient;

  constructor(
    url: string,
    private readonly maxLaunchCounters = MAX_LAUNCH_COUNTERS
  ) {
    // Fail fast instead of queueing or retrying while Valkey is unreachable:
    // with auto-reconnect a request would wait out the whole retry backoff.
    // send() reconnects on demand instead.
    this.client = new RedisClient(url, {
      enableOfflineQueue: false,
      autoReconnect: false,
      connectionTimeout: 2000,
    });
  }

  // The {user} hash tag keeps a user's keys in one slot, so the multi-key
  // scripts also work on clustered Valkey
  private keys(user: string) {
    const id = encodeURIComponent(user);
    return {
      prefs: `launchpad:v1:{${id}}:prefs`,
      counts: `launchpad:v1:{${id}}:launches`,
      lastLaunch: `launchpad:v1:{${id}}:last-launch`,
    };
  }

  private connecting: Promise<void> | null = null;

  // Connects lazily; concurrent commands share one connection attempt
  private async send(command: string, args: string[]): Promise<unknown> {
    if (!this.client.connected) {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = null;
      });
      await this.connecting;
    }
    return this.client.send(command, args);
  }

  async load(user: string): Promise<StoredPreferences | null> {
    const raw = await this.send('GET', [this.keys(user).prefs]);
    return typeof raw === 'string' ? (JSON.parse(raw) as StoredPreferences) : null;
  }

  async save(user: string, prefs: StoredPreferences): Promise<void> {
    const keys = this.keys(user);
    const ids = prefs.services.map((s) => s.id);
    const seeds = seedsFor(prefs).flatMap(([id, count, last]) => [id, String(count), String(last)]);
    await this.send('EVAL', [
      SAVE_SCRIPT,
      '3',
      keys.prefs,
      keys.counts,
      keys.lastLaunch,
      JSON.stringify(prefs),
      String(this.maxLaunchCounters),
      String(ids.length),
      ...ids,
      ...seeds,
    ]);
  }

  async recordLaunch(user: string, serviceId: string, at: number): Promise<LaunchStats | null> {
    const keys = this.keys(user);
    const count = await this.send('EVAL', [
      RECORD_LAUNCH_SCRIPT,
      '2',
      keys.counts,
      keys.lastLaunch,
      serviceId,
      String(at),
      String(this.maxLaunchCounters),
    ]);
    return count === null ? null : { count: Number(count), lastLaunchedAt: at };
  }

  async launchStats(user: string): Promise<Record<string, LaunchStats>> {
    const keys = this.keys(user);
    const [counts, lastLaunch] = (await Promise.all([
      this.send('HGETALL', [keys.counts]),
      this.send('HGETALL', [keys.lastLaunch]),
    ])) as [Record<string, string> | null, Record<string, string> | null];

    const stats: Record<string, LaunchStats> = {};
    for (const [id, count] of Object.entries(counts ?? {})) {
      stats[id] = { count: Number(count), lastLaunchedAt: Number(lastLaunch?.[id] ?? 0) };
    }
    return stats;
  }

  async loadSetting(name: string): Promise<unknown> {
    const raw = await this.send('GET', [settingKey(name)]);
    return typeof raw === 'string' ? JSON.parse(raw) : null;
  }

  async saveSetting(name: string, value: unknown): Promise<void> {
    await (value === null
      ? this.send('DEL', [settingKey(name)])
      : this.send('SET', [settingKey(name), JSON.stringify(value)]));
  }

  close(): void {
    this.client.close();
  }
}

let store: PreferencesStore | null = null;

/** Valkey when VALKEY_URL is set, otherwise an in-memory store. */
export function getPreferencesStore(): PreferencesStore {
  store ??= process.env.VALKEY_URL ? new ValkeyPreferencesStore(process.env.VALKEY_URL) : new MemoryPreferencesStore();
  return store;
}

/** Replaces the active store (tests). */
export function setPreferencesStore(next: PreferencesStore | null): void {
  store?.close();
  store = next;
}
