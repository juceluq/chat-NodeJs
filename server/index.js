import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { setupSocket } from './sockets.js';
import { createClient } from '@supabase/supabase-js';

dotenv.config();
const port = process.env.PORT ?? 3000;
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

io.on('connection', async (socket) => {
  console.log('A user connected:', socket.id);
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

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });

  socket.on('chat message', async ({ message, senderId }) => {
    try {
      const { error } = await supabase
        .from('messages')
        .insert([{ content: message, sender_id: senderId }]);
      if (error) {
        console.error('Supabase insert error:', error.message);
      }
    } catch (err) {
      console.error('Unexpected error inserting message:', err);
    }
  });
});

app.use(logger('dev'));
app.use(express.static('client'));

setupSocket(io);

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
