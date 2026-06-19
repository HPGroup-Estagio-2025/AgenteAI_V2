import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';

function auth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return false;
  try { verifyToken(token); return true; } catch { return false; }
}

// Termos genéricos de setor/categoria que NÃO devem ser usados como nome de fonte
const GENERIC_SECTOR_TERMS = [
  'maritimo','maritime','naval','shipping','port','offshore',
  'defesa','defense','defence','militar','military','army','navy','airforce',
  'aeroespacial','aerospace','aviation','aircraft','space','rocket',
  'ferroviario','railway','railroad','rail','tram','metro',
  'tecnologia','technology','tech','digital','software','hardware','ai',
  'fitness','workout','gym','treino','alimentacao','alimentação',
  'ginasio','ginásio','outdoor','saude','health','nutricao','nutrição',
  'news','noticias','notícias','latest','feed','rss','blog','articles',
];

function domainToName(feedUrl) {
  try {
    const hostname = new URL(feedUrl).hostname.replace(/^www\./, '').replace(/^feeds\./, '');
    const known = {
      'naval-technology.com': 'Naval Technology',
      'gcaptain.com': 'gCaptain',
      'defensenews.com': 'Defense News',
      'breakingdefense.com': 'Breaking Defense',
      'spacenews.com': 'SpaceNews',
      'simpleflying.com': 'Simple Flying',
      'railway-technology.com': 'Railway Technology',
      'railjournal.com': 'Rail Journal',
      'arstechnica.com': 'Ars Technica',
      'theverge.com': 'The Verge',
      'techcrunch.com': 'TechCrunch',
      'venturebeat.com': 'VentureBeat',
      'artificialintelligence-news.com': 'AI News',
      'aiweekly.co': 'AI Weekly',
      'feedburner.com': null, // precisa do path
      'nit.pt': 'NIT',
    };
    if (known[hostname] !== undefined) return known[hostname];
    const base = hostname.split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch { return null; }
}

function extractRssTitle(xml, feedUrl) {
  // Extrai o título do <channel> antes do primeiro <item>/<entry>
  const channelXml = xml.replace(/<item[\s\S]*$/i, '').replace(/<entry[\s\S]*$/i, '');
  const m = channelXml.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
  const raw = m?.[1]?.trim().replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() || null;

  // Se o título contém separadores ("NIT | Fitness" → "NIT"), pega a primeira parte
  let candidate = raw;
  if (candidate) {
    const separators = [' | ', ' - ', ' – ', ' · ', ' » ', ' > ', ' :: '];
    for (const sep of separators) {
      if (candidate.includes(sep)) { candidate = candidate.split(sep)[0].trim(); break; }
    }
  }

  // Verifica se o candidato é genérico demais (nome de setor/categoria)
  const normalize = s => s?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-_\s]+/g, '');
  const candidateNorm = normalize(candidate || '');
  const isGeneric = !candidate
    || GENERIC_SECTOR_TERMS.some(t => candidateNorm === normalize(t))
    || candidateNorm.length < 3;

  // Também verifica se o título bate com partes do URL path (ex: "alimentacao-saudavel" no path)
  let looksLikePathCategory = false;
  try {
    const pathParts = new URL(feedUrl).pathname.toLowerCase().split('/').filter(p => p.length > 3);
    looksLikePathCategory = pathParts.some(p => {
      const pNorm = normalize(p);
      return candidateNorm.includes(pNorm) || pNorm.includes(candidateNorm);
    });
  } catch {}

  if (isGeneric || looksLikePathCategory) return domainToName(feedUrl);
  return candidate || domainToName(feedUrl);
}

function countRssItems(xml) {
  return (xml.match(/<item[\s>]/gi) || []).length + (xml.match(/<entry[\s>]/gi) || []).length;
}

function isRssXml(text) {
  return /<rss|<feed|<channel|<atom/i.test(text.slice(0, 2000));
}

// Tenta encontrar o feed RSS a partir de uma página HTML
function extractFeedFromHtml(html, baseUrl) {
  const patterns = [
    /<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+type=["']application\/atom\+xml["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/rss\+xml["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      try {
        return new URL(match[1], baseUrl).href;
      } catch { return match[1]; }
    }
  }
  // Tentativas comuns de URL de feed
  try {
    const base = new URL(baseUrl);
    return `${base.origin}/feed/`;
  } catch { return null; }
}

export async function POST(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { url } = await request.json().catch(() => ({}));
  if (!url) return NextResponse.json({ error: 'URL obrigatório' }, { status: 400 });

  let targetUrl = url.trim();

  // Valida se parece um URL antes de tentar aceder
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = `https://${targetUrl}`;
  try { new URL(targetUrl); } catch {
    return NextResponse.json({ valid: false, error: 'URL inválido. Escreve um endereço completo (ex: https://exemplo.com/feed) ou pesquisa pelo nome da fonte.' });
  }
  if (!targetUrl.includes('.')) {
    return NextResponse.json({ valid: false, error: 'URL inválido. Escreve um endereço completo (ex: https://exemplo.com/feed) ou pesquisa pelo nome da fonte.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; publixy-validator/1.0)', Accept: 'application/rss+xml, application/atom+xml, text/xml, text/html, */*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ valid: false, error: `O servidor respondeu com erro ${res.status}` });
    }

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    // É RSS/Atom directamente
    if (isRssXml(text) || /rss|atom|xml/i.test(contentType)) {
      const title = extractRssTitle(text, targetUrl);
      const items = countRssItems(text);
      // Feed válido mesmo sem artigos (pode estar temporariamente vazio)
      return NextResponse.json({
        valid: true,
        feedUrl: targetUrl,
        name: title || new URL(targetUrl).hostname,
        itemCount: items > 0 ? items : null,
        note: items === 0 ? 'Feed válido mas sem artigos de momento' : null,
        type: 'rss',
      });
    }

    // É HTML — tenta encontrar feed RSS
    if (/html/i.test(contentType)) {
      const feedUrl = extractFeedFromHtml(text, targetUrl);
      if (feedUrl && feedUrl !== targetUrl) {
        // Tenta buscar o feed encontrado
        const feedController = new AbortController();
        const feedTimeout = setTimeout(() => feedController.abort(), 8000);
        try {
          const feedRes = await fetch(feedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; publixy-validator/1.0)' },
            signal: feedController.signal,
          });
          clearTimeout(feedTimeout);
          if (feedRes.ok) {
            const feedText = await feedRes.text();
            if (isRssXml(feedText)) {
              const title = extractRssTitle(feedText, feedUrl);
              const items = countRssItems(feedText);
              return NextResponse.json({
                valid: true,
                feedUrl,
                name: title || new URL(targetUrl).hostname,
                itemCount: items,
                type: 'rss',
                note: `Feed RSS encontrado em ${feedUrl}`,
              });
            }
          }
        } catch { clearTimeout(feedTimeout); }
      }
      return NextResponse.json({
        valid: false,
        error: 'Não foi possível encontrar um feed RSS neste site. Tenta adicionar /feed/ ou /rss/ ao URL.',
      });
    }

    return NextResponse.json({ valid: false, error: 'Formato não reconhecido como fonte de notícias' });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') return NextResponse.json({ valid: false, error: 'Tempo limite excedido. O site demorou demasiado a responder.' });
    return NextResponse.json({ valid: false, error: 'Não foi possível aceder ao URL. Verifica se o endereço está correcto.' });
  }
}
