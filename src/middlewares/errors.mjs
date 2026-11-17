import mongoose from 'mongoose';
import { HttpError } from '../utils/http.mjs';

export const notFound = (req, res) => {
  res.status(404).json({ code: 404, message: 'Route introuvable' });
};

// Gestion centralisée des erreurs : aucun détail interne n'est renvoyé au client
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 400, message: 'JSON invalide' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ code: 413, message: 'Corps de requête trop volumineux' });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ code: err.status, message: err.message, errors: err.details });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.fromEntries(
      Object.entries(err.errors).map(([field, e]) => [field, e.message])
    );
    return res.status(400).json({ code: 400, message: 'Données invalides', errors });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ code: 400, message: `Valeur invalide pour « ${err.path} »` });
  }
  if (err.code === 11000) {
    return res.status(409).json({
      code: 409,
      message: 'Cette ressource existe déjà',
      errors: Object.fromEntries(Object.keys(err.keyPattern || {}).map((k) => [k, 'Valeur déjà utilisée']))
    });
  }

  console.error(`[ERROR] ${req.method} ${req.originalUrl} -> ${err.stack || err}`);
  return res.status(500).json({ code: 500, message: 'Internal Server Error' });
};
