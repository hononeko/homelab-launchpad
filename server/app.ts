import path from 'node:path';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { apiRouter } from './routes/api';

export interface AppOptions {
  // Maximum requests per client per 15-minute window
  rateLimitMax?: number;
  // Directory with the built frontend; static serving is disabled when null
  distPath?: string | null;
}

// Restricted CORS configuration using Set lookup
export const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'https://kerrlab.app',
  'https://launch.kerrlab.app',
]);

function defaultDistPath(): string | null {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.DIST_PATH;
  return isProd ? process.env.DIST_PATH || path.resolve(process.cwd(), 'dist') : null;
}

export function createApp({ rateLimitMax = 1000, distPath = defaultDistPath() }: AppOptions = {}): Express {
  const app = express();

  // Disable fingerprinting headers
  app.disable('x-powered-by');

  // Security headers with Helmet and Content Security Policy directives
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https:', 'http:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // Rate limiting middleware to protect endpoints and prevent abuse
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
  app.use(limiter);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.has(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      methods: ['GET', 'POST', 'PUT'],
    })
  );

  // Large enough for a full preferences catalog (up to 300 services)
  app.use(express.json({ limit: '1mb' }));

  // Request logging with sanitized path to prevent log injection
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api') && req.path !== '/api/routes/stream') {
        const duration = Date.now() - start;
        const safePath = req.path.replace(/[\n\r]/g, '');
        const safeMethod = req.method.replace(/[\n\r]/g, '');
        console.log(`[HTTP] ${safeMethod} ${safePath} -> ${res.statusCode} (${duration}ms)`);
      }
    });
    next();
  });

  // Mount API router
  app.use('/api', apiRouter);

  // In production, serve static assets from dist
  if (distPath) {
    console.log(`[Server] Production mode: serving static files from ${distPath}`);
    app.use(express.static(distPath));
    app.get('{/*splat}', limiter, (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
