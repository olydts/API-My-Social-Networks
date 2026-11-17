import Event from '../models/event.mjs';
import Group from '../models/group.mjs';
import User from '../models/user.mjs';
import { HttpError, isObjectId } from '../utils/http.mjs';

export const has = (list, userId) => list.some((item) => String(item) === String(userId));

export const loadEvent = async (id) => {
  const event = await Event.findById(id);
  if (!event) throw new HttpError(404, 'Événement introuvable');
  return event;
};

export const loadGroup = async (id) => {
  const group = await Group.findById(id);
  if (!group) throw new HttpError(404, 'Groupe introuvable');
  return group;
};

export const isOrganizer = (event, user) => has(event.organizers, user._id);
export const isParticipant = (event, user) => has(event.participants, user._id);

// Un événement privé est invisible (404) pour ceux qui n'y sont pas invités
export const canViewEvent = (event, user) => event.visibility === 'public'
  || (user && (isOrganizer(event, user) || isParticipant(event, user)));

export const assertCanViewEvent = (event, user) => {
  if (!canViewEvent(event, user)) throw new HttpError(404, 'Événement introuvable');
};

export const assertOrganizer = (event, user) => {
  if (!isOrganizer(event, user)) throw new HttpError(403, "Réservé aux organisateurs de l'événement");
};

export const assertParticipant = (event, user) => {
  if (!isParticipant(event, user)) throw new HttpError(403, "Réservé aux participants de l'événement");
};

export const isMember = (group, user) => has(group.members, user._id);
export const isGroupAdmin = (group, user) => has(group.admins, user._id);

// Un groupe secret n'existe pas pour les non-membres
export const assertCanSeeGroup = (group, user) => {
  if (group.type === 'secret' && !isMember(group, user)) {
    throw new HttpError(404, 'Groupe introuvable');
  }
};

// Contenu du groupe (fil, événements) : public => tout le monde, sinon membres uniquement
export const assertCanReadGroupContent = (group, user) => {
  assertCanSeeGroup(group, user);
  if (group.type !== 'public' && !isMember(group, user)) {
    throw new HttpError(403, 'Réservé aux membres du groupe');
  }
};

export const assertGroupAdmin = (group, user) => {
  if (!isGroupAdmin(group, user)) throw new HttpError(403, 'Réservé aux administrateurs du groupe');
};

// Valide une liste d'identifiants d'utilisateurs existants
export const existingUserIds = async (ids) => {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every(isObjectId)) {
    throw new HttpError(400, "Liste d'identifiants d'utilisateurs invalide");
  }
  const uniqueIds = [...new Set(ids)];
  const found = await User.countDocuments({ _id: { $in: uniqueIds } });
  if (found !== uniqueIds.length) throw new HttpError(400, 'Un ou plusieurs utilisateurs sont introuvables');
  return uniqueIds;
};
