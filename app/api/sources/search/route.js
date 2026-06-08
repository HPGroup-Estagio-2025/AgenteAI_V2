import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';

function auth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return false;
  try { verifyToken(token); return true; } catch { return false; }
}

// Base de fontes conhecidas para pesquisa por nome
const KNOWN_SOURCES = [
  // Marítimo
  { name: 'Naval Technology',       url: 'https://www.naval-technology.com/feed/', sector: 'maritimo' },
  { name: 'gCaptain',               url: 'https://gcaptain.com/feed/', sector: 'maritimo' },
  { name: 'Maritime Executive',     url: 'https://maritime-executive.com/rss/articles', sector: 'maritimo' },
  { name: 'Splash 247',             url: 'https://splash247.com/feed/', sector: 'maritimo' },
  { name: 'TradeWinds',             url: 'https://www.tradewindsnews.com/rss', sector: 'maritimo' },
  { name: 'Lloyd\'s List',          url: 'https://www.lloydslist.com/rss', sector: 'maritimo' },
  { name: 'Hellenic Shipping News', url: 'https://www.hellenicshippingnews.com/feed/', sector: 'maritimo' },
  { name: 'Marine Link',            url: 'https://www.marinelink.com/rss/all', sector: 'maritimo' },
  { name: 'Port Technology',        url: 'https://www.porttechnology.org/feed/', sector: 'maritimo' },
  { name: 'Offshore Energy',        url: 'https://www.offshore-energy.biz/feed/', sector: 'maritimo' },

  // Defesa Militar
  { name: 'Defense News',           url: 'https://www.defensenews.com/arc/outboundfeeds/rss/', sector: 'defesa-militar' },
  { name: 'Breaking Defense',       url: 'https://breakingdefense.com/feed/', sector: 'defesa-militar' },
  { name: 'Jane\'s',                url: 'https://www.janes.com/feeds/news', sector: 'defesa-militar' },
  { name: 'Military.com',           url: 'https://www.military.com/rss-feeds/content', sector: 'defesa-militar' },
  { name: 'The War Zone',           url: 'https://www.thedrive.com/the-war-zone/feed', sector: 'defesa-militar' },
  { name: 'Defense One',            url: 'https://www.defenseone.com/rss/all/', sector: 'defesa-militar' },
  { name: 'Army Times',             url: 'https://www.armytimes.com/arc/outboundfeeds/rss/', sector: 'defesa-militar' },
  { name: 'Naval News',             url: 'https://www.navalnews.com/feed/', sector: 'defesa-militar' },
  { name: 'Alert 5',                url: 'https://alert5.com/feed/', sector: 'defesa-militar' },

  // Aeroespacial
  { name: 'Space News',             url: 'https://spacenews.com/feed/', sector: 'aeroespacial' },
  { name: 'Simple Flying',          url: 'https://simpleflying.com/feed/', sector: 'aeroespacial' },
  { name: 'Aviation Week',          url: 'https://aviationweek.com/rss.xml', sector: 'aeroespacial' },
  { name: 'FlightGlobal',           url: 'https://www.flightglobal.com/rss/news', sector: 'aeroespacial' },
  { name: 'Aero Telegraph',         url: 'https://www.aerotelegraph.com/feed', sector: 'aeroespacial' },
  { name: 'The Air Current',        url: 'https://theaircurrent.com/feed/', sector: 'aeroespacial' },
  { name: 'Space.com',              url: 'https://www.space.com/feeds/all', sector: 'aeroespacial' },
  { name: 'Parabolic Arc',          url: 'https://www.parabolicarc.com/feed/', sector: 'aeroespacial' },

  // Ferroviário
  { name: 'Railway Technology',     url: 'https://www.railway-technology.com/feed/', sector: 'ferroviario' },
  { name: 'Rail Journal',           url: 'https://www.railjournal.com/feed/', sector: 'ferroviario' },
  { name: 'Railway Gazette',        url: 'https://www.railwaygazette.com/rss', sector: 'ferroviario' },
  { name: 'International Railway',  url: 'https://www.internationalrailwayjournal.com/feed/', sector: 'ferroviario' },
  { name: 'Metro Report',           url: 'https://www.metreport.com/feed/', sector: 'ferroviario' },

  // Tecnologia
  { name: 'Ars Technica',           url: 'https://feeds.arstechnica.com/arstechnica/index', sector: 'tecnologia' },
  { name: 'The Verge',              url: 'https://www.theverge.com/rss/index.xml', sector: 'tecnologia' },
  { name: 'TechCrunch',             url: 'https://techcrunch.com/feed/', sector: 'tecnologia' },
  { name: 'Wired',                  url: 'https://www.wired.com/feed/rss', sector: 'tecnologia' },
  { name: 'MIT Technology Review',  url: 'https://www.technologyreview.com/feed/', sector: 'tecnologia' },
];

// Palavras-chave que mapeiam para sectores
const SECTOR_KEYWORDS = {
  'maritimo':       ['maritimo', 'maritimo', 'marítimo', 'naval', 'shipping', 'marine', 'marinha', 'navio', 'porto', 'offshore', 'ocean'],
  'defesa-militar': ['defesa', 'militar', 'military', 'defense', 'defence', 'army', 'exercito', 'força armada', 'forcas armadas', 'guerra', 'weapon'],
  'aeroespacial':   ['aeroespacial', 'aerospace', 'aviacao', 'aviação', 'aviation', 'espaco', 'espaço', 'space', 'rocket', 'satellite', 'drone'],
  'ferroviario':    ['ferroviario', 'ferroviário', 'railway', 'comboio', 'rail', 'train', 'metro', 'tram'],
  'tecnologia':     ['tecnologia', 'technology', 'tech', 'software', 'digital', 'inovacao', 'inovação', 'innovation'],
};

function normalize(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9 ]/g, '').trim();
}

function matchesSector(query) {
  const q = normalize(query);
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some(k => normalize(k) === q || q.includes(normalize(k)) || normalize(k).includes(q))) {
      return sector;
    }
  }
  return null;
}

function score(source, query) {
  const q = normalize(query);
  const name = normalize(source.name);
  const url = normalize(source.url);
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (url.includes(q.replace(/ /g, ''))) return 40;
  const words = q.split(' ').filter(w => w.length > 2);
  const matches = words.filter(w => name.includes(w)).length;
  return matches > 0 ? matches * 20 : 0;
}

function isRssXml(text) {
  return /<rss|<feed|<channel|<atom/i.test(text.slice(0, 2000));
}

function countItems(xml) {
  return (xml.match(/<item[\s>]/gi) || []).length + (xml.match(/<entry[\s>]/gi) || []).length;
}

function extractTitle(xml) {
  const m = xml.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
  return m?.[1]?.trim().replace(/<[^>]+>/g, '').slice(0, 80) || null;
}

// Tenta vários padrões de feed RSS comuns para um domínio
async function tryFeedPatterns(domain) {
  const patterns = ['/feed/', '/feed', '/rss/', '/rss', '/rss.xml', '/atom.xml', '/feed.xml', '/feeds/all'];
  const base = domain.startsWith('http') ? domain.replace(/\/$/, '') : `https://${domain}`;
  for (const path of patterns) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; publixy-validator/1.0)' },
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (isRssXml(text) && countItems(text) > 0) {
        return { url: `${base}${path}`, name: extractTitle(text) || domain, itemCount: countItems(text) };
      }
    } catch { continue; }
  }
  return null;
}

// Pesquisa DuckDuckGo para encontrar o site da fonte
async function searchWeb(query) {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query + ' news RSS feed')}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; publixy-validator/1.0)' }, signal: controller.signal }
    );
    const data = await res.json().catch(() => ({}));
    const urls = [];
    if (data.AbstractURL) urls.push(data.AbstractURL);
    if (Array.isArray(data.Results)) data.Results.slice(0, 3).forEach(r => r.FirstURL && urls.push(r.FirstURL));
    if (Array.isArray(data.RelatedTopics)) data.RelatedTopics.slice(0, 2).forEach(r => r.FirstURL && urls.push(r.FirstURL));
    return [...new Set(urls)].filter(u => /^https?:\/\//i.test(u));
  } catch { return []; }
}

export async function POST(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { query } = await request.json().catch(() => ({}));
  if (!query || query.trim().length < 2) return NextResponse.json({ results: [], notFound: false });

  const q = query.trim();

  // 1a. Verifica se é um setor — devolve todas as fontes desse setor
  const matchedSector = matchesSector(q);
  if (matchedSector) {
    const sectorSources = KNOWN_SOURCES
      .filter(src => src.sector === matchedSector)
      .map(src => ({ ...src, score: 90, isSectorSuggestion: true }));
    return NextResponse.json({ results: sectorSources, notFound: false, sectorMatch: matchedSector });
  }

  // 1b. Pesquisa por nome na base de fontes conhecidas
  const scored = KNOWN_SOURCES
    .map(src => ({ ...src, score: score(src, q) }))
    .filter(src => src.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (scored.length > 0) {
    return NextResponse.json({ results: scored, notFound: false });
  }

  // 2. Pesquisa na web para encontrar o site
  const webUrls = await searchWeb(q);
  for (const webUrl of webUrls.slice(0, 3)) {
    try {
      const domain = new URL(webUrl).origin;
      const feed = await tryFeedPatterns(domain);
      if (feed) {
        return NextResponse.json({
          results: [{ name: feed.name || q, url: feed.url, sector: null, score: 70, itemCount: feed.itemCount }],
          notFound: false,
        });
      }
    } catch { continue; }
  }

  // 3. Tenta construir URL directamente a partir do nome (ex: "Naval Times" → naval-times.com)
  const domainGuess = q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const tld of ['.com', '.org', '.net']) {
    const feed = await tryFeedPatterns(`${domainGuess}${tld}`);
    if (feed) {
      return NextResponse.json({
        results: [{ name: feed.name || q, url: feed.url, sector: null, score: 50, itemCount: feed.itemCount }],
        notFound: false,
      });
    }
  }

  // 4. Não encontrado
  return NextResponse.json({ results: [], notFound: true });
}
