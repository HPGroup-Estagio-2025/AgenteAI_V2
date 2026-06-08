import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

function isRssXml(text) {
  return /<rss|<feed|<channel|<atom/i.test(text.slice(0, 2000));
}
function countItems(xml) {
  return (xml.match(/<item[\s>]/gi) || []).length + (xml.match(/<entry[\s>]/gi) || []).length;
}
function parseItems(xml) {
  const items = [...String(xml).matchAll(/<item[\s\S]*?<\/item>/gi)].map(m => m[0])
    .concat([...String(xml).matchAll(/<entry[\s\S]*?<\/entry>/gi)].map(m => m[0]));
  return items.slice(0, 3).map(item => {
    const title = item.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim().slice(0, 60) || '';
    const linkText = item.match(/<link[^>]*>(.*?)<\/link>/i)?.[1]?.trim() || '';
    const linkHref = item.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || '';
    const guid = item.match(/<guid[^>]*>(.*?)<\/guid>/i)?.[1]?.trim() || '';
    const url = linkText || linkHref || guid;
    return { title, url: url.slice(0, 80) };
  });
}

export async function GET(request) {
  const { data: sources } = await supabaseAdmin
    .from('news_sources').select('*').eq('active', true);

  if (!sources?.length) {
    return NextResponse.json({ message: 'Nenhuma fonte custom encontrada na tabela news_sources', sources: [] });
  }

  const results = [];
  for (const src of sources) {
    const result = { id: src.id, name: src.name, url: src.url, sector: src.sector };
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 8000);
      const res = await fetch(src.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; publixy/1.0)' },
        signal: controller.signal,
      });
      result.httpStatus = res.status;
      if (!res.ok) { result.error = `HTTP ${res.status}`; results.push(result); continue; }
      const text = await res.text();
      result.isRss = isRssXml(text);
      result.itemCount = countItems(text);
      result.contentLength = text.length;
      result.sampleItems = parseItems(text);
    } catch (e) {
      result.error = e.message;
    }
    results.push(result);
  }

  return NextResponse.json({ count: sources.length, results });
}
