import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { db } from '../mongoClient.js';
import { UserRepository } from '../../user-repository.js';
import { requireAuth } from '../middleware/auth.js';
import { getIO } from '../io.js';

const router = Router();

// Buscar usuarios (incluye estado de solicitud)
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);
  try {
    const myId = req.session.user.id;
    const results = await UserRepository.searchUsers(q.trim(), myId);

    const users = db.collection('users');
    const me = await users.findOne({ _id: new ObjectId(myId) });
    const myContacts = new Set(me?.contacts ?? []);

    const requests = db.collection('friend_requests');
    const pendingOut = await requests.find({ fromId: myId, status: 'pending' }).toArray();
    const pendingIds = new Set(pendingOut.map(r => r.toId));

    res.json(results.map(u => ({
      ...u,
      isContact: myContacts.has(u.id),
      requestPending: pendingIds.has(u.id)
    })));
  } catch {
    res.status(500).json({ error: 'Error searching users.' });
  }
});

// Listar contactos del usuario
router.get('/', requireAuth, async (req, res) => {
  try {
    const users = db.collection('users');
    const me = await users.findOne({ _id: new ObjectId(req.session.user.id) });
    if (!me || !me.contacts?.length) return res.json([]);
    const contactDocs = await users.find(
      { _id: { $in: me.contacts.map(id => new ObjectId(id)) } },
      { projection: { password: 0 } }
    ).toArray();
    res.json(contactDocs.map(u => ({ id: u._id.toString(), username: u.username, avatar: u.avatar ?? null, bio: u.bio ?? '' })));
  } catch {
    res.status(500).json({ error: 'Error fetching contacts.' });
  }
});

// Listar solicitudes pendientes recibidas
router.get('/requests', requireAuth, async (req, res) => {
  try {
    const myId = req.session.user.id;
    const requests = db.collection('friend_requests');
    const pending = await requests.find({ toId: myId, status: 'pending' }).toArray();
    const users = db.collection('users');
    const enriched = await Promise.all(pending.map(async r => {
      const from = await users.findOne({ _id: new ObjectId(r.fromId) }, { projection: { password: 0 } });
      return {
        requestId: r._id.toString(),
        from: from ? { id: r.fromId, username: from.username, avatar: from.avatar ?? null } : null
      };
    }));
    res.json(enriched.filter(r => r.from !== null));
  } catch {
    res.status(500).json({ error: 'Error fetching requests.' });
  }
});

// Enviar solicitud de contacto
router.post('/:targetId', requireAuth, async (req, res) => {
  const { targetId } = req.params;
  const myId = req.session.user.id;
  if (targetId === myId) return res.status(400).json({ error: 'Cannot add yourself.' });
  try {
    const users = db.collection('users');
    const target = await users.findOne({ _id: new ObjectId(targetId) });
    if (!target) return res.status(404).json({ error: 'User not found.' });

    // Ya son contactos
    const me = await users.findOne({ _id: new ObjectId(myId) });
    if (me?.contacts?.includes(targetId)) return res.status(400).json({ error: 'Already a contact.' });

    const requests = db.collection('friend_requests');
    // Evitar duplicar solicitudes pendientes
    const existing = await requests.findOne({ fromId: myId, toId: targetId, status: 'pending' });
    if (existing) return res.status(400).json({ error: 'Request already sent.' });

    const result = await requests.insertOne({
      fromId: myId,
      toId: targetId,
      status: 'pending',
      createdAt: new Date()
    });

    // Notificar en tiempo real al destinatario
    const io = getIO();
    if (io) {
      const sender = await users.findOne({ _id: new ObjectId(myId) }, { projection: { password: 0 } });
      io.to(`user:${targetId}`).emit('contact:request', {
        requestId: result.insertedId.toString(),
        from: { id: myId, username: sender?.username, avatar: sender?.avatar ?? null }
      });
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error sending request.' });
  }
});

// Aceptar solicitud
router.post('/requests/:requestId/accept', requireAuth, async (req, res) => {
  const { requestId } = req.params;
  const myId = req.session.user.id;
  try {
    const requests = db.collection('friend_requests');
    const req_ = await requests.findOne({ _id: new ObjectId(requestId), toId: myId, status: 'pending' });
    if (!req_) return res.status(404).json({ error: 'Request not found.' });

    await requests.updateOne({ _id: new ObjectId(requestId) }, { $set: { status: 'accepted' } });

    const users = db.collection('users');
    // A�adir a contactos en ambos sentidos
    await users.updateOne({ _id: new ObjectId(myId) }, { $addToSet: { contacts: req_.fromId } });
    await users.updateOne({ _id: new ObjectId(req_.fromId) }, { $addToSet: { contacts: myId } });

    // Notificar al que envi� la solicitud
    const io = getIO();
    if (io) {
      const accepter = await users.findOne({ _id: new ObjectId(myId) }, { projection: { password: 0 } });
      io.to(`user:${req_.fromId}`).emit('contact:accepted', {
        user: { id: myId, username: accepter?.username, avatar: accepter?.avatar ?? null }
      });
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error accepting request.' });
  }
});

// Rechazar solicitud
router.post('/requests/:requestId/reject', requireAuth, async (req, res) => {
  const { requestId } = req.params;
  const myId = req.session.user.id;
  try {
    const requests = db.collection('friend_requests');
    const result = await requests.updateOne(
      { _id: new ObjectId(requestId), toId: myId, status: 'pending' },
      { $set: { status: 'rejected' } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Request not found.' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error rejecting request.' });
  }
});

// Eliminar contacto
router.delete('/:targetId', requireAuth, async (req, res) => {
  const { targetId } = req.params;
  const myId = req.session.user.id;
  try {
    const users = db.collection('users');
    await users.updateOne(
      { _id: new ObjectId(myId) },
      { $pull: { contacts: targetId } }
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error removing contact.' });
  }
});

export default router;
