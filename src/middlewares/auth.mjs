import { Router } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config.mjs';
import User from '../models/user.mjs';
import { asyncHandler, HttpError } from '../utils/http.mjs';

// Vérifie le JWT (en-tête Authorization: Bearer <token>) et charge l'utilisateur
export const authToken = asyncHandler(async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'Authentification requise : token manquant');
  }

  let payload;
  try {
    // L'algorithme est imposé côté serveur (protège de "none" et de l'algorithm confusion)
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Token invalide ou expiré');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw new HttpError(401, 'Utilisateur introuvable');

  req.user = user;
  return next();
});

// Routeur dont CHAQUE route exige un token. Contrairement à router.use(authToken), il ne
// s'applique qu'aux routes réellement déclarées : une URL inconnue renvoie bien 404 (et non 401).
export const authRouter = () => {
  const router = Router();
  ['get', 'post', 'patch', 'delete'].forEach((method) => {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => original(path, authToken, ...handlers);
  });
  return router;
};

// Contrôle d'accès basé sur les rôles (RBAC)
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new HttpError(403, 'Accès interdit : droits insuffisants'));
  }
  return next();
};
