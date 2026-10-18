import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LaunchStats, ServiceCategory, ServiceItem, TabFilter, UserPreferences } from '../types';

export type SyncState = 'local' | 'loading' | 'synced' | 'saving' | 'offline' | 'error';

export interface SyncedSettings {
  services: ServiceItem[];
  hiddenCategories: ServiceCategory[];
  hiddenRouteIds: string[];
  defaultTab: TabFilter;
  argoEnabled: boolean;
  autoSyncRoutes: boolean;
}

interface Options {
  // Sync only for signed-in users; everyone else stays on localStorage
  enabled: boolean;
  settings: SyncedSettings;
  apply: (prefs: UserPreferences) => void;
}

export const SAVE_DEBOUNCE_MS = 600;

/**
 * The persisted shape of local settings. Launch stats are left out (the server
 * tracks them atomically) unless `withSeeds` is set for the first upload.
 */
function toPayload(settings: SyncedSettings, withSeeds = false) {
  return {
    services: settings.services.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      displayUrl: s.displayUrl,
      description: s.description,
      icon: s.icon,
      category: s.category,
      isPinned: s.isPinned,
      ...(s.argoAppName ? { argoAppName: s.argoAppName } : {}),
      ...(s.discoveredFrom ? { discoveredFrom: s.discoveredFrom } : {}),
      ...(s.custom === undefined ? {} : { custom: s.custom }),
      ...(s.hidden ? { hidden: true } : {}),
      ...(s.original ? { original: { name: s.original.name, icon: s.original.icon } } : {}),
      ...(withSeeds ? { launchesPerWeek: s.launchesPerWeek, lastAccessedTimestamp: s.lastAccessedTimestamp } : {}),
    })),
    hiddenCategories: settings.hiddenCategories,
    // Profiles saved before route hiding existed have no list
    hiddenRouteIds: settings.hiddenRouteIds ?? [],
    defaultTab: settings.defaultTab,
    argoEnabled: settings.argoEnabled,
    autoSyncRoutes: settings.autoSyncRoutes,
  };
}

async function putPreferences(body: unknown): Promise<boolean> {
  try {
    const res = await fetch('/api/user/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Keeps launchpad settings in sync with the signed-in user's server-side
 * profile, falling back to localStorage when offline or signed out.
 */
export function usePreferencesSync({ enabled, settings, apply }: Options) {
  const [syncState, setSyncState] = useState<SyncState>('local');
  const [persisted, setPersisted] = useState(false);
  // Only push changes once the server state has been loaded, so stale local
  // state never overwrites a newer profile from another device
  const hydrated = useRef(false);
  const lastSynced = useRef<string | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const payload = useMemo(() => JSON.stringify(toPayload(settings)), [settings]);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  // Saves are sent one at a time, in order, so a slow request can never land
  // after a newer one and overwrite it
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const save = useCallback((body: string) => {
    saveQueue.current = saveQueue.current.then(async () => {
      setSyncState('saving');
      const ok = await putPreferences(JSON.parse(body));
      if (ok) lastSynced.current = body;
      setSyncState(ok ? 'synced' : 'error');
    });
  }, []);

  useEffect(() => {
    hydrated.current = false;
    lastSynced.current = null;
    if (!enabled) {
      setSyncState('local');
      return;
    }

    let cancelled = false;
    const payloadAtStart = payloadRef.current;
    setSyncState('loading');
    // Errors are handled inside; the promise itself is intentionally not awaited
    void (async () => {
      try {
        const res = await fetch('/api/user/preferences');
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (!data?.success) {
          setSyncState('offline');
          return;
        }
        setPersisted(Boolean(data.persisted));

        if (data.preferences && payloadRef.current !== payloadAtStart) {
          // The user changed something while the profile was loading: their
          // edit wins and is saved (last write wins, like every other save)
          hydrated.current = true;
          setSyncState('synced');
          save(payloadRef.current);
          return;
        }

        if (data.preferences) {
          const prefs = data.preferences as UserPreferences;
          lastSynced.current = JSON.stringify(toPayload(prefs));
          hydrated.current = true;
          applyRef.current(prefs);
          setSyncState('synced');
          return;
        }

        // First sync for this user: upload local state, including launch counts
        const local = settingsRef.current;
        const ok = await putPreferences(toPayload(local, true));
        if (cancelled) return;
        hydrated.current = true;
        if (ok) lastSynced.current = JSON.stringify(toPayload(local));
        setSyncState(ok ? 'synced' : 'error');
        // Edits made during the upload were skipped by the save effect; send them now
        if (payloadRef.current !== lastSynced.current) save(payloadRef.current);
      } catch {
        if (!cancelled) setSyncState('offline');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, save]);

  useEffect(() => {
    if (!enabled || !hydrated.current || payload === lastSynced.current) return;
    setSyncState('saving');
    const timer = setTimeout(() => save(payload), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, payload, save]);

  const recordLaunch = useCallback(
    async (serviceId: string): Promise<LaunchStats | null> => {
      if (!enabled) return null;
      try {
        const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}/launch`, { method: 'POST' });
        if (!res.ok) return null;
        const data = await res.json();
        if (typeof data?.count !== 'number' || typeof data?.lastLaunchedAt !== 'number') return null;
        return { count: data.count, lastLaunchedAt: data.lastLaunchedAt };
      } catch {
        return null;
      }
    },
    [enabled]
  );

  return { syncState, persisted, recordLaunch };
}
