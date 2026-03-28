import 'dotenv/config';
import express from 'express';
import logger from 'morgan';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { UserRepository } from '../user-repository.js';
import { setupSocket } from './sockets.js';
import contactsRouter from './routes/contacts.js';
import chatsRouter from './routes/chats.js';
import profileRouter from './routes/profile.js';
import { isMailConfigured, sendVerificationEmail } from './mailer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const port = process.env.PORT ?? 3000;
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.set('view engine', 'ejs');
app.set('views', join(ROOT, 'views'));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(join(ROOT, 'public')));

// Middleware JWT
app.use((req, res, next) => {
  const token = req.cookies.access_token;
  req.session = { user: null };
  if (token) {
    try {
      const data = jwt.verify(token, process.env.SECRET_JWT_KEY);
      req.session.user = { id: data.id, username: data.username };
    } catch {}
  }
  next();
});

// --- Vistas ---
app.get('/', (req, res) => {
  const { user } = req.session;
  if (user) return res.redirect('/app');
  res.render('auth', {
    error: req.query.error ?? null,
    success: req.query.success ?? null
  });
});

app.get('/app', (req, res) => {
  const { user } = req.session;
  if (!user) return res.redirect('/');
  res.render('app', { username: user.username, userId: user.id });
});

// --- Auth ---
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await UserRepository.login({ username, password });
    const accessToken = jwt.sign({ id: user.id, username: user.username }, process.env.SECRET_JWT_KEY, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ id: user.id, username: user.username }, process.env.SECRET_JWT_KEY, { expiresIn: '7d' });
    res
      .cookie('access_token', accessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 1000 * 60 * 60 })
      .cookie('refresh_token', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 1000 * 60 * 60 * 24 * 7 })
      .redirect('/app');
  } catch (error) {
    res.redirect('/?error=' + encodeURIComponent(error.message));
  }
});

app.post('/register', async (req, res) => {
  const { username, password, email } = req.body;
  try {
    const { verificationToken } = await UserRepository.create({ username, password, email });
    if (isMailConfigured && verificationToken) {
      // Responde inmediatamente sin esperar el email
      res.redirect('/?success=' + encodeURIComponent('Cuenta creada. Revisa tu email para verificar la cuenta.'));
      // Manda el correo en background
      sendVerificationEmail(email, username, verificationToken).catch(async () => {
        // Si falla, auto-verificar para no bloquear al usuario
        await UserRepository.verifyEmail(verificationToken).catch(() => {});
      });
    } else {
      res.redirect('/?success=' + encodeURIComponent('Cuenta creada. ¡Inicia sesión!'));
    }
  } catch (error) {
    res.redirect('/?error=' + encodeURIComponent(error.message));
  }
});

app.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.redirect('/?error=' + encodeURIComponent('Token de verificación inválido.'));
  }
  try {
    await UserRepository.verifyEmail(token);
    res.redirect('/?success=' + encodeURIComponent('¡Email verificado! Ya puedes iniciar sesión.'));
  } catch (err) {
    res.redirect('/?error=' + encodeURIComponent(err.message));
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('access_token').clearCookie('refresh_token').redirect('/');
});

app.post('/refresh-token', (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token missing.' });
  try {
    const data = jwt.verify(refreshToken, process.env.SECRET_JWT_KEY);
    const newAccessToken = jwt.sign({ id: data.id, username: data.username }, process.env.SECRET_JWT_KEY, { expiresIn: '1h' });
    res.cookie('access_token', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 1000 * 60 * 60 })
      .json({ ok: true });
  } catch {
    res.status(403).json({ error: 'Invalid refresh token.' });
  }
});

// --- API Routes ---
app.use('/api/contacts', contactsRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/profile', profileRouter);

// --- Socket.io ---
setupSocket(io);

// --- 404 fallback ---
app.use((_req, res) => {
  res.redirect('/');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
