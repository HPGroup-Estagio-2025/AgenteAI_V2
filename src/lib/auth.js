import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const g = globalThis;
if (!g._jwtSecret) {
  if (process.env.JWT_SECRET) {
    g._jwtSecret = process.env.JWT_SECRET;
  } else {
    console.warn('[AVISO] JWT_SECRET não definido. A usar segredo aleatório (sessões perdem-se ao reiniciar).');
    g._jwtSecret = crypto.randomBytes(64).toString('hex');
  }
}
const JWT_SECRET = g._jwtSecret;

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '4h', issuer: 'dashboard-news' });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function getTokenFromRequest(request) {
  const auth = request.headers.get('authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}
