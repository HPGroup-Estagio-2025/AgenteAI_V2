import { NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/src/lib/auth';

function auth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return false;
  try { verifyToken(token); return true; } catch { return false; }
}

function extractRssTitle(xml) {
  const m = xml.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
  return m?.[1]?.trim().replace(/<[^>]+>/g, '') || null;
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
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = `https://${targetUrl}`;

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
      const title = extractRssTitle(text);
      const items = countRssItems(text);
      if (items === 0) {
        return NextResponse.json({ valid: false, error: 'O feed RSS não contém artigos' });
      }
      return NextResponse.json({
        valid: true,
        feedUrl: targetUrl,
        name: title || new URL(targetUrl).hostname,
        itemCount: items,
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
              const title = extractRssTitle(feedText);
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
    if (err.name === 'AbortError') return NextResponse.json({ valid: false, error: 'Tempo limite excedido ao aceder ao URL' });
    return NextResponse.json({ valid: false, error: `Erro ao aceder ao URL: ${err.message}` });
  }
}
