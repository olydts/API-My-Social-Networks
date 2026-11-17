import mongoose from 'mongoose';
import { createSchema, objectId, atLeastOne } from '../utils/schema.mjs';

const optionSchema = createSchema({
  label: { type: String, required: [true, "Le libellé de la réponse est requis"], trim: true, maxlength: 200 }
}, { timestamps: false });

const questionSchema = createSchema({
  label: { type: String, required: [true, 'La question est requise'], trim: true, maxlength: 300 },
  // Plusieurs réponses possibles (au moins 2), une seule pourra être choisie
  options: {
    type: [optionSchema],
    validate: {
      validator: (v) => Array.isArray(v) && v.length >= 2,
      message: 'Une question doit proposer au moins 2 réponses'
    }
  }
}, { timestamps: false });

const pollSchema = createSchema({
  event: objectId('Event', { required: true, index: true }),
  createdBy: objectId('User', { required: true }),
  title: { type: String, required: [true, 'Le titre est requis'], trim: true, maxlength: 200 },
  questions: { type: [questionSchema], validate: atLeastOne }
});

const pollAnswerSchema = createSchema({
  poll: objectId('Poll', { required: true }),
  user: objectId('User', { required: true }),
  answers: [{
    _id: false,
    question: { type: mongoose.Schema.Types.ObjectId, required: true },
    option: { type: mongoose.Schema.Types.ObjectId, required: true }
  }]
});

// Un participant ne répond qu'une fois à un sondage
pollAnswerSchema.index({ poll: 1, user: 1 }, { unique: true });

export const Poll = mongoose.model('Poll', pollSchema);
export const PollAnswer = mongoose.model('PollAnswer', pollAnswerSchema);
