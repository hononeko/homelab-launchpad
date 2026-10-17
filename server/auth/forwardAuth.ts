import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { AuthSession, AuthUser } from '../../src/types';

export type AuthMode = 'forward-auth' | 'none';

/**
 * Peers whose identity headers are trusted: an explicit list, any peer (`*`, for
 * when a NetworkPolicy already restricts ingress to the gateway), or no peer.
 */
export type TrustedProxies = net.BlockList | 'any' | 'none';

export interface AuthConfig {
  mode: AuthMode;
  adminGroups: string[];
  viewerCategories: string[];
  trustedProxies: TrustedProxies;
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

function parsePrefix(prefix: string, family: number): number | null {
  if (!/^\d{1,3}$/.test(prefix)) return null;
  const value = Number.parseInt(prefix, 10);
  return value <= (family === 6 ? 128 : 32) ? value : null;
}

/**
 * Parses a comma-separated list of IPs and CIDRs into a BlockList (memoized per
 * value). Invalid entries are skipped; returns null when no entry is valid.
 */
export function parseTrustedProxies(spec: string): net.BlockList | null {
  if (spec === cachedProxySpec) return cachedProxyList;

  let list: net.BlockList | null = null;
  for (const entry of splitList(spec, '')) {
    const [address, prefix, ...rest] = entry.split('/');
    const family = net.isIP(address);
    const prefixLength = prefix === undefined ? null : parsePrefix(prefix, family);
    if (family === 0 || rest.length > 0 || (prefix !== undefined && prefixLength === null)) {
      console.warn('[Auth] Ignoring invalid AUTH_TRUSTED_PROXIES entry: %s', entry.replace(/[\r\n]/g, ''));
      continue;
    }
    list ??= new net.BlockList();
    const type = family === 6 ? 'ipv6' : 'ipv4';
    if (prefixLength === null) {
      list.addAddress(address, type);
    } else {
      list.addSubnet(address, prefixLength, type);
    }
  }

  cachedProxySpec = spec;
  cachedProxyList = list;
  return list;
}

/**
 * Resolves AUTH_TRUSTED_PROXIES. When unset (or invalid), development trusts any
 * peer, but production trusts none, so identity headers are ignored until the
 * gateway is configured: a misconfigured deployment fails closed.
 */
export function resolveTrustedProxies(spec: string | undefined, isProduction: boolean): TrustedProxies {
  const trimmed = spec?.trim() ?? '';
  if (trimmed === '*') return 'any';
  const list = parseTrustedProxies(trimmed);
  if (list) return list;
  return isProduction ? 'none' : 'any';
}

export function getAuthConfig(): AuthConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const devUsername = process.env.AUTH_DEV_USER?.trim();
  return {
    mode: process.env.AUTH_MODE === 'none' ? 'none' : 'forward-auth',
    adminGroups: splitList(process.env.AUTH_ADMIN_GROUPS, 'admins'),
    viewerCategories: splitList(process.env.AUTH_VIEWER_CATEGORIES, 'MEDIA,HOME & LIVING'),
    trustedProxies: resolveTrustedProxies(process.env.AUTH_TRUSTED_PROXIES, isProduction),
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

export function isTrustedProxy(address: string | undefined, trustedProxies: TrustedProxies): boolean {
  if (trustedProxies === 'any') return true;
  if (trustedProxies === 'none') return false;
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
    // Signed-out visitors see no services, so they get no categories either
    viewerCategories: user ? config.viewerCategories : [],
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
// `none` is a user-initiated request (e.g. typed into the address bar)
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

function isSameOriginRequest(req: Request): boolean {
  const fetchSite = req.get('Sec-Fetch-Site');
  if (fetchSite !== undefined) return ALLOWED_FETCH_SITES.has(fetchSite);

  // Older browsers omit Fetch Metadata; fall back to comparing Origin with Host.
  // Requests with neither header come from non-browser clients, which cannot
  // carry a victim's SSO cookie.
  const origin = req.get('Origin');
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.get('Host');
  } catch {
    return false;
  }
}

/**
 * Rejects state-changing requests initiated by any other origin, including
 * sibling subdomains: the Authelia session cookie is shared across the whole
 * domain, so `same-site` requests would otherwise carry it.
 */
export function rejectCrossSiteMutations(req: Request, res: Response, next: NextFunction): void {
  if (!SAFE_METHODS.has(req.method) && !isSameOriginRequest(req)) {
    res.status(403).json({ success: false, error: 'Cross-site request rejected' });
    return;
  }
  next();
}
