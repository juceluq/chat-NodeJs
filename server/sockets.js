import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { db } from './mongoClient.js';
import { setIO } from './io.js';

// Map: userId -> Set<socketId>
const onlineUsers = new Map();

// Parsea la cabecera Cookie del handshake (funciona aunque la cookie sea httpOnly)
function parseCookieHeader (cookieStr = '') {
  const result = {};
  cookieStr.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx < 0) return;
    result[c.slice(0, idx).trim()] = decodeURIComponent(c.slice(idx + 1).trim());
  });
  return result;
}

function getUserIdFromSocket (socket) {
  try {
    // Primero intenta auth.token (para clientes que lo manden explícitamente)
    // Si no, lee la cookie del header del handshake (funciona con httpOnly)
    const cookies = parseCookieHeader(socket.handshake.headers.cookie);
    const token = socket.handshake.auth?.token || cookies.access_token;
    if (!token) return null;
    const data = jwt.verify(token, process.env.SECRET_JWT_KEY);
    return data.id;
  } catch {
    return null;
  }
}

export function setupSocket (io) {
  setIO(io);

  io.on('connection', async (socket) => {
    const userId = getUserIdFromSocket(socket);
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    // Registrar online
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socket.userId = userId;

    // Sala personal para recibir notificaciones dirigidas
    socket.join(`user:${userId}`);

    // Unir al socket a todas las salas de chat del usuario
    const chats = db.collection('chats');
    const userChats = await chats.find({ members: userId }).toArray();
    userChats.forEach(chat => socket.join(chat._id.toString()));

    // Enviar al cliente recién conectado qué usuarios están online ahora mismo
    socket.emit('user:online:init', [...onlineUsers.keys()]);

    // Notificar al resto que este usuario está online
    socket.broadcast.emit('user:online', { userId });

    // --- Enviar mensaje ---
    socket.on('message:send', async ({ chatId, content }) => {
      if (!chatId || !content?.trim()) return;
      try {
        const chat = await chats.findOne({ _id: new ObjectId(chatId) });
        if (!chat || !chat.members.includes(userId)) return;

        const messages = db.collection('messages');
        const users = db.collection('users');
        const sender = await users.findOne({ _id: new ObjectId(userId) }, { projection: { password: 0 } });

        const msg = {
          chatId,
          content: content.trim(),
          senderId: userId,
          senderUsername: sender?.username ?? 'Unknown',
          senderAvatar: sender?.avatar ?? null,
          createdAt: new Date(),
          readBy: [userId]
        };
        const result = await messages.insertOne(msg);
        const savedMsg = { ...msg, id: result.insertedId.toString() };

        // Actualizar lastMessage del chat
        await chats.updateOne(
          { _id: new ObjectId(chatId) },
          { $set: { updatedAt: new Date(), lastMessage: { content: content.trim(), senderId: userId, senderUsername: sender?.username, createdAt: new Date() } } }
        );

        io.to(chatId).emit('message:new', savedMsg);
      } catch (err) {
        console.error('Error sending message:', err);
      }
    });

    // --- Marcar como leído ---
    socket.on('message:read', async ({ chatId }) => {
      if (!chatId) return;
      try {
        const messages = db.collection('messages');
        await messages.updateMany(
          { chatId, readBy: { $ne: userId } },
          { $addToSet: { readBy: userId } }
        );
        io.to(chatId).emit('message:read', { chatId, userId });
      } catch (err) {
        console.error('Error marking messages as read:', err);
      }
    });

    // --- Typing indicators ---
    socket.on('typing:start', ({ chatId }) => {
      socket.to(chatId).emit('typing:start', { chatId, userId, username: socket.username });
    });

    socket.on('typing:stop', ({ chatId }) => {
      socket.to(chatId).emit('typing:stop', { chatId, userId });
    });

    // --- Editar mensaje ---
    socket.on('message:edit', async ({ msgId, content }) => {
      if (!msgId || !content?.trim()) return;
      try {
        const messages = db.collection('messages');
        const msg = await messages.findOne({ _id: new ObjectId(msgId) });
        if (!msg || msg.senderId !== userId || msg.deleted) return;
        const newContent = content.trim();
        await messages.updateOne(
          { _id: new ObjectId(msgId) },
          { $set: { content: newContent, editedAt: new Date() } }
        );
        io.to(msg.chatId).emit('message:edited', { msgId, content: newContent });
      } catch (err) {
        console.error('Error editing message:', err);
      }
    });

    // --- Eliminar mensaje ---
    socket.on('message:delete', async ({ msgId }) => {
      if (!msgId) return;
      try {
        const messages = db.collection('messages');
        const msg = await messages.findOne({ _id: new ObjectId(msgId) });
        if (!msg || msg.senderId !== userId) return;
        await messages.updateOne(
          { _id: new ObjectId(msgId) },
          { $set: { deleted: true, content: null, editedAt: null } }
        );
        io.to(msg.chatId).emit('message:deleted', { msgId });
      } catch (err) {
        console.error('Error deleting message:', err);
      }
    });

    // --- Reaccionar a mensaje ---
    socket.on('message:react', async ({ msgId, emoji }) => {
      const ALLOWED = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];
      if (!msgId || !ALLOWED.includes(emoji)) return;
      try {
        const messages = db.collection('messages');
        const msg = await messages.findOne({ _id: new ObjectId(msgId) });
        if (!msg || msg.deleted) return;
        const chat = await chats.findOne({ _id: new ObjectId(msg.chatId) });
        if (!chat || !chat.members.includes(userId)) return;
        const reactions = msg.reactions ?? [];
        const idx = reactions.findIndex(r => r.emoji === emoji && r.userId === userId);
        if (idx >= 0) {
          reactions.splice(idx, 1);
        } else {
          reactions.push({ emoji, userId });
        }
        await messages.updateOne({ _id: new ObjectId(msgId) }, { $set: { reactions } });
        io.to(msg.chatId).emit('message:reaction', { msgId, reactions });
      } catch (err) {
        console.error('Error reacting to message:', err);
      }
    });

    // --- Unirse a un chat nuevo (cuando se crea) ---
    socket.on('chat:join', (chatId) => {
      socket.join(chatId);
    });

    // --- Desconexión ---
    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          io.emit('user:offline', { userId });
        }
      }
    });
  });
}

export function getOnlineUsers () {
  return [...onlineUsers.keys()];
}
