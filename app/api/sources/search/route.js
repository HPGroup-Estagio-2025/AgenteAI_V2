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

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function score(source, query) {
  const q = normalize(query);
  const name = normalize(source.name);
  const url = normalize(source.url);
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (url.includes(q.replace(/ /g, ''))) return 40;
  // Correspondência por palavras
  const words = q.split(' ').filter(w => w.length > 2);
  const matches = words.filter(w => name.includes(w)).length;
  return matches > 0 ? matches * 20 : 0;
}

export async function POST(request) {
  if (!auth(request)) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { query } = await request.json().catch(() => ({}));
  if (!query || query.trim().length < 2) return NextResponse.json({ results: [] });

  const q = query.trim();

  // Pesquisa na base de fontes conhecidas
  const scored = KNOWN_SOURCES
    .map(src => ({ ...src, score: score(src, q) }))
    .filter(src => src.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // Se encontrou resultados na base conhecida, devolve
  if (scored.length > 0) {
    return NextResponse.json({ results: scored });
  }

  // Fallback: gera feed do Google News para o termo pesquisado
  const googleFeedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en&gl=US&ceid=US:en`;
  return NextResponse.json({
    results: [{
      name: `Google News: "${q}"`,
      url: googleFeedUrl,
      sector: null, // utilizador escolhe
      score: 50,
      isGoogleNews: true,
    }],
  });
}
