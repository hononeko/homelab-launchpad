import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { apiRouter } from './routes/api';
import { getK8sClient } from './k8s/client';
import { scanClusterRoutes } from './k8s/discovery';

dotenv.config();

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const isProd = process.env.NODE_ENV === 'production';

// Disable fingerprinting headers
app.disable('x-powered-by');

// Security headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// Rate limiting middleware to protect endpoints and prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// Restricted CORS configuration
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://kerrlab.app',
  'https://launch.kerrlab.app',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST'],
  })
);

app.use(express.json());

// Request logging with sanitized path to prevent log injection
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api') && req.path !== '/api/routes/stream') {
      const duration = Date.now() - start;
      const safePath = req.path.replace(/[\r\n\t]/g, '');
      const safeMethod = req.method.replace(/[\r\n\t]/g, '');
      console.log(`[HTTP] ${safeMethod} ${safePath} -> ${res.statusCode} (${duration}ms)`);
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
  app.get('*', limiter, (req, res) => {
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
