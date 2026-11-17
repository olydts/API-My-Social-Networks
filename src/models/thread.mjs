import mongoose from 'mongoose';
import { createSchema, objectId } from '../utils/schema.mjs';

// Un fil de discussion est lié à UN groupe OU UN événement, jamais aux deux
const threadSchema = createSchema({
  group: objectId('Group'),
  event: objectId('Event')
});

threadSchema.pre('validate', function exclusiveParent() {
  if (Boolean(this.group) === Boolean(this.event)) {
    this.invalidate('group', 'Un fil de discussion est lié à un groupe ou à un événement, pas aux deux');
  }
});

threadSchema.index({ group: 1 }, { unique: true, sparse: true });
threadSchema.index({ event: 1 }, { unique: true, sparse: true });

const messageSchema = createSchema({
  thread: objectId('Thread', { required: true, index: true }),
  author: objectId('User', { required: true }),
  content: { type: String, required: [true, 'Le contenu est requis'], trim: true, minlength: 1, maxlength: 2000 },
  // Réponse à un autre message du même fil
  parent: objectId('Message', { default: null })
});

export const Thread = mongoose.model('Thread', threadSchema);
export const Message = mongoose.model('Message', messageSchema);
