import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { signToken } from '@/src/lib/auth';

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
const g = globalThis;

async function getAdminHash() {
  if (g._adminHash) return g._adminHash;
  const envHash = process.env.ADMIN_PASSWORD_HASH;
  if (envHash && /^\$2[ab]\$\d+\$/.test(envHash)) {
    g._adminHash = envHash;
  } else {
    if (envHash) console.warn('[AVISO] ADMIN_PASSWORD_HASH inválido (não é bcrypt). A gerar hash de ADMIN_PASSWORD.');
    const plain = process.env.ADMIN_PASSWORD || 'admin123';
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('[AVISO] A usar password padrão "admin123". Define ADMIN_PASSWORD em .env.local!');
    }
    g._adminHash = await bcrypt.hash(plain, 12);
  }
  return g._adminHash;
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'login api working' });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { username, password } = body;

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Username e password são obrigatórios' }, { status: 400 });
  }

  const hash = await getAdminHash();
  const userMatch = username.trim().toLowerCase() === ADMIN_USERNAME;
  const passMatch = await bcrypt.compare(password, hash);

  if (!userMatch || !passMatch) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
  }

  // Se TOTP_SECRET está configurado, exige o código 2FA
  const totpSecret = process.env.TOTP_SECRET;
  if (totpSecret) {
    const { totp } = body;
    if (!totp) {
      // Primeiro passo: credenciais válidas, pede o código 2FA
      return NextResponse.json({ requires2fa: true }, { status: 200 });
    }
    // Segundo passo: valida o código TOTP
    const isValid = authenticator.verify({ token: String(totp).replace(/\s/g, ''), secret: totpSecret });
    if (!isValid) {
      return NextResponse.json({ error: 'Código 2FA inválido ou expirado' }, { status: 401 });
    }
  }

  const token = signToken({ username: ADMIN_USERNAME, role: 'admin' });
  return NextResponse.json({ token, expiresIn: 14400 });
}
