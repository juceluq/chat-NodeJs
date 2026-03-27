import bcrypt from 'bcrypt';
import env from 'dotenv';
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
    const result = await users.insertOne({ username, password: hashedPassword });

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
}
