import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

function tagValue(xml, tag) {
  const escaped = tag.replace(':', '\\:');
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return (match?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
function attrValue(xml, tag, attr) {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return match?.[1] || '';
}

const DEFENSE_TERMS = ['defense', 'defence', 'military', 'armed forces', 'weapon', 'missile', 'warship', 'combat', 'pentagon', 'nato', 'troops', 'warfare', 'army'];
const MARINE_TERMS  = ['maritime', 'naval', 'shipping', 'vessel', 'shipbuilding', 'offshore', 'fleet', 'tanker', 'harbor', 'seaport', 'nautical'];
const AERO_TERMS    = ['aerospace', 'aviation', 'aircraft', 'satellite', 'rocket', 'orbit', 'spaceflight', 'astronaut'];
const SECTOR_TERMS_MAP = { 'defesa-militar': DEFENSE_TERMS, 'maritimo': MARINE_TERMS, 'aeroespacial': AERO_TERMS };

export async function GET() {
  const { data: sources } = await supabaseAdmin.from('news_sources').select('*').eq('active', true);
  if (!sources?.length) return NextResponse.json({ error: 'Sem fontes custom' });

  const results = [];

  for (const src of sources.slice(0, 2)) { // testa as primeiras 2 fontes
    const result = { source: src.name, url: src.url, sector: src.sector, steps: {} };

    // Passo 1: Fetch
    let text = '';
    try {
      const res = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
      text = await res.text();
      result.steps.fetch = { ok: res.ok, status: res.status, length: text.length };
    } catch (e) { result.steps.fetch = { error: e.message }; results.push(result); continue; }

    // Passo 2: Parse artigos
    const itemsXml = [...String(text).matchAll(/<item[\s\S]*?<\/item>/gi)].map(m => m[0])
      .concat([...String(text).matchAll(/<entry[\s\S]*?<\/entry>/gi)].map(m => m[0]));

    const articles = itemsXml.map(item => ({
      title: tagValue(item, 'title'),
      url: tagValue(item, 'link') || attrValue(item, 'link', 'href') || tagValue(item, 'guid'),
      description: tagValue(item, 'description'),
    }));
    result.steps.parse = { total: articles.length, sample: articles.slice(0, 2).map(a => ({ title: a.title.slice(0, 60), url: a.url.slice(0, 80), hasDescription: !!a.description })) };

    // Passo 3: Filtro de termos do setor
    const terms = SECTOR_TERMS_MAP[src.sector] || [];
    const filtered = articles.filter(a => {
      const text2 = `${a.title} ${a.description}`.toLowerCase();
      return terms.some(t => text2.includes(t));
    });
    result.steps.termFilter = {
      passed: filtered.length,
      failed: articles.length - filtered.length,
      terms,
      failedTitles: articles.filter(a => !filtered.includes(a)).slice(0, 3).map(a => a.title.slice(0, 60)),
    };

    results.push(result);
  }

  return NextResponse.json({ results }, { headers: { 'Content-Type': 'application/json' } });
}
