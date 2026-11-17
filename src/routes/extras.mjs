
import { ShoppingItem, Carpool } from '../models/extras.mjs';
import { authRouter } from '../middlewares/auth.mjs';
import {
  asyncHandler, HttpError, pick, validIds, paginate, withSearch
} from '../utils/http.mjs';
import {
  loadEvent, assertCanViewEvent, assertParticipant, isOrganizer, has
} from '../services/access.mjs';

const router = authRouter();

const ITEM_FIELDS = ['name', 'quantity', 'arrivalTime'];
const CARPOOL_FIELDS = ['departureLocation', 'departureTime', 'price', 'seats', 'maxDelayMinutes'];

const participantEvent = async (eventId, user, flag, label) => {
  const event = await loadEvent(eventId);
  assertCanViewEvent(event, user);
  assertParticipant(event, user);
  if (!event[flag]) throw new HttpError(409, `${label} n'est pas activé pour cet événement`);
  return event;
};

// ================= Shopping list (bonus) =================
router.post('/events/:eventId/shopping-items', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await participantEvent(req.params.eventId, req.user, 'shoppingListEnabled', 'La shopping list');
  const item = await ShoppingItem.create({
    ...pick(req.body, ITEM_FIELDS), event: event._id, user: req.user._id
  });
  res.status(201).json(item);
}));

router.get('/events/:eventId/shopping-items', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await participantEvent(req.params.eventId, req.user, 'shoppingListEnabled', 'La shopping list');
  const filter = withSearch({ event: event._id }, req.query.q, ['name']);
  const { page, limit, skip } = paginate(req.query);
  const [items, total] = await Promise.all([
    ShoppingItem.find(filter).sort({ arrivalTime: 1 }).skip(skip).limit(limit),
    ShoppingItem.countDocuments(filter)
  ]);
  res.json({ page, limit, total, items });
}));

router.get('/shopping-items/:itemId', validIds('itemId'), asyncHandler(async (req, res) => {
  const item = await ShoppingItem.findById(req.params.itemId);
  if (!item) throw new HttpError(404, 'Élément introuvable');
  const event = await loadEvent(item.event);
  assertCanViewEvent(event, req.user);
  assertParticipant(event, req.user);
  res.json(item);
}));

router.patch('/shopping-items/:itemId', validIds('itemId'), asyncHandler(async (req, res) => {
  const item = await ShoppingItem.findById(req.params.itemId);
  if (!item) throw new HttpError(404, 'Élément introuvable');
  if (String(item.user) !== String(req.user._id)) throw new HttpError(403, 'Seul son auteur peut le modifier');
  item.set(pick(req.body, ITEM_FIELDS));
  await item.save();
  res.json(item);
}));

router.delete('/shopping-items/:itemId', validIds('itemId'), asyncHandler(async (req, res) => {
  const item = await ShoppingItem.findById(req.params.itemId);
  if (!item) throw new HttpError(404, 'Élément introuvable');
  const event = await loadEvent(item.event);
  if (String(item.user) !== String(req.user._id) && !isOrganizer(event, req.user)) {
    throw new HttpError(403, "Seul l'auteur ou un organisateur peut le supprimer");
  }
  await item.deleteOne();
  res.status(204).end();
}));

// ================= Covoiturage (bonus) =================
router.post('/events/:eventId/carpools', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await participantEvent(req.params.eventId, req.user, 'carpoolEnabled', 'Le covoiturage');
  const carpool = await Carpool.create({
    ...pick(req.body, CARPOOL_FIELDS), event: event._id, driver: req.user._id
  });
  res.status(201).json(carpool);
}));

router.get('/events/:eventId/carpools', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await participantEvent(req.params.eventId, req.user, 'carpoolEnabled', 'Le covoiturage');
  const filter = withSearch({ event: event._id }, req.query.q, ['departureLocation']);
  const { page, limit, skip } = paginate(req.query);
  const [carpools, total] = await Promise.all([
    Carpool.find(filter).sort({ departureTime: 1 }).skip(skip).limit(limit),
    Carpool.countDocuments(filter)
  ]);
  const items = carpools.map((c) => ({ ...c.toJSON(), seatsLeft: c.seats - c.passengers.length }));
  res.json({ page, limit, total, items });
}));

router.get('/carpools/:carpoolId', validIds('carpoolId'), asyncHandler(async (req, res) => {
  const carpool = await Carpool.findById(req.params.carpoolId);
  if (!carpool) throw new HttpError(404, 'Covoiturage introuvable');
  const event = await loadEvent(carpool.event);
  assertCanViewEvent(event, req.user);
  assertParticipant(event, req.user);
  res.json({ ...carpool.toJSON(), seatsLeft: carpool.seats - carpool.passengers.length });
}));

// Modification par le conducteur ; on ne peut pas descendre sous le nombre de passagers déjà inscrits
router.patch('/carpools/:carpoolId', validIds('carpoolId'), asyncHandler(async (req, res) => {
  const carpool = await Carpool.findById(req.params.carpoolId);
  if (!carpool) throw new HttpError(404, 'Covoiturage introuvable');
  const event = await loadEvent(carpool.event);
  assertCanViewEvent(event, req.user);
  if (String(carpool.driver) !== String(req.user._id)) throw new HttpError(403, 'Réservé au conducteur');
  carpool.set(pick(req.body, CARPOOL_FIELDS));
  if (carpool.seats < carpool.passengers.length) {
    throw new HttpError(409, `Il y a déjà ${carpool.passengers.length} passager(s) : nombre de places insuffisant`);
  }
  await carpool.save();
  res.json({ ...carpool.toJSON(), seatsLeft: carpool.seats - carpool.passengers.length });
}));

// Réservation d'une place : mise à jour atomique pour ne jamais dépasser le nombre de places
router.post('/carpools/:carpoolId/join', validIds('carpoolId'), asyncHandler(async (req, res) => {
  const carpool = await Carpool.findById(req.params.carpoolId);
  if (!carpool) throw new HttpError(404, 'Covoiturage introuvable');
  const event = await loadEvent(carpool.event);
  assertCanViewEvent(event, req.user);
  assertParticipant(event, req.user);

  if (String(carpool.driver) === String(req.user._id)) throw new HttpError(409, 'Vous êtes le conducteur');
  if (has(carpool.passengers, req.user._id)) throw new HttpError(409, 'Vous avez déjà une place');

  // « passengers.<seats-1> n'existe pas » <=> il reste au moins une place (condition + ajout atomiques)
  const updated = await Carpool.findOneAndUpdate(
    {
      _id: carpool._id,
      passengers: { $ne: req.user._id },
      [`passengers.${carpool.seats - 1}`]: { $exists: false }
    },
    { $push: { passengers: req.user._id } },
    { new: true }
  );
  if (!updated) throw new HttpError(409, 'Plus de place disponible');
  res.json(updated);
}));

router.post('/carpools/:carpoolId/leave', validIds('carpoolId'), asyncHandler(async (req, res) => {
  const updated = await Carpool.findOneAndUpdate(
    { _id: req.params.carpoolId, passengers: req.user._id },
    { $pull: { passengers: req.user._id } },
    { new: true }
  );
  if (!updated) throw new HttpError(404, "Vous n'avez pas de place dans ce covoiturage");
  res.json(updated);
}));

router.delete('/carpools/:carpoolId', validIds('carpoolId'), asyncHandler(async (req, res) => {
  const carpool = await Carpool.findById(req.params.carpoolId);
  if (!carpool) throw new HttpError(404, 'Covoiturage introuvable');
  if (String(carpool.driver) !== String(req.user._id)) throw new HttpError(403, 'Réservé au conducteur');
  await carpool.deleteOne();
  res.status(204).end();
}));

export default router;
