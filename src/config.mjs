import 'dotenv/config';
import crypto from 'node:crypto';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) {
    throw new Error('JWT_SECRET est obligatoire en production');
  }
  // Secret éphémère en développement : les tokens ne survivent pas à un redémarrage
  jwtSecret = crypto.randomBytes(48).toString('hex');
  console.warn('[CONFIG] JWT_SECRET absent : secret aléatoire généré pour cette exécution');
}

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
};

export default {
  isProd,
  port: toInt(env.PORT, 3000),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/my_social_networks',
  jwtSecret,
  jwtExpiresIn: env.JWT_EXPIRES_IN || '1h',
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3001')
    .split(',').map((o) => o.trim()).filter(Boolean),
  rateLimitMax: toInt(env.RATE_LIMIT_MAX, 300),
  authRateLimitMax: toInt(env.AUTH_RATE_LIMIT_MAX, 20),
  bcryptRounds: toInt(env.BCRYPT_ROUNDS, 12)
};
