
import { Thread, Message } from '../models/thread.mjs';
import Event from '../models/event.mjs';
import Group from '../models/group.mjs';
import { authRouter } from '../middlewares/auth.mjs';
import {
  asyncHandler, HttpError, pick, paginate, validIds, isObjectId, withSearch
} from '../utils/http.mjs';
import {
  loadGroup, loadEvent, assertCanReadGroupContent, isMember, isGroupAdmin,
  isParticipant, isOrganizer, assertCanViewEvent
} from '../services/access.mjs';

const router = authRouter();

// Détermine ce que l'utilisateur peut faire dans un fil (groupe OU événement)
const threadAccess = async (thread, user) => {
  if (thread.group) {
    const group = await loadGroup(thread.group);
    assertCanReadGroupContent(group, user);
    return {
      canPost: isMember(group, user) && (isGroupAdmin(group, user) || group.allowMembersToPost),
      canModerate: isGroupAdmin(group, user)
    };
  }
  const event = await loadEvent(thread.event);
  assertCanViewEvent(event, user);
  if (!isParticipant(event, user)) throw new HttpError(403, "Réservé aux participants de l'événement");
  return { canPost: true, canModerate: isOrganizer(event, user) };
};

const loadThread = async (id) => {
  const thread = await Thread.findById(id);
  if (!thread) throw new HttpError(404, 'Fil de discussion introuvable');
  return thread;
};

router.get('/threads/:id/messages', validIds('id'), asyncHandler(async (req, res) => {
  const thread = await loadThread(req.params.id);
  await threadAccess(thread, req.user);

  const { page, limit, skip } = paginate(req.query);
  const filter = { thread: thread._id };
  // ?parent=<id> => réponses d'un message ; ?parent=root => messages racines
  if (req.query.parent === 'root') filter.parent = null;
  else if (isObjectId(req.query.parent)) filter.parent = req.query.parent;

  const searched = withSearch(filter, req.query.q, ['content']);
  const [items, total] = await Promise.all([
    Message.find(searched).sort({ createdAt: 1 }).skip(skip).limit(limit),
    Message.countDocuments(searched)
  ]);
  res.json({ page, limit, total, items });
}));

router.post('/threads/:id/messages', validIds('id'), asyncHandler(async (req, res) => {
  const thread = await loadThread(req.params.id);
  const access = await threadAccess(thread, req.user);
  if (!access.canPost) throw new HttpError(403, 'Vous ne pouvez pas publier dans ce fil');

  const data = pick(req.body, ['content']);
  let parent = null;
  if (req.body?.parentId !== undefined) {
    if (!isObjectId(req.body.parentId)) throw new HttpError(400, 'parentId invalide');
    const target = await Message.findOne({ _id: req.body.parentId, thread: thread._id });
    if (!target) throw new HttpError(404, 'Message parent introuvable dans ce fil');
    parent = target._id;
  }

  const message = await Message.create({
    ...data, thread: thread._id, author: req.user._id, parent
  });
  res.status(201).json(message);
}));

router.get('/messages/:id', validIds('id'), asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new HttpError(404, 'Message introuvable');
  await threadAccess(await loadThread(message.thread), req.user);
  res.json(message);
}));

// Seul l'auteur peut modifier son message (les modérateurs peuvent seulement le supprimer)
router.patch('/messages/:id', validIds('id'), asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new HttpError(404, 'Message introuvable');
  await threadAccess(await loadThread(message.thread), req.user);
  if (String(message.author) !== String(req.user._id)) {
    throw new HttpError(403, "Seul l'auteur peut modifier son message");
  }
  message.set(pick(req.body, ['content']));
  await message.save();
  res.json(message);
}));

router.delete('/messages/:id', validIds('id'), asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) throw new HttpError(404, 'Message introuvable');
  const thread = await loadThread(message.thread);
  const access = await threadAccess(thread, req.user);

  const isAuthor = String(message.author) === String(req.user._id);
  if (!isAuthor && !access.canModerate) throw new HttpError(403, 'Suppression non autorisée');

  await Message.deleteMany({ $or: [{ _id: message._id }, { parent: message._id }] });
  res.status(204).end();
}));

// Évite un avertissement d'import inutilisé tout en gardant les modèles référencés
export const _models = { Event, Group };
export default router;
