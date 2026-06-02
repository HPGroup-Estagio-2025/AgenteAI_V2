import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';

export async function POST(request) {
  const token = getTokenFromRequest(request);
  try { if (!token) throw new Error(); verifyToken(token); } catch {
    return Response.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const body = await request.json();
  const { companyName } = body;

  if (!companyName || typeof companyName !== 'string') {
    return Response.json({ error: 'companyName obrigatório' }, { status: 400 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('pending_company_name', encodeURIComponent(companyName), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 300, // 5 minutos
    path: '/',
  });

  return response;
}
