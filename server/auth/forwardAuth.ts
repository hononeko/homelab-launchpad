import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { AuthSession, AuthUser } from '../../src/types';

export type AuthMode = 'forward-auth' | 'none';

export interface AuthConfig {
  mode: AuthMode;
  adminGroups: string[];
  viewerCategories: string[];
  trustedProxies: net.BlockList | null;
  devUser: { username: string; groups: string[] } | null;
}

const USERNAME_PATTERN = /^[\w.@-]{1,128}$/;
const GROUP_PATTERN = /^[\w.@ -]{1,64}$/;
const MAX_GROUPS = 50;

const ANONYMOUS_ADMIN: AuthUser = {
  username: 'anonymous',
  name: null,
  email: null,
  groups: [],
  role: 'admin',
};

function splitList(raw: string | undefined, fallback: string): string[] {
  return (raw ?? fallback)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

let cachedProxySpec: string | null = null;
let cachedProxyList: net.BlockList | null = null;

/** Parses a comma-separated list of IPs and CIDRs into a BlockList (memoized per value). */
export function parseTrustedProxies(spec: string): net.BlockList | null {
  if (spec === cachedProxySpec) return cachedProxyList;

  let list: net.BlockList | null = null;
  for (const entry of splitList(spec, '')) {
    const [address, prefix] = entry.split('/');
    const family = net.isIP(address);
    if (family === 0) {
      console.warn('[Auth] Ignoring invalid AUTH_TRUSTED_PROXIES entry: %s', entry.replace(/[\r\n]/g, ''));
      continue;
    }
    list ??= new net.BlockList();
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (prefix === undefined) {
      list.addAddress(address, type);
    } else {
      list.addSubnet(address, Number.parseInt(prefix, 10), type);
    }
  }

  cachedProxySpec = spec;
  cachedProxyList = list;
  return list;
}

export function getAuthConfig(): AuthConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const devUsername = process.env.AUTH_DEV_USER?.trim();
  return {
    mode: process.env.AUTH_MODE === 'none' ? 'none' : 'forward-auth',
    adminGroups: splitList(process.env.AUTH_ADMIN_GROUPS, 'admins'),
    viewerCategories: splitList(process.env.AUTH_VIEWER_CATEGORIES, 'MEDIA,HOME & LIVING'),
    trustedProxies: parseTrustedProxies(process.env.AUTH_TRUSTED_PROXIES ?? ''),
    // Simulated identity for local development only; never honored in production
    devUser:
      !isProduction && devUsername
        ? { username: devUsername, groups: splitList(process.env.AUTH_DEV_GROUPS, '') }
        : null,
  };
}

function normalizeRemoteAddress(address: string | undefined): string | null {
  if (!address) return null;
  // IPv4 clients on a dual-stack socket appear as IPv4-mapped IPv6 addresses
  return address.startsWith('::ffff:') && net.isIPv4(address.slice(7)) ? address.slice(7) : address;
}

export function isTrustedProxy(address: string | undefined, trustedProxies: net.BlockList | null): boolean {
  if (!trustedProxies) return true;
  const normalized = normalizeRemoteAddress(address);
  if (!normalized) return false;
  const family = net.isIP(normalized);
  if (family === 0) return false;
  return trustedProxies.check(normalized, family === 6 ? 'ipv6' : 'ipv4');
}

function parseGroups(raw: string | undefined): string[] {
  return splitList(raw, '')
    .filter((g) => GROUP_PATTERN.test(g))
    .slice(0, MAX_GROUPS);
}

function cleanHeader(raw: string | undefined, maxLength: number): string | null {
  const value = raw?.replace(/[\r\n]/g, '').trim();
  return value && value.length <= maxLength ? value : null;
}

function buildUser(username: string, groups: string[], adminGroups: string[], name: string | null, email: string | null): AuthUser {
  return {
    username,
    name,
    email,
    groups,
    role: groups.some((g) => adminGroups.includes(g)) ? 'admin' : 'viewer',
  };
}

/** Resolves the signed-in user from Authelia forward-auth headers, or null if unauthenticated. */
export function resolveUser(req: Request, config: AuthConfig = getAuthConfig()): AuthUser | null {
  if (config.mode === 'none') return ANONYMOUS_ADMIN;

  const username = cleanHeader(req.get('Remote-User'), 128);
  if (username) {
    // Identity headers are only meaningful when set by the auth gateway
    if (!isTrustedProxy(req.socket.remoteAddress, config.trustedProxies)) return null;
    if (!USERNAME_PATTERN.test(username)) return null;
    const email = cleanHeader(req.get('Remote-Email'), 254);
    return buildUser(
      username,
      parseGroups(req.get('Remote-Groups')),
      config.adminGroups,
      cleanHeader(req.get('Remote-Name'), 128),
      email?.includes('@') ? email : null
    );
  }

  if (config.devUser) {
    return buildUser(config.devUser.username, config.devUser.groups, config.adminGroups, null, null);
  }
  return null;
}

export function getRequestUser(res: Response): AuthUser | null {
  return (res.locals.authUser as AuthUser | null | undefined) ?? null;
}

export function buildSession(user: AuthUser | null, config: AuthConfig = getAuthConfig()): AuthSession {
  return {
    authenticated: user !== null,
    mode: config.mode,
    user,
    viewerCategories: config.viewerCategories,
  };
}

/** Resolves the user once per request and stores it in `res.locals.authUser`. */
export function attachUser(req: Request, res: Response, next: NextFunction): void {
  res.locals.authUser = resolveUser(req);
  next();
}

export function requireAuth(_req: Request, res: Response, next: NextFunction): void {
  if (!getRequestUser(res)) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  next();
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  if (getRequestUser(res)?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Administrator access required' });
    return;
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rejects state-changing requests initiated by other sites. Browsers send
 * `Sec-Fetch-Site` on every request, so a forged cross-site POST that would
 * carry the SSO session cookie is refused before it reaches a handler.
 */
export function rejectCrossSiteMutations(req: Request, res: Response, next: NextFunction): void {
  if (!SAFE_METHODS.has(req.method) && req.get('Sec-Fetch-Site') === 'cross-site') {
    res.status(403).json({ success: false, error: 'Cross-site request rejected' });
    return;
  }
  next();
}
