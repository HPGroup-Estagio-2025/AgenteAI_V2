require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const { getLocalIp } = require('./scripts/local-ip');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || getLocalIp();

// JWT secret: usa variável de ambiente ou gera aleatório (avisa se não definido)
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[AVISO] JWT_SECRET não definido em .env. A usar segredo aleatório (sessões perdem-se ao reiniciar).');
  return crypto.randomBytes(64).toString('hex');
})();

const N8N_PUBLISH_WEBHOOK = process.env.N8N_PUBLISH_WEBHOOK || '';
const N8N_REJECT_WEBHOOK = process.env.N8N_REJECT_WEBHOOK || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();

// Hash da password em startup
let ADMIN_HASH;
if (process.env.ADMIN_PASSWORD_HASH) {
  ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH;
} else {
  const plain = process.env.ADMIN_PASSWORD || 'admin123';
  ADMIN_HASH = bcrypt.hashSync(plain, 12);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('[AVISO] A usar password padrão "admin123". Define ADMIN_PASSWORD em .env!');
  }
}

// Armazenamento em memória (n8n tem a DB)
let newsStore = [];

const VALID_SECTORS = ['maritimo', 'defesa-militar', 'aeroespacial', 'ferroviario'];
const VALID_SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin'];

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function duplicateKey(item) {
  const title = normalizeText(item && item.title);
  return title;
}

function isDuplicateNews(item) {
  const key = duplicateKey(item);
  return newsStore.some(n => n.id === item.id || duplicateKey(n) === key);
}

function dedupeNews(news) {
  const seen = new Set();
  return news.filter(item => {
    const key = duplicateKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Middlewares de segurança ──────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true,
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiadas tentativas de login. Tenta novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
    req.user = payload;
    next();
  });
}

function verifyWebhookSecret(req, res, next) {
  if (!WEBHOOK_SECRET) return next();
  const sig = req.headers['x-webhook-secret'];
  if (!sig || sig !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Webhook não autorizado' });
  }
  next();
}

function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
      crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

async function notifyN8n(url, body) {
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`[n8n] Resposta inesperada: ${res.status}`);
  } catch (err) {
    console.error('[n8n] Falha ao notificar:', err.message);
  }
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

// Login
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username e password são obrigatórios' });
  }

  const userMatch = safeCompare(username.trim().toLowerCase(), ADMIN_USERNAME);
  const passMatch = await bcrypt.compare(password, ADMIN_HASH);

  if (!userMatch || !passMatch) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = jwt.sign(
    { username: ADMIN_USERNAME, role: 'admin' },
    JWT_SECRET,
    { expiresIn: '4h', issuer: 'dashboard-news' }
  );

  res.json({ token, expiresIn: 14400 });
});

// Verificar token
app.get('/api/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, username: req.user.username });
});

// Receber notícia do n8n via POST /api/news (sem autenticação, compatível com n8n)
app.post('/api/news', verifyWebhookSecret, (req, res) => {
  const { id, title, content, source, publishedAt, imageUrl, category } = req.body || {};

  if (!id || !title || !content) {
    return res.status(400).json({ error: 'Campos obrigatórios em falta: id, title, content' });
  }

  const item = {
    id: String(id).substring(0, 100),
    title: String(title).substring(0, 300),
    content: String(content).substring(0, 10000),
    source: source ? String(source).substring(0, 200) : null,
    category: category ? String(category).substring(0, 80) : null,
    imageUrl: imageUrl ? String(imageUrl).substring(0, 500) : null,
    publishedAt: publishedAt || new Date().toISOString(),
    status: 'pending',
    receivedAt: new Date().toISOString(),
    processedAt: null,
    processedBy: null,
  };

  if (isDuplicateNews(item)) {
    return res.status(409).json({ error: 'Notícia já existe' });
  }

  newsStore.unshift(item);
  if (newsStore.length > 500) newsStore = newsStore.slice(0, 500);

  console.log(`[webhook] Nova notícia recebida via /api/news: ${item.id} - ${item.title}`);
  res.status(201).json({ success: true, id: item.id });
});

// Receber notícia do n8n
app.post('/webhook/news', verifyWebhookSecret, (req, res) => {
  const { id, title, content, source, publishedAt, imageUrl, category } = req.body || {};

  if (!id || !title || !content) {
    return res.status(400).json({ error: 'Campos obrigatórios em falta: id, title, content' });
  }

  const item = {
    id: String(id).substring(0, 100),
    title: String(title).substring(0, 300),
    content: String(content).substring(0, 10000),
    source: source ? String(source).substring(0, 200) : null,
    category: category ? String(category).substring(0, 80) : null,
    imageUrl: imageUrl ? String(imageUrl).substring(0, 500) : null,
    publishedAt: publishedAt || new Date().toISOString(),
    status: 'pending',
    receivedAt: new Date().toISOString(),
    processedAt: null,
    processedBy: null,
  };

  if (isDuplicateNews(item)) {
    return res.status(409).json({ error: 'Notícia já existe' });
  }

  newsStore.unshift(item);
  if (newsStore.length > 500) newsStore = newsStore.slice(0, 500);

  console.log(`[webhook] Nova notícia recebida: ${item.id} - ${item.title}`);
  res.status(201).json({ success: true, id: item.id });
});

// Listar notícias
app.get('/api/news', authenticateToken, apiLimiter, (req, res) => {
  const { status, page = '1', limit = '20', search = '', sector = '' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit) || 20));

  let filtered = newsStore;

  if (status && ['pending', 'published', 'rejected'].includes(status)) {
    filtered = filtered.filter(n => n.status === status);
  }

  if (sector && VALID_SECTORS.includes(sector.toLowerCase())) {
    const sectorQ = sector.toLowerCase();
    filtered = filtered.filter(n => n.category && n.category.toLowerCase() === sectorQ);
  }

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(n =>
      n.title.toLowerCase().includes(q) ||
      (n.source && n.source.toLowerCase().includes(q)) ||
      (n.category && n.category.toLowerCase().includes(q))
    );
  }

  filtered = dedupeNews(filtered);
  const total = filtered.length;
  const start = (pageNum - 1) * limitNum;
  const items = filtered.slice(start, start + limitNum);

  const sectorCounts = {};
  VALID_SECTORS.forEach(s => {
    sectorCounts[s] = newsStore.filter(n => n.category && n.category.toLowerCase() === s).length;
  });

  res.json({
    news: items,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    counts: {
      pending: newsStore.filter(n => n.status === 'pending').length,
      published: newsStore.filter(n => n.status === 'published').length,
      rejected: newsStore.filter(n => n.status === 'rejected').length,
    },
    sectorCounts,
  });
});

// Publicar notícia
app.post('/api/news/:id/publish', authenticateToken, apiLimiter, async (req, res) => {
  const item = newsStore.find(n => n.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Notícia não encontrada' });
  if (item.status !== 'pending') return res.status(409).json({ error: 'Notícia já foi processada' });

  item.status = 'published';
  item.processedAt = new Date().toISOString();
  item.processedBy = req.user.username;

  const socialPlatforms = Array.isArray(req.body?.socialPlatforms)
    ? req.body.socialPlatforms.filter(platform => VALID_SOCIAL_PLATFORMS.includes(platform))
    : [];

  await notifyN8n(N8N_PUBLISH_WEBHOOK, {
    action: 'publish',
    newsId: item.id,
    socialPlatforms,
    socialPlatform: socialPlatforms[0] || null,
    news: item,
  });

  console.log(`[ação] Notícia publicada: ${item.id} por ${req.user.username}`);
  res.json({ success: true, news: item });
});

// Rejeitar notícia
app.post('/api/news/:id/reject', authenticateToken, apiLimiter, async (req, res) => {
  const item = newsStore.find(n => n.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Notícia não encontrada' });
  if (item.status !== 'pending') return res.status(409).json({ error: 'Notícia já foi processada' });

  const reason = req.body?.reason ? String(req.body.reason).substring(0, 300) : null;

  item.status = 'rejected';
  item.processedAt = new Date().toISOString();
  item.processedBy = req.user.username;
  item.rejectReason = reason;

  await notifyN8n(N8N_REJECT_WEBHOOK, { action: 'reject', newsId: item.id, reason, news: item });

  console.log(`[ação] Notícia rejeitada: ${item.id} por ${req.user.username}`);
  res.json({ success: true, news: item });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', newsInMemory: newsStore.length, uptime: process.uptime() });
});

app.listen(PORT, HOST, () => {
  console.log(`Servidor ativo em:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Rede:    http://${HOST}:${PORT}`);
});
