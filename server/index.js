import express from 'express';
import logger from 'morgan';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { UserRepository } from '../user-repository.js';
import { setupSocket, handleConnection } from './sockets.js';
import { supabase } from './supabaseClient.js';

const port = process.env.PORT ?? 3000;
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', handleConnection);

app.set('view engine', 'ejs');
app.set('views', './views');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
  const token = req.cookies.access_token;
  req.session = { user: null };

  if (token) {
    try {
      const data = jwt.verify(token, process.env.SECRET_JWT_KEY);

      req.session.user = {
        id: data.id,
        username: data.username,
      };
    } catch (err) {
      console.error('JWT verification error:', err);
    }
  }

  next();
});

app.get('/', (req, res) => {
  const { user } = req.session;

  const error = req.query.error;
  const success = req.query.success;

  res.render('index', {
    username: user?.username,
    userId: user?.id,
    error,
    success
  });
});


app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await UserRepository.login({ username, password });

    const accessToken = jwt.sign({ id: user.id, username: user.username }, process.env.SECRET_JWT_KEY, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ id: user.id, username: user.username }, process.env.SECRET_JWT_KEY, { expiresIn: '7d' });

    res
      .cookie('access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60,
      })
      .cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      })
      .redirect('/');
  } catch (error) {
    res.redirect('/?error=' + encodeURIComponent(error.message));
  }
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    await UserRepository.create({ username, password });
    res.redirect('/?success=' + encodeURIComponent('Usuario registrado correctamente.'));
  } catch (error) {
    res.redirect('/?error=' + encodeURIComponent(error.message));
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('access_token')
    .clearCookie('refresh_token')
    .redirect('/?success=' + encodeURIComponent('Sesión cerrada correctamente.'));
});

app.post('/refresh-token', (req, res) => {
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) {
    return res.status(401).send('Refresh token missing');
  }

  try {
    const data = jwt.verify(refreshToken, process.env.SECRET_JWT_KEY);
    const newAccessToken = jwt.sign({ id: data.id, username: data.username }, process.env.SECRET_JWT_KEY, { expiresIn: '1h' });

    res
      .cookie('access_token', newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60,
      })
      .json({ accessToken: newAccessToken });
  } catch (err) {
    res.status(403).send('Invalid refresh token');
  }
});

app.get('/api/chat-history', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('id', { ascending: true });
    if (error) {
      throw error;
    }

    res.json(data);
  } catch (err) {
    console.error('Error retrieving chat history:', err);
    res.status(500).json({ error: 'Error retrieving chat history' });
  }
});

setupSocket(io);

app.use((req, res, next) => {
  const errorMessage = 'La URL solicitada no es válida.';
  res.redirect('/?error=' + encodeURIComponent(errorMessage));
});

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
