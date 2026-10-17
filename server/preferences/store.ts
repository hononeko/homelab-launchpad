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
  /** Saves preferences and seeds launch stats only for services without counters. */
  save(user: string, prefs: StoredPreferences): Promise<void>;
  /** Atomically increments a launch counter; null when the per-user cap is reached. */
  recordLaunch(user: string, serviceId: string, at: number): Promise<LaunchStats | null>;
  launchStats(user: string): Promise<Record<string, LaunchStats>>;
  close(): void;
}

function seedsFor(prefs: StoredPreferences): Array<[string, number, number]> {
  return prefs.services
    .filter((s) => s.launchesPerWeek > 0)
    .map((s) => [s.id, s.launchesPerWeek, s.lastAccessedTimestamp]);
}

/** Non-persistent store for development and tests. */
export class MemoryPreferencesStore implements PreferencesStore {
  readonly kind = 'memory' as const;
  private readonly prefs = new Map<string, StoredPreferences>();
  private readonly stats = new Map<string, Map<string, LaunchStats>>();

  constructor(private readonly maxLaunchCounters = MAX_LAUNCH_COUNTERS) {}

  private statsFor(user: string): Map<string, LaunchStats> {
    let userStats = this.stats.get(user);
    if (!userStats) {
      userStats = new Map();
      this.stats.set(user, userStats);
    }
    return userStats;
  }

  async load(user: string): Promise<StoredPreferences | null> {
    const prefs = this.prefs.get(user);
    return prefs ? structuredClone(prefs) : null;
  }

  async save(user: string, prefs: StoredPreferences): Promise<void> {
    this.prefs.set(user, structuredClone(prefs));
    const userStats = this.statsFor(user);
    for (const [id, count, lastLaunchedAt] of seedsFor(prefs)) {
      if (!userStats.has(id) && userStats.size < this.maxLaunchCounters) {
        userStats.set(id, { count, lastLaunchedAt });
      }
    }
  }

  async recordLaunch(user: string, serviceId: string, at: number): Promise<LaunchStats | null> {
    const userStats = this.statsFor(user);
    const current = userStats.get(serviceId);
    if (!current && userStats.size >= this.maxLaunchCounters) return null;
    const next = { count: (current?.count ?? 0) + 1, lastLaunchedAt: at };
    userStats.set(serviceId, next);
    return next;
  }

  async launchStats(user: string): Promise<Record<string, LaunchStats>> {
    return Object.fromEntries(this.stats.get(user) ?? []);
  }

  close(): void {}
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

// KEYS: prefs, counts hash, last-launch hash. ARGV: prefs JSON, counter cap, then (id, count, last) triples.
const SAVE_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1])
local cap = tonumber(ARGV[2])
for i = 3, #ARGV, 3 do
  if redis.call('HEXISTS', KEYS[2], ARGV[i]) == 0 and redis.call('HLEN', KEYS[2]) < cap then
    redis.call('HSET', KEYS[2], ARGV[i], ARGV[i + 1])
    redis.call('HSET', KEYS[3], ARGV[i], ARGV[i + 2])
  end
end
return 1
`;

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

  private keys(user: string) {
    const id = encodeURIComponent(user);
    return {
      prefs: `launchpad:v1:prefs:${id}`,
      counts: `launchpad:v1:launches:${id}`,
      lastLaunch: `launchpad:v1:last-launch:${id}`,
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
    const seeds = seedsFor(prefs).flatMap(([id, count, last]) => [id, String(count), String(last)]);
    await this.send('EVAL', [
      SAVE_SCRIPT,
      '3',
      keys.prefs,
      keys.counts,
      keys.lastLaunch,
      JSON.stringify(prefs),
      String(this.maxLaunchCounters),
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
