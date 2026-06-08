import { NextResponse } from 'next/server';
import otplib from 'otplib';
const { authenticator } = otplib;
import QRCode from 'qrcode';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';

export async function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  try { verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido' }, { status: 403 });
  }

  const secret = process.env.TOTP_SECRET;
  if (!secret) return NextResponse.json({ error: 'TOTP_SECRET não configurado' }, { status: 500 });

  const appName = 'Publixy';
  const username = process.env.ADMIN_USERNAME || 'admin';
  const otpauth = authenticator.keyuri(username, appName, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  return NextResponse.json({ qrDataUrl, secret, otpauth });
}
