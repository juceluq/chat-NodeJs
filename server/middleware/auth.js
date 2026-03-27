import jwt from 'jsonwebtoken';

export function requireAuth (req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
}

export function optionalAuth (req, res, next) {
  const token = req.cookies.access_token;
  req.session = { user: null };
  if (token) {
    try {
      const data = jwt.verify(token, process.env.SECRET_JWT_KEY);
      req.session.user = { id: data.id, username: data.username };
    } catch {}
  }
  next();
}
