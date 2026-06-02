import crypto from 'crypto';
import { supabase } from './supabase';
import { notifyClients } from './events';

const AGENT_RUNS_TABLE = process.env.SUPABASE_AGENT_RUNS_TABLE || 'agent_runs';

const RSS_FEEDS = [
  'https://www.defensenews.com/arc/outboundfeeds/rss/',
  'https://news.google.com/rss/search?q=naval+technology&hl=en-US&gl=US&ceid=US:en',
  'https://www.railway-technology.com/feed/',
  'https://spacenews.com/feed/',
];

const sectors = {
  supplyChain: ['supply chain', 'procurement', 'sourcing', 'inventory', 'warehouse', 'supplier'],
  logistics: ['logistics', 'freight', 'shipping', 'transport', 'distribution', 'cargo'],
  marine: ['marine', 'maritime', 'shipbuilding', 'naval', 'port', 'vessel'],
  defense: ['defense', 'defence', 'military', 'army', 'navy', 'air force'],
  aviation: ['aviation', 'aircraft', 'airline', 'aerospace', 'airport'],
  space: ['space', 'satellite', 'orbital', 'launch', 'spacecraft'],
  railway: ['railway', 'rail', 'train', 'rolling stock', 'metro'],
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

function generatePostDescription(article) {
  const title = article.title || 'Untitled article';
  const sectorsText = Array.isArray(article.matchedSectors) ? article.matchedSectors.join(', ') : 'General industry';
  const source = article.source || 'Unknown source';
  const riskText = Array.isArray(article.matchedRiskTerms) && article.matchedRiskTerms.length > 0
    ? `Sensitive terms detected: ${article.matchedRiskTerms.join(', ')}.`
    : '';

  return `${title}\n\nKey sectors: ${sectorsText}\n\nSource: ${source}\n\nThis article highlights relevant developments that may impact strategic operations, supply chains, infrastructure, technology, or market positioning.\n\n${riskText}`.trim();
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
      const response = await fetch(feedUrl, { headers: { 'User-Agent': 'dashboard-news-agent/1.0' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`${feedUrl} respondeu ${response.status}`);
      return parseRss(await response.text(), feedUrl);
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
  const validated = sorted.filter(a => a.isValidated);
  if (validated.length >= maxArticles) return validated.slice(0, maxArticles);
  // Se não há validados suficientes, completa com os melhores restantes
  const rest = sorted.filter(a => !a.isValidated);
  return [...validated, ...rest].slice(0, maxArticles);
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
    const enrichedArticles = await enrichWithImages(rawArticles);
    const selectedArticles = scoreArticles(enrichedArticles, 5);

    // Os artigos NÃO são guardados no Supabase aqui.
    // Ficam em memória local no browser até o admin decidir publicar ou rejeitar.
    const articles = selectedArticles.map(article => ({
      id: articleId(),
      title: article.title.slice(0, 300),
      content: article.postDescription,
      url: article.url || null,
      source: article.source || 'RSS',
      category: dashboardCategory(article.matchedSectors),
      imageUrl: article.image || null,
      publishedAt: article.publishedAt || new Date().toISOString(),
      status: 'pending',
      receivedAt: new Date().toISOString(),
      processedAt: null,
      processedBy: null,
      rejectReason: null,
    }));

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
