import { Router } from 'express';
import Event from '../models/event.mjs';
import { Thread, Message } from '../models/thread.mjs';
import { Album, Photo, PhotoComment } from '../models/photo.mjs';
import { Poll, PollAnswer } from '../models/poll.mjs';
import { TicketType, Ticket } from '../models/ticket.mjs';
import { ShoppingItem, Carpool } from '../models/extras.mjs';
import Group from '../models/group.mjs';
import { authToken } from '../middlewares/auth.mjs';
import {
  asyncHandler, HttpError, pick, paginate, validIds, isObjectId, withSearch
} from '../utils/http.mjs';
import {
  loadEvent, assertCanViewEvent, assertOrganizer, isOrganizer, isParticipant,
  existingUserIds, has
} from '../services/access.mjs';

const router = Router();

const EVENT_FIELDS = [
  'name', 'description', 'startDate', 'endDate', 'location', 'coverPhoto', 'visibility',
  'ticketingEnabled', 'shoppingListEnabled', 'carpoolEnabled'
];

export const createGroupEvent = async (group, user, body) => {
  const data = pick(body, EVENT_FIELDS);
  // Dans un groupe privé ou secret, l'événement reste privé (pas de fuite vers l'extérieur)
  if (group.type !== 'public') data.visibility = 'private';

  const event = await Event.create({
    ...data,
    group: group._id,
    organizers: [user._id],
    participants: group.members // invitation automatique de tous les membres
  });
  await Thread.create({ event: event._id });
  return event;
};

// ---- Billetterie publique (sans authentification : « personne extérieure ») ----
// Déclarées AVANT router.use(authToken) pour rester accessibles aux anonymes.
router.get('/:id/ticket-types', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  if (event.visibility !== 'public' || !event.ticketingEnabled) {
    throw new HttpError(404, 'Billetterie introuvable');
  }
  const types = await TicketType.find({ event: event._id }).sort({ amount: 1 });
  res.json(types.map((t) => ({ ...t.toJSON(), remaining: t.quantity - t.sold })));
}));

router.post('/:id/tickets', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  if (event.visibility !== 'public' || !event.ticketingEnabled) {
    throw new HttpError(404, 'Billetterie introuvable');
  }
  const body = req.body || {};
  if (!isObjectId(body.ticketTypeId)) throw new HttpError(400, 'ticketTypeId invalide');
  const address = typeof body.address === 'object' && body.address ? body.address : {};
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : body.email;

  if (await Ticket.exists({ event: event._id, email })) {
    throw new HttpError(409, 'Cette personne a déjà un billet pour cet événement');
  }

  // Réservation atomique : évite de dépasser la quantité limite, même en cas de requêtes simultanées
  const type = await TicketType.findOne({ _id: body.ticketTypeId, event: event._id });
  if (!type) throw new HttpError(404, 'Type de billet introuvable');

  // La condition `sold < quantity` et l'incrément sont évalués en une seule opération côté base
  const reserved = await TicketType.findOneAndUpdate(
    { _id: type._id, sold: { $lt: type.quantity } },
    { $inc: { sold: 1 } },
    { new: true }
  );
  if (!reserved) throw new HttpError(409, 'Plus de billets disponibles pour ce type');

  try {
    const ticket = await Ticket.create({
      event: event._id,
      ticketType: reserved._id,
      firstName: body.firstName,
      lastName: body.lastName,
      email,
      address: pick(address, ['street', 'zipCode', 'city', 'country'])
    });
    res.status(201).json(ticket);
  } catch (err) {
    await TicketType.updateOne({ _id: reserved._id }, { $inc: { sold: -1 } }); // libère la place
    throw err;
  }
}));

// ---- Tout le reste nécessite d'être connecté ----
router.use(authToken);

router.post('/', asyncHandler(async (req, res) => {
  const organizers = await existingUserIds(req.body?.organizers);
  const participants = await existingUserIds(req.body?.participants);
  const event = await Event.create({
    ...pick(req.body, EVENT_FIELDS),
    organizers: [req.user._id, ...organizers],
    participants
  });
  await Thread.create({ event: event._id });
  res.status(201).json(event);
}));

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {
    $or: [{ visibility: 'public' }, { organizers: req.user._id }, { participants: req.user._id }]
  };
  if (['public', 'private'].includes(req.query.visibility)) {
    filter.$and = [{ visibility: req.query.visibility }];
  }
  // Recherche : ?q= (nom, description, lieu), ?from= / ?to= (dates ISO sur startDate)
  const range = {};
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);
  if (!Number.isNaN(from.getTime())) range.$gte = from;
  if (!Number.isNaN(to.getTime())) range.$lte = to;
  if (Object.keys(range).length) {
    filter.$and = [...(filter.$and || []), { startDate: range }];
  }
  const searched = withSearch(filter, req.query.q, ['name', 'description', 'location']);
  const [items, total] = await Promise.all([
    Event.find(searched).sort({ startDate: 1 }).skip(skip).limit(limit),
    Event.countDocuments(searched)
  ]);
  res.json({ page, limit, total, items });
}));

router.get('/:id', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  res.json(event);
}));

router.patch('/:id', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  event.set(pick(req.body, EVENT_FIELDS));
  await event.save();
  res.json(event);
}));

router.delete('/:id', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);

  // Suppression en cascade de tout ce qui dépend de l'événement
  const thread = await Thread.findOne({ event: event._id });
  if (thread) await Message.deleteMany({ thread: thread._id });
  await Thread.deleteMany({ event: event._id });

  const albums = await Album.find({ event: event._id }).distinct('_id');
  const photos = await Photo.find({ album: { $in: albums } }).distinct('_id');
  await PhotoComment.deleteMany({ photo: { $in: photos } });
  await Photo.deleteMany({ album: { $in: albums } });
  await Album.deleteMany({ event: event._id });

  const polls = await Poll.find({ event: event._id }).distinct('_id');
  await PollAnswer.deleteMany({ poll: { $in: polls } });
  await Poll.deleteMany({ event: event._id });

  await Ticket.deleteMany({ event: event._id });
  await TicketType.deleteMany({ event: event._id });
  await ShoppingItem.deleteMany({ event: event._id });
  await Carpool.deleteMany({ event: event._id });
  await event.deleteOne();
  res.status(204).end();
}));

// ---- Participants & organisateurs ----
router.post('/:id/join', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  if (event.visibility !== 'public') throw new HttpError(403, "Cet événement est privé : il faut être invité");
  if (isParticipant(event, req.user)) throw new HttpError(409, 'Vous participez déjà à cet événement');
  event.participants.push(req.user._id);
  await event.save();
  res.json(event);
}));

router.post('/:id/leave', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  if (!isParticipant(event, req.user)) throw new HttpError(409, 'Vous ne participez pas à cet événement');
  if (isOrganizer(event, req.user)) {
    throw new HttpError(409, "Un organisateur ne peut pas quitter l'événement : retirez d'abord son rôle");
  }
  event.participants = event.participants.filter((p) => String(p) !== String(req.user._id));
  await event.save();
  res.status(204).end();
}));

router.post('/:id/participants', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  const ids = await existingUserIds(req.body?.userIds);
  if (ids.length === 0) throw new HttpError(400, 'userIds est requis');
  event.participants.push(...ids);
  await event.save();
  res.status(201).json(event);
}));

router.delete('/:id/participants/:userId', validIds('id', 'userId'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  const { userId } = req.params;
  if (has(event.organizers, userId)) throw new HttpError(409, "Retirez d'abord son rôle d'organisateur");
  if (!has(event.participants, userId)) throw new HttpError(404, 'Participant introuvable');
  event.participants = event.participants.filter((p) => String(p) !== userId);
  await event.save();
  res.status(204).end();
}));

router.post('/:id/organizers', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  const [userId] = await existingUserIds([req.body?.userId]);
  if (has(event.organizers, userId)) throw new HttpError(409, 'Déjà organisateur');
  event.organizers.push(userId);
  await event.save();
  res.status(201).json(event);
}));

router.delete('/:id/organizers/:userId', validIds('id', 'userId'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  const { userId } = req.params;
  if (!has(event.organizers, userId)) throw new HttpError(404, 'Organisateur introuvable');
  if (event.organizers.length === 1) throw new HttpError(409, 'Un événement doit avoir au moins un organisateur');
  event.organizers = event.organizers.filter((o) => String(o) !== userId);
  await event.save();
  res.status(204).end();
}));

// ---- Partage sur les réseaux sociaux (événements d'un groupe public uniquement) ----
router.post('/:id/share', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  const group = event.group ? await Group.findById(event.group) : null;
  if (!group || group.type !== 'public' || event.visibility !== 'public') {
    throw new HttpError(403, "Le partage n'est possible que pour un événement public d'un groupe public");
  }
  const base = `${req.protocol}://${req.get('host')}/events/${event.id}`;
  const url = encodeURIComponent(base);
  const title = encodeURIComponent(event.name);
  res.json({
    url: base,
    links: {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      twitter: `https://twitter.com/intent/tweet?url=${url}&text=${title}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`
    }
  });
}));

router.get('/:id/thread', validIds('id'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.id);
  assertCanViewEvent(event, req.user);
  if (!isParticipant(event, req.user)) throw new HttpError(403, "Réservé aux participants de l'événement");
  const thread = await Thread.findOne({ event: event._id });
  if (!thread) throw new HttpError(404, 'Fil de discussion introuvable');
  res.json(thread);
}));

export default router;
