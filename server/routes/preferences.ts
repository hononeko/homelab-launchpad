import { Request, Response, Router } from 'express';
import { getRequestUser } from '../auth/forwardAuth';
import { formatRelativeTime } from '../k8s/argo';
import { getPreferencesStore } from '../preferences/store';
import { parsePreferences, SERVICE_ID_PATTERN } from '../preferences/validate';
import { AuthUser, LaunchStats, UserPreferences } from '../../src/types';

// Mounted on the API router after authentication; every route acts on the signed-in user
export const preferencesRouter = Router();

function withStats(prefs: Omit<UserPreferences, 'updatedAt'> & { updatedAt: string | null }, stats: Record<string, LaunchStats>): UserPreferences {
  return {
    ...prefs,
    services: prefs.services.map((service) => {
      const serviceStats = stats[service.id];
      return {
        ...service,
        launchesPerWeek: serviceStats?.count ?? 0,
        lastAccessedTimestamp: serviceStats?.lastLaunchedAt ?? 0,
        lastAccessed: serviceStats?.lastLaunchedAt ? formatRelativeTime(new Date(serviceStats.lastLaunchedAt)) : 'never',
      };
    }),
  };
}

function storeUnavailable(res: Response, action: string, error: unknown) {
  const safeErr = String((error as Error)?.message || error).replace(/[\n\r]/g, '');
  console.error('[Preferences] Failed to %s: %s', action, safeErr);
  res.status(503).json({ success: false, error: 'Preferences store unavailable' });
}

preferencesRouter.get('/user/preferences', async (_req: Request, res: Response) => {
  const user = getRequestUser(res) as AuthUser;
  const store = getPreferencesStore();
  try {
    const [prefs, stats] = await Promise.all([store.load(user.username), store.launchStats(user.username)]);
    res.json({
      success: true,
      persisted: store.kind === 'valkey',
      // null until the first save, so clients can upload their local state
      preferences: prefs ? withStats(prefs, stats) : null,
    });
  } catch (error) {
    storeUnavailable(res, 'load preferences', error);
  }
});

preferencesRouter.put('/user/preferences', async (req: Request, res: Response) => {
  const parsed = parsePreferences(req.body);
  if (parsed.ok === false) {
    res.status(400).json({ success: false, error: parsed.error });
    return;
  }

  const user = getRequestUser(res) as AuthUser;
  const store = getPreferencesStore();
  try {
    const saved = { ...parsed.value, updatedAt: new Date().toISOString() };
    await store.save(user.username, saved);
    const stats = await store.launchStats(user.username);
    res.json({ success: true, persisted: store.kind === 'valkey', preferences: withStats(saved, stats) });
  } catch (error) {
    storeUnavailable(res, 'save preferences', error);
  }
});

preferencesRouter.post('/services/:id/launch', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  if (!SERVICE_ID_PATTERN.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid service id' });
    return;
  }

  const user = getRequestUser(res) as AuthUser;
  try {
    const stats = await getPreferencesStore().recordLaunch(user.username, id, Date.now());
    if (!stats) {
      res.status(409).json({ success: false, error: 'Launch counter limit reached' });
      return;
    }
    res.json({ success: true, id, ...stats });
  } catch (error) {
    storeUnavailable(res, 'record launch', error);
  }
});
