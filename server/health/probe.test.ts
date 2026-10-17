import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  classifyHttpStatus,
  getHealthSnapshot,
  parseProbeTarget,
  probeUrl,
  ProbeConfig,
  registerTargets,
  resetHealthProbeState,
  runProbeRound,
} from './probe';

const config: ProbeConfig = {
  intervalMs: 30000,
  timeoutMs: 500,
  concurrency: 4,
  allowedDomains: ['127.0.0.1'],
  insecureTls: false,
};

let server: http.Server;
let baseUrl: string;
const seenMethods: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seenMethods.push(`${req.method} ${req.url}`);
    switch (req.url) {
      case '/ok':
        res.writeHead(200).end('ok');
        break;
      case '/auth':
        res.writeHead(302, { Location: 'https://auth.kerrlab.app/' }).end();
        break;
      case '/forbidden':
        res.writeHead(403).end();
        break;
      case '/broken':
        res.writeHead(503).end();
        break;
      case '/no-head':
        res.writeHead(req.method === 'HEAD' ? 405 : 200).end();
        break;
      case '/hang':
        // Never respond; the probe must time out
        break;
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

afterEach(() => {
  resetHealthProbeState();
  delete process.env.HEALTH_PROBE_ALLOWED_DOMAINS;
  seenMethods.length = 0;
});

describe('classifyHttpStatus', () => {
  test.each([200, 204, 301, 302, 401, 403, 404])('%d is reachable', (code) => {
    expect(classifyHttpStatus(code)).toBe('active');
  });

  test.each([500, 502, 503, 504])('%d is degraded', (code) => {
    expect(classifyHttpStatus(code)).toBe('degraded');
  });
});

describe('parseProbeTarget', () => {
  const domains = ['kerrlab.app'];

  test('accepts the apex and subdomains of allowed domains', () => {
    expect(parseProbeTarget('https://kerrlab.app', domains)?.hostname).toBe('kerrlab.app');
    expect(parseProbeTarget('https://plex.kerrlab.app/web', domains)?.hostname).toBe('plex.kerrlab.app');
  });

  test('rejects lookalike and foreign hosts', () => {
    expect(parseProbeTarget('https://evilkerrlab.app', domains)).toBeNull();
    expect(parseProbeTarget('https://kerrlab.app.evil.com', domains)).toBeNull();
    expect(parseProbeTarget('http://169.254.169.254/latest/meta-data', domains)).toBeNull();
  });

  test('rejects non-http schemes, credentials, and malformed input', () => {
    expect(parseProbeTarget('ftp://files.kerrlab.app', domains)).toBeNull();
    expect(parseProbeTarget('https://user:pass@plex.kerrlab.app', domains)).toBeNull();
    expect(parseProbeTarget('not a url', domains)).toBeNull();
    expect(parseProbeTarget(42, domains)).toBeNull();
  });

  test('wildcard allows any http(s) host', () => {
    expect(parseProbeTarget('http://10.0.0.5:8080', ['*'])).not.toBeNull();
    expect(parseProbeTarget('file:///etc/passwd', ['*'])).toBeNull();
  });
});

describe('probeUrl', () => {
  test('marks 2xx responses active with timing breakdown', async () => {
    const result = await probeUrl(new URL(`${baseUrl}/ok`), config);
    expect(result.status).toBe('active');
    expect(result.httpStatus).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.timings?.totalMs).toBeGreaterThanOrEqual(result.timings?.ttfbMs ?? 0);
    expect(result.timings?.tlsMs).toBeNull();
    expect(seenMethods).toEqual(['HEAD /ok']);
  });

  test('treats auth redirects and 403 as reachable', async () => {
    expect((await probeUrl(new URL(`${baseUrl}/auth`), config)).status).toBe('active');
    expect((await probeUrl(new URL(`${baseUrl}/forbidden`), config)).status).toBe('active');
  });

  test('marks 5xx responses degraded', async () => {
    const result = await probeUrl(new URL(`${baseUrl}/broken`), config);
    expect(result.status).toBe('degraded');
    expect(result.httpStatus).toBe(503);
  });

  test('falls back to GET when HEAD is not allowed', async () => {
    const result = await probeUrl(new URL(`${baseUrl}/no-head`), config);
    expect(result.status).toBe('active');
    expect(result.httpStatus).toBe(200);
    expect(seenMethods).toEqual(['HEAD /no-head', 'GET /no-head']);
  });

  test('marks timeouts offline', async () => {
    const result = await probeUrl(new URL(`${baseUrl}/hang`), { ...config, timeoutMs: 100 });
    expect(result.status).toBe('offline');
    expect(result.error).toBe('ETIMEDOUT');
    expect(result.latencyMs).toBeNull();
  });

  test('refuses to send requests to hosts outside the allowlist', async () => {
    const result = await probeUrl(new URL(`${baseUrl}/ok`), { ...config, allowedDomains: ['kerrlab.app'] });
    expect(result.status).toBe('offline');
    expect(result.error).toBe('EPROBENOTALLOWED');
    expect(seenMethods).toEqual([]);
  });

  test('marks refused connections offline', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const result = await probeUrl(new URL(`http://127.0.0.1:${port}/`), config);
    expect(result.status).toBe('offline');
    expect(result.error).toBe('ECONNREFUSED');
  });
});

describe('probe scheduler', () => {
  test('registers allowed targets and stores results under the registered URL', async () => {
    process.env.HEALTH_PROBE_ALLOWED_DOMAINS = '127.0.0.1';
    const okUrl = `${baseUrl}/ok`;
    const brokenUrl = `${baseUrl}/broken`;

    const { accepted, rejected } = registerTargets([okUrl, brokenUrl, 'https://example.com', 7], 'alice');
    expect(accepted).toEqual([okUrl, brokenUrl]);
    expect(rejected).toEqual(['https://example.com']);

    await runProbeRound();
    const snapshot = getHealthSnapshot();
    expect(snapshot.targetCount).toBe(2);
    expect(snapshot.lastProbedAt).not.toBeNull();
    expect(snapshot.results[okUrl].status).toBe('active');
    expect(snapshot.results[okUrl].url).toBe(okUrl);
    expect(snapshot.results[brokenUrl].status).toBe('degraded');
  });

  test('targeted rounds only probe the requested targets', async () => {
    process.env.HEALTH_PROBE_ALLOWED_DOMAINS = '127.0.0.1';
    registerTargets([`${baseUrl}/ok`, `${baseUrl}/forbidden`], 'alice');

    await runProbeRound([`${baseUrl}/forbidden`]);
    expect(Object.keys(getHealthSnapshot().results)).toEqual([`${baseUrl}/forbidden`]);
  });

  test('results are only visible to the users who registered the target', async () => {
    process.env.HEALTH_PROBE_ALLOWED_DOMAINS = '127.0.0.1';
    registerTargets([`${baseUrl}/ok`], 'alice');
    registerTargets([`${baseUrl}/forbidden`], 'bob');
    await runProbeRound();

    expect(Object.keys(getHealthSnapshot('alice').results)).toEqual([`${baseUrl}/ok`]);
    expect(Object.keys(getHealthSnapshot('bob').results)).toEqual([`${baseUrl}/forbidden`]);
    expect(getHealthSnapshot('mallory').targetCount).toBe(0);
    expect(getHealthSnapshot().targetCount).toBe(2);
  });
});
