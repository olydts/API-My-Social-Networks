import { Router } from 'express';
import User from '../models/user.mjs';
import Group from '../models/group.mjs';
import Event from '../models/event.mjs';
import { Message } from '../models/thread.mjs';
import { Photo, PhotoComment } from '../models/photo.mjs';
import { PollAnswer } from '../models/poll.mjs';
import { ShoppingItem, Carpool } from '../models/extras.mjs';
import { authToken, requireRole } from '../middlewares/auth.mjs';
import {
  asyncHandler, HttpError, pick, paginate, validIds, searchFilter
} from '../utils/http.mjs';

const router = Router();
router.use(authToken);

// Recherche d'utilisateurs (nom, prénom, ville) : profil public uniquement, pas d'email
router.get('/search', asyncHandler(async (req, res) => {
  const filter = searchFilter(req.query.q, ['firstName', 'lastName', 'city']);
  if (!filter) throw new HttpError(400, 'Paramètre q requis (ex : /users/search?q=alice)');
  const { page, limit, skip } = paginate(req.query);
  const [users, total] = await Promise.all([
    User.find(filter).sort({ lastName: 1, firstName: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);
  const items = users.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, city: u.city }));
  res.json({ page, limit, total, items });
}));

// Liste complète : réservée aux administrateurs (RBAC), avec recherche ?q= (inclut l'email)
router.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = searchFilter(req.query.q, ['firstName', 'lastName', 'email', 'city']) || {};
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);
  res.json({ page, limit, total, items });
}));

router.patch('/me', asyncHandler(async (req, res) => {
  const updates = pick(req.body, ['firstName', 'lastName', 'age', 'city', 'password']);
  req.user.set(updates);
  // Il faut re-sélectionner le mot de passe uniquement s'il est modifié (hash dans pre-save)
  await req.user.save();
  res.json(req.user);
}));

// Suppression d'un compte : le propriétaire (avec confirmation du mot de passe) ou un admin.
// On refuse tant que l'utilisateur est le dernier admin d'un groupe ou le dernier organisateur
// d'un événement (sinon ils deviendraient orphelins) : il faut d'abord transférer ou supprimer.
const removeUser = async (user) => {
  const [soleGroup, soleEvent] = await Promise.all([
    Group.exists({ admins: user._id, 'admins.1': { $exists: false } }),
    Event.exists({ organizers: user._id, 'organizers.1': { $exists: false } })
  ]);
  if (soleGroup || soleEvent) {
    throw new HttpError(409, "Cet utilisateur est le seul administrateur d'un groupe ou le seul organisateur d'un événement : transférez ou supprimez-le d'abord");
  }
  const { _id } = user;
  await Promise.all([
    Group.updateMany({ members: _id }, { $pull: { members: _id, admins: _id } }),
    Event.updateMany({ $or: [{ participants: _id }, { organizers: _id }] }, { $pull: { participants: _id, organizers: _id } }),
    Carpool.updateMany({ passengers: _id }, { $pull: { passengers: _id } }),
    Carpool.deleteMany({ driver: _id }),
    ShoppingItem.deleteMany({ user: _id }),
    PollAnswer.deleteMany({ user: _id }),
    PhotoComment.deleteMany({ author: _id }),
    Photo.deleteMany({ postedBy: _id }),
    Message.deleteMany({ author: _id })
  ]);
  await user.deleteOne();
};

router.delete('/me', asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id).select('+password');
  const password = req.body?.password;
  if (typeof password !== 'string' || !(await me.comparePassword(password))) {
    throw new HttpError(401, 'Mot de passe incorrect : suppression refusée');
  }
  await removeUser(me);
  res.status(204).end();
}));

router.delete('/:id', requireRole('admin'), validIds('id'), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'Utilisateur introuvable');
  await removeUser(user);
  res.status(204).end();
}));

// Profil public : on n'expose pas l'email des autres utilisateurs
router.get('/:id', validIds('id'), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'Utilisateur introuvable');

  const isSelf = String(user._id) === String(req.user._id);
  const isAdmin = req.user.role === 'admin';
  if (isSelf || isAdmin) return res.json(user);

  return res.json({
    id: user.id, firstName: user.firstName, lastName: user.lastName, city: user.city
  });
}));

export default router;
