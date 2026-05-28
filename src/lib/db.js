import { supabase } from './supabase';
import { getStore, addToStore, VALID_SECTORS } from './store';
import { notifyClients } from './events';

export { VALID_SECTORS };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const USE_SUPABASE = url.length > 0 && !url.includes('xxxx');
const NEWS_TABLE = process.env.SUPABASE_NEWS_TABLE || 'news';
const PENDING_STATUSES = ['pending', 'draft'];
const SECTOR_ALIASES = {
  maritimo: ['maritimo', 'maritime', 'marine'],
  'defesa-militar': ['defesa-militar', 'defesa', 'defense', 'military'],
  aeroespacial: ['aeroespacial', 'aerospace', 'space'],
  ferroviario: ['ferroviario', 'ferrovia', 'rail', 'railway'],
};
const TITLE_STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por', 'que',
  'the', 'a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'to', 'with',
]);

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  }
}

function duplicateKeys(item) {
  const keys = [];
  const title = normalizeText(item?.title);
  const content = normalizeText(item?.content || item?.post);
  const url = normalizeUrl(item?.url || item?.link);
  const titleSignature = titleDuplicateSignature(title);

  if (title) keys.push(`title:${title}`);
  if (titleSignature) keys.push(`title-signature:${titleSignature}`);
  if (url) keys.push(`url:${url}`);
  if (content.length >= 80) keys.push(`content:${content.slice(0, 500)}`);

  return keys;
}

function titleTokens(value) {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 4 && !TITLE_STOP_WORDS.has(token));
}

function titleDuplicateSignature(value) {
  const tokens = [...new Set(titleTokens(value))].sort();
  return tokens.length >= 4 ? tokens.join(' ') : '';
}

function titleSimilarity(a, b) {
  const aTokens = new Set(titleTokens(a));
  const bTokens = new Set(titleTokens(b));
  if (aTokens.size < 4 || bTokens.size < 4) return 0;

  let common = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) common += 1;
  }

  return common / Math.min(aTokens.size, bTokens.size);
}

function hasDuplicateKey(a, b) {
  const aKeys = new Set(duplicateKeys(a));
  if (duplicateKeys(b).some(key => aKeys.has(key))) return true;
  return titleSimilarity(a?.title, b?.title) >= 0.86;
}

function dedupeNews(news) {
  const seen = new Set();
  return news.filter(item => {
    const keys = duplicateKeys(item);
    if (keys.length === 0 || keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  });
}

function countByStatus(news, status) {
  return dedupeNews(news.filter(item => item.status === status)).length;
}

function countBySector(news, sector) {
  return dedupeNews(news.filter(item => item.category?.toLowerCase() === sector)).length;
}

function isMissingTableError(error) {
  return error?.code === 'PGRST205' || error?.message?.includes('Could not find the table');
}

function normalizeStatus(status) {
  if (PENDING_STATUSES.includes(status)) return 'pending';
  return status || 'pending';
}

function parseSector(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value[0] || '';
  if (typeof value !== 'string') return String(value);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed[0] || '';
  } catch {}
  return value;
}

function normalizeSector(value) {
  const sector = parseSector(value).toLowerCase();
  for (const [key, aliases] of Object.entries(SECTOR_ALIASES)) {
    if (aliases.includes(sector)) return key;
  }
  return sector;
}

function toDashboardNews(row) {
  if (!row) return null;
  const status = normalizeStatus(row.status);
  return {
    ...row,
    status,
    content: row.content || row.post || row.url || '',
    url: row.url || null,
    category: row.category || normalizeSector(row.sector),
    imageUrl: row.imageUrl || row.image || null,
    publishedAt: row.publishedAt || row.date || row.created_at || null,
    receivedAt: row.receivedAt || row.created_at || row.updated_at || null,
    processedAt: row.processedAt || (status !== 'pending' ? row.updated_at : null),
    rejectReason: row.rejectReason || null,
  };
}

async function fetchNewsForDuplicateCheck() {
  const rows = [];
  const pageSize = 1000;
  const selectColumns = 'id,title,post,url,source,created_at';

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(NEWS_TABLE)
      .select(selectColumns)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      if (isMissingTableError(error)) return null;
      throw error;
    }

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function toSupabaseInsert(item) {
  return {
    id: item.id,
    title: item.title,
    post: item.content || null,
    url: item.url || null,
    source: item.source,
    date: item.publishedAt,
    image: item.imageUrl,
    sector: item.category ? JSON.stringify([item.category]) : null,
    status: item.status === 'pending' ? 'draft' : item.status,
    created_at: item.receivedAt,
    updated_at: item.receivedAt,
  };
}

function toSupabaseUpdates(updates) {
  const mapped = {};
  if (updates.status) mapped.status = updates.status === 'pending' ? 'draft' : updates.status;
  if (updates.content !== undefined) mapped.post = updates.content;
  if (updates.source !== undefined) mapped.source = updates.source;
  if (updates.publishedAt !== undefined) mapped.date = updates.publishedAt;
  if (updates.imageUrl !== undefined) mapped.image = updates.imageUrl;
  if (updates.category !== undefined) mapped.sector = updates.category ? JSON.stringify([updates.category]) : null;
  mapped.updated_at = updates.processedAt || new Date().toISOString();
  return mapped;
}

function listNewsFromStore({ status, sector, search, pageNum, limitNum }) {
  const start = (pageNum - 1) * limitNum;
  const store = getStore();
  let filtered = [...store];
  if (status && ['pending', 'published', 'rejected'].includes(status)) filtered = filtered.filter(n => n.status === status);
  if (sector && VALID_SECTORS.includes(sector)) filtered = filtered.filter(n => n.category?.toLowerCase() === sector);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(n => n.title?.toLowerCase().includes(q) || n.source?.toLowerCase().includes(q) || n.category?.toLowerCase().includes(q));
  }
  filtered = dedupeNews(filtered);
  const total = filtered.length;
  return {
    news: filtered.slice(start, start + limitNum),
    total,
    totalPages: Math.ceil(total / limitNum) || 1,
    counts: { pending: countByStatus(store, 'pending'), published: countByStatus(store, 'published'), rejected: countByStatus(store, 'rejected') },
    sectorCounts: Object.fromEntries(VALID_SECTORS.map(s => [s, countBySector(store, s)])),
  };
}

export async function listNews({ status, sector, search, pageNum, limitNum }) {
  const start = (pageNum - 1) * limitNum;
  const end = start + limitNum - 1;

  if (USE_SUPABASE) {
    let query = supabase
      .from(NEWS_TABLE)
      .select('*', { count: 'exact' });

    if (status === 'pending') query = query.in('status', PENDING_STATUSES);
    if (status && ['published', 'rejected'].includes(status)) query = query.eq('status', status);

    if (sector && VALID_SECTORS.includes(sector)) {
      const aliases = SECTOR_ALIASES[sector] || [sector];
      query = query.or(aliases.map(s => `sector.ilike.%${s}%`).join(','));
    }

    if (search) {
      query = query.or(
        `title.ilike.%${search}%,source.ilike.%${search}%,sector.ilike.%${search}%,url.ilike.%${search}%`
      );
    }

    const { data: news, error, count } = await query
      .order('created_at', { ascending: false })
      .range(start, end);

    const { data: allNews, error: allError } = await supabase
      .from(NEWS_TABLE)
      .select('id,status,sector,title,post,url,source,created_at,updated_at,date,image')
      .order('created_at', { ascending: false });

    if (isMissingTableError(error)) {
      return listNewsFromStore({ status, sector, search, pageNum, limitNum });
    }

    if (error) throw error;
    if (allError && !isMissingTableError(allError)) throw allError;

    const dashboardNews = (news || []).map(toDashboardNews);
    const dashboardAllNews = (allNews || []).map(toDashboardNews);

    const total = count || 0;

    return {
      news: dashboardNews,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
      counts: {
        pending: dashboardAllNews.filter(item => item.status === 'pending').length,
        published: dashboardAllNews.filter(item => item.status === 'published').length,
        rejected: dashboardAllNews.filter(item => item.status === 'rejected').length,
      },
      sectorCounts: Object.fromEntries(
        VALID_SECTORS.map(s => [
          s,
          dashboardAllNews.filter(item => item.category?.toLowerCase() === s).length,
        ])
      ),
    };
  }

  return listNewsFromStore({ status, sector, search, pageNum, limitNum });
}

export async function insertNews(item) {
  if (USE_SUPABASE) {
    const possibleDuplicates = await fetchNewsForDuplicateCheck();
    if (possibleDuplicates?.some(row => hasDuplicateKey(item, toDashboardNews(row)))) {
      throw Object.assign(new Error('duplicate'), { code: 'duplicate' });
    }

    const { error } = await supabase.from(NEWS_TABLE).insert(toSupabaseInsert(item));
    if (error) {
      if (error.code === '23505') throw Object.assign(new Error('duplicate'), { code: 'duplicate' });
      if (!isMissingTableError(error)) throw error;
    } else {
      notifyClients();
      return;
    }
  }
  const store = getStore();
  if (store.find(n => n.id === item.id || hasDuplicateKey(n, item))) throw Object.assign(new Error('duplicate'), { code: 'duplicate' });
  addToStore(item);
  notifyClients();
}

export async function findNews(id) {
  if (USE_SUPABASE) {
    const { data, error } = await supabase.from(NEWS_TABLE).select('*').eq('id', id).single();
    if (!error) return toDashboardNews(data);
    if (!isMissingTableError(error)) return null;
  }
  return getStore().find(n => n.id === id) || null;
}

export async function updateNews(id, updates) {
  if (USE_SUPABASE) {
    const { data, error } = await supabase.from(NEWS_TABLE).update(toSupabaseUpdates(updates)).eq('id', id).select().single();
    if (!error) return toDashboardNews(data);
    if (!isMissingTableError(error)) throw error;
  }
  const item = getStore().find(n => n.id === id);
  if (!item) return null;
  Object.assign(item, updates);
  return item;
}
