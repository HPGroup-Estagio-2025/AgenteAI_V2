import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { jwtVerify, SignJWT } from 'jose';
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
    const plain = process.env.ADMIN_PASSWORD || 'admin123';
    g._adminHash = await bcrypt.hash(plain, 12);
  }
  return g._adminHash;
}

export async function GET() {
  return NextResponse.json({ ok: true, route: 'login api working' });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const { username, password, otp, otpToken } = body;

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Username e password são obrigatórios' }, { status: 400 });
  }

  const hash = await getAdminHash();
  const userMatch = username.trim().toLowerCase() === ADMIN_USERNAME;
  const passMatch = await bcrypt.compare(password, hash);

  if (!userMatch || !passMatch) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
  }

  const smtpConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

  // Se SMTP configurado e ainda não foi validado o OTP
  if (smtpConfigured && !otp) {
    return NextResponse.json({ requires2fa: true });
  }

  // Valida OTP se foi enviado
  if (smtpConfigured && otp && otpToken) {
    try {
      const { payload } = await jwtVerify(otpToken, SECRET);
      if (payload.otp !== otp.trim()) {
        return NextResponse.json({ error: 'Código inválido ou expirado.' }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: 'Código inválido ou expirado.' }, { status: 401 });
    }
  }

  const token = signToken({ username: ADMIN_USERNAME, role: 'admin' });
  return NextResponse.json({ token, expiresIn: 14400 });
}
