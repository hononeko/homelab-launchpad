import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { ProbeStatus, ProbeTimings, ServiceHealth } from '../../src/types';
import { getCachedRoutes } from '../k8s/discovery';

export interface ProbeConfig {
  intervalMs: number;
  timeoutMs: number;
  concurrency: number;
  allowedDomains: string[];
  insecureTls: boolean;
}

export const MAX_TARGETS = 200;
// Targets not re-registered by any client within this window are dropped
const TARGET_TTL_MS = 30 * 60 * 1000;
// Minimum spacing between on-demand probe rounds
const ON_DEMAND_MIN_SPACING_MS = 5000;
const USER_AGENT = 'HomelabLaunchpad-HealthProbe/1.0';

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getProbeConfig(): ProbeConfig {
  return {
    intervalMs: readPositiveInt('HEALTH_PROBE_INTERVAL_MS', 30000),
    timeoutMs: readPositiveInt('HEALTH_PROBE_TIMEOUT_MS', 3000),
    concurrency: readPositiveInt('HEALTH_PROBE_CONCURRENCY', 8),
    allowedDomains: (process.env.HEALTH_PROBE_ALLOWED_DOMAINS ?? 'kerrlab.app')
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^\*?\./, ''))
      .filter(Boolean),
    insecureTls: process.env.HEALTH_PROBE_INSECURE_TLS === 'true',
  };
}

/**
 * Validates a probe target URL. Only http(s) URLs without embedded credentials,
 * whose host is on the allowlist or belongs to a discovered cluster route, may be
 * probed, so the endpoint cannot be used as a generic SSRF / port-scan oracle.
 */
export function parseProbeTarget(rawUrl: unknown, allowedDomains: string[]): URL | null {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  return isAllowedProbeTarget(parsed, allowedDomains) ? parsed : null;
}

export function isAllowedProbeTarget(url: URL, allowedDomains: string[]): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (allowedDomains.includes('*')) return true;
  if (allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  return getCachedRoutes().some((r) => r.host.toLowerCase() === host);
}

export function classifyHttpStatus(code: number): ProbeStatus {
  // Any response below 500 proves the service is reachable. 3xx covers Authelia
  // redirects to the login portal; 401/403 cover forward-auth denials.
  return code >= 500 ? 'degraded' : 'active';
}

interface RawProbe {
  httpStatus: number;
  timings: ProbeTimings;
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function sanitizeError(err: unknown): string {
  let message = 'unknown error';
  if (err instanceof Error) {
    message = (err as NodeJS.ErrnoException).code || err.message;
  } else if (typeof err === 'string') {
    message = err;
  }
  return message.replace(/[\r\n]/g, '').slice(0, 120);
}

function requestOnce(url: URL, method: 'HEAD' | 'GET', config: ProbeConfig): Promise<RawProbe> {
  return new Promise((resolve, reject) => {
    // Re-check at request time: the allowlist or discovered routes may have
    // changed since the target was registered.
    if (!isAllowedProbeTarget(url, config.allowedDomains)) {
      reject(Object.assign(new Error('target not allowed'), { code: 'EPROBENOTALLOWED' }));
      return;
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const start = performance.now();
    let lookupAt: number | null = null;
    let connectAt: number | null = null;
    let secureAt: number | null = null;
    let settled = false;

    const req = transport.request(
      url,
      {
        method,
        // Fresh connection per probe so DNS/TCP/TLS phases are measured every time
        agent: false,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        ...(isHttps ? { rejectUnauthorized: !config.insecureTls } : {}),
      },
      (res) => {
        const responseAt = performance.now();
        settled = true;
        clearTimeout(timer);
        // Headers are all we need; never download response bodies
        res.destroy();
        req.destroy();

        const connectBase = lookupAt ?? start;
        const ttfbBase = secureAt ?? connectAt ?? start;
        resolve({
          httpStatus: res.statusCode ?? 0,
          timings: {
            dnsMs: lookupAt === null ? null : roundMs(lookupAt - start),
            connectMs: connectAt === null ? null : roundMs(connectAt - connectBase),
            tlsMs: secureAt === null || connectAt === null ? null : roundMs(secureAt - connectAt),
            ttfbMs: roundMs(responseAt - ttfbBase),
            totalMs: roundMs(responseAt - start),
          },
        });
      }
    );

    const timer = setTimeout(() => {
      const err = new Error('timeout') as NodeJS.ErrnoException;
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    }, config.timeoutMs);

    req.on('socket', (socket) => {
      socket.once('lookup', () => {
        lookupAt = performance.now();
      });
      socket.once('connect', () => {
        connectAt = performance.now();
      });
      socket.once('secureConnect', () => {
        secureAt = performance.now();
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

export async function probeUrl(url: URL, config: ProbeConfig = getProbeConfig()): Promise<ServiceHealth> {
  const checkedAt = new Date().toISOString();
  try {
    let raw = await requestOnce(url, 'HEAD', config);
    // Some servers reject HEAD; retry with GET (body is never read)
    if (raw.httpStatus === 405 || raw.httpStatus === 501) {
      raw = await requestOnce(url, 'GET', config);
    }
    return {
      url: url.href,
      status: classifyHttpStatus(raw.httpStatus),
      httpStatus: raw.httpStatus,
      latencyMs: Math.round(raw.timings.totalMs),
      timings: raw.timings,
      error: null,
      checkedAt,
    };
  } catch (err) {
    return {
      url: url.href,
      status: 'offline',
      httpStatus: null,
      latencyMs: null,
      timings: null,
      error: sanitizeError(err),
      checkedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Probe scheduler: registered targets, cached results, and periodic rounds
// ---------------------------------------------------------------------------

interface ProbeTarget {
  url: URL;
  lastRegisteredAt: number;
}

// Keyed by the exact URL string the client registered, so clients can look up
// results by their own `service.url` without re-normalizing.
const targets = new Map<string, ProbeTarget>();
const results = new Map<string, ServiceHealth>();
let lastProbedAt: string | null = null;
let lastRoundStartedMs = 0;
let roundInFlight: Promise<void> | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let onRoundComplete: ((snapshot: HealthSnapshot) => void) | null = null;

export interface HealthSnapshot {
  results: Record<string, ServiceHealth>;
  lastProbedAt: string | null;
  intervalMs: number;
  targetCount: number;
}

export function getHealthSnapshot(): HealthSnapshot {
  return {
    results: Object.fromEntries(results),
    lastProbedAt,
    intervalMs: getProbeConfig().intervalMs,
    targetCount: targets.size,
  };
}

export interface RegisterResult {
  accepted: string[];
  rejected: string[];
}

export function registerTargets(rawUrls: unknown[]): RegisterResult {
  const { allowedDomains } = getProbeConfig();
  const now = Date.now();
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const raw of rawUrls) {
    const parsed = parseProbeTarget(raw, allowedDomains);
    if (!parsed) {
      if (typeof raw === 'string') rejected.push(raw.slice(0, 256));
      continue;
    }
    const key = raw as string;
    const existing = targets.get(key);
    if (existing) {
      existing.lastRegisteredAt = now;
    } else if (targets.size < MAX_TARGETS) {
      targets.set(key, { url: parsed, lastRegisteredAt: now });
    } else {
      rejected.push(key.slice(0, 256));
      continue;
    }
    accepted.push(key);
  }

  return { accepted, rejected };
}

function pruneExpiredTargets(now: number) {
  for (const [key, target] of targets) {
    if (now - target.lastRegisteredAt > TARGET_TTL_MS) {
      targets.delete(key);
      results.delete(key);
    }
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  // Each runner takes the next item when its previous one settles
  const next = (): Promise<void> => {
    if (index >= items.length) return Promise.resolve();
    const item = items[index++];
    return worker(item).then(next);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

async function executeRound(keys?: string[]): Promise<void> {
  const config = getProbeConfig();
  const now = Date.now();
  pruneExpiredTargets(now);
  lastRoundStartedMs = now;

  const selected = (keys ?? [...targets.keys()]).filter((k) => targets.has(k));
  await runPool(selected, config.concurrency, async (key) => {
    const target = targets.get(key);
    if (!target) return;
    const health = await probeUrl(target.url, config);
    // Target may have been pruned while the probe was in flight
    if (targets.has(key)) {
      results.set(key, { ...health, url: key });
    }
  });

  lastProbedAt = new Date().toISOString();
  onRoundComplete?.(getHealthSnapshot());
}

/**
 * Runs a probe round. Concurrent callers share the in-flight round. When `keys`
 * is given, only those targets are probed (used for newly registered targets).
 */
export function runProbeRound(keys?: string[]): Promise<void> {
  if (roundInFlight !== null) {
    // A targeted request may include keys the in-flight round did not select
    return keys ? roundInFlight.then(() => runProbeRound(keys)) : roundInFlight;
  }
  roundInFlight = executeRound(keys).finally(() => {
    roundInFlight = null;
  });
  return roundInFlight;
}

/** On-demand probe of all targets, throttled to avoid hammering services. */
export async function requestProbeRound(): Promise<{ throttled: boolean }> {
  if (roundInFlight === null && Date.now() - lastRoundStartedMs < ON_DEMAND_MIN_SPACING_MS) {
    return { throttled: true };
  }
  await runProbeRound();
  return { throttled: false };
}

export function startHealthProbeScheduler(onComplete: (snapshot: HealthSnapshot) => void): void {
  if (schedulerTimer) return;
  onRoundComplete = onComplete;
  const { intervalMs } = getProbeConfig();
  schedulerTimer = setInterval(() => {
    if (targets.size > 0) {
      void runProbeRound();
    }
  }, intervalMs);
}

export function stopHealthProbeScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  onRoundComplete = null;
}

/** Test-only: reset module state. */
export function resetHealthProbeState(): void {
  stopHealthProbeScheduler();
  targets.clear();
  results.clear();
  lastProbedAt = null;
  lastRoundStartedMs = 0;
  roundInFlight = null;
}
