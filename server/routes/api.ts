import { Router, Request, Response } from 'express';
import { getK8sClient } from '../k8s/client';
import {
  scanClusterRoutes,
  getCachedRoutes,
  getLastScannedAt,
  markRouteImported,
} from '../k8s/discovery';
import {
  fetchArgoApplications,
  getCachedArgoApps,
  getLastArgoScannedAt,
  syncArgoApplication,
  syncAllArgoApplications,
} from '../k8s/argo';
import { fetchClusterTelemetry, TelemetryData } from '../k8s/telemetry';

export const apiRouter = Router();

// Set of connected SSE clients
const sseClients = new Set<Response>();

function broadcastSSE(eventType: string, data: any) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

export function broadcastTelemetry(data: TelemetryData) {
  broadcastSSE('telemetry:updated', data);
}

// 1. Healthcheck Endpoint
apiRouter.get('/health', (req: Request, res: Response) => {
  const client = getK8sClient();
  const argoApps = getCachedArgoApps();
  const argoSynced = argoApps.filter((a) => a.syncStatus === 'Synced').length;
  const argoOutOfSync = argoApps.filter((a) => a.syncStatus === 'OutOfSync').length;

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    k8s: {
      connected: client.isConnected,
      mode: client.connectionMode,
      server: client.clusterServer || null,
    },
    routes: {
      totalCached: getCachedRoutes().length,
      lastScannedAt: getLastScannedAt(),
    },
    argo: {
      totalCached: argoApps.length,
      synced: argoSynced,
      outOfSync: argoOutOfSync,
      lastScannedAt: getLastArgoScannedAt(),
    },
    lastScannedAt: getLastScannedAt(),
    totalRoutesCached: getCachedRoutes().length,
  });
});

// 2. Discovered Routes Endpoint
apiRouter.get('/routes', async (req: Request, res: Response) => {
  try {
    let routes = getCachedRoutes();
    if (routes.length === 0) {
      routes = await scanClusterRoutes();
    }
    res.json({
      success: true,
      routes,
      lastScannedAt: getLastScannedAt(),
      count: routes.length,
    });
  } catch (error: any) {
    const safeErr = String((error as Error)?.message || error).replace(/[\r\n]/g, ' ');
    console.error('[API] /routes error: %s', safeErr);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch routes',
    });
  }
});

// 3. Trigger Route Scan
apiRouter.post('/routes/scan', async (req: Request, res: Response) => {
  try {
    const existingImported = req.body?.importedIds ? new Set<string>(req.body.importedIds) : new Set<string>();
    const routes = await scanClusterRoutes(existingImported);

    // Broadcast update to all connected SSE clients
    broadcastSSE('routes:updated', {
      routes,
      lastScannedAt: getLastScannedAt(),
      count: routes.length,
    });

    res.json({
      success: true,
      routes,
      lastScannedAt: getLastScannedAt(),
      count: routes.length,
    });
  } catch (error: any) {
    const safeErr = String((error as Error)?.message || error).replace(/[\r\n]/g, ' ');
    console.error('[API] /routes/scan error: %s', safeErr);
    res.status(500).json({
      success: false,
      error: 'Failed to scan cluster routes',
    });
  }
});

// 4. Mark Route as Imported
apiRouter.post('/routes/import', (req: Request, res: Response) => {
  const { routeId } = req.body;
  if (!routeId) {
    res.status(400).json({ success: false, error: 'Missing routeId' });
    return;
  }

  const marked = markRouteImported(routeId);
  if (marked) {
    broadcastSSE('route:imported', { routeId });
    res.json({ success: true, routeId });
  } else {
    res.status(404).json({ success: false, error: 'Route not found in cache' });
  }
});

// 5. ArgoCD Applications Endpoint
apiRouter.get('/argo/applications', async (req: Request, res: Response) => {
  try {
    let applications = getCachedArgoApps();
    if (applications.length === 0) {
      applications = await fetchArgoApplications();
    }
    res.json({
      success: true,
      applications,
      count: applications.length,
      lastScannedAt: getLastArgoScannedAt(),
    });
  } catch (error: any) {
    const safeErr = String((error as Error)?.message || error).replace(/[\r\n]/g, ' ');
    console.error('[API] /argo/applications error: %s', safeErr);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch ArgoCD applications',
    });
  }
});

// 6. ArgoCD Refresh Scan
apiRouter.post('/argo/refresh', async (req: Request, res: Response) => {
  try {
    const applications = await fetchArgoApplications();
    broadcastSSE('argo:updated', {
      applications,
      lastScannedAt: getLastArgoScannedAt(),
      count: applications.length,
    });
    res.json({
      success: true,
      applications,
      count: applications.length,
      lastScannedAt: getLastArgoScannedAt(),
    });
  } catch (error: any) {
    const safeErr = String((error as Error)?.message || error).replace(/[\r\n]/g, ' ');
    console.error('[API] /argo/refresh error: %s', safeErr);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh ArgoCD applications',
    });
  }
});

// 7. Trigger Sync for Single Application
apiRouter.post('/argo/applications/:name/sync', async (req: Request, res: Response) => {
  const rawName = String(req.params.name ?? '');
  const safeName = rawName.replace(/[\r\n\t]/g, '');
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(safeName)) {
    res.status(400).json({ success: false, error: 'Invalid application name' });
    return;
  }

  try {
    const result = await syncArgoApplication(safeName);

    broadcastSSE('argo:syncing', { name: safeName });
    broadcastSSE('argo:updated', {
      applications: getCachedArgoApps(),
      lastScannedAt: getLastArgoScannedAt(),
    });

    res.json({
      success: true,
      name: safeName,
      message: result.message,
    });
  } catch (error: any) {
    const safeErr = String(error?.message || error).replace(/[\r\n]/g, ' ');
    console.error('[API] /argo/applications/sync error for %s: %s', safeName, safeErr);
    res.status(500).json({
      success: false,
      error: `Failed to trigger sync for ${safeName}`,
    });
  }
});

// 8. Trigger Batch Sync for OutOfSync Applications
apiRouter.post('/argo/sync-all', async (req: Request, res: Response) => {
  try {
    const result = await syncAllArgoApplications();

    broadcastSSE('argo:updated', {
      applications: getCachedArgoApps(),
      lastScannedAt: getLastArgoScannedAt(),
    });

    res.json({
      success: true,
      triggered: result.triggered,
      count: result.count,
    });
  } catch (error: any) {
    const safeErr = String((error as Error)?.message || error).replace(/[\r\n]/g, ' ');
    console.error('[API] /argo/sync-all error: %s', safeErr);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger batch sync',
    });
  }
});

async function handleTelemetry(res: Response, force: boolean) {
  try {
    const data = await fetchClusterTelemetry(force);
    if (force) {
      broadcastTelemetry(data);
    }
    res.json({ success: true, ...data });
  } catch (error: any) {
    const safeErr = String((error as Error)?.message || error).replace(/[\r\n]/g, ' ');
    console.error('[API] /telemetry%s error: %s', force ? '/refresh' : '', safeErr);
    res.status(500).json({
      success: false,
      error: `Failed to ${force ? 'refresh' : 'fetch'} cluster telemetry`,
    });
  }
}

// 9. Real-Time Cluster Telemetry Endpoint
apiRouter.get('/telemetry', (_req: Request, res: Response) => {
  void handleTelemetry(res, false);
});

// 10. Force Refresh Telemetry
apiRouter.post('/telemetry/refresh', (_req: Request, res: Response) => {
  void handleTelemetry(res, true);
});

// 11. Server-Sent Events (SSE) Stream
apiRouter.get('/routes/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial connected event with current routes and argo counts
  const initialRoutes = getCachedRoutes();
  const initialArgo = getCachedArgoApps();
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      connected: true,
      routesCount: initialRoutes.length,
      argoCount: initialArgo.length,
    })}\n\n`
  );

  // Send current telemetry state immediately on connection
  fetchClusterTelemetry()
    .then((data) => {
      res.write(`event: telemetry:updated\ndata: ${JSON.stringify(data)}\n\n`);
    })
    .catch((err) => {
      const safeErr = String((err as Error)?.message || err).replace(/[\r\n]/g, ' ');
      console.warn('[SSE] Failed to send initial telemetry: %s', safeErr);
    });

  sseClients.add(res);

  // Heartbeat every 25s to prevent connection timeout
  const heartbeatTimer = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    sseClients.delete(res);
  });
});
