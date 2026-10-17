import { afterEach, describe, expect, test } from 'bun:test';
import type { Request } from 'express';
import { getAuthConfig, isTrustedProxy, parseTrustedProxies, resolveUser } from './forwardAuth';

const AUTH_ENV = [
  'AUTH_MODE',
  'AUTH_ADMIN_GROUPS',
  'AUTH_VIEWER_CATEGORIES',
  'AUTH_TRUSTED_PROXIES',
  'AUTH_DEV_USER',
  'AUTH_DEV_GROUPS',
];
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  for (const name of AUTH_ENV) delete process.env[name];
  process.env.NODE_ENV = originalNodeEnv;
});

function fakeRequest(headers: Record<string, string>, remoteAddress = '10.0.0.5'): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    get: (name: string) => lower[name.toLowerCase()],
    socket: { remoteAddress },
  } as unknown as Request;
}

describe('resolveUser', () => {
  test('maps Authelia headers to an admin when in an admin group', () => {
    const user = resolveUser(
      fakeRequest({
        'Remote-User': 'jdoe',
        'Remote-Name': 'Jane Doe',
        'Remote-Email': 'jane.doe@example.com',
        'Remote-Groups': 'homelab, admins',
      })
    );
    expect(user).toEqual({
      username: 'jdoe',
      name: 'Jane Doe',
      email: 'jane.doe@example.com',
      groups: ['homelab', 'admins'],
      role: 'admin',
    });
  });

  test('users outside admin groups are viewers', () => {
    const user = resolveUser(fakeRequest({ 'Remote-User': 'guest', 'Remote-Groups': 'guests' }));
    expect(user?.role).toBe('viewer');
  });

  test('honors custom admin groups', () => {
    process.env.AUTH_ADMIN_GROUPS = 'ops,root';
    expect(resolveUser(fakeRequest({ 'Remote-User': 'a', 'Remote-Groups': 'admins' }))?.role).toBe('viewer');
    expect(resolveUser(fakeRequest({ 'Remote-User': 'a', 'Remote-Groups': 'root' }))?.role).toBe('admin');
  });

  test('returns null without identity headers', () => {
    expect(resolveUser(fakeRequest({}))).toBeNull();
  });

  test('rejects malformed usernames and drops invalid groups and emails', () => {
    expect(resolveUser(fakeRequest({ 'Remote-User': 'bad user<script>' }))).toBeNull();
    const user = resolveUser(
      fakeRequest({ 'Remote-User': 'eve', 'Remote-Email': 'not-an-email', 'Remote-Groups': 'ok,<bad>,admins' })
    );
    expect(user?.email).toBeNull();
    expect(user?.groups).toEqual(['ok', 'admins']);
  });

  test('ignores identity headers from untrusted peers', () => {
    process.env.AUTH_TRUSTED_PROXIES = '10.42.0.0/16';
    const headers = { 'Remote-User': 'jdoe', 'Remote-Groups': 'admins' };
    expect(resolveUser(fakeRequest(headers, '10.42.3.7'))?.role).toBe('admin');
    expect(resolveUser(fakeRequest(headers, '192.168.1.20'))).toBeNull();
  });

  test('AUTH_MODE=none treats every request as an anonymous admin', () => {
    process.env.AUTH_MODE = 'none';
    expect(resolveUser(fakeRequest({}))).toMatchObject({ username: 'anonymous', role: 'admin' });
  });

  test('development identity applies only outside production', () => {
    process.env.AUTH_DEV_USER = 'dev';
    process.env.AUTH_DEV_GROUPS = 'admins';
    expect(resolveUser(fakeRequest({}))).toMatchObject({ username: 'dev', role: 'admin' });

    process.env.NODE_ENV = 'production';
    expect(resolveUser(fakeRequest({}))).toBeNull();
  });

  test('real headers take precedence over the development identity', () => {
    process.env.AUTH_DEV_USER = 'dev';
    expect(resolveUser(fakeRequest({ 'Remote-User': 'real' }))?.username).toBe('real');
  });
});

describe('trusted proxies', () => {
  test('matches IPv4 CIDRs, single addresses and IPv4-mapped IPv6 peers', () => {
    const list = parseTrustedProxies('10.0.0.0/8, 192.168.1.1, fd00::/8');
    expect(isTrustedProxy('10.9.8.7', list)).toBe(true);
    expect(isTrustedProxy('::ffff:10.9.8.7', list)).toBe(true);
    expect(isTrustedProxy('192.168.1.1', list)).toBe(true);
    expect(isTrustedProxy('192.168.1.2', list)).toBe(false);
    expect(isTrustedProxy('fd12::1', list)).toBe(true);
    expect(isTrustedProxy(undefined, list)).toBe(false);
  });

  test('trusts every peer when no list is configured', () => {
    expect(isTrustedProxy('203.0.113.9', parseTrustedProxies(''))).toBe(true);
  });

  test('skips invalid entries', () => {
    const list = parseTrustedProxies('not-an-ip, 10.0.0.1');
    expect(isTrustedProxy('10.0.0.1', list)).toBe(true);
  });
});

describe('getAuthConfig', () => {
  test('defaults to forward-auth with admins group and media/home viewer categories', () => {
    const config = getAuthConfig();
    expect(config.mode).toBe('forward-auth');
    expect(config.adminGroups).toEqual(['admins']);
    expect(config.viewerCategories).toEqual(['MEDIA', 'HOME & LIVING']);
  });
});
