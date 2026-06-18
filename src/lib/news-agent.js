import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { notifyClients } from './events';

// Cliente admin para operações server-side que precisam de bypasaar RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

async function generateAiSummary(title, rawText) {
  if (!anthropic) return null;
  try {
    const text = rawText.replace(/\s{2,}/g, ' ').trim().slice(0, 800);
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `Summarize this news article in 2 sentences (max 160 characters total). Be factual and concise. Reply only with the summary, no quotes or labels.\n\nTitle: ${title}\n\n${text}`,
      }],
    });
    return msg.content[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

const AGENT_RUNS_TABLE = process.env.SUPABASE_AGENT_RUNS_TABLE || 'agent_runs';

// Feeds organizados por setor — 2 fontes por setor
const SECTOR_FEEDS = {
  'maritimo': [
    'https://www.naval-technology.com/feed/',
    'https://gcaptain.com/feed/',
  ],
  'defesa-militar': [
    'https://www.defensenews.com/arc/outboundfeeds/rss/',
    'https://breakingdefense.com/feed/',
  ],
  'aeroespacial': [
    'https://spacenews.com/feed/',
    'https://simpleflying.com/feed/',
  ],
  'ferroviario': [
    'https://www.railway-technology.com/feed/',
    'https://www.railjournal.com/feed/',
  ],
  'tecnologia': [
    'https://feeds.arstechnica.com/arstechnica/index',
    'https://www.theverge.com/rss/index.xml',
    'https://techcrunch.com/feed/',
    'https://venturebeat.com/feed/',
    'https://www.artificialintelligence-news.com/feed/',
    'https://aiweekly.co/issues.rss',
    'https://feeds.feedburner.com/MachineLearningMastery',
  ],
  'fitness': [
    'https://nit.pt/category/fit/alimentacao-saudavel/feed/',
    'https://nit.pt/category/fit/ginasios-e-outdoor/feed/',
  ],
};

const RSS_FEEDS = Object.values(SECTOR_FEEDS).flat();

// Pools de imagens de fallback por categoria (rodam para evitar repetição)
const FALLBACK_POOLS = {
  'maritimo': [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
    'https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=800&q=80',
    'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=800&q=80',
    'https://images.unsplash.com/photo-1559827291-72ee739d0d9a?w=800&q=80',
    'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80',
    'https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80',
  ],
  'defesa-militar': [
    'https://images.unsplash.com/photo-1547745369-5fa52b64e8ac?w=800&q=80',
    'https://images.unsplash.com/photo-1540573133985-87b6da6d54a9?w=800&q=80',
    'https://images.unsplash.com/photo-1585114685099-1c7a0dd06d05?w=800&q=80',
  ],
  'aeroespacial': [
    'https://images.unsplash.com/photo-1446776877081-d282a0f896e2?w=800&q=80',
    'https://images.unsplash.com/photo-1516849841032-87cbac4d88f7?w=800&q=80',
    'https://images.unsplash.com/photo-1457364887197-9150188c107b?w=800&q=80',
  ],
  'ferroviario': [
    'https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=800&q=80',
    'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=800&q=80',
    'https://images.unsplash.com/photo-1508361001413-7a9dca21d08a?w=800&q=80',
  ],
  'fitness': [
    'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=80',
    'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=800&q=80',
  ],
  'tecnologia': [
    'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=800&q=80',
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&q=80',
    'https://images.unsplash.com/photo-1655720828018-edd2daec9349?w=800&q=80',
    'https://images.unsplash.com/photo-1591453089816-0fbb971b454c?w=800&q=80',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80',
    'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800&q=80',
  ],
  'default': [
    'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=80',
    'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=800&q=80',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80',
  ],
};

let _fallbackCounters = {};
function getFallbackImage(category) {
  const pool = FALLBACK_POOLS[category] || FALLBACK_POOLS['default'];
  const idx = (_fallbackCounters[category] || 0) % pool.length;
  _fallbackCounters[category] = idx + 1;
  return pool[idx];
}

const FALLBACK_IMAGES = {
  'maritimo':       FALLBACK_POOLS['maritimo'][0],
  'defesa-militar': FALLBACK_POOLS['defesa-militar'][0],
  'aeroespacial':   FALLBACK_POOLS['aeroespacial'][0],
  'ferroviario':    FALLBACK_POOLS['ferroviario'][0],
  'default':        FALLBACK_POOLS['default'][0],
};

const sectors = {
  supplyChain: ['supply chain', 'procurement', 'sourcing', 'inventory', 'warehouse', 'supplier', 'cadeia de abastecimento', 'fornecedor'],
  logistics: ['logistics', 'freight', 'shipping', 'transport', 'distribution', 'cargo', 'logística', 'transporte', 'carga'],
  marine: ['marine', 'maritime', 'shipbuilding', 'naval', 'port', 'vessel', 'marítimo', 'maritimo', 'marinha', 'naval', 'porto', 'navio', 'embarcação'],
  defense: ['defense', 'defence', 'military', 'army', 'navy', 'air force', 'defesa', 'militar', 'exército', 'exercito', 'forças armadas', 'forcas armadas'],
  aviation: ['aviation', 'aircraft', 'airline', 'aerospace', 'airport', 'aviação', 'aviacao', 'aeronave', 'aeroporto', 'aeroespacial'],
  space: ['space', 'satellite', 'orbital', 'launch', 'spacecraft', 'espaço', 'espaco', 'satélite', 'satelite', 'lançamento', 'lancamento'],
  railway: ['railway', 'rail', 'train', 'rolling stock', 'metro', 'ferroviário', 'ferroviario', 'comboio', 'caminho de ferro', 'metropolitano'],
  industry: ['industry', 'industrial', 'manufacturing', 'factory', 'production'],
  automotive: ['automotive', 'vehicle', 'ev', 'battery', 'mobility', 'car'],
  engineering: ['engineering', 'infrastructure', 'systems integration', 'project'],
  fitness: ['fitness', 'workout', 'exercise', 'gym', 'training', 'nutrition', 'health', 'muscle', 'weight loss', 'running', 'yoga', 'crossfit', 'strength', 'cardio', 'sports medicine'],
};

const trustedSources = [
  'Reuters',
  'BBC',
  'Bloomberg',
  'Financial Times',
  'Defense News',
  'Aviation Week',
  'Supply Chain Dive',
  'Maritime Executive',
  'SpaceNews',
  'Railway Technology',
];

const highValueSectors = Object.keys(sectors);

const riskTerms = [
  'rumor',
  'unconfirmed',
  'alleged',
  'attack',
  'killed',
  'death',
  'sanctions',
  'corruption',
  'lawsuit',
  'scandal',
  'political crisis',
  'war',
];

function stripHtml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagValue(xml, tag) {
  const escaped = tag.replace(':', '\\:');
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return stripHtml(match?.[1] || '');
}

function attrValue(xml, tag, attr) {
  const escaped = tag.replace(':', '\\:');
  const match = xml.match(new RegExp(`<${escaped}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return (match?.[1] || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function ageInDays(dateString) {
  if (!dateString) return 999;
  const date = new Date(dateString);
  const now = new Date();
  if (Number.isNaN(date.getTime())) return 999;
  return Math.floor((now - date) / (1000 * 60 * 60 * 24));
}

function dashboardCategory(matchedSectors = []) {
  if (matchedSectors.includes('marine')) return 'maritimo';
  if (matchedSectors.includes('defense')) return 'defesa-militar';
  if (matchedSectors.includes('space') || matchedSectors.includes('aviation')) return 'aeroespacial';
  if (matchedSectors.includes('railway')) return 'ferroviario';
  if (matchedSectors.includes('technology') || matchedSectors.includes('engineering')) return 'tecnologia';
  return matchedSectors[0] || 'industry';
}

function decodeEntities(raw) {
  return (raw || "")
    .replace(/&#(d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"' )
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&hellip;/g, "…");
}

function generatePostDescription(article) {
  const titleLower = (article.title || '').toLowerCase().trim();

  function cleanRaw(raw) {
    return decodeEntities(raw || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Tenta description primeiro, depois content — descarta se for só o título
  for (const raw of [article.description, article.content]) {
    const clean = cleanRaw(raw);
    const cleanLower = clean.toLowerCase();
    if (clean.length > 40 && !cleanLower.startsWith(titleLower.slice(0, 30))) {
      return clean.slice(0, 500);
    }
  }

  // Fallback: usa o que tiver, mesmo que curto
  const fallback = cleanRaw(article.description || article.content || '');
  return fallback.slice(0, 500) || article.title || '';
}

function parseRss(xml, feedUrl) {
  const items = [...String(xml).matchAll(/<item[\s\S]*?<\/item>/gi)].map(match => match[0]);
  return items.map(itemXml => {
    const content = tagValue(itemXml, 'content:encoded') || tagValue(itemXml, 'description');
    const url = tagValue(itemXml, 'link')
      || attrValue(itemXml, 'link', 'href')   // Atom: <link href="..."/>
      || tagValue(itemXml, 'guid')
      || attrValue(itemXml, 'guid', 'isPermaLink');
    const image =
      attrValue(itemXml, 'enclosure', 'url') ||
      attrValue(itemXml, 'media:content', 'url') ||
      attrValue(itemXml, 'media:thumbnail', 'url') ||
      content.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ||
      '';

    return {
      title: tagValue(itemXml, 'title'),
      description: tagValue(itemXml, 'description'),
      content,
      url,
      image,
      source: cleanSourceName(tagValue(itemXml, 'source'), feedUrl),
      publishedAt: tagValue(itemXml, 'pubDate') || tagValue(itemXml, 'dc:date') || tagValue(itemXml, 'updated') || new Date().toISOString(),
      rawProvider: 'RSS',
      _feedUrl: feedUrl, // domínio do feed de origem (usado para filtro de setor)
    };
  });
}

function isValidImage(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!u.startsWith('http')) return false;
  // Rejeita ícones, logos e imagens demasiado pequenas por nome
  if (/favicon|logo|icon|sprite|placeholder|blank|pixel|tracking|1x1/i.test(u)) return false;
  return true;
}

async function fetchOgImage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dashboard-news-agent/1.0)' },
    });
    clearTimeout(timeout);
    if (!response.ok) return '';
    const html = await response.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i) ||
      html.match(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i);
    const found = match?.[1] || '';
    return isValidImage(found) ? found : '';
  } catch {
    return '';
  }
}

async function enrichWithImages(articles) {
  // Marca artigos sem imagem válida (inclui artigos com imagem inválida/placeholder)
  const missing = articles.filter(a => !isValidImage(a.image) && a.url);
  if (missing.length > 0) {
    const fetched = await Promise.allSettled(
      missing.map(a => fetchOgImage(a.url))
    );
    const imageMap = new Map();
    missing.forEach((a, i) => {
      const result = fetched[i];
      if (result.status === 'fulfilled' && result.value) {
        imageMap.set(a.url, result.value);
      }
    });
    articles = articles.map(a =>
      !isValidImage(a.image) && imageMap.has(a.url) ? { ...a, image: imageMap.get(a.url) } : a
    );
  }
  // Garante que todos os artigos têm sempre uma imagem válida (fallback por categoria)
  return articles.map(a => {
    if (isValidImage(a.image)) return a;
    const category = a._forcedCategory || dashboardCategory(a.matchedSectors);
    return { ...a, image: getFallbackImage(category) };
  });
}

function sourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').replace(/^feeds\./, '');
    if (host.includes('defensenews')) return 'Defense News';
    if (host.includes('spacenews')) return 'SpaceNews';
    if (host.includes('railway-technology')) return 'Railway Technology';
    if (host.includes('naval-technology')) return 'Naval Technology';
    if (host.includes('gcaptain')) return 'gCaptain';
    if (host.includes('breakingdefense')) return 'Breaking Defense';
    if (host.includes('simpleflying')) return 'Simple Flying';
    if (host.includes('railjournal')) return 'Rail Journal';
    if (host.includes('flipboard')) return 'Flipboard';
    if (host.includes('arstechnica')) return 'Ars Technica';
    if (host.includes('theverge')) return 'The Verge';
    if (host.includes('news.google')) return 'Google News';
    // Capitaliza o domínio para ficar mais legível
    const parts = host.split('.');
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  } catch {
    return 'RSS';
  }
}

function cleanSourceName(raw, feedUrl) {
  if (!raw) return sourceFromUrl(feedUrl);
  // Rejeita valores que parecem URLs, query strings ou IDs numéricos
  if (/^https?:\/\//.test(raw)) return sourceFromUrl(feedUrl);
  if (/[?&=]/.test(raw)) return sourceFromUrl(feedUrl);
  if (/^\d+$/.test(raw.trim())) return sourceFromUrl(feedUrl);
  if (raw.trim().length < 2 || raw.trim().length > 80) return sourceFromUrl(feedUrl);
  return raw.trim();
}

function scrapeHtmlArticles(html, pageUrl) {
  const articles = [];
  const base = (() => { try { const u = new URL(pageUrl); return `${u.protocol}//${u.host}`; } catch { return ''; } })();

  // Tenta extrair blocos <article> (padrão WordPress)
  const blocks = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)].map(m => m[1]);

  // Fallback: blocos de lista de notícias com classe "post" ou "item"
  const fallbackBlocks = blocks.length > 0 ? blocks :
    [...html.matchAll(/<(?:div|li)[^>]+class=["'][^"']*(?:post|article|item|card|entry)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li)>/gi)].map(m => m[1]);

  for (const block of fallbackBlocks) {
    // URL + título: procura <h2>/<h3> com link, ou link com classe entry-title
    const linkMatch =
      block.match(/<h[23][^>]*>[\s\S]*?<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<a[^>]+href=["']([^"'#][^"']*)["'][^>]*class=["'][^"']*(?:title|headline)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<a[^>]+class=["'][^"']*(?:title|headline)[^"']*["'][^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const rawUrl = linkMatch[1];
    const url = rawUrl.startsWith('http') ? rawUrl : `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    const title = linkMatch[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 5 || !url.startsWith('http')) continue;

    // Descrição/excerpt
    const descMatch =
      block.match(/<p[^>]*class=["'][^"']*excerpt[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
      block.match(/<div[^>]*class=["'][^"']*excerpt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      block.match(/<p(?![^>]*class=["'][^"']*(?:meta|tag|date|author)[^"']*["'])[^>]*>([^<]{30,})<\/p>/i);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';

    // Imagem
    const imgMatch = block.match(/src=["']([^"']*(?:jpg|jpeg|png|webp)[^"'?]*)["']/i);
    const image = imgMatch ? (imgMatch[1].startsWith('http') ? imgMatch[1] : `${base}${imgMatch[1]}`) : '';

    // Data
    const dateMatch = block.match(/datetime=["']([^"']+)["']/i) || block.match(/(\d{4}-\d{2}-\d{2})/);
    const publishedAt = dateMatch ? dateMatch[1] : new Date().toISOString();

    articles.push({ title, description, content: description, url, image, source: 'Women\'s Health PT', publishedAt, rawProvider: 'HTML', _feedUrl: pageUrl });
  }

  console.log(`[agent] Scrape HTML ${pageUrl}: ${articles.length} artigos extraídos`);
  return articles;
}

async function fetchAllRss(sectorFeeds = SECTOR_FEEDS) {
  const allFeeds = [...new Set(Object.values(sectorFeeds).flat())];
  const results = await Promise.allSettled(
    allFeeds.map(async feedUrl => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dashboard-news-agent/1.0)' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${feedUrl} respondeu ${response.status}`);
        const text = await response.text();
        const trimmed = text.trimStart();
        // Se não é XML/RSS, tenta scraping HTML
        if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<rss') && !trimmed.startsWith('<feed') && trimmed.startsWith('<')) {
          return scrapeHtmlArticles(text, feedUrl);
        }
        return parseRss(text, feedUrl);
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

function scoreArticles(items, maxArticles = 5) {
  const seen = new Set();
  const uniqueItems = [];

  for (const article of items) {
    const title = normalize(article.title);
    const url = normalize(article.url);
    if (!title || !url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    uniqueItems.push(article);
  }

  const sectorFilteredItems = [];
  for (const article of uniqueItems) {
    const text = `${article.title || ''} ${article.description || ''} ${article.content || ''}`.toLowerCase();
    const matchedSectors = [];
    for (const [sector, terms] of Object.entries(sectors)) {
      if (terms.some(term => text.includes(term))) matchedSectors.push(sector);
    }
    if (matchedSectors.length >= 1) {
      sectorFilteredItems.push({ ...article, matchedSectors, relevanceScore: matchedSectors.length });
    }
  }

  const scoredItems = sectorFilteredItems
    .map(article => {
      const ageDays = ageInDays(article.publishedAt);
      const recencyScore = ageDays <= 1 ? 5 : ageDays <= 3 ? 3 : ageDays <= 7 ? 1 : 0;
      return { ...article, ageDays, combinedScore: (article.relevanceScore || 0) + recencyScore };
    })
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, 200);

  const validatedItems = scoredItems.map(article => {
    const text = `${article.title || ''} ${article.description || ''} ${article.content || ''}`.toLowerCase();
    const sourceText = `${article.source || ''} ${article.url || ''}`.toLowerCase();
    const matrix = {};
    let score = 0;

    matrix.sourceTrust = trustedSources.some(source => sourceText.includes(source.toLowerCase())) ? 30 : 15;
    score += matrix.sourceTrust;

    const relevanceScore = article.relevanceScore || 0;
    matrix.hpRelevance = relevanceScore >= 4 ? 25 : relevanceScore === 3 ? 20 : relevanceScore === 2 ? 15 : relevanceScore === 1 ? 8 : 5;
    score += matrix.hpRelevance;

    const age = ageInDays(article.publishedAt);
    matrix.recency = age <= 1 ? 15 : age <= 3 ? 10 : age <= 7 ? 6 : 3;
    score += matrix.recency;

    const qualityFields = [article.title, article.description || article.content, article.url, article.publishedAt].filter(Boolean).length;
    matrix.contentQuality = qualityFields === 4 ? 10 : qualityFields === 3 ? 7 : qualityFields === 2 ? 4 : 2;
    score += matrix.contentQuality;

    const strategicMatches = (article.matchedSectors || []).filter(sector => highValueSectors.includes(sector));
    matrix.strategicFit = strategicMatches.length >= 3 ? 10 : strategicMatches.length === 2 ? 7 : strategicMatches.length === 1 ? 5 : 0;
    score += matrix.strategicFit;

    const matchedRiskTerms = riskTerms.filter(term => text.includes(term));
    matrix.reputationRisk = matchedRiskTerms.length >= 3 ? -20 : matchedRiskTerms.length === 2 ? -12 : matchedRiskTerms.length === 1 ? -6 : 0;
    score += matrix.reputationRisk;

    score = Math.max(0, Math.min(100, score));
    const finalArticle = {
      ...article,
      validationMatrix: matrix,
      finalScore: score,
      decision: score >= 15 ? 'REVIEW' : 'REJECT',
      isValidated: score >= 15,
      matchedRiskTerms,
    };
    return { ...finalArticle, postDescription: generatePostDescription(finalArticle) };
  });

  const sorted = validatedItems.sort((a, b) => b.finalScore - a.finalScore);
  const allCandidates = sorted.filter(a => a.isValidated);

  // Distribui de forma equilibrada pelos setores prioritários
  const prioritySectors = ['marine', 'defense', 'space', 'aviation', 'railway', 'supplyChain', 'logistics', 'industry', 'engineering', 'automotive'];
  const maxPerSector = Math.max(2, Math.ceil(maxArticles / prioritySectors.length) + 1);
  const sectorCounts = {};
  const selected = [];

  // Passo 0: garante mínimo de 5 artigos marítimos (marine)
  const MARINE_MIN = 5;
  const marineCandidates = allCandidates.filter(a => a.matchedSectors?.includes('marine'));
  for (const article of marineCandidates) {
    if ((sectorCounts['marine'] || 0) >= MARINE_MIN) break;
    selected.push(article);
    sectorCounts['marine'] = (sectorCounts['marine'] || 0) + 1;
  }

  // Passa 1: seleciona até maxPerSector por setor, por ordem de score
  for (const article of allCandidates) {
    if (selected.length >= maxArticles) break;
    if (selected.includes(article)) continue;
    const primarySector = article.matchedSectors?.[0] || 'other';
    const count = sectorCounts[primarySector] || 0;
    if (count < maxPerSector) {
      selected.push(article);
      sectorCounts[primarySector] = count + 1;
    }
  }

  // Passa 2: se ainda faltam artigos, preenche com os restantes por score
  if (selected.length < maxArticles) {
    for (const article of allCandidates) {
      if (selected.length >= maxArticles) break;
      if (!selected.includes(article)) selected.push(article);
    }
  }

  // Se ainda não há validados suficientes, completa com os não validados
  if (selected.length < maxArticles) {
    const rest = sorted.filter(a => !a.isValidated && !selected.includes(a));
    selected.push(...rest.slice(0, maxArticles - selected.length));
  }

  return selected.slice(0, maxArticles);
}

function articleId() {
  return crypto.randomUUID();
}

async function createRun({ triggerType, triggeredBy }) {
  const run = {
    agent_name: 'news-agent',
    trigger_type: triggerType,
    triggered_by: triggeredBy || null,
    status: 'running',
    started_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin.from(AGENT_RUNS_TABLE).insert(run).select().single();
  if (error) throw error;
  return data;
}

async function finishRun(id, updates) {
  const { error } = await supabaseAdmin
    .from(AGENT_RUNS_TABLE)
    .update({ ...updates, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[agent_runs] erro ao atualizar execução:', error.message);
}


async function loadCustomSources() {
  try {
    const { data } = await supabaseAdmin
      .from('news_sources')
      .select('url, sector, priority')
      .eq('active', true)
      .order('priority', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    return data || [];
  } catch { return []; }
}

export async function runNewsAgent({ triggerType = 'manual', triggeredBy = 'admin', excludeUrls = [] } = {}) {
  let run;
  try {
    run = await createRun({ triggerType, triggeredBy });
  } catch (error) {
    throw new Error(`Não foi possível criar agent_run. Confirma a tabela ${AGENT_RUNS_TABLE}. Detalhe: ${error.message}`);
  }

  try {
    // Carrega fontes personalizadas do Supabase (já ordenadas por priority ASC)
    const customSources = await loadCustomSources();
    const customUrls = new Set(customSources.map(s => s.url));
    // Mapa url → priority para usar no sorting de artigos
    const customPriorityMap = new Map(customSources.map(s => [s.url.toLowerCase(), s.priority ?? 9999]));

    // Se o user tem fontes custom: custom primeiro, predefinidas a seguir
    // Se não tem fontes custom: usa só as predefinidas
    const activeSectorFeeds = {};
    const hasAnySources = customSources.length > 0;

    for (const [sector, feeds] of Object.entries(SECTOR_FEEDS)) {
      const custom = customSources.filter(s => s.sector === sector).map(s => s.url);
      if (custom.length > 0) {
        // Setor tem fontes custom — custom primeiro, depois as predefinidas
        const defaults = feeds.filter(u => !customUrls.has(u));
        activeSectorFeeds[sector] = [...custom, ...defaults];
      } else {
        // Sem fontes custom neste setor — usa só as predefinidas
        activeSectorFeeds[sector] = [...feeds];
      }
    }
    // Adiciona setores novos que só existem em fontes custom
    for (const src of customSources) {
      if (src.sector && src.url && !activeSectorFeeds[src.sector]) {
        activeSectorFeeds[src.sector] = [src.url];
      }
    }
    console.log('[agent] Modo fontes:', hasAnySources ? 'custom + predefinidas' : 'só predefinidas');
    console.log('[agent] Fontes activas por setor:', Object.fromEntries(Object.entries(activeSectorFeeds).map(([k, v]) => [k, v.length])));

    const rawArticles = await fetchAllRss(activeSectorFeeds);

    // Só filtra artigos JÁ PUBLICADOS — rejeitados e on_hold podem reaparecer
    let seenUrls = new Set();
    try {
      const { data: existingNews } = await supabaseAdmin
        .from('news')
        .select('url')
        .not('url', 'is', null)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (existingNews) existingNews.forEach(n => n.url && seenUrls.add(n.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()));
    } catch { /* ignora erros — continua sem filtro */ }

    // Também exclui URLs actualmente visíveis no dashboard (para entregar artigos diferentes a cada run)
    const excludeSet = new Set(
      excludeUrls.map(u => u.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()).filter(Boolean)
    );

    const filteredArticles = rawArticles.filter(a => {
      if (!a.url) return true;
      const norm = a.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
      if (seenUrls.has(norm)) return false;
      if (excludeSet.has(norm)) return false;
      return true;
    });

    console.log(`[agent] ${rawArticles.length} artigos brutos, ${filteredArticles.length} após filtrar publicados + ${excludeSet.size} actuais`);

    const SECTOR_TERMS = {
      'maritimo':       ['maritime', 'naval', 'shipping lane', 'vessel', 'shipbuilding', 'offshore', 'fleet', 'tanker', 'cargo ship', 'freighter', 'tugboat', 'harbor', 'seaport', 'seafarer', 'nautical', 'marine engineering', 'port authority'],
      'defesa-militar': ['defense', 'defence', 'military', 'armed forces', 'weapon system', 'missile', 'warship', 'combat', 'pentagon', 'nato', 'troops', 'warfare', 'munitions', 'air force', 'army'],
      'aeroespacial':   ['aerospace', 'aviation', 'aircraft', 'airline', 'satellite', 'rocket launch', 'orbit', 'uav', 'airport', 'spaceflight', 'astronaut', 'spacecraft'],
      'ferroviario':    ['railway', 'railroad', 'rolling stock', 'locomotive', 'tram', 'high-speed rail', 'rail freight', 'metro system'],
      'tecnologia':     ['technology', 'software', 'hardware', 'artificial intelligence', 'machine learning', 'deep learning', 'large language model', 'llm', 'generative ai', 'chatgpt', 'openai', 'anthropic', 'gemini', 'neural network', 'ai model', 'digital', 'cybersecurity', 'semiconductor', 'cloud computing', 'robotics', 'startup', 'automation', 'natural language processing', 'computer vision'],
      'fitness':        ['fitness', 'treino', 'exercício', 'ginásio', 'nutrição', 'saúde', 'yoga', 'pilates', 'crossfit', 'corrida', 'bem-estar', 'workout', 'exercise', 'gym', 'nutrition', 'health', 'running', 'strength', 'cardio', 'wellness', 'mulher', 'feminino', 'feminina', 'women', 'female'],
    };

    // Termos obrigatórios e de exclusão para o setor fitness (apenas PT + feminino)
    const FITNESS_PT_WORDS = ['de', 'da', 'do', 'em', 'para', 'com', 'que', 'não', 'uma', 'ao', 'na', 'se', 'por', 'mais', 'como', 'mas', 'as', 'os', 'às', 'é', 'são', 'foram'];
    const FITNESS_FEMALE_TERMS = ['mulher', 'mulheres', 'feminino', 'feminina', 'femininas', 'femininos', 'woman', 'women', 'female', 'girl', 'girls', 'ela', 'grávida', 'gravidez', 'maternidade', 'menopausa', 'menstrual', 'menstruação'];
    const FITNESS_MALE_EXCLUDE = [' homem', ' homens', 'masculino', 'masculina', " men'", " men ", "men's", ' male ', "male'", ' man ', "man's", 'boyfriend', 'husband', 'paternidade', ' pai ', ' rapaz', ' rapazes'];

    // Busca os feeds de cada setor — mínimo 10 artigos por setor
    const ARTICLES_PER_SECTOR = 10;
    const sectorArticles = [];
    const usedUrls = new Set();

    for (const [sectorKey, feeds] of Object.entries(activeSectorFeeds)) {
      const terms = SECTOR_TERMS[sectorKey] || [];

      // Extrai domínio base (sem subdomínios como "feeds.", "www.")
      function baseDomain(url) {
        try {
          const host = new URL(url).hostname.replace(/^www\./, '').replace(/^feeds\./, '');
          return host;
        } catch { return ''; }
      }

      // Conjunto de URLs exactos dos feeds deste setor e de outros setores
      const thisSectorFeedUrls = new Set(feeds.map(f => f.toLowerCase()));
      const otherSectorFeedUrls = new Set(
        Object.entries(activeSectorFeeds)
          .filter(([k]) => k !== sectorKey)
          .flatMap(([, fs]) => fs.map(f => f.toLowerCase()))
      );
      // Domínios para fontes sem _feedUrl (fallback)
      const sectorDomains = feeds.map(baseDomain).filter(Boolean);
      const allOtherDomains = Object.entries(SECTOR_FEEDS)
        .filter(([k]) => k !== sectorKey)
        .flatMap(([, fs]) => fs.map(baseDomain).filter(Boolean));

      const sectorRaw = filteredArticles.filter(a => {
        const text = `${a.title} ${a.description} ${a.content}`.toLowerCase();

        if (a._feedUrl) {
          const feedUrlLower = a._feedUrl.toLowerCase();
          // URL exacto do feed está neste setor → aceita sempre
          if (thisSectorFeedUrls.has(feedUrlLower)) return true;
          // URL exacto do feed está noutro setor → rejeita
          if (otherSectorFeedUrls.has(feedUrlLower)) return false;
          // Feed não está em nenhum setor → aceita por termos
          return terms.some(t => text.includes(t));
        }

        // Sem _feedUrl: usa domínio (comportamento legado)
        const articleDomain = a.url ? baseDomain(a.url) : '';
        const fromThisSectorFeed = sectorDomains.some(d => articleDomain === d || articleDomain.endsWith(`.${d}`));
        if (fromThisSectorFeed) return true;
        const fromOtherSectorFeed = allOtherDomains.some(d => articleDomain === d || articleDomain.endsWith(`.${d}`));
        if (fromOtherSectorFeed) return false;
        return terms.some(t => text.includes(t));
      });

      // Filtro extra para fitness: apenas artigos em PT e sobre fitness feminino
      let sectorFiltered = sectorRaw;
      if (sectorKey === 'fitness') {
        sectorFiltered = sectorRaw.filter(a => {
          const text = `${a.title || ''} ${a.description || ''} ${a.content || ''}`.toLowerCase();
          const ptCount = FITNESS_PT_WORDS.filter(w => new RegExp(`\\b${w}\\b`).test(text)).length;
          if (ptCount < 2) return false; // não está em português
          if (FITNESS_MALE_EXCLUDE.some(t => text.includes(t))) return false; // exclui conteúdo explicitamente masculino
          return true;
        });
        console.log(`[agent] Fitness após filtro PT+feminino: ${sectorFiltered.length}/${sectorRaw.length} artigos`);
      }

      // Prioridade: artigos de fontes custom entram primeiro (sem filtro de keywords),
      // depois preenchem-se as slots restantes com artigos das fontes predefinidas.
      const customFeedUrlsLower = new Set([...customUrls].map(u => u.toLowerCase()));
      const customSectorRaw = sectorFiltered.filter(a =>
        a._feedUrl && customFeedUrlsLower.has(a._feedUrl.toLowerCase())
      );
      const defaultSectorRaw = sectorFiltered.filter(a =>
        !a._feedUrl || !customFeedUrlsLower.has(a._feedUrl.toLowerCase())
      );
      if (customUrls.size > 0) {
        const flipFeeds = [...customFeedUrlsLower].filter(u => u.includes('flipboard'));
        if (flipFeeds.length > 0) {
          const allFlipRaw = filteredArticles.filter(a => flipFeeds.some(f => a._feedUrl?.toLowerCase() === f));
          console.log(`[agent][debug] Flipboard: ${allFlipRaw.length} artigos em filteredArticles, ${customSectorRaw.length} em customSectorRaw para setor ${sectorKey}`);
          if (allFlipRaw.length === 0) {
            const rawFlip = rawArticles.filter(a => flipFeeds.some(f => a._feedUrl?.toLowerCase() === f));
            console.log(`[agent][debug] Flipboard: ${rawFlip.length} artigos brutos (antes de filtro seenUrls)`);
          }
        }
      }

      // Artigos custom: máximo 3-4 por setor (mistura com predefinidas)
      const CUSTOM_SLOTS = customSectorRaw.length > 0 ? Math.min(4, Math.floor(ARTICLES_PER_SECTOR * 0.35)) : 0;
      const customScored = customSectorRaw
        .filter(a => (a.url || a.title) && !usedUrls.has(a.url || a.title))
        .sort((a, b) => {
          const pa = customPriorityMap.get(a._feedUrl?.toLowerCase()) ?? 9999;
          const pb = customPriorityMap.get(b._feedUrl?.toLowerCase()) ?? 9999;
          if (pa !== pb) return pa - pb;
          return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
        })
        .slice(0, CUSTOM_SLOTS)
        .map(a => ({ ...a, _isCustomSource: true, finalScore: 80, postDescription: generatePostDescription(a) }));

      // Slots restantes: fontes predefinidas passam pelo scoring normal
      const customUsedKeys = new Set(customScored.map(a => a.url || a.title));
      const slotsLeft = ARTICLES_PER_SECTOR - customScored.length;
      const defaultScored = slotsLeft > 0
        ? scoreArticles(defaultSectorRaw, slotsLeft * 3)
            .filter(a => {
              const key = a.url || a.title;
              return !usedUrls.has(key) && !customUsedKeys.has(key);
            })
            .slice(0, slotsLeft)
        : [];

      const scored = [...customScored, ...defaultScored];

      scored.forEach(a => {
        a._forcedCategory = sectorKey;
        usedUrls.add(a.url || a.title);
      });

      sectorArticles.push(...scored);
      console.log(`[agent] Setor ${sectorKey}: ${scored.length} artigos`);
    }

    const selectedArticles = sectorArticles;
    // Enriquece imagens e gera resumos AI em paralelo
    const [enrichedArticles, aiSummaries] = await Promise.all([
      enrichWithImages(selectedArticles),
      Promise.all(selectedArticles.map(a =>
        generateAiSummary(a.title, a.description || a.content || '')
      )),
    ]);

    // Os artigos NÃO são guardados no Supabase aqui.
    // Ficam em memória local no browser até o admin decidir publicar ou rejeitar.
    const articles = enrichedArticles.map((article, i) => {
      const category = article._forcedCategory || dashboardCategory(article.matchedSectors);
      const fallback = getFallbackImage(category);
      return {
        id: articleId(),
        title: article.title.slice(0, 300),
        content: article.postDescription,
        description: (article.description || article.content || '').slice(0, 500),
        summary: aiSummaries[i] || null,
        url: article.url || null,
        source: article.source || 'RSS',
        category,
        imageUrl: article.image || fallback,
        publishedAt: article.publishedAt || new Date().toISOString(),
        status: 'pending',
        receivedAt: new Date().toISOString(),
        processedAt: null,
        processedBy: null,
        rejectReason: null,
      };
    });

    const summary = {
      fetched_count: rawArticles.length,
      selected_count: selectedArticles.length,
      inserted_count: 0,
      duplicate_count: 0,
    };

    await finishRun(run.id, { status: 'completed', inserted_count: articles.length, summary });
    notifyClients();

    return { run_id: run.id, status: 'completed', articles, ...summary };
  } catch (error) {
    await finishRun(run.id, { status: 'failed', error: error.message });
    throw Object.assign(error, { run_id: run.id });
  }
}
