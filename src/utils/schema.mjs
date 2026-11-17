import mongoose from 'mongoose';
import validator from 'validator';

export const objectId = (ref, extra = {}) => ({
  type: mongoose.Schema.Types.ObjectId,
  ref,
  ...extra
});

// Schéma commun : champ `id` au lieu de `_id`, pas de `__v`, dates de création/modification
export const createSchema = (definition, options = {}) => {
  const schema = new mongoose.Schema(definition, {
    versionKey: false,
    timestamps: true,
    minimize: false,
    ...options
  });

  schema.set('toJSON', {
    transform: (doc, ret) => {
      const out = ret;
      if (out._id !== undefined) {
        out.id = out._id;
        delete out._id;
      }
      return out;
    }
  });

  return schema;
};

export const urlValidator = {
  validator: (value) => !value || validator.isURL(value, {
    protocols: ['http', 'https'],
    require_protocol: true
  }),
  message: 'URL invalide (http ou https obligatoire)'
};

export const atLeastOne = {
  validator: (value) => Array.isArray(value) && value.length >= 1,
  message: 'Au moins un élément est requis'
};

export const unique = (list) => [...new Map(list.map((id) => [String(id), id])).values()];
