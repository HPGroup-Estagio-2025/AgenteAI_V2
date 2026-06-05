import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';
import { signToken } from '@/src/lib/auth';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'publixy-secret-key');

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

  // Se SMTP está configurado, exige OTP por email
  const emailOtpEnabled = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  if (emailOtpEnabled) {
    const { otp, otpToken } = body;
    if (!otp || !otpToken) {
      // Primeiro passo: credenciais válidas, pede para enviar OTP
      return NextResponse.json({ requires2fa: true }, { status: 200 });
    }
    // Segundo passo: valida o OTP contra o token assinado
    try {
      const { payload } = await jwtVerify(otpToken, SECRET);
      if (String(payload.otp) !== String(otp).replace(/\s/g, '')) {
        return NextResponse.json({ error: 'Código inválido ou expirado' }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: 'Código inválido ou expirado' }, { status: 401 });
    }
  }

  const token = signToken({ username: ADMIN_USERNAME, role: 'admin' });
  return NextResponse.json({ token, expiresIn: 14400 });
}
