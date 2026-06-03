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

// Imagem de fallback quando o artigo não tem imagem
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&q=80';

function getItemImage(item) {
  return item.imageUrl || FALLBACK_IMAGE;
}

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

function generateHashtags(item) {
  const text = `${item.title || ''} ${item.description || ''} ${item.content || ''}`.toLowerCase();
  const tags = [];

  // Setor
  const sectorTags = {
    'maritimo':       ['#Maritime', '#Naval', '#Shipping', '#MaritimeIndustry', '#PortOperations'],
    'defesa-militar': ['#Defense', '#Military', '#NavalDefense', '#DefenceIndustry', '#ArmedForces'],
    'aeroespacial':   ['#Aerospace', '#Aviation', '#Space', '#AerospaceIndustry', '#Aircraft'],
    'ferroviario':    ['#Railway', '#RailTransport', '#Rail', '#RollingStock', '#TrainIndustry'],
  }[item.category] || ['#Industry', '#Engineering', '#Technology'];
  tags.push(...sectorTags.slice(0, 3));

  // Keywords do título
  if (text.includes('navy') || text.includes('naval')) tags.push('#Navy');
  if (text.includes('ship') || text.includes('vessel')) tags.push('#Shipbuilding');
  if (text.includes('propuls')) tags.push('#Propulsion');
  if (text.includes('engine') || text.includes('motor')) tags.push('#MarineEngines');
  if (text.includes('port') || text.includes('porto')) tags.push('#PortInfrastructure');
  if (text.includes('supply chain') || text.includes('logistics')) tags.push('#SupplyChain');
  if (text.includes('technology') || text.includes('tech')) tags.push('#Technology');
  if (text.includes('contract') || text.includes('deal')) tags.push('#BusinessDevelopment');
  if (text.includes('invest') || text.includes('acquisition')) tags.push('#Investment');
  if (text.includes('sustainab') || text.includes('green')) tags.push('#Sustainability');
  if (text.includes('digital') || text.includes('ai') || text.includes('automat')) tags.push('#Innovation');
  if (text.includes('europe') || text.includes('nato')) tags.push('#Europe');
  if (text.includes('space') || text.includes('satellite')) tags.push('#SpaceTech');
  if (text.includes('drone') || text.includes('uav') || text.includes('unmanned')) tags.push('#UnmannedSystems');

  // Tags fixas da empresa (ajustadas por empresa se necessário — passado via item._companyName)
  const isDefense = (item._companyName || '').toLowerCase().includes('defense') || (item._companyName || '').toLowerCase().includes('defesa');
  if (isDefense) {
    tags.push('#PartYard', '#PartYardDefense', '#BeStrongTogether');
  } else {
    tags.push('#PartYard', '#PartYardMarine', '#MovingTheSeaWithUs');
  }

  // Remove duplicados e limita a 12
  return [...new Set(tags)].slice(0, 12).join(' ');
}

function cleanDescription(raw) {
  return (raw || '')
    .replace(/Key sectors:[^\n]*/gi, '')
    .replace(/Source:[^\n]*/gi, '')
    .replace(/This article highlights[^.]*\./gi, '')
    .replace(/Sensitive terms[^.]*\./gi, '')
    .replace(/Read the full story here\.?/gi, '')
    .replace(/According to the original report[^.]*\./gi, '')
    .replace(/this development is expected[^.]*\./gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildWordPressContent(item, company) {
  const title = item.title || '';
  // Limpa a descrição de boilerplate gerado pelo agente
  const rawDesc = item.description || item.summary || item.excerpt || item.content || '';
  const description = cleanDescription(rawDesc) || title;
  const sourceUrl = item.url || '';
  const imageUrl = getItemImage(item);
  const sector = item.category || '';
  const publishedAt = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const companyName = company?.name || '';
  const companyUrl = company?.website_url || '';
  const sectorLabel = sector ? sector.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Industry';
  const isDefense = companyName.toLowerCase().includes('defense') || companyName.toLowerCase().includes('defesa');
  const hashtags = generateHashtags({ ...item, _companyName: companyName });

  // CTA baseado na empresa
  const ctaLine = isDefense
    ? `<strong>Be Strong Together!</strong>`
    : `<strong>Moving The Sea With Us!</strong>`;
  const contactLine = isDefense
    ? `Call Us Today: <a href="tel:+351265544370">+351 265544370</a><br/>Email: <a href="mailto:sales@partyardmilitary.com">sales@partyardmilitary.com</a>`
    : `Contact us today: <a href="tel:+351265544370">+351 265 544 370</a> or go to <a href="${companyUrl}/contacts" target="_blank" rel="noopener noreferrer">Contacts Page</a><br/>Email: <a href="mailto:sales@partyard.eu">sales@partyard.eu</a>`;

  // Subtítulos e contexto expandido por setor
  const sectorContent = {
    'maritimo': {
      sub1: 'A Changing Maritime Landscape',
      p1: `The global maritime industry is undergoing significant transformation. Port authorities, shipowners, and logistics operators face mounting pressure to modernise infrastructure, embrace greener technologies, and adapt to shifting trade routes shaped by geopolitical developments and environmental regulations. This context makes every major development in the sector particularly noteworthy.`,
      sub2: 'What This Means for the Supply Chain',
      p2: `For companies operating across the maritime supply chain — from spare parts procurement and engine repair to logistics and port services — staying ahead of industry developments is essential. The ability to anticipate change, source the right components, and maintain operational continuity defines competitive advantage in this demanding sector. At ${companyName || 'PartYard'}, we monitor these trends closely to better serve our clients across the globe.`,
    },
    'defesa-militar': {
      sub1: 'The Evolving Defence Landscape',
      p1: `Global defence spending continues to rise as nations invest in new capabilities, readiness, and strategic partnerships. The demand for advanced systems, resilient supply chains, and trusted suppliers has never been higher. Every significant procurement decision or technological milestone in this sector carries broad implications for industry players and allied nations alike.`,
      sub2: 'Implications for Industry and Suppliers',
      p2: `For suppliers and service providers operating within the defence ecosystem, this environment presents both opportunities and responsibilities. Meeting the exacting standards of defence programmes requires deep technical knowledge, strict compliance, and a commitment to delivery under pressure. At ${companyName || 'PartYard'}, we understand these demands and work to support our clients with the parts and expertise they need.`,
    },
    'aeroespacial': {
      sub1: 'Aerospace in Transformation',
      p1: `The aerospace and aviation sectors are evolving at a rapid pace. Commercial aviation continues its recovery trajectory, while the space economy expands with new launch providers, satellite networks, and in-orbit services. These shifts create sustained demand for precision components, advanced materials, and reliable engineering support across the value chain.`,
      sub2: 'Opportunities Across the Value Chain',
      p2: `For businesses operating in or adjacent to the aerospace sector, keeping pace with these changes is critical. Whether it is sourcing specialist parts, maintaining complex systems, or adapting logistics to new operational realities, agility and expertise are key. ${companyName || 'PartYard'} is positioned to support clients navigating this dynamic environment.`,
    },
    'ferroviario': {
      sub1: 'A New Era for Rail',
      p1: `Rail transport is experiencing a global revival, underpinned by decarbonisation goals, urbanisation, and the proven efficiency of rail freight. Major infrastructure projects across Europe, Asia, and North America are generating sustained demand for rolling stock, signalling systems, and maintenance expertise — creating significant opportunities for well-positioned suppliers and service providers.`,
      sub2: 'Supply Chain and Maintenance Considerations',
      p2: `The shift towards electrified and high-speed rail networks introduces new technical requirements for components and maintenance. Organisations that invest early in understanding these specifications and building robust supply chains will be best placed to win and deliver on major contracts. ${companyName || 'PartYard'} follows these developments closely to ensure our clients are always a step ahead.`,
    },
  }[sector] || {
    sub1: 'Broader Industry Context',
    p1: `The industrial and engineering sectors continue to navigate a period of structural change — driven by digitalisation, sustainability imperatives, and supply chain reconfiguration. Companies across manufacturing, logistics, and technical services are adapting to new demands while maintaining the quality and reliability their customers depend on.`,
    sub2: 'Staying Ahead of the Curve',
    p2: `In this environment, access to timely and accurate industry intelligence is a genuine competitive advantage. Organisations that monitor market developments closely, and act decisively, are better positioned to manage risk and capitalise on emerging opportunities. At ${companyName || 'PartYard'}, we are committed to keeping our clients informed and supported.`,
  };

  // Intro reescrita (evita plágio — reformula em vez de copiar)
  const introRewritten = description
    ? `A recent report${publishedAt ? ` from ${publishedAt}` : ''} has brought to light an important development in the ${sectorLabel.toLowerCase()} industry: ${description.charAt(0).toLowerCase() + description.slice(1)}${description.endsWith('.') ? '' : '.'} This story has attracted significant attention from professionals and stakeholders across the sector.`
    : `A significant development has emerged in the ${sectorLabel.toLowerCase()} sector that warrants close attention from industry professionals and decision-makers alike.`;

  return `<!-- wp:image {"align":"wide","sizeSlug":"large"} -->
<figure class="wp-block-image alignwide size-large"><img src="${imageUrl}" alt="${title}" /></figure>
<!-- /wp:image -->

<!-- wp:paragraph -->
<p>${introRewritten}</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>${description ? `Reports indicate that ${description.charAt(0).toLowerCase() + description.slice(1)}${description.endsWith('.') ? '' : '.'} The story continues to develop, and its ramifications are being felt across multiple segments of the ${sectorLabel.toLowerCase()} value chain.` : `Industry observers are closely monitoring how this situation evolves, with many expecting further announcements in the coming days and weeks.`}</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":3} -->
<h3>${sectorContent.sub1}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>${sectorContent.p1}</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":3} -->
<h3>${sectorContent.sub2}</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>${sectorContent.p2}</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":3} -->
<h3>Our Perspective</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>At ${companyName}, we believe that keeping our clients and partners informed about developments in the ${sectorLabel.toLowerCase()} sector is part of our commitment to excellence. Whether this news affects procurement, operations, or strategic planning, our team is here to help you navigate the implications and find the right solutions for your needs.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>As the situation continues to evolve, we will keep monitoring and sharing relevant updates. We encourage our readers to follow this story closely and reach out to our team if you have questions or need support.</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>${ctaLine}</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>${contactLine}</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p>${hashtags}</p>
<!-- /wp:paragraph -->

<!-- wp:separator -->
<hr class="wp-block-separator"/>
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
  };

  // Sempre faz upload de imagem como featured media (usa fallback se necessário)
  const wpImageUrl = getItemImage(item);
  let featuredMediaId = null;
  try {
    const imgRes = await fetch(wpImageUrl, { signal: AbortSignal.timeout(8000) });
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

  if (featuredMediaId) postData.featured_media = featuredMediaId;

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
  const caption = buildFacebookMessage(item, item._wpUrl || null);
  console.log('[instagram] A publicar com conta:', {
    id: account.id,
    name: account.name,
    instagramUserId: account.instagramUserId,
  });

  // Usa imagem do artigo ou fallback — sempre envia imagem (obrigatório no Instagram)
  const imageForInstagram = getItemImage(item);
  // Garante aspect ratio 1:1 via proxy (Instagram aceita entre 4:5 e 1.91:1)
  const safeImageUrl = `https://wsrv.nl/?url=${encodeURIComponent(imageForInstagram)}&w=1080&h=1080&fit=cover&a=attention&output=jpg`;

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

  // Sempre publica com imagem (usa fallback se não houver)
  const imageForFacebook = getItemImage(item);
  {
    const imageUrls = [
      imageForFacebook,
      `https://wsrv.nl/?url=${encodeURIComponent(imageForFacebook)}&w=1200&h=630&fit=cover&a=attention&output=jpg`,
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
