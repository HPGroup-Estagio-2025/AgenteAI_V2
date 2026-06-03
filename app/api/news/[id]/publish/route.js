import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { findNews, findNewsByUrl, insertNews, updateNews } from '@/src/lib/db';
import { getAccount, getAccountById, waitForAccounts, refreshAccountsFromSupabase } from '@/src/lib/social';

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

async function fetchFacebookPagesFromToken(account) {
  if (!account?.accessToken) return [];
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,tasks,picture.width(200)&access_token=${encodeURIComponent(account.accessToken)}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[facebook] Falha ao buscar paginas no momento da publicacao:', data.error?.message || data);
      return [];
    }
    const pages = Array.isArray(data.data) ? data.data.map(page => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      tasks: page.tasks || [],
      picture: page.picture?.data?.url || null,
    })) : [];
    console.log('[facebook] Paginas buscadas ao vivo:', pages.map(page => ({
      id: page.id,
      name: page.name,
      hasAccessToken: Boolean(page.accessToken),
      tasks: page.tasks || [],
    })));
    return pages;
  } catch (err) {
    console.error('[facebook] Erro ao buscar paginas no momento da publicacao:', err.message);
    return [];
  }
}

function selectFacebookPage(pages) {
  const availablePages = Array.isArray(pages) ? pages : [];
  if (FACEBOOK_PAGE_ID) return availablePages.find(page => page.id === FACEBOOK_PAGE_ID) || null;
  return availablePages[0] || null;
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
  console.log('[instagram] A publicar com conta:', {
    id: account.id,
    name: account.name,
    instagramUserId: account.instagramUserId,
  });

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

  console.log('[facebook] Conta encontrada:', {
    id: account.id,
    name: account.name,
    pagesCount: Array.isArray(account.pages) ? account.pages.length : 0,
    pages: Array.isArray(account.pages) ? account.pages.map(p => ({ id: p.id, name: p.name })) : [],
  });

  const storedPages = Array.isArray(account.pages) ? account.pages : [];
  const storedPage = selectFacebookPage(storedPages);
  let page = storedPage;

  if (!page?.accessToken) {
    const livePages = await fetchFacebookPagesFromToken(account);
    // Tenta encontrar a página pelo ID guardado, depois qualquer página com token
    page = (storedPage?.id ? livePages.find(p => p.id === storedPage.id) : null)
      || livePages.find(p => p.accessToken)
      || selectFacebookPage(livePages);
    console.log('[facebook] Página selecionada após fetch ao vivo:', page ? { id: page.id, name: page.name, hasToken: Boolean(page.accessToken) } : null);
  }

  if (!page?.accessToken) {
    throw Object.assign(
      new Error('A pagina Facebook foi encontrada, mas falta o token da pagina. Reconecta o Facebook e seleciona/autoriza a pagina na janela da Meta.'),
      { code: 'facebook_page_missing' }
    );
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
      if (err.code === 'duplicate') {
        const existing = articleData.url ? await findNewsByUrl(articleData.url) : null;
        if (existing) {
          item = existing;
        } else {
          return NextResponse.json({ error: 'Notícia já existe na base de dados' }, { status: 409 });
        }
      } else {
        console.error('[db] Erro ao inserir artigo antes de publicar:', err.message);
        return NextResponse.json({ error: 'Erro ao guardar a notícia' }, { status: 500 });
      }
    }
  }

  // Permite publicar se está pending (novo) ou on_hold (guardado)
  // Rejeita se já foi published
  if (item.status === 'published') {
    return NextResponse.json({ error: 'Notícia já foi publicada', alreadyPublished: true }, { status: 409 });
  }

  if (!['pending', 'on_hold'].includes(item.status)) {
    return NextResponse.json({ error: 'Notícia não pode ser publicada' }, { status: 409 });
  }

  const socialPlatforms = Array.isArray(body.socialPlatforms)
    ? body.socialPlatforms.filter(p => VALID_SOCIAL_PLATFORMS.includes(p))
    : [];
  if (socialPlatforms.length === 0) {
    return NextResponse.json({ error: 'Seleciona pelo menos uma rede social para publicar.' }, { status: 400 });
  }
  // Conta específica escolhida pelo admin para cada plataforma: { facebook: 'uuid', ... }
  const selectedAccounts = body.selectedAccounts && typeof body.selectedAccounts === 'object'
    ? body.selectedAccounts : {};

  try {
    // Garante que as contas estão carregadas do Supabase antes de publicar
    await waitForAccounts();

    // IMPORTANTE: Recarrega as contas do Supabase para ter dados frescos
    // Isto garante que se o utilizador reconectou uma conta recentemente,
    // o servidor tem a versão mais atualizada (com páginas e tokens)
    await refreshAccountsFromSupabase();

    console.log('[publish] Processando publicação:', {
      platforms: socialPlatforms,
      selectedAccounts,
      cacheCounts: {
        facebook: getAccount('facebook') ? 1 : 0,
        instagram: getAccount('instagram') ? 1 : 0,
      }
    });

    const publishTasks = [];

    if (socialPlatforms.includes('facebook')) {
      const fbAccountId = selectedAccounts.facebook || null;
      if (!fbAccountId && !getAccount('facebook')) {
        console.error('[publish] Facebook: nenhuma conta selecionada (accountId=%s) ou na cache', fbAccountId);
        return NextResponse.json({ error: 'Facebook ainda nao esta conectado em Redes Sociais' }, { status: 409 });
      }
      console.log('[publish] Publicando no Facebook com accountId=%s', fbAccountId || 'default');
      publishTasks.push(publishToFacebook(item, fbAccountId));
    }

    if (socialPlatforms.includes('instagram')) {
      const igAccountId = selectedAccounts.instagram || null;
      if (!igAccountId && !getAccount('instagram')) {
        console.error('[publish] Instagram: nenhuma conta selecionada (accountId=%s) ou na cache', igAccountId);
        return NextResponse.json({ error: 'Instagram ainda nao esta conectado em Redes Sociais' }, { status: 409 });
      }
      console.log('[publish] Publicando no Instagram com accountId=%s', igAccountId || 'default');
      publishTasks.push(publishToInstagram(item, igAccountId));
    }

    const socialResults = await Promise.all(publishTasks);

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
    // Log detalhado para debugging
    console.error('[publish] Erro ao publicar:', {
      message: err.message,
      code: err.code,
      details: err.details || '',
      stack: err.stack?.split('\n')[0],
    });

    if (err.code === 'facebook_page_missing') {
      return NextResponse.json({ error: err.message || 'Facebook conectado, mas sem Pagina disponivel para publicar.' }, { status: 409 });
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
    console.error('[db] Erro ao publicar:', err.message, err.details || '');
    return NextResponse.json({ error: `Erro ao publicar notícia: ${err.message}` }, { status: 500 });
  }
}
