import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import env from 'dotenv';
import { Validation } from './validation.js';
import { supabase } from './server/supabaseClient.js';

env.config();
export class UserRepository {
  static async create({ username, password }) {
    Validation.username(username);
    Validation.password(password);
    await Validation.checkUserExistence(username);
    const saltRounds = parseInt(process.env.SALT_ROUNDS, 10) || 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          username,
          password: hashedPassword
        }
      ]);

    if (error) {
      console.error('Error creating user:', error.message);
      throw new Error('Error creating user.');
    }
    return true;
  };

  static async login({ username, password }) {
    Validation.username(username);
    Validation.password(password);

    const { data: user, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();
    if (!user) {
      throw new Error('User does not exist.');
    }


    if (findError) {
      console.error('Error fetching user:', findError.message);
      throw new Error('Error fetching user.');
    }

    if (!user) {
      throw new Error('User does not exist.');
    }
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new Error('Invalid password.');
    }

    const { password: _, ...publicUser } = user;
    return publicUser;
  }

}