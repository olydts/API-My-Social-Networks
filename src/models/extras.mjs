import mongoose from 'mongoose';
import { createSchema, objectId } from '../utils/schema.mjs';

// ---- BONUS : shopping list ----
const shoppingItemSchema = createSchema({
  event: objectId('Event', { required: true, index: true }),
  user: objectId('User', { required: true }),
  name: { type: String, required: [true, 'Le nom est requis'], trim: true, minlength: 1, maxlength: 100 },
  // Clé normalisée pour garantir l'unicité (insensible à la casse)
  nameKey: { type: String, select: false },
  quantity: {
    type: Number,
    required: [true, 'La quantité est requise'],
    min: [1, 'La quantité doit être supérieure ou égale à 1'],
    validate: { validator: Number.isInteger, message: 'La quantité doit être un entier' }
  },
  arrivalTime: { type: Date, required: [true, "L'heure d'arrivée est requise"] }
});

shoppingItemSchema.pre('validate', function setKey() {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});
// Chaque chose apportée doit être unique par événement
shoppingItemSchema.index({ event: 1, nameKey: 1 }, { unique: true });

// ---- BONUS : covoiturage ----
const carpoolSchema = createSchema({
  event: objectId('Event', { required: true, index: true }),
  driver: objectId('User', { required: true }),
  departureLocation: { type: String, required: [true, 'Le lieu de départ est requis'], trim: true, maxlength: 200 },
  departureTime: { type: Date, required: [true, "L'heure de départ est requise"] },
  price: { type: Number, required: [true, 'Le prix est requis'], min: [0, 'Le prix ne peut pas être négatif'] },
  seats: {
    type: Number,
    required: [true, 'Le nombre de places est requis'],
    min: [1, 'Au moins 1 place'],
    max: 8,
    validate: { validator: Number.isInteger, message: 'Le nombre de places doit être un entier' }
  },
  // Écart maximal accepté en minutes (ex. trajet de 2h30 + 30 min => 3h max)
  maxDelayMinutes: { type: Number, required: [true, "Le temps maximum d'écart est requis"], min: 0, max: 600 },
  passengers: { type: [objectId('User')], default: [] }
});

export const ShoppingItem = mongoose.model('ShoppingItem', shoppingItemSchema);
export const Carpool = mongoose.model('Carpool', carpoolSchema);
