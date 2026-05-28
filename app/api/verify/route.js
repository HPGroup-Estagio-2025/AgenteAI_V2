import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';

export function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  try {
    const payload = verifyToken(token);
    return NextResponse.json({ valid: true, username: payload.username });
  } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }
}
