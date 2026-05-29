import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { findNews, insertNews, updateNews } from '@/src/lib/db';
import { getAccount, getAccountById } from '@/src/lib/social';

const N8N_PUBLISH_WEBHOOK = process.env.N8N_PUBLISH_WEBHOOK || '';
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID || '';
const VALID_SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin'];

async function notifyN8n(url, body) {
  if (!url) return;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!res.ok) console.error(`[n8n] Resposta inesperada: ${res.status}`);
  } catch (err) { console.error('[n8n] Falha ao notificar:', err.message); }
}

function getFacebookPage(account) {
  const pages = Array.isArray(account?.pages) ? account.pages : [];
  if (FACEBOOK_PAGE_ID) return pages.find(page => page.id === FACEBOOK_PAGE_ID) || null;
  return pages[0] || null;
}

function buildFacebookMessage(item) {
  const description = item.description || item.summary || item.excerpt || item.content || '';
  return [item.title, description, item.url ? `🔗 Ler notícia completa:\n${item.url}` : '']
    .filter(Boolean).join('\n\n').slice(0, 60000);
}

async function publishToInstagram(item, accountId = null) {
  const account = accountId ? getAccountById(accountId) : getAccount('instagram');
  if (!account) throw Object.assign(new Error('Instagram nao conectado'), { code: 'instagram_not_connected' });
  if (!account.instagramUserId) {
    throw Object.assign(
      new Error('Instagram User ID em falta — reconecta a conta Instagram em Redes Sociais'),
      { code: 'instagram_user_id_missing' }
    );
  }
  if (!item.imageUrl) {
    throw Object.assign(new Error('Instagram requer uma imagem na noticia'), { code: 'instagram_no_image' });
  }
  const caption = buildFacebookMessage(item);

  // Passo 1: criar container de media
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${account.instagramUserId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: item.imageUrl,
        caption,
        access_token: account.accessToken,
      }).toString(),
    }
  );
  const containerData = await containerRes.json().catch(() => ({}));
  if (!containerRes.ok || !containerData.id) {
    throw Object.assign(
      new Error(containerData.error?.message || 'Falha ao criar container Instagram'),
      { code: 'instagram_publish_failed', details: containerData }
    );
  }

  // Passo 2: publicar o container
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${account.instagramUserId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: containerData.id,
        access_token: account.accessToken,
      }).toString(),
    }
  );
  const publishData = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok) {
    throw Object.assign(
      new Error(publishData.error?.message || 'Falha ao publicar no Instagram'),
      { code: 'instagram_publish_failed', details: publishData }
    );
  }
  return { platform: 'instagram', postId: publishData.id };
}

async function publishToFacebook(item, accountId = null) {
  const account = accountId ? getAccountById(accountId) : getAccount('facebook');
  if (!account) throw Object.assign(new Error('Facebook nao conectado'), { code: 'facebook_not_connected' });
  const page = getFacebookPage(account);
  if (!page?.accessToken) {
    throw Object.assign(new Error('Nenhuma Pagina do Facebook disponivel'), { code: 'facebook_page_missing' });
  }
  const body = new URLSearchParams({ access_token: page.accessToken, message: buildFacebookMessage(item) });
  if (item.url) body.set('link', item.url);
  const res = await fetch(`https://graph.facebook.com/v19.0/${page.id}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error?.message || 'Falha ao publicar no Facebook'), {
      code: 'facebook_publish_failed', details: data,
    });
  }
  return { platform: 'facebook', pageId: page.id, pageName: page.name, postId: data.id };
}

export async function POST(request, { params }) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  let user;
  try { user = verifyToken(token); } catch {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  // Tenta encontrar o artigo na base de dados
  let item = await findNews(id);

  if (!item) {
    // Artigo ainda não está no Supabase (vem do localStorage do browser)
    // O frontend envia os dados completos do artigo no body
    const articleData = body.article;
    if (!articleData?.title) {
      return NextResponse.json({ error: 'Notícia não encontrada' }, { status: 404 });
    }

    // Insere o artigo no Supabase antes de publicar
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
      console.error('[db] Erro ao inserir artigo antes de publicar:', err.message);
      return NextResponse.json({ error: 'Erro ao guardar a notícia' }, { status: 500 });
    }
  }

  if (item.status !== 'pending') {
    return NextResponse.json({ error: 'Notícia já foi processada' }, { status: 409 });
  }

  const socialPlatforms = Array.isArray(body.socialPlatforms)
    ? body.socialPlatforms.filter(p => VALID_SOCIAL_PLATFORMS.includes(p))
    : [];
  // Conta específica escolhida pelo admin para cada plataforma: { facebook: 'uuid', ... }
  const selectedAccounts = body.selectedAccounts && typeof body.selectedAccounts === 'object'
    ? body.selectedAccounts : {};

  try {
    const socialResults = [];

    if (socialPlatforms.includes('facebook')) {
      const fbAccountId = selectedAccounts.facebook || null;
      if (!fbAccountId && !getAccount('facebook')) {
        return NextResponse.json({ error: 'Facebook ainda nao esta conectado em Redes Sociais' }, { status: 409 });
      }
      socialResults.push(await publishToFacebook(item, fbAccountId));
    }

    if (socialPlatforms.includes('instagram')) {
      const igAccountId = selectedAccounts.instagram || null;
      if (!igAccountId && !getAccount('instagram')) {
        return NextResponse.json({ error: 'Instagram ainda nao esta conectado em Redes Sociais' }, { status: 409 });
      }
      socialResults.push(await publishToInstagram(item, igAccountId));
    }

    const updated = await updateNews(id, {
      status: 'published',
      processedAt: new Date().toISOString(),
      processedBy: user.username,
    });

    await notifyN8n(N8N_PUBLISH_WEBHOOK, {
      action: 'publish', newsId: id, socialPlatforms,
      socialPlatform: socialPlatforms[0] || null, socialResults, news: updated,
    });

    console.log(`[ação] Notícia publicada: ${id} por ${user.username}`);
    return NextResponse.json({ success: true, news: updated, socialResults });
  } catch (err) {
    if (err.code === 'facebook_page_missing') {
      return NextResponse.json({ error: 'Facebook conectado, mas sem Pagina disponivel para publicar.' }, { status: 409 });
    }
    if (err.code === 'facebook_publish_failed') {
      console.error('[facebook] Erro ao publicar:', err.details || err.message);
      return NextResponse.json({ error: `Erro ao publicar no Facebook: ${err.message}` }, { status: 502 });
    }
    if (err.code === 'instagram_not_connected') {
      return NextResponse.json({ error: 'Instagram ainda nao esta conectado em Redes Sociais.' }, { status: 409 });
    }
    if (err.code === 'instagram_user_id_missing') {
      return NextResponse.json({ error: 'Reconecta a conta Instagram em Redes Sociais para ativar a publicacao.' }, { status: 409 });
    }
    if (err.code === 'instagram_no_image') {
      return NextResponse.json({ error: 'O Instagram requer que a noticia tenha uma imagem para publicar.' }, { status: 422 });
    }
    if (err.code === 'instagram_publish_failed') {
      console.error('[instagram] Erro ao publicar:', err.details || err.message);
      return NextResponse.json({ error: `Erro ao publicar no Instagram: ${err.message}` }, { status: 502 });
    }
    console.error('[db] Erro ao publicar:', err.message);
    return NextResponse.json({ error: 'Erro ao publicar notícia' }, { status: 500 });
  }
}
