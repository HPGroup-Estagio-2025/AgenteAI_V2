import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { findNews, updateNews } from '@/src/lib/db';
import { getAccount } from '@/src/lib/social';

const N8N_PUBLISH_WEBHOOK = process.env.N8N_PUBLISH_WEBHOOK || '';
const FACEBOOK_DIRECT_PUBLISH = process.env.FACEBOOK_DIRECT_PUBLISH === 'true';
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
  const description =
    item.description ||
    item.summary ||
    item.excerpt ||
    item.content ||
    '';

  return [
    item.title,
    description,
    item.url ? `🔗 Ler notícia completa:\n${item.url}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 60000);
}

async function publishToFacebook(item) {
  const account = getAccount('facebook');
  if (!account) throw Object.assign(new Error('Facebook nao conectado'), { code: 'facebook_not_connected' });

  const page = getFacebookPage(account);
  if (!page?.accessToken) {
    throw Object.assign(new Error('Nenhuma Pagina do Facebook disponivel'), { code: 'facebook_page_missing' });
  }

  const body = new URLSearchParams({
    access_token: page.accessToken,
    message: buildFacebookMessage(item),
  });
  if (item.url) body.set('link', item.url);

  const res = await fetch(`https://graph.facebook.com/v19.0/${page.id}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error?.message || 'Falha ao publicar no Facebook'), {
      code: 'facebook_publish_failed',
      details: data,
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
  const item = await findNews(id);
  if (!item) return NextResponse.json({ error: 'Notícia não encontrada' }, { status: 404 });
  if (item.status !== 'pending') return NextResponse.json({ error: 'Notícia já foi processada' }, { status: 409 });

  const body = await request.json().catch(() => ({}));
  const socialPlatforms = Array.isArray(body.socialPlatforms)
    ? body.socialPlatforms.filter(platform => VALID_SOCIAL_PLATFORMS.includes(platform))
    : [];

  try {
    const socialResults = [];
    if (socialPlatforms.includes('facebook')) {
      if (!getAccount('facebook')) {
        return NextResponse.json({ error: 'Facebook ainda nao esta conectado em Redes Sociais' }, { status: 409 });
      }
      if (FACEBOOK_DIRECT_PUBLISH) {
        socialResults.push(await publishToFacebook(item));
      }
    }

    const updated = await updateNews(id, { status: 'published', processedAt: new Date().toISOString(), processedBy: user.username });
    await notifyN8n(N8N_PUBLISH_WEBHOOK, {
      action: 'publish',
      newsId: id,
      socialPlatforms,
      socialPlatform: socialPlatforms[0] || null,
      socialResults,
      news: updated,
    });
    console.log(`[ação] Notícia publicada: ${id} por ${user.username}`);
    return NextResponse.json({ success: true, news: updated, socialResults });
  } catch (err) {
    if (err.code === 'facebook_page_missing') {
      return NextResponse.json({ error: 'Facebook conectado, mas sem Pagina disponivel para publicar. Confirma as permissoes e que tens uma Pagina.' }, { status: 409 });
    }
    if (err.code === 'facebook_publish_failed') {
      console.error('[facebook] Erro ao publicar:', err.details || err.message);
      return NextResponse.json({ error: `Erro ao publicar no Facebook: ${err.message}` }, { status: 502 });
    }
    console.error('[db] Erro ao publicar:', err.message);
    return NextResponse.json({ error: 'Erro ao publicar notícia' }, { status: 500 });
  }
}
