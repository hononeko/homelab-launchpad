import { Router, Request, Response } from 'express';
import { getK8sClient } from '../k8s/client';
import {
  scanClusterRoutes,
  getCachedRoutes,
  getLastScannedAt,
  markRouteImported,
  DiscoveredRoute,
} from '../k8s/discovery';

export const apiRouter = Router();

// Set of connected SSE clients
const sseClients = new Set<Response>();

function broadcastSSE(eventType: string, data: any) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

// 1. Healthcheck Endpoint
apiRouter.get('/health', (req: Request, res: Response) => {
  const client = getK8sClient();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    k8s: {
      connected: client.isConnected,
      mode: client.connectionMode,
      server: client.clusterServer || null,
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
    console.error('[API] /routes error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch routes',
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
    console.error('[API] /routes/scan error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to scan cluster routes',
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

// 5. Server-Sent Events (SSE) Stream
apiRouter.get('/routes/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial connected event with current routes
  const initialRoutes = getCachedRoutes();
  res.write(`event: connected\ndata: ${JSON.stringify({ connected: true, routesCount: initialRoutes.length })}\n\n`);

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
