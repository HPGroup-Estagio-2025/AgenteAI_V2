import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { findNews, findNewsByUrl, insertNews, updateNews } from '@/src/lib/db';
import { getAccount, getAccountById, waitForAccounts, refreshAccountsFromSupabase } from '@/src/lib/social';
import { supabase } from '@/src/lib/supabase';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const N8N_PUBLISH_WEBHOOK = process.env.N8N_PUBLISH_WEBHOOK || '';
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID || '';
const VALID_SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'wordpress'];

async function getCompanyForAccount(accountId) {
  if (!accountId) return null;
  try {
    const { data: account } = await supabaseAdmin.from('social_accounts').select('company_id').eq('id', accountId).single();
    if (!account?.company_id) return null;
    const { data: company } = await supabaseAdmin.from('companies').select('*').eq('id', account.company_id).single();
    return company || null;
  } catch { return null; }
}

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

function buildSocialSummary(item) {
  // Usa descrição real do RSS se disponível; senão cai para content e limpa o texto gerado
  const raw = item.description || item.summary || item.excerpt || '';
  if (raw.trim().length > 20) {
    const clean = raw.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return clean.length > 280 ? clean.slice(0, 277) + '...' : clean;
  }
  // Fallback: limpa o postDescription gerado pelo agente
  const generated = item.content || '';
  const clean = generated
    .replace(/Key sectors:[^\n]*/gi, '')
    .replace(/Source:[^\n]*/gi, '')
    .replace(/This article highlights[^.]*\./gi, '')
    .replace(/Sensitive terms[^.]*\./gi, '')
    .replace((item.title || ''), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return clean.length > 280 ? clean.slice(0, 277) + '...' : clean;
}

function buildFacebookMessage(item, readMoreUrl) {
  const summary = buildSocialSummary(item);
  const linkUrl = readMoreUrl || item.url || '';
  return [item.title, summary, linkUrl ? `🔗 Read more:\n${linkUrl}` : '']
    .filter(Boolean).join('\n\n').slice(0, 60000);
}

function buildWordPressContent(item, company) {
  const title = item.title || '';
  const description = item.description || item.summary || item.excerpt || item.content || '';
  const sourceUrl = item.url || '';
  const imageUrl = item.imageUrl || '';
  const sector = item.category || '';
  const publishedAt = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const companyName = company?.name || '';
  const companyUrl = company?.website_url || '';
  const sectorLabel = sector ? sector.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Industry';

  // Contexto adicional baseado no setor — expande o conteúdo real
  const sectorAdditions = {
    'maritimo': [
      `The maritime sector, which accounts for over 80% of global trade by volume, continues to evolve at a rapid pace. Port authorities, shipowners, and logistics providers are under increasing pressure to modernise infrastructure, adopt cleaner technologies, and respond to shifting trade routes driven by geopolitical events.`,
      `For companies like ${companyName || 'industry operators'} operating across the maritime supply chain, staying ahead of these changes is not optional — it is a business necessity. From spare parts procurement to engine maintenance, every link in the chain must adapt to maintain efficiency and reliability.`,
    ],
    'defesa-militar': [
      `Defence spending globally reached record levels in recent years, with NATO members and allied nations investing heavily in new capabilities, interoperability, and readiness. The evolving security landscape demands not only advanced hardware but also resilient supply chains capable of delivering critical components under pressure.`,
      `For suppliers and service providers in the defence ecosystem, this environment creates both challenges and opportunities. Long-term contracts, stringent compliance requirements, and the need for rapid response make it essential to work with trusted, experienced partners who understand the complexity of the sector.`,
    ],
    'aeroespacial': [
      `The aerospace and aviation industry is navigating a period of significant transformation. Commercial aviation continues its post-pandemic recovery while the space economy expands at an unprecedented rate, with new launch providers, satellite constellations, and in-orbit services reshaping the competitive landscape.`,
      `Across both sub-sectors, the demand for precision components, advanced materials, and reliable maintenance services remains robust. Companies that can deliver on quality, traceability, and lead time will find themselves well-positioned to capture a growing share of this dynamic market.`,
    ],
    'ferroviario': [
      `Rail transport is experiencing a global renaissance, driven by decarbonisation targets, urban congestion challenges, and the proven efficiency of rail freight over long distances. Major infrastructure programmes across Europe, Asia, and North America are creating sustained demand for rolling stock, signalling systems, and maintenance services.`,
      `The shift towards high-speed rail and electrified networks also brings new requirements for specialised components and engineering expertise. Industry players that invest early in understanding these evolving specifications will be best placed to win contracts in this growing segment.`,
    ],
  }[sector] || [
    `The broader industrial sector is undergoing a period of structural change, driven by digitalisation, sustainability mandates, and the reconfiguration of global supply chains following recent disruptions. Companies across manufacturing, engineering, and logistics are being asked to do more with less while maintaining the quality and reliability their customers demand.`,
    `In this environment, access to accurate, timely industry intelligence is a key competitive advantage. Organisations that monitor market developments closely — and act on them swiftly — are better positioned to identify risks early and seize emerging opportunities before competitors.`,
  ];

  return `<!-- wp:image {"align":"wide","sizeSlug":"large"} -->
${imageUrl ? `<figure class="wp-block-image alignwide size-large"><img src="${imageUrl}" alt="${title}" /></figure>` : ''}
<!-- /wp:image -->

<!-- wp:paragraph -->
<p><strong>${description || title}</strong></p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>What Happened</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>${description || title} ${sourceUrl ? `This was reported by <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">the original source</a>${publishedAt ? ` on ${publishedAt}` : ''}.` : ''}</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Industry Context</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>${sectorAdditions[0]}</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Why It Matters</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>${sectorAdditions[1]}</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Looking Ahead</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>As this story develops, industry professionals and stakeholders will be monitoring the situation closely. The implications may extend beyond the immediate headline — affecting procurement decisions, operational planning, and strategic partnerships across the ${sectorLabel.toLowerCase()} value chain.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>At ${companyName || 'our company'}, we believe that staying informed is the first step to staying competitive. Follow our blog for the latest news and analysis from across the ${sectorLabel.toLowerCase()} sector${companyUrl ? `, or visit <a href="${companyUrl}" target="_blank" rel="noopener noreferrer">our website</a> to learn more about our services` : ''}.
</p>
<!-- /wp:paragraph -->

<!-- wp:separator {"className":"is-style-wide"} -->
<hr class="wp-block-separator has-alpha-channel-opacity is-style-wide"/>
<!-- /wp:separator -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"fontWeight":"700","fontSize":"1.2rem"}}} -->
<p class="has-text-align-center"><strong>Moving The Sea With Us!</strong></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center">Contact us today: <a href="tel:+351265544370">+351 265 544 370</a> or go to <a href="${companyUrl}/contacts" target="_blank" rel="noopener noreferrer">Contacts Page</a><br/>Email: <a href="mailto:sales@partyard.eu">sales@partyard.eu</a></p>
<!-- /wp:paragraph -->

<!-- wp:separator {"className":"is-style-wide"} -->
<hr class="wp-block-separator has-alpha-channel-opacity is-style-wide"/>
<!-- /wp:separator -->

<!-- wp:paragraph {"className":"article-source"} -->
<p class="article-source"><em>Original source: <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${sourceUrl}</a>${publishedAt ? ` — Published on ${publishedAt}` : ''}</em></p>
<!-- /wp:paragraph -->`;
}

async function publishToWordPress(item, company) {
  if (!company?.wordpress_url || !company?.wordpress_username || !company?.wordpress_app_password) {
    throw Object.assign(
      new Error('WordPress não configurado para esta empresa — adiciona URL, utilizador e password em Redes Sociais'),
      { code: 'wordpress_not_configured' }
    );
  }

  const wpBase = company.wordpress_url.replace(/\/$/, '');
  const credentials = Buffer.from(`${company.wordpress_username}:${company.wordpress_app_password}`).toString('base64');
  const content = buildWordPressContent(item, company);

  const postData = {
    title: item.title,
    content,
    status: 'publish',
    categories: [],
    tags: [],
    ...(item.imageUrl ? { featured_media: 0 } : {}),
  };

  // Tenta fazer upload da imagem como featured media
  let featuredMediaId = null;
  if (item.imageUrl) {
    try {
      const imgRes = await fetch(item.imageUrl, { signal: AbortSignal.timeout(8000) });
      if (imgRes.ok) {
        const imgBuffer = await imgRes.arrayBuffer();
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : 'jpg';
        const uploadRes = await fetch(`${wpBase}/wp-json/wp/v2/media`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Disposition': `attachment; filename="news-${Date.now()}.${ext}"`,
            'Content-Type': contentType,
          },
          body: imgBuffer,
          signal: AbortSignal.timeout(15000),
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (uploadRes.ok && uploadData.id) featuredMediaId = uploadData.id;
      }
    } catch (err) {
      console.warn('[wordpress] Falha ao fazer upload de imagem:', err.message);
    }
  }

  if (featuredMediaId) postData.featured_media = featuredMediaId;
  else delete postData.featured_media;

  const res = await fetch(`${wpBase}/wp-json/wp/v2/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postData),
    signal: AbortSignal.timeout(20000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(data.message || 'Falha ao publicar no WordPress'),
      { code: 'wordpress_publish_failed', details: data }
    );
  }

  console.log('[wordpress] Artigo publicado:', data.link);
  return { platform: 'wordpress', postId: String(data.id), postUrl: data.link };
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
  const caption = buildFacebookMessage(item, item._wpUrl || null);
  console.log('[instagram] A publicar com conta:', {
    id: account.id,
    name: account.name,
    instagramUserId: account.instagramUserId,
  });

  // Garante aspect ratio 1:1 via proxy (Instagram aceita entre 4:5 e 1.91:1)
  const safeImageUrl = `https://wsrv.nl/?url=${encodeURIComponent(item.imageUrl)}&w=1080&h=1080&fit=cover&a=attention&output=jpg`;

  // Passo 1: criar container de media
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${account.instagramUserId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: safeImageUrl,
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

async function publishToFacebook(item, accountId = null, companyUrl = null, wordpressUrl = null) {
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
  const linkUrl = wordpressUrl || item.url || null;
  const message = buildFacebookMessage(item, linkUrl);

  // Se tem imagem, tenta publicar como foto (tenta URL original, depois proxy)
  if (item.imageUrl) {
    const imageUrls = [
      item.imageUrl,
      `https://wsrv.nl/?url=${encodeURIComponent(item.imageUrl)}&w=1200&h=630&fit=cover&a=attention&output=jpg`,
    ];
    for (const imgUrl of imageUrls) {
      const photoBody = new URLSearchParams({
        access_token: page.accessToken,
        url: imgUrl,
        caption: message,
      });
      const photoRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: photoBody.toString(),
      });
      const photoData = await photoRes.json().catch(() => ({}));
      if (photoRes.ok) {
        return { platform: 'facebook', pageId: page.id, pageName: page.name, postId: photoData.post_id || photoData.id };
      }
      console.warn('[facebook] Imagem falhou, a tentar próxima:', photoData.error?.message);
    }
    // Se ambas as URLs falharam, cai para post com link
    console.warn('[facebook] Todas as imagens falharam, publicando como link');
  }

  // Sem imagem (ou imagem falhou) — publica como post com link (WordPress preview)
  const body = new URLSearchParams({ access_token: page.accessToken, message });
  if (linkUrl) body.set('link', linkUrl);
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

    // Busca empresa — usa companyId do body se disponível, senão tenta via conta selecionada
    const bodyCompanyId = body.companyId || null;
    console.log('[publish] companyId recebido:', bodyCompanyId);
    let company = null;
    if (bodyCompanyId) {
      const { data } = await supabaseAdmin.from('companies').select('*').eq('id', bodyCompanyId).single();
      company = data || null;
      console.log('[publish] Empresa encontrada:', company?.name || 'não encontrada');
    }
    if (!company) {
      const primaryAccountId = selectedAccounts.facebook || selectedAccounts.instagram || null;
      company = await getCompanyForAccount(primaryAccountId);
    }
    const companyUrl = company?.website_url || null;

    console.log('[publish] Processando publicação:', {
      platforms: socialPlatforms,
      selectedAccounts,
      companyUrl,
      cacheCounts: {
        facebook: getAccount('facebook') ? 1 : 0,
        instagram: getAccount('instagram') ? 1 : 0,
      }
    });

    const socialResults = [];

    // Publica no WordPress primeiro para obter o URL do post
    let wordpressPostUrl = null;
    if (socialPlatforms.includes('wordpress')) {
      if (!company) {
        return NextResponse.json({ error: 'Não foi possível determinar a empresa para publicar no WordPress' }, { status: 409 });
      }
      console.log('[publish] Publicando no WordPress para empresa:', company.name);
      const wpResult = await publishToWordPress(item, company);
      wordpressPostUrl = wpResult.postUrl || null;
      socialResults.push(wpResult);
      console.log('[publish] WordPress URL:', wordpressPostUrl);
    }

    // Link para redes sociais: WordPress se publicado, senão URL da notícia original
    const socialLinkUrl = wordpressPostUrl || item.url || null;

    const publishTasks = [];

    if (socialPlatforms.includes('facebook')) {
      const fbAccountId = selectedAccounts.facebook || null;
      if (!fbAccountId && !getAccount('facebook')) {
        console.error('[publish] Facebook: nenhuma conta selecionada (accountId=%s) ou na cache', fbAccountId);
        return NextResponse.json({ error: 'Facebook ainda nao esta conectado em Redes Sociais' }, { status: 409 });
      }
      console.log('[publish] Publicando no Facebook com accountId=%s, link=%s', fbAccountId || 'default', socialLinkUrl);
      publishTasks.push(publishToFacebook(item, fbAccountId, companyUrl, socialLinkUrl));
    }

    if (socialPlatforms.includes('instagram')) {
      const igAccountId = selectedAccounts.instagram || null;
      if (!igAccountId && !getAccount('instagram')) {
        console.error('[publish] Instagram: nenhuma conta selecionada (accountId=%s) ou na cache', igAccountId);
        return NextResponse.json({ error: 'Instagram ainda nao esta conectado em Redes Sociais' }, { status: 409 });
      }
      console.log('[publish] Publicando no Instagram com accountId=%s', igAccountId || 'default');
      // Atualiza caption do Instagram com link do WordPress se disponível
      publishTasks.push(publishToInstagram({ ...item, _wpUrl: socialLinkUrl }, igAccountId));
    }

    const remainingResults = await Promise.all(publishTasks);
    socialResults.push(...remainingResults);

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
    if (err.code === 'wordpress_not_configured') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err.code === 'wordpress_publish_failed') {
      console.error('[wordpress] Erro ao publicar:', err.details || err.message);
      return NextResponse.json({ error: `Erro ao publicar no WordPress: ${err.message}` }, { status: 502 });
    }
    console.error('[db] Erro ao publicar:', err.message, err.details || '');
    return NextResponse.json({ error: `Erro ao publicar notícia: ${err.message}` }, { status: 500 });
  }
}
