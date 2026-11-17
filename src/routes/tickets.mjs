
import { TicketType, Ticket } from '../models/ticket.mjs';
import { authRouter } from '../middlewares/auth.mjs';
import {
  asyncHandler, HttpError, pick, validIds, isObjectId, listPage, withSearch
} from '../utils/http.mjs';
import { loadEvent, assertCanViewEvent, assertOrganizer } from '../services/access.mjs';

// La consultation des types de billets et l'achat sont publics (voir events.mjs).
// Ici : la gestion de la billetterie par les organisateurs.
const router = authRouter();

router.post('/events/:eventId/ticket-types', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.eventId);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  if (event.visibility !== 'public' || !event.ticketingEnabled) {
    throw new HttpError(409, "La billetterie doit être activée sur un événement public (ticketingEnabled: true)");
  }
  const type = await TicketType.create({
    ...pick(req.body, ['name', 'amount', 'quantity']), event: event._id
  });
  res.status(201).json(type);
}));

router.patch('/ticket-types/:typeId', validIds('typeId'), asyncHandler(async (req, res) => {
  const type = await TicketType.findById(req.params.typeId);
  if (!type) throw new HttpError(404, 'Type de billet introuvable');
  const event = await loadEvent(type.event);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  type.set(pick(req.body, ['name', 'amount', 'quantity']));
  if (type.quantity < type.sold) {
    throw new HttpError(409, `La quantité ne peut pas être inférieure aux billets déjà vendus (${type.sold})`);
  }
  await type.save();
  res.json(type);
}));

router.delete('/ticket-types/:typeId', validIds('typeId'), asyncHandler(async (req, res) => {
  const type = await TicketType.findById(req.params.typeId);
  if (!type) throw new HttpError(404, 'Type de billet introuvable');
  const event = await loadEvent(type.event);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  if (type.sold > 0) throw new HttpError(409, 'Des billets ont déjà été vendus pour ce type');
  await type.deleteOne();
  res.status(204).end();
}));

// Liste des billets vendus : organisateurs uniquement (données personnelles)
router.get('/events/:eventId/tickets', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.eventId);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  // Recherche : ?q= (nom, prénom, email, ville) et filtre ?ticketTypeId=
  const filter = { event: event._id };
  if (isObjectId(req.query.ticketTypeId)) filter.ticketType = req.query.ticketTypeId;
  const searched = withSearch(filter, req.query.q, ['firstName', 'lastName', 'email', 'address.city']);
  res.json(await listPage(Ticket, searched, req.query, { purchaseDate: -1 }));
}));

// Un billet : réservé aux organisateurs (données personnelles de l'acheteur)
const loadTicketAsOrganizer = async (id, user) => {
  const ticket = await Ticket.findById(id);
  if (!ticket) throw new HttpError(404, 'Billet introuvable');
  const event = await loadEvent(ticket.event);
  assertCanViewEvent(event, user);
  assertOrganizer(event, user);
  return ticket;
};

router.get('/tickets/:ticketId', validIds('ticketId'), asyncHandler(async (req, res) => {
  res.json(await loadTicketAsOrganizer(req.params.ticketId, req.user));
}));

// Correction des informations de l'acheteur (l'email et le type de billet ne changent pas :
// l'unicité « 1 billet par personne » et le stock en dépendent)
router.patch('/tickets/:ticketId', validIds('ticketId'), asyncHandler(async (req, res) => {
  const ticket = await loadTicketAsOrganizer(req.params.ticketId, req.user);
  const body = req.body || {};
  ticket.set(pick(body, ['firstName', 'lastName']));
  const address = typeof body.address === 'object' && body.address ? body.address : {};
  Object.entries(pick(address, ['street', 'zipCode', 'city', 'country'])).forEach(([key, value]) => {
    ticket.set(`address.${key}`, value);
  });
  await ticket.save();
  res.json(ticket);
}));

// Annulation d'un billet : la place est remise en vente
router.delete('/tickets/:ticketId', validIds('ticketId'), asyncHandler(async (req, res) => {
  const ticket = await loadTicketAsOrganizer(req.params.ticketId, req.user);
  await ticket.deleteOne();
  await TicketType.updateOne({ _id: ticket.ticketType, sold: { $gt: 0 } }, { $inc: { sold: -1 } });
  res.status(204).end();
}));

export default router;
