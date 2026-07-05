import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import ocrRoutes from './routes/ocr.js';
import usersRoutes from './routes/users.js';
import receiptsRoutes from './routes/receipts.js';
import splitsRoutes from './routes/splits.js';
import groupsRoutes from './routes/groups.js';

const app = new Hono();

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      const allowed = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(s => s.trim());
      // Allow any local network origin in dev
      if (!origin || allowed.includes(origin) || /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) {
        return origin ?? '*';
      }
      return null;
    },
    credentials: true,
  })
);

app.route('/api/ocr', ocrRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/receipts', receiptsRoutes);
app.route('/api/splits', splitsRoutes);
app.route('/api/groups', groupsRoutes);

app.get('/api/health', (c) => c.json({ ok: true }));

// Serve the Vite build in production
app.use('*', serveStatic({ root: '../web/dist' }));
app.get('*', serveStatic({ path: '../web/dist/index.html' }));

const port = Number(process.env.PORT ?? 3001);
console.log(`API server running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
