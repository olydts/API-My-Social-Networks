// Crée un administrateur : ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed:admin
import mongoose from 'mongoose';
import config from '../src/config.mjs';
import User from '../src/models/user.mjs';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error('ADMIN_EMAIL et ADMIN_PASSWORD sont requis');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);
const user = await User.create({
  firstName: 'Admin', lastName: 'Root', email, password, role: 'admin'
});
console.log(`Administrateur créé : ${user.email}`);
await mongoose.disconnect();
