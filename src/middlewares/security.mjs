import rateLimit from 'express-rate-limit';
import config from '../config.mjs';

const limitMessage = { code: 429, message: 'Trop de requêtes, réessayez plus tard' };

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage
});

// Plus strict sur l'authentification (freine le brute force)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage
});

// Supprime les clés dangereuses ($where, $ne, a.b…) pour empêcher l'injection NoSQL
const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('$') && !key.includes('.'))
        .map(([key, val]) => [key, clean(val)])
    );
  }
  return value;
};

export const sanitize = (req, res, next) => {
  if (req.body) req.body = clean(req.body);
  if (req.query) req.query = clean(req.query);
  if (req.params) req.params = clean(req.params);
  next();
};
