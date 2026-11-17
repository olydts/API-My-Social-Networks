import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import config from './config.mjs';
import { globalLimiter, sanitize } from './middlewares/security.mjs';
import { notFound, errorHandler } from './middlewares/errors.mjs';
import authRoutes from './routes/auth.mjs';
import userRoutes from './routes/users.mjs';
import groupRoutes from './routes/groups.mjs';
import eventRoutes from './routes/events.mjs';
import threadRoutes from './routes/threads.mjs';
import albumRoutes from './routes/albums.mjs';
import pollRoutes from './routes/polls.mjs';
import ticketRoutes from './routes/tickets.mjs';
import extraRoutes from './routes/extras.mjs';

const loadOpenApi = () => {
  const file = new URL('../docs/openapi.json', import.meta.url);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by'); // ne révèle pas la technologie utilisée
  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigins, // origines explicitement autorisées, jamais "*"
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400
  }));
  app.use(globalLimiter);
  app.use(express.json({ limit: '10kb' })); // limite la taille des corps de requête
  app.use(sanitize);

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  const openapi = loadOpenApi();
  if (openapi) app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  app.use('/auth', authRoutes);
  app.use('/users', userRoutes);
  app.use('/groups', groupRoutes);
  app.use('/events', eventRoutes);
  app.use('/', threadRoutes);
  app.use('/', albumRoutes);
  app.use('/', pollRoutes);
  app.use('/', ticketRoutes);
  app.use('/', extraRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
};
