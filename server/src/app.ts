import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { demoRouter } from './demo';
import { errorHandler, httpError } from './lib/http';
import { authRouter } from './modules/authRoutes';
import { chatRouter } from './modules/chat';
import { achievementsRouter } from './modules/gamification';
import { ordersRouter } from './modules/orders';
import { prizesRouter } from './modules/prizes';
import { usersRouter } from './modules/users';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRouter, usersRouter, ordersRouter, chatRouter, achievementsRouter, prizesRouter, demoRouter);
  app.use('/api', (_req, _res, next) => next(httpError(404, 'Нет такого метода')));
  app.use(errorHandler);

  // В продакшене сервер отдаёт и собранный фронтенд.
  const dist = path.resolve(import.meta.dirname, '../../dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
