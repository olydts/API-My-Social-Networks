import { Router } from 'express';
import Group from '../models/group.mjs';
import Event from '../models/event.mjs';
import { Thread, Message } from '../models/thread.mjs';
import { authToken } from '../middlewares/auth.mjs';
import {
  asyncHandler, HttpError, pick, paginate, validIds, isObjectId, withSearch
} from '../utils/http.mjs';
import {
  loadGroup, isMember, isGroupAdmin, assertCanSeeGroup, assertCanReadGroupContent,
  assertGroupAdmin, has
} from '../services/access.mjs';
import User from '../models/user.mjs';
import { createGroupEvent } from './events.mjs';

const router = Router();
router.use(authToken);

const GROUP_FIELDS = [
  'name', 'description', 'icon', 'coverPhoto', 'type',
  'allowMembersToPost', 'allowMembersToCreateEvents'
];

// Vue réduite d'un groupe privé pour un non-membre
const preview = (group) => ({
  id: group.id,
  name: group.name,
  description: group.description,
  icon: group.icon,
  coverPhoto: group.coverPhoto,
  type: group.type,
  memberCount: group.members.length
});

router.post('/', asyncHandler(async (req, res) => {
  const group = await Group.create({
    ...pick(req.body, GROUP_FIELDS),
    members: [req.user._id],
    admins: [req.user._id]
  });
  await Thread.create({ group: group._id }); // fil de discussion mis à disposition
  res.status(201).json(group);
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {
    $or: [{ type: { $in: ['public', 'private'] } }, { members: req.user._id }]
  };
  if (['public', 'private', 'secret'].includes(req.query.type)) {
    filter.$and = [{ type: req.query.type }];
  }
  const searched = withSearch(filter, req.query.q, ['name', 'description']);
  const [groups, total] = await Promise.all([
    Group.find(searched).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Group.countDocuments(searched)
  ]);
  const items = groups.map((g) => (isMember(g, req.user) || g.type === 'public' ? g : preview(g)));
  res.json({ page, limit, total, items });
}));

router.get('/:id', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  res.json(isMember(group, req.user) || group.type === 'public' ? group : preview(group));
}));

router.patch('/:id', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  assertGroupAdmin(group, req.user);
  group.set(pick(req.body, GROUP_FIELDS));
  await group.save();
  res.json(group);
}));

router.delete('/:id', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  assertGroupAdmin(group, req.user);

  const thread = await Thread.findOne({ group: group._id });
  if (thread) {
    await Message.deleteMany({ thread: thread._id });
    await thread.deleteOne();
  }
  await Event.updateMany({ group: group._id }, { $set: { group: null } });
  await group.deleteOne();
  res.status(204).end();
}));

// ---- Adhésion ----
router.post('/:id/join', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  if (group.type !== 'public') {
    throw new HttpError(403, "Ce groupe n'est pas public : un administrateur doit vous ajouter");
  }
  if (isMember(group, req.user)) throw new HttpError(409, 'Vous êtes déjà membre');
  group.members.push(req.user._id);
  await group.save();
  res.json(group);
}));

router.post('/:id/leave', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  if (!isMember(group, req.user)) throw new HttpError(409, "Vous n'êtes pas membre de ce groupe");
  if (isGroupAdmin(group, req.user) && group.admins.length === 1) {
    throw new HttpError(409, "Vous êtes le dernier administrateur : nommez-en un autre avant de partir");
  }
  group.members = group.members.filter((m) => String(m) !== String(req.user._id));
  group.admins = group.admins.filter((a) => String(a) !== String(req.user._id));
  await group.save();
  res.status(204).end();
}));

router.post('/:id/members', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  assertGroupAdmin(group, req.user);
  const { userId } = req.body || {};
  if (!isObjectId(userId) || !(await User.exists({ _id: userId }))) {
    throw new HttpError(400, 'userId invalide ou utilisateur introuvable');
  }
  if (has(group.members, userId)) throw new HttpError(409, 'Cet utilisateur est déjà membre');
  group.members.push(userId);
  await group.save();
  res.status(201).json(group);
}));

router.delete('/:id/members/:userId', validIds('id', 'userId'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  assertGroupAdmin(group, req.user);
  const { userId } = req.params;
  if (!has(group.members, userId)) throw new HttpError(404, 'Membre introuvable');
  if (has(group.admins, userId) && group.admins.length === 1) {
    throw new HttpError(409, 'Impossible de retirer le dernier administrateur');
  }
  group.members = group.members.filter((m) => String(m) !== userId);
  group.admins = group.admins.filter((a) => String(a) !== userId);
  await group.save();
  res.status(204).end();
}));

router.post('/:id/admins', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  assertGroupAdmin(group, req.user);
  const { userId } = req.body || {};
  if (!isObjectId(userId) || !has(group.members, userId)) {
    throw new HttpError(400, "L'utilisateur doit être membre du groupe");
  }
  if (has(group.admins, userId)) throw new HttpError(409, 'Cet utilisateur est déjà administrateur');
  group.admins.push(userId);
  await group.save();
  res.status(201).json(group);
}));

// ---- Fil de discussion et événements du groupe ----
router.get('/:id/thread', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanReadGroupContent(group, req.user);
  const thread = await Thread.findOne({ group: group._id });
  if (!thread) throw new HttpError(404, 'Fil de discussion introuvable');
  res.json(thread);
}));

// Création simplifiée : tous les membres du groupe sont invités automatiquement
router.post('/:id/events', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanSeeGroup(group, req.user);
  if (!isGroupAdmin(group, req.user)
    && !(isMember(group, req.user) && group.allowMembersToCreateEvents)) {
    throw new HttpError(403, "Vous n'êtes pas autorisé à créer des événements dans ce groupe");
  }
  const event = await createGroupEvent(group, req.user, req.body);
  res.status(201).json(event);
}));

router.get('/:id/events', validIds('id'), asyncHandler(async (req, res) => {
  const group = await loadGroup(req.params.id);
  assertCanReadGroupContent(group, req.user);
  const events = await Event.find({
    group: group._id,
    $or: [{ visibility: 'public' }, { participants: req.user._id }]
  }).sort({ startDate: 1 });
  res.json(events);
}));

export default router;
