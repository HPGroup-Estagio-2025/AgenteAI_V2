import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { findNews, updateNews } from '@/src/lib/db';

const N8N_REJECT_WEBHOOK = process.env.N8N_REJECT_WEBHOOK || '';

async function notifyN8n(url, body) {
  if (!url) return;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!res.ok) console.error(`[n8n] Resposta inesperada: ${res.status}`);
  } catch (err) { console.error('[n8n] Falha ao notificar:', err.message); }
}

export async function POST(request, { params }) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  let user;
  try { user = verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  const { id } = await params;
  const item = await findNews(id);
  if (!item) return NextResponse.json({ error: 'Notícia não encontrada' }, { status: 404 });
  if (item.status !== 'pending') return NextResponse.json({ error: 'Notícia já foi processada' }, { status: 409 });

  const body = await request.json().catch(() => ({}));
  const reason = body?.reason ? String(body.reason).substring(0, 300) : null;

  try {
    const updated = await updateNews(id, { status: 'rejected', processedAt: new Date().toISOString(), processedBy: user.username, rejectReason: reason });
    await notifyN8n(N8N_REJECT_WEBHOOK, { action: 'reject', newsId: id, reason, news: updated });
    console.log(`[ação] Notícia rejeitada: ${id} por ${user.username}`);
    return NextResponse.json({ success: true, news: updated });
  } catch (err) {
    console.error('[db] Erro ao rejeitar:', err.message);
    return NextResponse.json({ error: 'Erro ao rejeitar notícia' }, { status: 500 });
  }
}
