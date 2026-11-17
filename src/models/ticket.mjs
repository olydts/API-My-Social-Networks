import mongoose from 'mongoose';
import validator from 'validator';
import { createSchema, objectId } from '../utils/schema.mjs';

const ticketTypeSchema = createSchema({
  event: objectId('Event', { required: true, index: true }),
  name: { type: String, required: [true, 'Le nom est requis'], trim: true, minlength: 1, maxlength: 100 },
  amount: { type: Number, required: [true, 'Le montant est requis'], min: [0, 'Le montant ne peut pas être négatif'] },
  quantity: {
    type: Number,
    required: [true, 'La quantité est requise'],
    min: [1, 'La quantité doit être supérieure ou égale à 1'],
    validate: { validator: Number.isInteger, message: 'La quantité doit être un entier' }
  },
  // Nombre de billets déjà vendus (incrémenté de façon atomique)
  sold: { type: Number, default: 0, min: 0 }
});

ticketTypeSchema.index({ event: 1, name: 1 }, { unique: true });

const required = (label) => [true, `${label} est requis`];

const ticketSchema = createSchema({
  event: objectId('Event', { required: true, index: true }),
  ticketType: objectId('TicketType', { required: true }),
  firstName: { type: String, required: required('Le prénom'), trim: true, maxlength: 50 },
  lastName: { type: String, required: required('Le nom'), trim: true, maxlength: 50 },
  email: {
    type: String,
    required: required("L'email"),
    lowercase: true,
    trim: true,
    validate: { validator: (v) => validator.isEmail(v), message: 'Email invalide' }
  },
  address: {
    street: { type: String, required: required('La rue'), trim: true, maxlength: 200 },
    zipCode: { type: String, required: required('Le code postal'), trim: true, maxlength: 20 },
    city: { type: String, required: required('La ville'), trim: true, maxlength: 100 },
    country: { type: String, required: required('Le pays'), trim: true, maxlength: 100 }
  },
  purchaseDate: { type: Date, default: Date.now }
});

// Une personne extérieure ne peut obtenir qu'un seul billet par événement
ticketSchema.index({ event: 1, email: 1 }, { unique: true });

export const TicketType = mongoose.model('TicketType', ticketTypeSchema);
export const Ticket = mongoose.model('Ticket', ticketSchema);
