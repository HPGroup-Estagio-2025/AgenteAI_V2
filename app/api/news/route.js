import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { listNews, insertNews, VALID_SECTORS } from '@/src/lib/db';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  try { verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pageNum = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20') || 20));

  try {
    const result = await listNews({
      status: searchParams.get('status') || '',
      sector: searchParams.get('sector') || '',
      search: searchParams.get('search') || '',
      pageNum,
      limitNum,
    });
    return NextResponse.json(
      { ...result, page: pageNum },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    console.error('[db] Erro ao listar notícias:', err.message);
    return NextResponse.json({ error: 'Erro ao carregar notícias' }, { status: 500 });
  }
}

export async function POST(request) {
  if (WEBHOOK_SECRET) {
    const sig = request.headers.get('x-webhook-secret');
    if (!sig || sig !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Webhook não autorizado' }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const { id, title, content, source, publishedAt, imageUrl, category, url } = body;

  if (!id || !title || !content) {
    return NextResponse.json({ error: 'Campos obrigatórios em falta: id, title, content' }, { status: 400 });
  }

  const item = {
    id: String(id).substring(0, 100),
    title: String(title).substring(0, 300),
    content: String(content).substring(0, 10000),
    url: url ? String(url).substring(0, 500) : null,
    source: source ? String(source).substring(0, 200) : null,
    category: category ? String(category).substring(0, 80) : null,
    imageUrl: imageUrl ? String(imageUrl).substring(0, 500) : null,
    publishedAt: publishedAt || new Date().toISOString(),
    status: 'pending',
    receivedAt: new Date().toISOString(),
    processedAt: null,
    processedBy: null,
    rejectReason: null,
  };

  try {
    await insertNews(item);
  } catch (err) {
    if (err.code === 'duplicate') return NextResponse.json({ error: 'Notícia já existe' }, { status: 409 });
    console.error('[db] Erro ao inserir notícia:', err.message);
    return NextResponse.json({ error: 'Erro ao guardar notícia' }, { status: 500 });
  }

  console.log(`[webhook] Nova notícia recebida: ${item.id} - ${item.title}`);
  return NextResponse.json({ success: true, id: item.id }, { status: 201 });
}
