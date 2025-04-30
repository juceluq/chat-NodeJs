import { supabase } from './server/supabaseClient.js';

export class Validation {
  static username(username) {
    if (typeof username !== 'string') {
      throw new Error('Invalid input types. Expected strings.');
    }
    if (username.length < 3 || username.length > 20) {
      throw new Error('Username must be between 3 and 20 characters long.');
    }
  }

  static password(password) {
    if (typeof password !== 'string') {
      throw new Error('Invalid input types. Expected strings.');
    }
    if (password.length < 6 || password.length > 20) {
      throw new Error('Password must be between 6 and 20 characters long.');
    }
  }

  static async checkUserExistence(username) {
    const { data: existingUser, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .maybeSingle();

    if (error) {
      console.error('Error checking user existence:', error.message);
      throw new Error('Error checking user existence.');
    }

    if (existingUser) {
      throw new Error('User already exists.');
    }
  }

}