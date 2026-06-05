import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from './supabase';
import { notifyClients } from './events';

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

const RSS_FEEDS = [
  // Fontes especializadas — Marítimo / Naval
  'https://www.naval-technology.com/feed/',
  'https://www.maritime-executive.com/rss',
  'https://splash247.com/feed/',
  'https://www.tradewindsnews.com/rss',
  'https://gcaptain.com/feed/',
  // Fontes especializadas — Defesa / Militar
  'https://www.defensenews.com/arc/outboundfeeds/rss/',
  'https://www.janes.com/feeds/news',
  'https://breakingdefense.com/feed/',
  // Fontes especializadas — Aeroespacial / Aviação
  'https://spacenews.com/feed/',
  'https://www.aviationweek.com/rss.xml',
  'https://simpleflying.com/feed/',
  // Fontes especializadas — Ferroviário
  'https://www.railway-technology.com/feed/',
  'https://www.railjournal.com/feed/',
  // Fontes especializadas — Indústria / Supply Chain
  'https://www.supplychaindive.com/feeds/news/',
  'https://www.industryweek.com/rss',
  // Google News — Marítimo / Naval
  'https://news.google.com/rss/search?q=maritime+shipping+port+vessel+2025&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=naval+shipbuilding+marine+engine&hl=en-US&gl=US&ceid=US:en',
  // Google News — Defesa / Militar
  'https://news.google.com/rss/search?q=defense+military+navy+procurement+2025&hl=en-US&gl=US&ceid=US:en',
  // Google News — Aeroespacial
  'https://news.google.com/rss/search?q=aerospace+aviation+aircraft+space+launch+2025&hl=en-US&gl=US&ceid=US:en',
  // Google News — Ferroviário
  'https://news.google.com/rss/search?q=railway+rail+train+rolling+stock+2025&hl=en-US&gl=US&ceid=US:en',
  // Google News — Supply Chain / Logistics
  'https://news.google.com/rss/search?q=supply+chain+logistics+shipping+freight+2025&hl=en-US&gl=US&ceid=US:en',
];

// Imagens de fallback estáveis por categoria (usadas quando o artigo não tem imagem)
const FALLBACK_IMAGES = {
  'maritimo':       'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
  'defesa-militar': 'https://images.unsplash.com/photo-1547745369-5fa52b64e8ac?w=800&q=80',
  'aeroespacial':   'https://images.unsplash.com/photo-1446776877081-d282a0f896e2?w=800&q=80',
  'ferroviario':    'https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=800&q=80',
  'default':        'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&q=80',
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
  return match?.[1] || '';
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
  return matchedSectors[0] || 'industry';
}

function decodeEntities(raw) {
  return (raw || ‘’)
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, ‘&’)
    .replace(/&quot;/g, ‘”’)
    .replace(/&#39;/g, “’”)
    .replace(/&apos;/g, “’”)
    .replace(/&lt;/g, ‘<’)
    .replace(/&gt;/g, ‘>’)
    .replace(/&nbsp;/g, ‘ ‘)
    .replace(/&mdash;/g, ‘—‘)
    .replace(/&ndash;/g, ‘–‘)
    .replace(/&rsquo;/g, ‘’’)
    .replace(/&lsquo;/g, ‘‘’)
    .replace(/&rdquo;/g, ‘”’)
    .replace(/&ldquo;/g, ‘“’)
    .replace(/&hellip;/g, ‘…’);
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
    const url = tagValue(itemXml, 'link') || tagValue(itemXml, 'guid');
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
      source: tagValue(itemXml, 'source') || sourceFromUrl(feedUrl),
      publishedAt: tagValue(itemXml, 'pubDate') || tagValue(itemXml, 'dc:date') || tagValue(itemXml, 'updated') || new Date().toISOString(),
      rawProvider: 'RSS',
    };
  });
}

async function fetchOgImage(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'dashboard-news-agent/1.0' },
    });
    clearTimeout(timeout);
    if (!response.ok) return '';
    const html = await response.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function enrichWithImages(articles) {
  const missing = articles.filter(a => !a.image && a.url);
  if (missing.length === 0) return articles;

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

  return articles.map(a =>
    !a.image && imageMap.has(a.url) ? { ...a, image: imageMap.get(a.url) } : a
  );
}

function sourceFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('defensenews')) return 'Defense News';
    if (host.includes('spacenews')) return 'SpaceNews';
    if (host.includes('railway-technology')) return 'Railway Technology';
    if (host.includes('news.google')) return 'Google News';
    return host;
  } catch {
    return 'RSS';
  }
}

async function fetchAllRss() {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async feedUrl => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(feedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dashboard-news-agent/1.0)' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${feedUrl} respondeu ${response.status}`);
        return parseRss(await response.text(), feedUrl);
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
    .slice(0, 50);

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

  // Passa 1: seleciona até maxPerSector por setor, por ordem de score
  for (const article of allCandidates) {
    if (selected.length >= maxArticles) break;
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

  const { data, error } = await supabase.from(AGENT_RUNS_TABLE).insert(run).select().single();
  if (error) throw error;
  return data;
}

async function finishRun(id, updates) {
  const { error } = await supabase
    .from(AGENT_RUNS_TABLE)
    .update({ ...updates, finished_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[agent_runs] erro ao atualizar execução:', error.message);
}

export async function runNewsAgent({ triggerType = 'manual', triggeredBy = 'admin' } = {}) {
  let run;
  try {
    run = await createRun({ triggerType, triggeredBy });
  } catch (error) {
    throw new Error(`Não foi possível criar agent_run. Confirma a tabela ${AGENT_RUNS_TABLE}. Detalhe: ${error.message}`);
  }

  try {
    const rawArticles = await fetchAllRss();

    // Só filtra artigos JÁ PUBLICADOS — rejeitados e on_hold podem reaparecer
    let seenUrls = new Set();
    try {
      const { data: existingNews } = await supabase
        .from('news')
        .select('url')
        .not('url', 'is', null)
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (existingNews) existingNews.forEach(n => n.url && seenUrls.add(n.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()));
    } catch { /* ignora erros — continua sem filtro */ }

    const filteredArticles = seenUrls.size > 0
      ? rawArticles.filter(a => {
          if (!a.url) return true;
          const norm = a.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
          return !seenUrls.has(norm);
        })
      : rawArticles;

    console.log(`[agent] ${rawArticles.length} artigos brutos, ${filteredArticles.length} após filtrar publicados`);

    // Busca mais artigos por execução (15 em vez de 8)
    const MAX_ARTICLES = 15;
    const selectedArticles = scoreArticles(filteredArticles, MAX_ARTICLES);
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
      const category = dashboardCategory(article.matchedSectors);
      const fallback = FALLBACK_IMAGES[category] || FALLBACK_IMAGES['default'];
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
