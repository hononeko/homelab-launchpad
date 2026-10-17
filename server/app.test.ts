import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, AppOptions } from './app';

const servers: Server[] = [];

async function start(options: AppOptions): Promise<string> {
  const app = createApp(options);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

describe('security middleware', () => {
  let baseUrl: string;

  beforeAll(async () => {
    baseUrl = await start({ distPath: null });
  });

  test('sets helmet headers with a restrictive CSP and hides the framework', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  test('allows CORS only for allowlisted origins', async () => {
    const allowed = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://launch.kerrlab.app' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://launch.kerrlab.app');

    const denied = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://evil.example.com' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('answers CORS preflight only with the allowed methods', async () => {
    const res = await fetch(`${baseUrl}/api/routes/scan`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET,POST');
  });

  test('does not serve the frontend outside production', async () => {
    expect((await fetch(`${baseUrl}/`)).status).toBe(404);
  });
});

describe('rate limiting', () => {
  test('returns 429 with standard headers once the limit is reached', async () => {
    const baseUrl = await start({ distPath: null, rateLimitMax: 2 });
    const first = await fetch(`${baseUrl}/api/health`);
    expect(first.headers.get('ratelimit-limit')).toBe('2');
    await fetch(`${baseUrl}/api/health`);

    const limited = await fetch(`${baseUrl}/api/health`);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'Too many requests, please try again later.' });
  });
});

describe('static frontend', () => {
  let baseUrl: string;
  let distPath: string;

  beforeAll(async () => {
    distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'launchpad-dist-'));
    fs.writeFileSync(path.join(distPath, 'index.html'), '<!doctype html><title>Launchpad</title>');
    fs.writeFileSync(path.join(distPath, 'asset.txt'), 'static asset');
    baseUrl = await start({ distPath });
  });

  afterAll(() => {
    fs.rmSync(distPath, { recursive: true, force: true });
  });

  test('serves assets and falls back to index.html for client-side routes', async () => {
    expect(await (await fetch(`${baseUrl}/asset.txt`)).text()).toBe('static asset');
    expect(await (await fetch(`${baseUrl}/`)).text()).toContain('<title>Launchpad</title>');
    expect(await (await fetch(`${baseUrl}/gitops/apps`)).text()).toContain('<title>Launchpad</title>');
  });

  test('API routes take precedence over the SPA fallback', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
