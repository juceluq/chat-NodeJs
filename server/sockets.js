import { supabase } from './supabaseClient.js';

export function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });

    socket.on('chat message', (msg) => {
      console.log(`Message received: ${msg.message}`);
      socket.broadcast.emit('chat message', msg);
    });
  });
}

export const handleConnection = (socket) => {
  console.log('A user connected:', socket.id);

  const fetchMessages = async () => {
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .order('id', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error.message);
      } else {
        socket.emit('chat history', messages);
      }
    } catch (err) {
      console.error('Unexpected error fetching messages:', err);
    }
  };

  fetchMessages();

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });

  socket.on('chat message', async ({ message, senderId, username }) => {
    try {
      const { error } = await supabase
        .from('messages')
        .insert([{ content: message, sender_id: senderId, sender_username: username }]);

      if (error) {
        console.error('Supabase insert error:', error.message);
      }
    } catch (err) {
      console.error('Unexpected error inserting message:', err);
    }
  });
};