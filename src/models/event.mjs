import mongoose from 'mongoose';
import {
  createSchema, objectId, urlValidator, atLeastOne, unique
} from '../utils/schema.mjs';

const eventSchema = createSchema({
  name: { type: String, required: [true, 'Le nom est requis'], trim: true, minlength: 2, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  startDate: { type: Date, required: [true, 'La date de début est requise'] },
  endDate: {
    type: Date,
    required: [true, 'La date de fin est requise'],
    validate: {
      validator(value) {
        return !this.startDate || value > this.startDate;
      },
      message: 'La date de fin doit être postérieure à la date de début'
    }
  },
  location: { type: String, required: [true, 'Le lieu est requis'], trim: true, maxlength: 200 },
  coverPhoto: { type: String, validate: urlValidator },
  visibility: {
    type: String,
    enum: { values: ['public', 'private'], message: 'Visibilité invalide (public, private)' },
    default: 'private',
    required: true
  },
  organizers: { type: [objectId('User')], validate: atLeastOne },
  participants: { type: [objectId('User')], default: [] },
  group: objectId('Group', { default: null }),
  // Options d'événement
  ticketingEnabled: {
    type: Boolean,
    default: false,
    validate: {
      validator(value) {
        return !value || this.visibility === 'public';
      },
      message: 'Seul un événement public peut avoir une billetterie'
    }
  },
  shoppingListEnabled: { type: Boolean, default: false },
  carpoolEnabled: { type: Boolean, default: false }
});

// Les organisateurs sont aussi des participants de l'événement
eventSchema.pre('validate', function normalize() {
  this.organizers = unique(this.organizers);
  this.participants = unique([...this.participants, ...this.organizers]);
});

eventSchema.index({ visibility: 1, startDate: 1 });

export default mongoose.model('Event', eventSchema);
