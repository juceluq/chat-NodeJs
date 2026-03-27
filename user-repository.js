import bcrypt from 'bcrypt';
import env from 'dotenv';
import { ObjectId } from 'mongodb';
import { Validation } from './validation.js';
import { db } from './server/mongoClient.js';

env.config();
export class UserRepository {
  static async create ({ username, password }) {
    Validation.username(username);
    Validation.password(password);
    await Validation.checkUserExistence(username);
    const saltRounds = parseInt(process.env.SALT_ROUNDS, 10) || 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const users = db.collection('users');
    const result = await users.insertOne({
      username,
      password: hashedPassword,
      bio: '',
      avatar: null,
      contacts: [],
      createdAt: new Date()
    });

    if (!result.insertedId) {
      throw new Error('Error creating user.');
    }
    return true;
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
