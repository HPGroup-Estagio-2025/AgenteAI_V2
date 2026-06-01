import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { findNews, findNewsByUrl, insertNews, updateNews } from '@/src/lib/db';

export async function POST(request, { params }) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  let user;
  try { user = verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  let item = await findNews(id);

  if (!item) {
    // Artigo vem do localStorage — inserir no Supabase antes de guardar
    const articleData = body.article;
    if (!articleData?.title) {
      return NextResponse.json({ error: 'Notícia não encontrada' }, { status: 404 });
    }
    const newItem = {
      id,
      title: String(articleData.title).slice(0, 300),
      content: articleData.content || null,
      url: articleData.url || null,
      source: articleData.source || 'RSS',
      category: articleData.category || null,
      imageUrl: articleData.imageUrl || null,
      publishedAt: articleData.publishedAt || new Date().toISOString(),
      status: 'pending',
      receivedAt: articleData.receivedAt || new Date().toISOString(),
      processedAt: null,
      processedBy: null,
      rejectReason: null,
    };
    try {
      await insertNews(newItem);
      item = newItem;
    } catch (err) {
      if (err.code === 'duplicate') {
        // Article already in Supabase under a different UUID — find it by URL
        const existing = articleData.url ? await findNewsByUrl(articleData.url) : null;
        if (existing) {
          item = existing;
        } else {
          console.error('[save] Artigo duplicado sem URL correspondente:', err.message);
          return NextResponse.json({ error: 'Notícia já existe na base de dados' }, { status: 409 });
        }
      } else {
        console.error('[save] Erro ao inserir artigo:', err.message, err.details || '');
        return NextResponse.json({ error: `Erro ao guardar a notícia: ${err.message}` }, { status: 500 });
      }
    }
  }

  try {
    const targetId = item.id;
    const updated = await updateNews(targetId, {
      status: 'on_hold',
      processedAt: new Date().toISOString(),
      processedBy: user.username,
    });
    console.log(`[ação] Notícia guardada (on_hold): ${targetId} por ${user.username}`);
    return NextResponse.json({ success: true, news: updated });
  } catch (err) {
    console.error('[save] Erro ao atualizar estado:', err.message, err.details || '');
    return NextResponse.json({ error: `Erro ao atualizar notícia: ${err.message}` }, { status: 500 });
  }
}
