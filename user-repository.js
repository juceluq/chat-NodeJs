import bcrypt from 'bcrypt';
import env from 'dotenv';
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { Validation } from './validation.js';
import { db } from './server/mongoClient.js';
import { isMailConfigured } from './server/mailer.js';

env.config();
export class UserRepository {
  static async create ({ username, password, email }) {
    Validation.username(username);
    Validation.password(password);
    Validation.email(email);
    await Validation.checkUserExistence(username);
    await Validation.checkEmailExistence(email);

    const saltRounds = parseInt(process.env.SALT_ROUNDS, 10) || 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const emailVerified = !isMailConfigured;
    const verificationToken = isMailConfigured ? randomBytes(32).toString('hex') : null;
    const verificationTokenExpiry = isMailConfigured ? new Date(Date.now() + 24 * 3600 * 1000) : null;

    const users = db.collection('users');
    const result = await users.insertOne({
      username,
      password: hashedPassword,
      email: email.toLowerCase(),
      emailVerified,
      verificationToken,
      verificationTokenExpiry,
      bio: '',
      avatar: null,
      contacts: [],
      createdAt: new Date()
    });

    if (!result.insertedId) {
      throw new Error('Error creating user.');
    }
    return { verificationToken };
  }

  static async verifyEmail (token) {
    const users = db.collection('users');
    const user = await users.findOne({ verificationToken: token });
    if (!user) throw new Error('Token de verificación inválido.');
    if (user.verificationTokenExpiry && new Date() > user.verificationTokenExpiry) {
      throw new Error('El token de verificación ha expirado. Regístrate de nuevo.');
    }
    if (user.emailVerified) return; // Ya verificado (idempotente)
    await users.updateOne({ _id: user._id }, {
      $set: { emailVerified: true }
    });
  }

  static async deleteAccount (id) {
    const users = db.collection('users');
    await users.updateMany({ contacts: id }, { $pull: { contacts: id } });
    await users.deleteOne({ _id: new ObjectId(id) });
    const requests = db.collection('friend_requests');
    await requests.deleteMany({ $or: [{ fromId: id }, { toId: id }] });
  }

  static async login ({ username, password }) {
    Validation.username(username);
    Validation.password(password);

    const users = db.collection('users');
    const user = await users.findOne({ username });

    if (!user) {
      throw new Error('User does not exist.');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new Error('Invalid password.');
    }

    if (user.emailVerified === false) {
      throw new Error('Debes verificar tu email antes de iniciar sesión. Revisa tu bandeja de entrada.');
    }

    const { password: _, _id, ...rest } = user;
    return { id: _id.toString(), ...rest };
  }

  static async findById (id) {
    const users = db.collection('users');
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) return null;
    const { password: _, _id, ...rest } = user;
    return { id: _id.toString(), ...rest };
  }

  static async updateProfile (id, { bio, avatar }) {
    const users = db.collection('users');
    const update = {};
    if (bio !== undefined) update.bio = bio;
    if (avatar !== undefined) update.avatar = avatar;
    await users.updateOne({ _id: new ObjectId(id) }, { $set: update });
  }

  static async changePassword (id, { currentPassword, newPassword }) {
    Validation.password(newPassword);
    const users = db.collection('users');
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) throw new Error('User not found.');
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) throw new Error('Current password is incorrect.');
    const saltRounds = parseInt(process.env.SALT_ROUNDS, 10) || 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await users.updateOne({ _id: new ObjectId(id) }, { $set: { password: hashedPassword } });
  }

  static async searchUsers (query, excludeId) {
    const users = db.collection('users');
    const results = await users.find({
      username: { $regex: query, $options: 'i' },
      _id: { $ne: new ObjectId(excludeId) }
    }, { projection: { password: 0 } }).limit(20).toArray();
    return results.map(u => ({ id: u._id.toString(), username: u.username, avatar: u.avatar ?? null, bio: u.bio ?? '' }));
  }
}
