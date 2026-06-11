import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { runNewsAgent } from '@/src/lib/news-agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  let user;
  try {
    user = verifyToken(token);
  } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const seenKeys = Array.isArray(body.seenKeys) ? body.seenKeys : [];

    const result = await runNewsAgent({
      triggerType: 'manual',
      triggeredBy: user.username || 'admin',
      seenKeys,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[news-agent] erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao executar agente', run_id: error.run_id || null },
      { status: 500 }
    );
  }
}
