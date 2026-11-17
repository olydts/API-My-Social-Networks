import mongoose from 'mongoose';
import {
  createSchema, objectId, urlValidator, atLeastOne, unique
} from '../utils/schema.mjs';

const groupSchema = createSchema({
  name: { type: String, required: [true, 'Le nom est requis'], trim: true, minlength: 2, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  icon: { type: String, validate: urlValidator },
  coverPhoto: { type: String, validate: urlValidator },
  type: {
    type: String,
    enum: { values: ['public', 'private', 'secret'], message: 'Type invalide (public, private, secret)' },
    required: true,
    default: 'public'
  },
  allowMembersToPost: { type: Boolean, default: true },
  allowMembersToCreateEvents: { type: Boolean, default: false },
  members: { type: [objectId('User')], validate: atLeastOne },
  admins: { type: [objectId('User')], validate: atLeastOne }
});

// Les administrateurs sont toujours membres du groupe
groupSchema.pre('validate', function normalize() {
  this.admins = unique(this.admins);
  this.members = unique([...this.members, ...this.admins]);
});

export default mongoose.model('Group', groupSchema);
