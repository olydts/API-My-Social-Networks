import { Router } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config.mjs';
import User from '../models/user.mjs';
import { authToken } from '../middlewares/auth.mjs';
import { authLimiter } from '../middlewares/security.mjs';
import { asyncHandler, HttpError, pick } from '../utils/http.mjs';

const router = Router();

export const signToken = (user) => jwt.sign(
  { sub: String(user._id), role: user.role },
  config.jwtSecret,
  { algorithm: 'HS256', expiresIn: config.jwtExpiresIn }
);

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  // `role` n'est volontairement pas autorisé : impossible de s'auto-promouvoir admin
  const data = pick(req.body, ['firstName', 'lastName', 'email', 'password', 'age', 'city']);
  if (typeof data.password !== 'string') throw new HttpError(400, 'Le mot de passe est requis');

  const user = await User.create(data);
  res.status(201).json({ user, token: signToken(user) });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'Email et mot de passe requis');
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
  const valid = user ? await user.comparePassword(password) : false;
  // Même message dans les deux cas : ne révèle pas si l'email existe
  if (!valid) throw new HttpError(401, 'Identifiants invalides');

  res.json({ token: signToken(user), user });
}));

router.get('/me', authToken, (req, res) => {
  res.json(req.user);
});

export default router;
