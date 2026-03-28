import { Router } from 'express';
import { ObjectId } from 'mongodb';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { db } from '../mongoClient.js';
import { requireAuth } from '../middleware/auth.js';
import { getIO } from '../io.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'
];

const mediaStorage = multer.diskStorage({
  destination: join(__dirname, '../../public/uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const uploadMedia = multer({
  storage: mediaStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido.'));
  }
});

const router = Router();

// Listar chats del usuario (directos + grupales)
router.get('/', requireAuth, async (req, res) => {
  try {
    const chats = db.collection('chats');
    const myId = req.session.user.id;
    const chatList = await chats.find({ members: myId }).sort({ updatedAt: -1 }).toArray();

    // Enriquecer con datos del otro usuario para chats directos
    const users = db.collection('users');
    const enriched = await Promise.all(chatList.map(async (chat) => {
      if (chat.type === 'direct') {
        const otherId = chat.members.find(m => m !== myId);
        const other = await users.findOne(
          { _id: new ObjectId(otherId) },
          { projection: { password: 0 } }
        );
        return {
          ...chat,
          id: chat._id.toString(),
          otherUser: other ? { id: otherId, username: other.username, avatar: other.avatar ?? null } : null
        };
      }
      return { ...chat, id: chat._id.toString() };
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching chats.' });
  }
});

// Obtener o crear chat directo con alguien
router.post('/direct/:targetId', requireAuth, async (req, res) => {
  const { targetId } = req.params;
  const myId = req.session.user.id;
  if (targetId === myId) return res.status(400).json({ error: 'Cannot chat with yourself.' });
  try {
    const chats = db.collection('chats');
    const members = [myId, targetId].sort();
    let chat = await chats.findOne({ type: 'direct', members: { $all: members, $size: 2 } });
    let isNew = false;
    if (!chat) {
      isNew = true;
      const result = await chats.insertOne({
        type: 'direct',
        members,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessage: null
      });
      chat = await chats.findOne({ _id: result.insertedId });
    }
    const chatId = chat._id.toString();
    // Enriquecer con datos del otro usuario
    const users = db.collection('users');
    const other = await users.findOne({ _id: new ObjectId(targetId) }, { projection: { password: 0 } });
    const enriched = {
      ...chat,
      id: chatId,
      otherUser: other ? { id: targetId, username: other.username, avatar: other.avatar ?? null } : null
    };
    // Si el chat es nuevo, notificar al otro usuario para que su socket se una a la sala
    if (isNew) {
      const io = getIO();
      if (io) io.to(`user:${targetId}`).emit('chat:new', { chatId });
    }
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creating direct chat.' });
  }
});

// Crear chat grupal
router.post('/group', requireAuth, async (req, res) => {
  const { name, memberIds } = req.body;
  const myId = req.session.user.id;
  if (!name || typeof name !== 'string' || name.trim().length < 1) {
    return res.status(400).json({ error: 'Group name is required.' });
  }
  if (!Array.isArray(memberIds) || memberIds.length < 1) {
    return res.status(400).json({ error: 'At least one member required.' });
  }
  try {
    const allMembers = [...new Set([myId, ...memberIds])];
    const chats = db.collection('chats');
    const result = await chats.insertOne({
      type: 'group',
      name: name.trim(),
      members: allMembers,
      admins: [myId],
      avatar: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessage: null
    });
    const chat = await chats.findOne({ _id: result.insertedId });
    res.json({ ...chat, id: chat._id.toString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creating group chat.' });
  }
});

// Obtener mensajes de un chat
router.get('/:chatId/messages', requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const myId = req.session.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before;
  try {
    const chats = db.collection('chats');
    const chat = await chats.findOne({ _id: new ObjectId(chatId) });
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    if (!chat.members.includes(myId)) return res.status(403).json({ error: 'Forbidden.' });

    const messages = db.collection('messages');
    const filter = { chatId };
    if (before) filter._id = { $lt: new ObjectId(before) };
    const msgList = await messages.find(filter).sort({ _id: -1 }).limit(limit).toArray();
    res.json(msgList.reverse().map(m => ({ ...m, id: m._id.toString() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching messages.' });
  }
});

// Añadir miembro a grupo (solo admins)
router.post('/:chatId/members', requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;
  const myId = req.session.user.id;
  try {
    const chats = db.collection('chats');
    const chat = await chats.findOne({ _id: new ObjectId(chatId) });
    if (!chat || chat.type !== 'group') return res.status(404).json({ error: 'Group not found.' });
    if (!chat.admins.includes(myId)) return res.status(403).json({ error: 'Only admins can add members.' });
    await chats.updateOne({ _id: new ObjectId(chatId) }, { $addToSet: { members: userId } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error adding member.' });
  }
});

// Salir de un chat/grupo
router.delete('/:chatId/leave', requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const myId = req.session.user.id;
  try {
    const chats = db.collection('chats');
    await chats.updateOne({ _id: new ObjectId(chatId) }, { $pull: { members: myId, admins: myId } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error leaving chat.' });
  }
});

// Subir archivo multimedia y enviarlo como mensaje
router.post('/:chatId/media', requireAuth, uploadMedia.single('file'), async (req, res) => {
  const { chatId } = req.params;
  const myId = req.session.user.id;
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
  try {
    const chats = db.collection('chats');
    const chat = await chats.findOne({ _id: new ObjectId(chatId) });
    if (!chat) return res.status(404).json({ error: 'Chat not found.' });
    if (!chat.members.includes(myId)) return res.status(403).json({ error: 'Forbidden.' });

    const fileUrl = `/uploads/${req.file.filename}`;
    const mediaType = req.file.mimetype.split('/')[0]; // 'image' | 'video' | 'audio'

    const messages = db.collection('messages');
    const users = db.collection('users');
    const sender = await users.findOne({ _id: new ObjectId(myId) }, { projection: { password: 0 } });

    const msg = {
      chatId,
      content: req.body.caption?.trim() || '',
      mediaUrl: fileUrl,
      mediaType,
      mediaMime: req.file.mimetype,
      senderId: myId,
      senderUsername: sender?.username ?? 'Unknown',
      senderAvatar: sender?.avatar ?? null,
      createdAt: new Date(),
      readBy: [myId]
    };
    const result = await messages.insertOne(msg);
    const savedMsg = { ...msg, id: result.insertedId.toString() };

    const lastContent = mediaType === 'image' ? '📷 Imagen' : mediaType === 'video' ? '🎥 Vídeo' : '🎵 Audio';
    await chats.updateOne(
      { _id: new ObjectId(chatId) },
      { $set: { updatedAt: new Date(), lastMessage: { content: lastContent, senderId: myId, senderUsername: sender?.username, createdAt: new Date() } } }
    );

    const io = getIO();
    if (io) io.to(chatId).emit('message:new', savedMsg);

    res.json(savedMsg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar el archivo.' });
  }
});

export default router;
