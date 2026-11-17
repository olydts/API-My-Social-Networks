// Test de bout en bout : démarre l'API sur une base MongoDB puis rejoue la collection Postman avec Newman.
//   MONGODB_URI=mongodb://127.0.0.1:27017/msn_test npm run test:e2e
import mongoose from 'mongoose';
import newman from 'newman';

// Variables d'environnement de test (avant l'import de l'application)
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.BCRYPT_ROUNDS = '4';

const { createApp } = await import('../src/app.mjs');

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/my_social_networks_e2e';
await mongoose.connect(uri);
await mongoose.connection.dropDatabase(); // base de test propre
await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // index uniques prêts

const server = createApp().listen(0);
const { port } = server.address();
console.log(`API de test sur le port ${port}`);

// CAPTURE=1 : enregistre les vraies réponses dans docs/examples.json (exemples de la documentation)
const captured = {};
const clean = (value) => {
  if (typeof value === 'string') return value.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '<jwt>');
  if (Array.isArray(value)) return value.slice(0, 2).map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
  return value;
};

const summary = await new Promise((resolve, reject) => {
  const run = newman.run({
    collection: new URL('../docs/postman_collection.json', import.meta.url).pathname,
    envVar: [{ key: 'baseUrl', value: `http://127.0.0.1:${port}` }],
    reporters: ['cli'],
    reporter: { cli: { noBanner: true } },
    delayRequest: 0
  }, (err, result) => (err ? reject(err) : resolve(result)));
  run.on('request', (err, args) => {
    if (err || !process.env.CAPTURE || captured[args.item.name]) return;
    let body;
    try { body = clean(JSON.parse(args.response.stream.toString())); } catch { body = undefined; }
    captured[args.item.name] = { code: args.response.code, body };
  });
});

if (process.env.CAPTURE) {
  const fs = await import('node:fs');
  fs.writeFileSync(new URL('../docs/examples.json', import.meta.url), `${JSON.stringify(captured, null, 2)}\n`);
  console.log(`Exemples enregistrés : ${Object.keys(captured).length}`);
}

server.close();
await mongoose.disconnect();

const { assertions, requests } = summary.run.stats;
console.log(`\nRequêtes : ${requests.total} | Assertions : ${assertions.total}, échecs : ${assertions.failed}`);
process.exit(summary.run.failures.length ? 1 : 0);
