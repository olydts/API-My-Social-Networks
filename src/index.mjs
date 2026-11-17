import mongoose from 'mongoose';
import config from './config.mjs';
import { createApp } from './app.mjs';

const start = async () => {
  await mongoose.connect(config.mongoUri);
  console.log('[DB] MongoDB connecté');

  const server = createApp().listen(config.port, () => {
    console.log(`[API] http://localhost:${config.port}  (docs : /docs)`);
  });

  const shutdown = async () => {
    server.close();
    await mongoose.connection.close();
    console.log('[API] arrêt propre');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

start().catch((err) => {
  console.error(`[ERROR] démarrage impossible -> ${err.message}`);
  process.exit(1);
});
