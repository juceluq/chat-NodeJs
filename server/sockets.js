import { db } from './mongoClient.js';

export function setupSocket (io) {
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
      const messages = db.collection('messages');
      const messageList = await messages.find({}).sort({ _id: 1 }).toArray();
      socket.emit('chat history', messageList);
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
      const messages = db.collection('messages');
      await messages.insertOne({ content: message, sender_id: senderId, sender_username: username, created_at: new Date() });
    } catch (err) {
      console.error('Unexpected error inserting message:', err);
    }
  });
};
