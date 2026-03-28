import { Router } from 'express';
import multer from 'multer';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserRepository } from '../../user-repository.js';
import { requireAuth } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

const storage = multer.diskStorage({
  destination: join(__dirname, '../../public/avatars'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only images are allowed.'));
    }
    cb(null, true);
  }
});

// Ver perfil propio
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await UserRepository.findById(req.session.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Error fetching profile.' });
  }
});

// Actualizar bio
router.patch('/bio', requireAuth, async (req, res) => {
  const { bio } = req.body;
  if (typeof bio !== 'string' || bio.length > 200) {
    return res.status(400).json({ error: 'Bio must be a string of max 200 characters.' });
  }
  try {
    await UserRepository.updateProfile(req.session.user.id, { bio });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error updating bio.' });
  }
});

// Subir avatar
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const avatarUrl = `/avatars/${req.file.filename}`;
  try {
    await UserRepository.updateProfile(req.session.user.id, { avatar: avatarUrl });
    res.json({ avatar: avatarUrl });
  } catch {
    res.status(500).json({ error: 'Error saving avatar.' });
  }
});

// Ver perfil de otro usuario
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const user = await UserRepository.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const { contacts: _, ...pub } = user;
    res.json(pub);
  } catch {
    res.status(500).json({ error: 'Error fetching profile.' });
  }
});

// Cambiar contraseña
router.patch('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    await UserRepository.changePassword(req.session.user.id, { currentPassword, newPassword });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar cuenta
router.delete('/', requireAuth, async (req, res) => {
  try {
    await UserRepository.deleteAccount(req.session.user.id);
    res.clearCookie('access_token').clearCookie('refresh_token').json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Error al eliminar la cuenta.' });
  }
});

export default router;
