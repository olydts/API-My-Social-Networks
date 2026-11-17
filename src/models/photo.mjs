import mongoose from 'mongoose';
import { createSchema, objectId, urlValidator } from '../utils/schema.mjs';

const albumSchema = createSchema({
  event: objectId('Event', { required: true, index: true }),
  title: { type: String, required: [true, 'Le titre est requis'], trim: true, minlength: 1, maxlength: 100 },
  createdBy: objectId('User', { required: true })
});

const photoSchema = createSchema({
  album: objectId('Album', { required: true, index: true }),
  event: objectId('Event', { required: true }),
  postedBy: objectId('User', { required: true }),
  url: {
    type: String,
    required: [true, "L'URL de la photo est requise"],
    validate: urlValidator
  },
  caption: { type: String, trim: true, maxlength: 300, default: '' }
});

const photoCommentSchema = createSchema({
  photo: objectId('Photo', { required: true, index: true }),
  author: objectId('User', { required: true }),
  content: { type: String, required: [true, 'Le commentaire est requis'], trim: true, minlength: 1, maxlength: 1000 }
});

export const Album = mongoose.model('Album', albumSchema);
export const Photo = mongoose.model('Photo', photoSchema);
export const PhotoComment = mongoose.model('PhotoComment', photoCommentSchema);
