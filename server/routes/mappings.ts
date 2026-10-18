import { Request, Response, Router } from 'express';
import { requireAdmin } from '../auth/forwardAuth';
import {
  DEFAULT_MAPPINGS,
  getMappings,
  isCustomized,
  isRouteHost,
  MAX_OVERRIDES,
  parseMappings,
  parseRouteOverride,
  setMappings,
} from '../k8s/mappings';
import { getPreferencesStore, PreferencesStore } from '../preferences/store';
import { errorMessage } from '../util/errorMessage';
import type { CategoryMappings } from '../../src/types';

const SETTING = 'category-mappings';

/** Loads saved mappings at startup; the bundled defaults stay active if there are none or they are invalid. */
export async function restoreMappings(store: PreferencesStore = getPreferencesStore()): Promise<string> {
  const saved = await store.loadSetting(SETTING);
  if (saved === null) return 'Using the default category mappings.';
  const parsed = parseMappings(saved);
  if (parsed.ok === false) {
    console.warn('[Mappings] Ignoring saved category mappings: %s', parsed.error);
    return 'Using the default category mappings.';
  }
  setMappings(parsed.value);
  return 'Restored saved category mappings.';
}

function snapshot() {
  return { mappings: getMappings(), customized: isCustomized() };
}

/**
 * Category and icon rules for discovered routes (administrators only).
 * `onChanged` re-runs discovery so the new rules apply straight away.
 */
export function createMappingsRouter(onChanged: () => Promise<void>): Router {
  const router = Router();

  async function persist(res: Response, next: CategoryMappings | null) {
    try {
      await getPreferencesStore().saveSetting(SETTING, next);
    } catch (error) {
      console.error('[Mappings] Failed to save: %s', errorMessage(error));
      res.status(503).json({ success: false, error: 'Settings store unavailable' });
      return;
    }
    setMappings(next);
    await onChanged();
    res.json({ success: true, ...snapshot() });
  }

  router.get('/config/mappings', requireAdmin, (_req: Request, res: Response) => {
    res.json({ success: true, ...snapshot(), defaults: DEFAULT_MAPPINGS });
  });

  router.put('/config/mappings', requireAdmin, async (req: Request, res: Response) => {
    const parsed = parseMappings(req.body);
    if (parsed.ok === false) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    await persist(res, parsed.value);
  });

  router.post('/config/mappings/reset', requireAdmin, async (_req: Request, res: Response) => {
    await persist(res, null);
  });

  router.put('/config/mappings/overrides/:host', requireAdmin, async (req: Request, res: Response) => {
    const host = String(req.params.host).toLowerCase();
    const override = parseRouteOverride(req.body);
    if (!isRouteHost(host) || override.ok === false) {
      res.status(400).json({ success: false, error: override.ok === false ? override.error : 'Invalid host' });
      return;
    }
    const current = getMappings();
    const overrides = { ...current.overrides, [host]: override.value };
    if (Object.keys(overrides).length > MAX_OVERRIDES) {
      res.status(400).json({ success: false, error: `At most ${MAX_OVERRIDES} route overrides` });
      return;
    }
    await persist(res, { ...current, overrides });
  });

  router.delete('/config/mappings/overrides/:host', requireAdmin, async (req: Request, res: Response) => {
    const host = String(req.params.host).toLowerCase();
    const current = getMappings();
    if (!Object.hasOwn(current.overrides, host)) {
      res.status(404).json({ success: false, error: 'No override for this host' });
      return;
    }
    const overrides = Object.fromEntries(Object.entries(current.overrides).filter(([key]) => key !== host));
    await persist(res, { ...current, overrides });
  });

  return router;
}
