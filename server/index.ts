import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { apiRouter } from './routes/api';
import { getK8sClient } from './k8s/client';
import { scanClusterRoutes } from './k8s/discovery';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const isProd = process.env.NODE_ENV === 'production';

// Middleware
app.use(cors());
app.use(express.json());

// Request logging in development
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api') && req.path !== '/api/routes/stream') {
      const duration = Date.now() - start;
      console.log(`[HTTP] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Mount API router
app.use('/api', apiRouter);

// In production, serve static assets from dist
if (isProd) {
  const distPath = path.resolve(__dirname, '../dist');
  console.log(`[Server] Production mode: serving static files from ${distPath}`);
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n==================================================`);
  console.log(`  Homelab Launchpad Backend Server`);
  console.log(`  Listening on: http://0.0.0.0:${PORT}`);
  console.log(`==================================================\n`);

  // Initialize K8s client and warm up route cache
  const client = getK8sClient();
  if (client.isConnected) {
    console.log(`[Server] Initializing cluster route scan against ${client.clusterServer}...`);
    try {
      const routes = await scanClusterRoutes();
      console.log(`[Server] Successfully discovered ${routes.length} HTTPRoutes in cluster.`);
    } catch (err) {
      console.warn('[Server] Initial cluster scan failed:', err);
    }
  } else {
    console.log('[Server] Kubernetes cluster not connected, operating in simulation mode.');
  }
});
