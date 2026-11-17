import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import validator from 'validator';
import config from '../config.mjs';
import { createSchema } from '../utils/schema.mjs';

const userSchema = createSchema({
  firstName: { type: String, required: [true, 'Le prénom est requis'], trim: true, maxlength: 50 },
  lastName: { type: String, required: [true, 'Le nom est requis'], trim: true, maxlength: 50 },
  email: {
    type: String,
    required: [true, "L'email est requis"],
    unique: true, // deux utilisateurs ne peuvent pas avoir le même email
    lowercase: true,
    trim: true,
    validate: { validator: (v) => validator.isEmail(v), message: 'Email invalide' }
  },
  password: {
    type: String,
    required: [true, 'Le mot de passe est requis'],
    minlength: [8, 'Le mot de passe doit contenir au moins 8 caractères'],
    maxlength: [72, 'Le mot de passe est trop long (72 caractères max)'],
    select: false
  },
  age: { type: Number, min: [13, 'Âge minimum : 13 ans'], max: 120 },
  city: { type: String, trim: true, maxlength: 100 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
});

userSchema.pre('save', async function hashPassword() {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, config.bcryptRounds);
  }
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    const out = ret;
    out.id = out._id;
    delete out._id;
    delete out.password;
    return out;
  }
});

export default mongoose.model('User', userSchema);
